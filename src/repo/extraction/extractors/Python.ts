/**
 * Экстрактор для Python.
 *
 * Использует tree-sitter-python для парсинга и извлечения узлов, рёбер и неразрешённых ссылок.
 */

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

export class PythonExtractor extends ExtractorBase {
  public getLanguage(): Language {
    return 'python';
  }

  public getSupportedExtensions(): string[] {
    return ['.py', '.pyi'];
  }

  public extract(
    content: string,
    filePath: string,
    frameworkNames?: string[]
  ): IExtractionResult {
    const isDjango = frameworkNames?.includes('django') ?? false;
    const nodes: INode[] = [];
    const edges: IEdge[] = [];
    const unresolvedRefs: IUnresolvedReference[] = [];
    const errors: IExtractionError[] = [];
    // Измеряем время извлечения
    const start = Date.now();

    try {
      const parser = require('tree-sitter');
      const pyGrammar = require('tree-sitter-python');

      const p = new parser.Parser();
      p.setLanguage(pyGrammar);

      const tree = p.parse(content);
      if (!tree) {
        errors.push(this.createError(
          'Не удалось разобрать файл',
          filePath,
          'error',
          'PARSE_FAILED'
        ));
        return { nodes, edges, unresolvedReferences: unresolvedRefs, errors, durationMs: Date.now() - start };
      }

      const root = tree.rootNode;

      // Корневой узел — файл, а не модуль
      const moduleNode = this.createNode(
        filePath,
        NodeKind.File,
        filePath,
        1,
        content.split('\n').length,
        0,
        0
      );
      nodes.push(moduleNode);

      // Обработка узлов модуля
      this.processPyNodes(
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
        isDjango
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(this.createError(
        `Ошибка tree-sitter: ${message}`,
        filePath,
        'error',
        'TREE_SITTER_ERROR'
      ));
    }

    return { nodes, edges, unresolvedReferences: unresolvedRefs, errors, durationMs: Date.now() - start };
  }

  /** Обрабатывает узлы AST для Python. */
  protected processPyNodes(
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
    isDjango: boolean = false
  ): void {
    if (!node || node.isMissing || node.isError) return;

    switch (node.type) {
      case 'module':
        this.processModule(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, isDjango);
        break;

      case 'class_definition':
        this.processClassDefinition(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix, isDjango);
        break;

      case 'function_definition':
        this.processFunctionDefinition(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix, insideClass, isDjango);
        break;

      case 'decorated_definition':
        this.processDecoratedDefinition(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix, insideClass, isDjango);
        break;

      case 'assignment':
        this.processAssignment(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix, insideClass, isDjango);
        break;

      case 'import_statement':
        this.processImportStatement(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      case 'import_from_statement':
        this.processImportFromStatement(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      case 'try_statement':
        this.processTryStatement(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      case 'raise_statement':
        this.processRaiseStatement(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      case 'call':
        this.processCall(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, isDjango);
        break;

      default:
        // Рекурсивный обход дочерних узлов
        let child = node.firstChild;
        while (child) {
          this.processPyNodes(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix, insideClass, isDjango);
          child = child.nextSibling;
        }
    }
  }

  /** Обрабатывает модуль. */
  protected processModule(
    node: any,
    filePath: string,
    content: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    errors: IExtractionError[],
    isDjango: boolean = false
  ): void {
    let child = node.firstChild;
    while (child) {
      this.processPyNodes(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, '', false, isDjango);
      child = child.nextSibling;
    }
  }

  /** Обрабатывает определение класса. */
  protected processClassDefinition(
    node: any,
    filePath: string,
    content: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    errors: IExtractionError[],
    qualifiedNamePrefix: string,
    isDjango: boolean = false
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;

    const name = nameNode.text;
    const qualifiedName = qualifiedNamePrefix ? `${qualifiedNamePrefix}.${name}` : name;
    const decorators = this.extractDecorators(node, content);
    const docstring = this.extractDocstring(content, node.startPosition.row + 1);

    // Определение: Django view или обычный класс
    const isDjangoView = isDjango && this.isDjangoViewBaseClass(node);
    const isDjangoModel = isDjango && this.isDjangoModelClass(node);
    const kind = isDjangoView ? NodeKind.Component : NodeKind.Class;

    const classNode = this.createNode(
      filePath,
      kind,
      name,
      node.startPosition.row + 1,
      node.endPosition.row + 1,
      node.startPosition.column,
      node.endPosition.column,
      {
        qualifiedName,
        docstring,
        decorators,
      }
    );
    nodes.push(classNode);
    edges.push(this.createEdge(parentId, classNode.id, EdgeKind.Contains));

    // Обработка базовых классов
    const superclasses = node.childForFieldName('superclasses');
    if (superclasses) {
      let sc = superclasses.firstChild;
      while (sc) {
        const scText = sc.text;

        // Generic[T] — извлечение TypeParameter
        if (sc.type === 'subscript' && scText.startsWith('Generic[')) {
          const argsNode = sc.childForFieldName('value');
          if (argsNode) {
            let arg = argsNode.firstChild;
            while (arg) {
              const tpName = arg.text;
              const tpNode = this.createNode(
                filePath,
                NodeKind.Parameter,
                tpName,
                arg.startPosition.row + 1,
                arg.endPosition.row + 1,
                arg.startPosition.column,
                arg.endPosition.column
              );
              nodes.push(tpNode);
              edges.push(this.createEdge(classNode.id, tpNode.id, EdgeKind.Contains));
              arg = arg.nextSibling;
            }
          }
        }
        // Mixin — реализует
        else if (scText.includes('Mixin')) {
          edges.push(this.createEdge(classNode.id, this.nodeId(filePath, NodeKind.Class, scText, 0), EdgeKind.Implements, {
            metadata: { referenceName: scText },
            line: sc.startPosition.row + 1,
            column: sc.startPosition.column,
          }));
          unresolvedRefs.push(this.createUnresolvedRef(
            classNode.id,
            scText,
            EdgeKind.Implements,
            sc.startPosition.row + 1,
            sc.startPosition.column,
            filePath
          ));
        }
        // Обычное наследование — наследует
        else {
          edges.push(this.createEdge(classNode.id, this.nodeId(filePath, NodeKind.Class, scText, 0), EdgeKind.Extends, {
            metadata: { referenceName: scText },
            line: sc.startPosition.row + 1,
            column: sc.startPosition.column,
          }));
          unresolvedRefs.push(this.createUnresolvedRef(
            classNode.id,
            scText,
            EdgeKind.Extends,
            sc.startPosition.row + 1,
            sc.startPosition.column,
            filePath
          ));
        }

        sc = sc.nextSibling;
      }
    }

    // Обработка тела класса
    const body = node.childForFieldName('body');
    if (body) {
      let child = body.firstChild;
      while (child) {
        this.processPyNodes(child, filePath, content, classNode.id, nodes, edges, unresolvedRefs, errors, qualifiedName, true, isDjango);
        child = child.nextSibling;
      }
    }
  }

  /** Обрабатывает декорированное определение. */
  protected processDecoratedDefinition(
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
    isDjango: boolean = false
  ): void {
    // Получаем имя метода из внутреннего определения
    const inner = node.childForFieldName('definition');
    let methodName: string | undefined;
    if (inner) {
      const nameNode = inner.childForFieldName('name');
      if (nameNode) {
        methodName = nameNode.text;
      }
    }

    // Обработка декораторов
    let child = node.firstChild;
    while (child) {
      if (child.type === 'decorator') {
        const line = child.startPosition.row + 1;
        const decoratorText = child.text.slice(1); // Убираем @

        const decNode = this.createNode(
          filePath,
          NodeKind.Function,
          decoratorText,
          line,
          line,
          child.startPosition.column,
          child.endPosition.column
        );
        nodes.push(decNode);
        // Ребро Decorates от декоратора к декорируемой функции
        if (methodName) {
          const funcNodeId = this.nodeId(filePath, insideClass ? NodeKind.Method : NodeKind.Function, methodName, inner ? inner.startPosition.row + 1 : line);
          edges.push(this.createEdge(decNode.id, funcNodeId, EdgeKind.Decorates, {
            line,
            column: child.startPosition.column,
          }));
        }

        // @override — неразрешённая ссылка на метод родительского класса
        if (decoratorText === 'override' && methodName) {
          unresolvedRefs.push(this.createUnresolvedRef(
            parentId,
            methodName,
            EdgeKind.Overrides,
            line,
            child.startPosition.column,
            filePath
          ));
        }
      }
      child = child.nextSibling;
    }

    // Внутреннее определение
    if (inner) {
      this.processPyNodes(inner, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix, insideClass, isDjango);
    }
  }

  /** Обрабатывает определение функции/метода. */
  protected processFunctionDefinition(
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
    isDjango: boolean = false
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;

    const name = nameNode.text;
    const qualifiedName = qualifiedNamePrefix ? `${qualifiedNamePrefix}.${name}` : name;
    const decorators = this.extractDecorators(node, content);
    const docstring = this.extractDocstring(content, node.startPosition.row + 1);
    const signature = this.extractFunctionSignature(node, content);
    const isAsync = this.hasDecorator(node, 'async') || this.hasAsyncKeyword(node);

    // Определение: Property или Function/Method
    const isProperty = decorators.includes('property');
    const kind = isProperty
      ? NodeKind.Property
      : (insideClass ? NodeKind.Method : NodeKind.Function);

    const funcNode = this.createNode(
      filePath,
      kind,
      name,
      node.startPosition.row + 1,
      node.endPosition.row + 1,
      node.startPosition.column,
      node.endPosition.column,
      {
        qualifiedName,
        docstring,
        signature,
        isAsync,
        decorators,
      }
    );
    nodes.push(funcNode);
    edges.push(this.createEdge(parentId, funcNode.id, EdgeKind.Contains));

    // Ребро Returns от функции к типу возвращаемого значения
    const returnTypeNode = node.childForFieldName('return_type');
    if (returnTypeNode) {
      edges.push(this.createEdge(funcNode.id, this.nodeId(filePath, NodeKind.Variable, returnTypeNode.text, funcNode.startLine), EdgeKind.Returns, { line: funcNode.startLine }));
    }

    // Параметры
    const params = node.childForFieldName('parameters');
    if (params) {
      this.processParameters(params, filePath, content, funcNode.id, nodes, edges, unresolvedRefs, errors);
    }

    // Обработка тела функции для вызовов и ссылок
    const body = node.childForFieldName('body');
    if (body) {
      this.processFunctionBody(body, filePath, content, funcNode.id, nodes, edges, unresolvedRefs, errors, insideClass ? parentId : undefined, insideClass ? qualifiedNamePrefix : '', isDjango);
    }
  }

  /** Обрабатывает присваивание (переменная или поле). */
  protected processAssignment(
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
    isDjango: boolean = false
  ): void {
    const lhs = node.childForFieldName('left');
    if (!lhs) return;

    // self.field = value — поле экземпляра
    if (lhs.type === 'attribute') {
      const obj = lhs.childForFieldName('object');
      const attr = lhs.childForFieldName('attribute');
      if (obj && obj.text === 'self' && attr && attr.type === 'identifier') {
        const fieldName = attr.text;
        const qualifiedName = qualifiedNamePrefix ? `${qualifiedNamePrefix}.${fieldName}` : fieldName;

        const fieldNode = this.createNode(
          filePath,
          NodeKind.Field,
          fieldName,
          attr.startPosition.row + 1,
          attr.endPosition.row + 1,
          attr.startPosition.column,
          attr.endPosition.column,
          {
            qualifiedName,
          }
        );
        nodes.push(fieldNode);
        edges.push(this.createEdge(parentId, fieldNode.id, EdgeKind.Contains));
        return;
      }
    }

    // Обычное присваивание — поле или переменная
    let child = lhs.firstChild;
    while (child) {
      if (child.type === 'identifier') {
        const name = child.text;
        const qualifiedName = qualifiedNamePrefix ? `${qualifiedNamePrefix}.${name}` : name;
        // Константа: переменная с именем в UPPER_CASE на уровне модуля
        const kind = !insideClass && /^[A-Z][A-Z0-9_]*$/.test(name)
          ? NodeKind.Constant
          : (insideClass ? NodeKind.Field : NodeKind.Variable);

        // Django модельное поле — определение типа поля
        let fieldType: string | undefined;
        if (isDjango && insideClass) {
          const rhs = node.childForFieldName('right');
          if (rhs && rhs.type === 'call') {
            const func = rhs.childForFieldName('function');
            if (func && func.type === 'attribute') {
              const attr = func.childForFieldName('attribute');
              if (attr && this.isDjangoFieldType(attr.text)) {
                fieldType = func.text;
              }
            }
          }
        }

        const fieldOpts: Record<string, unknown> = {
          qualifiedName,
        };
        if (fieldType) {
          fieldOpts.fieldType = fieldType;
        }

        const varNode = this.createNode(
          filePath,
          kind,
          name,
          child.startPosition.row + 1,
          child.endPosition.row + 1,
          child.startPosition.column,
          child.endPosition.column,
          fieldOpts
        );
        nodes.push(varNode);
        edges.push(this.createEdge(parentId, varNode.id, EdgeKind.Contains));
      }
      child = child.nextSibling;
    }

    // Django — рекурсивная обработка дочерних узлов для маршрутов
    if (isDjango) {
      let c = node.firstChild;
      while (c) {
        this.processPyNodes(c, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix, insideClass, isDjango);
        c = c.nextSibling;
      }
    }
  }

  /** Обрабатывает import. */
  protected processImportStatement(
    node: any,
    filePath: string,
    content: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    errors: IExtractionError[]
  ): void {
    const line = node.startPosition.row + 1;
    const column = node.startPosition.column;

    // Извлечение имени модуля
    const nameNode = node.childForFieldName('name');
    const sourceText = nameNode ? nameNode.text : 'unknown';

    const importNode = this.createNode(
      filePath,
      NodeKind.Import,
      sourceText,
      line,
      line,
      column,
      node.endPosition.column
    );
    nodes.push(importNode);
    edges.push(this.createEdge(parentId, importNode.id, EdgeKind.Contains));
    // Ребро Imports от файла к узлу импорта
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

  /** Обрабатывает from ... import. */
  protected processImportFromStatement(
    node: any,
    filePath: string,
    content: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    errors: IExtractionError[]
  ): void {
    const line = node.startPosition.row + 1;
    const column = node.startPosition.column;

    const moduleNode = node.childForFieldName('module');
    const sourceText = moduleNode ? moduleNode.text : 'unknown';

    const importNode = this.createNode(
      filePath,
      NodeKind.Import,
      sourceText,
      line,
      line,
      column,
      node.endPosition.column
    );
    nodes.push(importNode);
    edges.push(this.createEdge(parentId, importNode.id, EdgeKind.Contains));
    // Ребро Imports от файла к узлу импорта
    edges.push(this.createEdge(parentId, importNode.id, EdgeKind.Imports));

    unresolvedRefs.push(this.createUnresolvedRef(
      importNode.id,
      sourceText,
      EdgeKind.Imports,
      line,
      column,
      filePath
    ));

    // Извлечение импортируемых имён
    const nameNode = node.childForFieldName('name');
    if (nameNode) {
      let child = nameNode.firstChild;
      while (child) {
        if (child.type === 'alias') {
          const imported = child.childForFieldName('name');
          if (imported) {
            const importedName = imported.text;
            edges.push(this.createEdge(importNode.id, this.nodeId(filePath, NodeKind.Import, importedName, line), EdgeKind.Exports, {
              metadata: { importedName },
              line,
              column,
            }));
          }
        } else if (child.type === 'identifier') {
          const importedName = child.text;
          edges.push(this.createEdge(importNode.id, this.nodeId(filePath, NodeKind.Import, importedName, line), EdgeKind.Exports, {
            metadata: { importedName },
            line,
            column,
          }));
        }
        child = child.nextSibling;
      }
    }
  }

  /** Обрабатывает try/catch. */
  protected processTryStatement(
    node: any,
    filePath: string,
    content: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    errors: IExtractionError[]
  ): void {
    const line = node.startPosition.row + 1;

    const tryNode = this.createNode(
      filePath,
      NodeKind.Function,
      'try',
      line,
      node.endPosition.row + 1,
      node.startPosition.column,
      node.endPosition.column
    );
    nodes.push(tryNode);
    edges.push(this.createEdge(parentId, tryNode.id, EdgeKind.Contains));

       // Обработка except
    let child = node.firstChild;
    while (child) {
      if (child.type === 'except_clause') {
        const catchNode = this.createNode(
          filePath,
          NodeKind.Function,
          'except',
          child.startPosition.row + 1,
          child.endPosition.row + 1,
          child.startPosition.column,
          child.endPosition.column
        );
        nodes.push(catchNode);
        edges.push(this.createEdge(tryNode.id, catchNode.id, EdgeKind.References));

        // Тип исключения
        const exceptionType = child.childForFieldName('type');
        if (exceptionType) {
          const excName = exceptionType.text;
          edges.push(this.createEdge(catchNode.id, this.nodeId(filePath, NodeKind.Class, excName, 0), EdgeKind.References, {
            metadata: { referenceName: excName },
            line: exceptionType.startPosition.row + 1,
            column: exceptionType.startPosition.column,
          }));
          unresolvedRefs.push(this.createUnresolvedRef(
            catchNode.id,
            excName,
            EdgeKind.References,
            exceptionType.startPosition.row + 1,
            exceptionType.startPosition.column,
            filePath
          ));
        }

        // Параметр исключения
        const excName = child.childForFieldName('name');
        if (excName) {
          const paramNode = this.createNode(
            filePath,
            NodeKind.Parameter,
            excName.text,
            excName.startPosition.row + 1,
            excName.endPosition.row + 1,
            excName.startPosition.column,
            excName.endPosition.column
          );
          nodes.push(paramNode);
          edges.push(this.createEdge(catchNode.id, paramNode.id, EdgeKind.Contains));
        }
      }
      child = child.nextSibling;
    }
  }

  /** Обрабатывает raise. */
  protected processRaiseStatement(
    node: any,
    filePath: string,
    content: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    errors: IExtractionError[]
  ): void {
    const line = node.startPosition.row + 1;

    const throwNode = this.createNode(
      filePath,
      NodeKind.Function,
      'raise',
      line,
      line,
      node.startPosition.column,
      node.endPosition.column
    );
    nodes.push(throwNode);
    edges.push(this.createEdge(parentId, throwNode.id, EdgeKind.Contains));

    const argumentNode = node.childForFieldName('error');
    if (argumentNode) {
      edges.push(this.createEdge(throwNode.id, parentId, EdgeKind.References, {
        metadata: { expression: argumentNode.text },
        line,
        column: argumentNode.startPosition.column,
      }));
    }
  }

  /** Обрабатывает вызов функции. */
protected processCall(
    node: any,
    filePath: string,
    content: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    errors: IExtractionError[],
    isDjango: boolean = false
  ): void {
    const funcNode = node.childForFieldName('function');
    if (!funcNode) return;

    const line = node.startPosition.row + 1;
    const column = node.startPosition.column;

    let funcName: string | undefined;
    if (funcNode.type === 'identifier') {
      funcName = funcNode.text;
    } else if (funcNode.type === 'attribute') {
      const attrName = funcNode.childForFieldName('attribute');
      if (attrName) {
        funcName = attrName.text;
      }
    }

    // Django маршруты — path() и re_path()
    if (isDjango && (funcName === 'path' || funcName === 're_path')) {
      this.processDjangoRoute(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
      return;
    }

        // TypeVar — параметр типа
    if (funcName === 'TypeVar') {
      const args = node.childForFieldName('arguments');
      if (args) {
        let arg = args.firstChild;
        while (arg) {
          if (arg.type === 'string') {
            const tpName = arg.text.replace(/['"]/g, '');
            const tpNode = this.createNode(
              filePath,
              NodeKind.Parameter,
              tpName,
              arg.startPosition.row + 1,
              arg.endPosition.row + 1,
              arg.startPosition.column,
              arg.endPosition.column
            );
            nodes.push(tpNode);
            edges.push(this.createEdge(parentId, tpNode.id, EdgeKind.Contains));
          }
          arg = arg.nextSibling;
        }
      }
      return;
    }

    if (funcName) {
      edges.push(this.createEdge(parentId, this.nodeId(filePath, NodeKind.Function, funcName, 0), EdgeKind.Calls, {
        metadata: { referenceName: funcName },
        line,
        column,
      }));
    }
  }

  /** Обрабатывает тело функции для вызовов и ссылок. */
  protected processFunctionBody(
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
    isDjango: boolean = false
  ): void {
    let child = node.firstChild;
    while (child) {
      if (child.type === 'call') {
        this.processCall(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, isDjango);
      } else if (child.type === 'raise_statement') {
        this.processRaiseStatement(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
      } else if (child.type === 'try_statement') {
        this.processTryStatement(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
      } else if (child.type === 'assignment' && classNodeId) {
        // self.field = value — извлечение поля экземпляра
        const lhs = child.childForFieldName('left');
        if (lhs && lhs.type === 'attribute') {
          const obj = lhs.childForFieldName('object');
          const attr = lhs.childForFieldName('attribute');
          if (obj && obj.text === 'self' && attr && attr.type === 'identifier') {
            const fieldName = attr.text;
            const qualifiedName = qualifiedNamePrefix ? `${qualifiedNamePrefix}.${fieldName}` : fieldName;

            const fieldNode = this.createNode(
              filePath,
              NodeKind.Field,
              fieldName,
              attr.startPosition.row + 1,
              attr.endPosition.row + 1,
              attr.startPosition.column,
              attr.endPosition.column,
              {
                qualifiedName,
              }
            );
            nodes.push(fieldNode);
            edges.push(this.createEdge(classNodeId, fieldNode.id, EdgeKind.Contains));
          }
        }
      } else if (child.type === 'if_statement' ||
                 child.type === 'for_statement' ||
                 child.type === 'while_statement' ||
                 child.type === 'with_statement') {
        // Рекурсия в управляющие конструкции
        let inner = child.firstChild;
        while (inner) {
          this.processFunctionBody(inner, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, classNodeId, qualifiedNamePrefix, isDjango);
          inner = inner.nextSibling;
        }
      }
      child = child.nextSibling;
    }
  }

  /** Обрабатывает параметры функции. */
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
        // Пропуск self и cls
        if (paramName !== 'self' && paramName !== 'cls') {
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
      } else if (child.type === 'parameter') {
        const nameNode = child.childForFieldName('name');
        if (nameNode && nameNode.type === 'identifier') {
          const paramName = nameNode.text;
          if (paramName !== 'self' && paramName !== 'cls') {
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
            // Ребро TypeOf от параметра к типу
            const typeNode = child.childForFieldName('type');
            if (typeNode) {
              edges.push(this.createEdge(paramNode.id, this.nodeId(filePath, NodeKind.Variable, typeNode.text, paramNode.startLine), EdgeKind.TypeOf, { line: paramNode.startLine }));
            }
          }
        }
      }
      child = child.nextSibling;
    }
  }

  /** Проверяет наличие декоратора. */
  protected hasDecorator(node: any, decoratorName: string): boolean {
    let child = node.firstChild;
    while (child) {
      if (child.type === 'decorator') {
        const decText = child.text.slice(1);
        if (decText === decoratorName) return true;
      }
      child = child.nextSibling;
    }
    return false;
  }

  /** Проверяет ключевое слово async. */
  protected hasAsyncKeyword(node: any): boolean {
    let child = node.firstChild;
    while (child) {
      if (child.type === 'async_statement') {
        return true;
      }
      child = child.nextSibling;
    }
    return false;
  }

  /** Извлекает декораторы перед узлом. */
  protected extractDecorators(node: any, content: string): string[] {
    const decorators: string[] = [];
    const lineIdx = node.startPosition.row - 1;
    const lines = content.split('\n');

    if (lineIdx < 0) return decorators;

    let i = lineIdx;
    while (i >= 0) {
      const line = lines[i]?.trim();
      if (!line) break;
      if (line.startsWith('@')) {
        decorators.unshift(line.slice(1).trim());
      } else {
        break;
      }
      i--;
    }

    return decorators;
  }

  /** Извлекает сигнатуру функции. */
  protected extractFunctionSignature(node: any, content: string): string | undefined {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return undefined;

    const paramsNode = node.childForFieldName('parameters');
    const returnType = this.extractReturnType(node);

    let params = '';
    if (paramsNode) {
      const start = paramsNode.startPosition;
      const end = paramsNode.endPosition;
      if (start.row === end.row) {
        const line = content.split('\n')[start.row];
        params = line.substring(start.column, end.column + 1);
      }
    }

    const name = nameNode.text;
    const sig = `${name}(${params})`;
    return returnType ? `${sig} -> ${returnType}` : sig;
  }

  /** Извлекает тип возвращаемого значения. */
  protected extractReturnType(node: any): string | undefined {
    const retType = node.childForFieldName('return_type');
    if (retType) {
      return retType.text;
    }
    return undefined;
  }

  /** Проверяет, является ли класс базовым классом Django view. */
  protected isDjangoViewBaseClass(node: any): boolean {
    const superclasses = node.childForFieldName('superclasses');
    if (!superclasses) return false;

    const viewBases = new Set([
      'View', 'APIView', 'ViewSet', 'ListView', 'DetailView',
      'CreateView', 'UpdateView', 'DeleteView', 'TemplateView',
      'RedirectView', 'GenericAPIView', 'ModelViewSet', 'ReadOnlyModelViewSet'
    ]);

    let sc = superclasses.firstChild;
    while (sc) {
      const scText = sc.text;
      const baseName = this.extractBaseName(scText);
      if (viewBases.has(baseName)) return true;
      sc = sc.nextSibling;
    }
    return false;
  }

  /** Проверяет, является ли класс Django моделью. */
  protected isDjangoModelClass(node: any): boolean {
    const superclasses = node.childForFieldName('superclasses');
    if (!superclasses) return false;

    let sc = superclasses.firstChild;
    while (sc) {
      const scText = sc.text;
      if (scText === 'models.Model') return true;
      sc = sc.nextSibling;
    }
    return false;
  }

  /** Проверяет, является ли имя типом Django поля. */
  protected isDjangoFieldType(name: string): boolean {
    const fieldTypes = new Set([
      'CharField', 'TextField', 'IntegerField', 'BooleanField',
      'DateTimeField', 'DateField', 'TimeField', 'FloatField',
      'DecimalField', 'EmailField', 'URLField', 'FileField',
      'ImageField', 'ForeignKey', 'OneToOneField', 'ManyToManyField',
      'JSONField', 'UUIDField', 'SlugField', 'PositiveIntegerField',
      'PositiveSmallIntegerField', 'SmallIntegerField', 'BinaryField',
      'NullBooleanField', 'AutoField', 'BigAutoField', 'DurationField'
    ]);
    return fieldTypes.has(name);
  }

  /** Извлекает имя базового класса из текста. */
  protected extractBaseName(scText: string): string {
    // Убираем путь модуля, например 'django.views.generic.base.View' -> 'View'
    const dotIdx = scText.lastIndexOf('.');
    if (dotIdx !== -1) {
      return scText.slice(dotIdx + 1);
    }
    return scText;
  }

  /** Обрабатывает Django маршрут — path() или re_path(). */
  protected processDjangoRoute(
    node: any,
    filePath: string,
    content: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    errors: IExtractionError[]
  ): void {
    const args = node.childForFieldName('arguments');
    if (!args) return;

    const line = node.startPosition.row + 1;
    const column = node.startPosition.column;

    // Первый аргумент — URL-паттерн
    const firstArg = args.firstChild;
    if (!firstArg) return;

    const urlPattern = firstArg.text;
    const routeName = `route:${urlPattern}`;

    const routeNode = this.createNode(
      filePath,
      NodeKind.Route,
      routeName,
      node.startPosition.row + 1,
      node.endPosition.row + 1,
      node.startPosition.column,
      node.endPosition.column
    );
    nodes.push(routeNode);
    edges.push(this.createEdge(parentId, routeNode.id, EdgeKind.Contains));

    // Второй аргумент — ссылка на view
    const secondArg = firstArg.nextSibling;
    if (secondArg) {
      const viewRef = secondArg.text;
      edges.push(this.createEdge(routeNode.id, this.nodeId(filePath, NodeKind.Component, viewRef, 0), EdgeKind.Calls, {
        metadata: { referenceName: viewRef },
        line,
        column,
      }));
      unresolvedRefs.push(this.createUnresolvedRef(
        routeNode.id,
        viewRef,
        EdgeKind.Calls,
        line,
        column,
        filePath
      ));
    }
  }
}
