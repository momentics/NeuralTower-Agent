/**
 * Экстрактор для Ruby.
 *
 * Парсинг через WASM-грамматики web-tree-sitter (WasmRuntime).
 * Извлечение узлов, рёбер и неразрешённых ссылок.
 */

import { getParserForFile } from '../WasmRuntime';
import {
  INode,
  IEdge,
  IUnresolvedReference,
  IExtractionResult,
  IExtractionError,
  NodeKind,
  EdgeKind,
  Language,
} from '../../ntgraph/Types';
import { ExtractorBase } from '../ExtractorBase';

export class RubyExtractor extends ExtractorBase {
  public getLanguage(): Language {
    return 'ruby';
  }

  public getSupportedExtensions(): string[] {
    return ['.rb'];
  }

  public extract(
    content: string,
    filePath: string,
    frameworkNames?: string[]
  ): IExtractionResult {
    const isRails = frameworkNames?.includes('rails') ?? false;
    const nodes: INode[] = [];
    const edges: IEdge[] = [];
    const unresolvedRefs: IUnresolvedReference[] = [];
    const errors: IExtractionError[] = [];
    const start = Date.now();

    try {
      const p = getParserForFile('ruby', filePath);
      if (!p) {
        errors.push(this.createError(
          'WASM-грамматика ruby не загружена',
          filePath,
          'error',
          'parse_error'
        ));
        return { nodes, edges, unresolvedReferences: unresolvedRefs, errors, durationMs: Date.now() - start };
      }

      const tree = p.parse(content);
      if (!tree) {
        errors.push(this.createError(
          'Не удалось разобрать файл',
          filePath,
          'error',
          'parse_error'
        ));
        return { nodes, edges, unresolvedReferences: unresolvedRefs, errors, durationMs: Date.now() - start };
      }

      const root = tree.rootNode;
      const totalLines = content.split('\n').length;

      // Узел файла
      const fileNode = this.createNode(
        filePath,
        NodeKind.File,
        filePath,
        1,
        totalLines,
        0,
        0
      );
      nodes.push(fileNode);

      // Узел модуля
      const moduleName = filePath.replace(/.*[/\\]/, '').replace(/\.[^.]+$/, '');
      const moduleNode = this.createNode(
        filePath,
        NodeKind.Module,
        moduleName,
        1,
        totalLines,
        0,
        0,
        { filePath }
      );
      nodes.push(moduleNode);
      edges.push(this.createEdge(fileNode.id, moduleNode.id, EdgeKind.Contains));

      // Обработка узлов программы
      this.processRubyNodes(
        root,
        filePath,
        content,
        moduleNode.id,
        nodes,
        edges,
        unresolvedRefs,
        errors,
        '',
        false,
        isRails
      );
      tree.delete();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(this.createError(
        `Ошибка tree-sitter: ${message}`,
        filePath,
        'error',
        'parse_error'
      ));
    }

    return { nodes, edges, unresolvedReferences: unresolvedRefs, errors, durationMs: Date.now() - start };
  }

  /** Обрабатывает узлы AST для Ruby. */
  protected processRubyNodes(
    node: any,
    filePath: string,
    content: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    errors: IExtractionError[],
    qualifiedNamePrefix: string = '',
    insideClass: boolean = false,
    isRails: boolean = false
  ): void {
    if (!node || node.isMissing || node.isError) return;

    switch (node.type) {
      case 'program':
        this.processProgram(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, isRails);
        break;

      case 'class':
        this.processClass(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix, isRails);
        break;

      case 'module':
        this.processModule(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'method':
        this.processMethod(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix, insideClass, isRails);
        break;

      case 'singleton_method':
        this.processSingletonMethod(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix, isRails);
        break;

      case 'constant':
        this.processConstant(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix, insideClass);
        break;

      case 'instance_variable':
        this.processInstanceVariable(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'call':
        this.processCall(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, insideClass, qualifiedNamePrefix, isRails);
        break;

      case 'binary':
        this.processBinary(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix, insideClass);
        break;

      default:
        // Рекурсивный обход дочерних узлов
        let child = node.firstChild;
        while (child) {
          this.processRubyNodes(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix, insideClass, isRails);
          child = child.nextSibling;
        }
    }
  }

  /** Обрабатывает программу. */
  protected processProgram(
    node: any,
    filePath: string,
    content: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    errors: IExtractionError[],
    isRails: boolean = false
  ): void {
    let child = node.firstChild;
    while (child) {
      this.processRubyNodes(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, '', false, isRails);
      child = child.nextSibling;
    }
  }

  /** Обрабатывает определение класса. */
  protected processClass(
    node: any,
    filePath: string,
    content: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    errors: IExtractionError[],
    qualifiedNamePrefix: string,
    isRails: boolean = false
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;

    const name = nameNode.text;
    const qualifiedName = qualifiedNamePrefix ? `${qualifiedNamePrefix}.${name}` : name;
    const docstring = this.extractDocstring(content, node.startPosition.row + 1);

    const classNode = this.createNode(
      filePath,
      NodeKind.Class,
      name,
      node.startPosition.row + 1,
      node.endPosition.row + 1,
      node.startPosition.column,
      node.endPosition.column,
      {
        qualifiedName,
        docstring,
      }
    );
    nodes.push(classNode);
    edges.push(this.createEdge(parentId, classNode.id, EdgeKind.Contains));

    // Наследование
    const superClass = node.childForFieldName('superclass');
    if (superClass) {
      const superName = superClass.text;
      edges.push(this.createEdge(classNode.id, this.nodeId(filePath, NodeKind.Class, superName, 0), EdgeKind.Extends, {
        metadata: { referenceName: superName },
        line: superClass.startPosition.row + 1,
        column: superClass.startPosition.column,
      }));
      unresolvedRefs.push(this.createUnresolvedRef(
        classNode.id,
        superName,
        EdgeKind.Extends,
        superClass.startPosition.row + 1,
        superClass.startPosition.column,
        filePath
      ));
    }

    // Обработка тела класса
    const body = node.childForFieldName('body');
    if (body) {
      let child = body.firstChild;
      while (child) {
        this.processRubyNodes(child, filePath, content, classNode.id, nodes, edges, unresolvedRefs, errors, qualifiedName, true, isRails);
        child = child.nextSibling;
      }
    }
  }

  /** Обрабатывает определение модуля. */
  protected processModule(
    node: any,
    filePath: string,
    content: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    errors: IExtractionError[],
    qualifiedNamePrefix: string
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;

    const name = nameNode.text;
    const qualifiedName = qualifiedNamePrefix ? `${qualifiedNamePrefix}.${name}` : name;
    const docstring = this.extractDocstring(content, node.startPosition.row + 1);

    const moduleNode = this.createNode(
      filePath,
      NodeKind.Module,
      name,
      node.startPosition.row + 1,
      node.endPosition.row + 1,
      node.startPosition.column,
      node.endPosition.column,
      {
        qualifiedName,
        docstring,
      }
    );
    nodes.push(moduleNode);
    edges.push(this.createEdge(parentId, moduleNode.id, EdgeKind.Contains));

    // Обработка тела модуля
    const body = node.childForFieldName('body');
    if (body) {
      let child = body.firstChild;
      while (child) {
        this.processRubyNodes(child, filePath, content, moduleNode.id, nodes, edges, unresolvedRefs, errors, qualifiedName, false);
        child = child.nextSibling;
      }
    }
  }

  /** Обрабатывает определение метода. */
  protected processMethod(
    node: any,
    filePath: string,
    content: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    errors: IExtractionError[],
    qualifiedNamePrefix: string,
    insideClass: boolean,
    isRails: boolean = false
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;

    const name = nameNode.text;
    const qualifiedName = qualifiedNamePrefix ? `${qualifiedNamePrefix}.${name}` : name;
    const docstring = this.extractDocstring(content, node.startPosition.row + 1);
    const signature = this.extractMethodSignature(node, content);

    const isStatic = name.startsWith('self.');
    const methodName = isStatic ? name.slice(5) : name;

    const methodNode = this.createNode(
      filePath,
      NodeKind.Method,
      methodName,
      node.startPosition.row + 1,
      node.endPosition.row + 1,
      node.startPosition.column,
      node.endPosition.column,
      {
        qualifiedName: isStatic ? `${qualifiedNamePrefix}.${methodName}` : qualifiedName,
        docstring,
        signature,
        isStatic,
        visibility: this.extractVisibility(node, content),
      }
    );
    nodes.push(methodNode);
    edges.push(this.createEdge(parentId, methodNode.id, EdgeKind.Contains));

    // Параметры
    const params = node.childForFieldName('parameters');
    if (params) {
      this.processParameters(params, filePath, content, methodNode.id, nodes, edges, unresolvedRefs, errors);
    }

    // Обработка тела метода для вызовов
    const body = node.childForFieldName('body');
    if (body) {
      this.processMethodBody(body, filePath, content, methodNode.id, nodes, edges, unresolvedRefs, errors, insideClass ? parentId : undefined, qualifiedNamePrefix, isRails);
    }
  }

  /** Обрабатывает определение одиночного метода (def self.method). */
  protected processSingletonMethod(
    node: any,
    filePath: string,
    content: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    errors: IExtractionError[],
    qualifiedNamePrefix: string,
    isRails: boolean = false
  ): void {
    const nameNode = node.childForFieldName('method_name');
    if (!nameNode) return;

    const name = nameNode.text;
    const qualifiedName = qualifiedNamePrefix ? `${qualifiedNamePrefix}.${name}` : name;
    const docstring = this.extractDocstring(content, node.startPosition.row + 1);
    const signature = this.extractMethodSignature(node, content);

    const methodNode = this.createNode(
      filePath,
      NodeKind.Method,
      name,
      node.startPosition.row + 1,
      node.endPosition.row + 1,
      node.startPosition.column,
      node.endPosition.column,
      {
        qualifiedName,
        docstring,
        signature,
        isStatic: true,
      }
    );
    nodes.push(methodNode);
    edges.push(this.createEdge(parentId, methodNode.id, EdgeKind.Contains));

    // Параметры
    const params = node.childForFieldName('parameters');
    if (params) {
      this.processParameters(params, filePath, content, methodNode.id, nodes, edges, unresolvedRefs, errors);
    }

    // Обработка тела метода
    const body = node.childForFieldName('body');
    if (body) {
      this.processMethodBody(body, filePath, content, methodNode.id, nodes, edges, unresolvedRefs, errors, parentId, qualifiedNamePrefix, isRails);
    }
  }

  /** Обрабатывает константу. */
  protected processConstant(
    node: any,
    filePath: string,
    content: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    errors: IExtractionError[],
    qualifiedNamePrefix: string,
    insideClass: boolean
  ): void {
    const name = node.text;
    const qualifiedName = qualifiedNamePrefix ? `${qualifiedNamePrefix}.${name}` : name;

    const constNode = this.createNode(
      filePath,
      NodeKind.Constant,
      name,
      node.startPosition.row + 1,
      node.endPosition.row + 1,
      node.startPosition.column,
      node.endPosition.column,
      {
        qualifiedName,
      }
    );
    nodes.push(constNode);
    edges.push(this.createEdge(parentId, constNode.id, EdgeKind.Contains));
  }

  /** Обрабатывает переменную экземпляра. */
  protected processInstanceVariable(
    node: any,
    filePath: string,
    content: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    errors: IExtractionError[],
    qualifiedNamePrefix: string
  ): void {
    const name = node.text;
    const qualifiedName = qualifiedNamePrefix ? `${qualifiedNamePrefix}.${name}` : name;

    const fieldNode = this.createNode(
      filePath,
      NodeKind.Field,
      name,
      node.startPosition.row + 1,
      node.endPosition.row + 1,
      node.startPosition.column,
      node.endPosition.column,
      {
        qualifiedName,
      }
    );
    nodes.push(fieldNode);
    edges.push(this.createEdge(parentId, fieldNode.id, EdgeKind.Contains));
  }

  /** Обрабатывает вызов метода. */
  protected processCall(
    node: any,
    filePath: string,
    content: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    errors: IExtractionError[],
    insideClass: boolean,
    qualifiedNamePrefix: string = '',
    isRails: boolean = false
  ): void {
    const methodNameNode = node.childForFieldName('method');
    if (!methodNameNode) return;

    const methodName = methodNameNode.text;
    const line = node.startPosition.row + 1;
    const column = node.startPosition.column;

    // include — реализует модуль
    if (methodName === 'include') {
      const args = node.childForFieldName('arguments');
      if (args) {
        let arg = args.firstChild;
        while (arg) {
          if (arg.type === 'constant') {
            const modName = arg.text;
            edges.push(this.createEdge(parentId, this.nodeId(filePath, NodeKind.Module, modName, 0), EdgeKind.Implements, {
              metadata: { referenceName: modName },
              line: arg.startPosition.row + 1,
              column: arg.startPosition.column,
            }));
            unresolvedRefs.push(this.createUnresolvedRef(
              parentId,
              modName,
              EdgeKind.Implements,
              arg.startPosition.row + 1,
              arg.startPosition.column,
              filePath
            ));
          }
          arg = arg.nextSibling;
        }
      }
      return;
    }

    // extend — расширяет класс
    if (methodName === 'extend') {
      const args = node.childForFieldName('arguments');
      if (args) {
        let arg = args.firstChild;
        while (arg) {
          if (arg.type === 'constant') {
            const modName = arg.text;
            edges.push(this.createEdge(parentId, this.nodeId(filePath, NodeKind.Module, modName, 0), EdgeKind.Implements, {
              metadata: { referenceName: modName },
              line: arg.startPosition.row + 1,
              column: arg.startPosition.column,
            }));
            unresolvedRefs.push(this.createUnresolvedRef(
              parentId,
              modName,
              EdgeKind.Implements,
              arg.startPosition.row + 1,
              arg.startPosition.column,
              filePath
            ));
          }
          arg = arg.nextSibling;
        }
      }
      return;
    }

    // require / require_relative — импорт
    if (methodName === 'require' || methodName === 'require_relative') {
      const args = node.childForFieldName('arguments');
      if (args) {
        const arg = args.firstChild;
        if (arg && arg.type === 'string') {
          const sourceText = arg.text.replace(/['"]/g, '');
          const importNode = this.createNode(
            filePath,
            NodeKind.Import,
            sourceText,
            line,
            line,
            column,
            arg.endPosition.column
          );
          nodes.push(importNode);
          edges.push(this.createEdge(parentId, importNode.id, EdgeKind.Contains));
          edges.push(this.createEdge(parentId, importNode.id, EdgeKind.Imports));
          unresolvedRefs.push(this.createUnresolvedRef(
            importNode.id,
            sourceText,
            EdgeKind.Imports,
            line,
            column,
            filePath
          ));
        }
      }
      return;
    }

    // attr_reader, attr_writer, attr_accessor — определение полей
    if (methodName === 'attr_reader' || methodName === 'attr_writer' || methodName === 'attr_accessor') {
      const args = node.childForFieldName('arguments');
      if (args) {
        let arg = args.firstChild;
        while (arg) {
          if (arg.type === 'symbol') {
            const attrName = arg.text.replace(/^:/, '');
            const attrQualifiedName = qualifiedNamePrefix ? `${qualifiedNamePrefix}.${attrName}` : attrName;
            const attrNode = this.createNode(
              filePath,
              NodeKind.Property,
              attrName,
              arg.startPosition.row + 1,
              arg.endPosition.row + 1,
              arg.startPosition.column,
              arg.endPosition.column,
              {
                qualifiedName: attrQualifiedName,
              }
            );
            nodes.push(attrNode);
            edges.push(this.createEdge(parentId, attrNode.id, EdgeKind.Contains));
          }
          arg = arg.nextSibling;
        }
      }
      return;
    }

    // Rails маршруты — get, post, put, patch, delete
    if (isRails && ['get', 'post', 'put', 'patch', 'delete'].includes(methodName)) {
      this.processRailsRoute(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
      return;
    }

    // Обычный вызов метода
    const isConstructor = /^[A-Z]/.test(methodName);
    const edgeKind = isConstructor ? EdgeKind.Instantiates : EdgeKind.Calls;

    edges.push(this.createEdge(parentId, this.nodeId(filePath, NodeKind.Method, methodName, 0), edgeKind, {
      metadata: { referenceName: methodName },
      line,
      column,
    }));
    unresolvedRefs.push(this.createUnresolvedRef(
      parentId,
      methodName,
      edgeKind,
      line,
      column,
      filePath
    ));
  }

  /** Обрабатывает бинарную операцию (для присваивания переменных экземпляра). */
  protected processBinary(
    node: any,
    filePath: string,
    content: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    errors: IExtractionError[],
    qualifiedNamePrefix: string,
    insideClass: boolean
  ): void {
    const operator = node.childForFieldName('operator');
    if (!operator) return;

    // Присваивание @ivar = value
    if (operator.text === '=') {
      const left = node.childForFieldName('left');
      if (left && left.type === 'instance_variable') {
        const name = left.text;
        const qualifiedName = qualifiedNamePrefix ? `${qualifiedNamePrefix}.${name}` : name;

        const fieldNode = this.createNode(
          filePath,
          NodeKind.Field,
          name,
          left.startPosition.row + 1,
          left.endPosition.row + 1,
          left.startPosition.column,
          left.endPosition.column,
          {
            qualifiedName,
          }
        );
        nodes.push(fieldNode);
        edges.push(this.createEdge(parentId, fieldNode.id, EdgeKind.Contains));
      }
    }
  }

  /** Обрабатывает тело метода для вызовов и ссылок. */
  protected processMethodBody(
    node: any,
    filePath: string,
    content: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    errors: IExtractionError[],
    classNodeId: string | undefined = undefined,
    qualifiedNamePrefix: string = '',
    isRails: boolean = false
  ): void {
    let child = node.firstChild;
    while (child) {
      if (child.type === 'call') {
        this.processCall(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, classNodeId !== undefined, qualifiedNamePrefix, isRails);
      } else if (child.type === 'binary') {
        this.processBinary(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix, classNodeId !== undefined);
      } else if (child.type === 'if' ||
                 child.type === 'unless' ||
                 child.type === 'case' ||
                 child.type === 'while' ||
                 child.type === 'until' ||
                 child.type === 'for' ||
                 child.type === 'begin') {
        // Рекурсия в управляющие конструкции
        let inner = child.firstChild;
        while (inner) {
          this.processMethodBody(inner, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, classNodeId, qualifiedNamePrefix, isRails);
          inner = inner.nextSibling;
        }
      } else if (child.type === 'rescue') {
        this.processRescue(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
      } else if (child.type === 'instance_variable' || child.type === 'constant') {
        this.processRubyNodes(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix, classNodeId !== undefined);
      }
      child = child.nextSibling;
    }
  }

  /** Обрабатывает rescue блок. */
  protected processRescue(
    node: any,
    filePath: string,
    content: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    errors: IExtractionError[],
    qualifiedNamePrefix: string = ''
  ): void {
    const rescueBody = node.childForFieldName('body');
    if (rescueBody) {
      let child = rescueBody.firstChild;
      while (child) {
        if (child.type === 'call') {
          this.processCall(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, false, qualifiedNamePrefix);
        }
        child = child.nextSibling;
      }
    }
  }

  /** Обрабатывает Rails маршрут. */
  protected processRailsRoute(
    node: any,
    filePath: string,
    content: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    errors: IExtractionError[]
  ): void {
    const methodNameNode = node.childForFieldName('method');
    if (!methodNameNode) return;

    const method = methodNameNode.text;
    const args = node.childForFieldName('arguments');
    if (!args) return;

    const line = node.startPosition.row + 1;
    const column = node.startPosition.column;

    // Первый аргумент — путь
    const firstArg = args.firstChild;
    if (!firstArg) return;

    const routePath = firstArg.type === 'string' ? firstArg.text.replace(/['"]/g, '') : firstArg.text;
    const routeName = `route:${method.toUpperCase()}:${routePath}`;

    const routeNode = this.createNode(
      filePath,
      NodeKind.Route,
      routeName,
      node.startPosition.row + 1,
      node.endPosition.row + 1,
      node.startPosition.column,
      node.endPosition.column,
      {
        method: method.toUpperCase(),
        path: routePath,
      }
    );
    nodes.push(routeNode);
    edges.push(this.createEdge(parentId, routeNode.id, EdgeKind.Contains));

    // Ищем параметр to: для определения контроллера/экшена
    let arg = args.firstChild;
    while (arg) {
      if (arg.type === 'pair') {
        const key = arg.childForFieldName('key');
        const value = arg.childForFieldName('value');
        if (key && key.text === ':to' && value) {
          const handlerRef = value.text.replace(/['"]/g, '');
          edges.push(this.createEdge(routeNode.id, this.nodeId(filePath, NodeKind.Method, handlerRef, 0), EdgeKind.Calls, {
            metadata: { referenceName: handlerRef },
            line,
            column,
          }));
          unresolvedRefs.push(this.createUnresolvedRef(
            routeNode.id,
            handlerRef,
            EdgeKind.Calls,
            line,
            column,
            filePath
          ));
        }
      }
    }
  }

  /** Обрабатывает параметры метода. */
  protected processParameters(
    node: any,
    filePath: string,
    content: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    errors: IExtractionError[]
  ): void {
    let child = node.firstChild;
    while (child) {
      if (child.type === 'identifier') {
        const paramName = child.text;
        const paramNode = this.createNode(
          filePath,
          NodeKind.Parameter,
          paramName,
          child.startPosition.row + 1,
          child.endPosition.row + 1,
          child.startPosition.column,
          child.endPosition.column
        );
        nodes.push(paramNode);
        edges.push(this.createEdge(parentId, paramNode.id, EdgeKind.Contains));
      } else if (child.type === 'required_parameter') {
        const nameNode = child.childForFieldName('name');
        if (nameNode) {
          const paramName = nameNode.text;
          const paramNode = this.createNode(
            filePath,
            NodeKind.Parameter,
            paramName,
            child.startPosition.row + 1,
            child.endPosition.row + 1,
            child.startPosition.column,
            child.endPosition.column
          );
          nodes.push(paramNode);
          edges.push(this.createEdge(parentId, paramNode.id, EdgeKind.Contains));
        }
      } else if (child.type === 'optional_parameter') {
        const nameNode = child.childForFieldName('name');
        if (nameNode) {
          const paramName = nameNode.text;
          const paramNode = this.createNode(
            filePath,
            NodeKind.Parameter,
            paramName,
            child.startPosition.row + 1,
            child.endPosition.row + 1,
            child.startPosition.column,
            child.endPosition.column
          );
          nodes.push(paramNode);
          edges.push(this.createEdge(parentId, paramNode.id, EdgeKind.Contains));
        }
      } else if (child.type === 'rest_parameter') {
        const nameNode = child.childForFieldName('name');
        if (nameNode) {
          const paramName = nameNode.text;
          const paramNode = this.createNode(
            filePath,
            NodeKind.Parameter,
            paramName,
            child.startPosition.row + 1,
            child.endPosition.row + 1,
            child.startPosition.column,
            child.endPosition.column
          );
          nodes.push(paramNode);
          edges.push(this.createEdge(parentId, paramNode.id, EdgeKind.Contains));
        }
      }
      child = child.nextSibling;
    }
  }

  /** Извлекает сигнатуру метода. */
  protected extractMethodSignature(node: any, content: string): string | undefined {
    const nameNode = node.childForFieldName('name') || node.childForFieldName('method_name');
    if (!nameNode) return undefined;

    const paramsNode = node.childForFieldName('parameters');

    let params = '';
    if (paramsNode) {
      const start = paramsNode.startPosition;
      const end = paramsNode.endPosition;
      if (start.row === end.row) {
        const line = content.split('\n')[start.row];
        params = line.substring(start.column, end.column + 1);
      }
    }

    return `${nameNode.text}(${params})`;
  }

  /** Извлекает видимость метода из комментариев. */
  protected extractVisibility(node: any, content: string): 'public' | 'private' | 'protected' | undefined {
    const lineIdx = node.startPosition.row - 1;
    const lines = content.split('\n');

    if (lineIdx < 0) return undefined;

    const line = lines[lineIdx]?.trim();
    if (line === 'private') return 'private';
    if (line === 'protected') return 'protected';
    if (line === 'public') return 'public';

    return undefined;
  }
}
