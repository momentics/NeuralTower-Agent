/**
 * Экстрактор для Java.
 *
 * Использует tree-sitter-java для парсинга и извлечения узлов, рёбер и неразрешённых ссылок.
 */

import {
  INode,
  IEdge,
  IUnresolvedReference,
  IExtractionResult,
  IExtractionError,
  NodeKind,
  EdgeKind,
} from '../../ntgraph/Types';
import { ExtractorBase } from '../ExtractorBase';

export class JavaExtractor extends ExtractorBase {
  public getLanguage(): string {
    return 'java';
  }

  public getSupportedExtensions(): string[] {
    return ['.java'];
  }

  public extract(
    filePath: string,
    content: string,
    _frameworkNames?: string[]
  ): IExtractionResult {
    const nodes: INode[] = [];
    const edges: IEdge[] = [];
    const unresolvedRefs: IUnresolvedReference[] = [];
    const errors: IExtractionError[] = [];

    try {
      const parser = require('tree-sitter');
      const javaGrammar = require('tree-sitter-java');

      const p = new parser.Parser();
      p.setLanguage(javaGrammar);

      const tree = p.parse(content);
      if (!tree) {
        errors.push(this.createError(
          'Не удалось разобрать файл',
          filePath,
          'error',
          'PARSE_FAILED'
        ));
        return { nodes, edges, unresolvedRefs, errors, durationMs: 0 };
      }

      const root = tree.rootNode;

      // Узел модуля
      const moduleNode = this.createNode(
        filePath,
        NodeKind.Module,
        filePath,
        1,
        content.split('\n').length,
        0,
        0
      );
      nodes.push(moduleNode);

      // Обработка объявлений верхнего уровня
      this.processJavaNodes(
        root,
        filePath,
        content,
        moduleNode.id,
        nodes,
        edges,
        unresolvedRefs,
        errors
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

    return { nodes, edges, unresolvedRefs, errors, durationMs: 0 };
  }

  /** Обрабатывает узлы AST для Java. */
  protected processJavaNodes(
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
    if (!node || node.isMissing || node.isError) return;

    switch (node.type) {
      case 'program':
        this.processProgram(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      case 'package_declaration':
        this.processPackageDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      case 'import_declaration':
        this.processImportDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      case 'class_declaration':
        this.processClassDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'interface_declaration':
        this.processInterfaceDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'enum_declaration':
        this.processEnumDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'method_declaration':
        this.processMethodDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'constructor_declaration':
        this.processConstructorDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'field_declaration':
        this.processFieldDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'local_variable_declaration':
        this.processLocalVariableDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'try_statement':
        this.processTryStatement(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      case 'catch_clause':
        this.processCatchClause(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      case 'throw_statement':
        this.processThrowStatement(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      case 'annotation':
        this.processAnnotation(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      case 'type_parameter':
        this.processTypeParameter(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      case 'type_argument':
        this.processTypeArgument(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      default:
        // Рекурсия по дочерним узлам
        let child = node.firstChild;
        while (child) {
          this.processJavaNodes(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
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
    errors: IExtractionError[]
  ): void {
    let child = node.firstChild;
    while (child) {
      this.processJavaNodes(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
      child = child.nextSibling;
    }
  }

  /** Обрабатывает объявление пакета (Namespace). */
  protected processPackageDeclaration(
    node: any,
    filePath: string,
    content: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    errors: IExtractionError[]
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;

    const name = nameNode.text;
    const docstring = this.extractDocstring(content, node.startPosition.row + 1);

    const nsNode = this.createNode(
      filePath,
      NodeKind.Namespace,
      name,
      node.startPosition.row + 1,
      node.endPosition.row + 1,
      node.startPosition.column,
      node.endPosition.column,
      {
        qualifiedName: name,
        docstring,
      }
    );
    nodes.push(nsNode);
    edges.push(this.createEdge(parentId, nsNode.id, EdgeKind.Contains));
  }

  /** Обрабатывает объявление импорта. */
  protected processImportDeclaration(
    node: any,
    filePath: string,
    content: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    errors: IExtractionError[]
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;

    const name = nameNode.text;
    const isStatic = this.hasModifier(node, 'static');
    const line = node.startPosition.row + 1;
    const column = node.startPosition.column;

    const importNode = this.createNode(
      filePath,
      NodeKind.Import,
      name,
      line,
      line,
      column,
      node.endPosition.column,
      {
        isStatic,
      }
    );
    nodes.push(importNode);
    edges.push(this.createEdge(parentId, importNode.id, EdgeKind.Contains));

    unresolvedRefs.push(this.createUnresolvedRef(
      importNode.id,
      name,
      EdgeKind.Imports,
      line,
      column,
      filePath
    ));
  }

  /** Обрабатывает объявление класса. */
  protected processClassDeclaration(
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
    const isAbstract = this.hasModifier(node, 'abstract');
    const isFinal = this.hasModifier(node, 'final');
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
        isAbstract,
        isFinal,
        visibility: this.extractVisibility(node),
      }
    );
    nodes.push(classNode);
    edges.push(this.createEdge(parentId, classNode.id, EdgeKind.Contains));

    // Параметры типов
    const typeParams = node.childForFieldName('type_parameters');
    if (typeParams) {
      this.processTypeParameters(typeParams, filePath, content, classNode.id, nodes, edges, unresolvedRefs, errors);
    }

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

    // Реализует
    const implementsList = node.childForFieldName('interfaces');
    if (implementsList) {
      let impl = implementsList.firstChild;
      while (impl) {
        const implName = impl.text;
        edges.push(this.createEdge(classNode.id, this.nodeId(filePath, NodeKind.Interface, implName, 0), EdgeKind.Implements, {
          metadata: { referenceName: implName },
          line: impl.startPosition.row + 1,
          column: impl.startPosition.column,
        }));
        unresolvedRefs.push(this.createUnresolvedRef(
          classNode.id,
          implName,
          EdgeKind.Implements,
          impl.startPosition.row + 1,
          impl.startPosition.column,
          filePath
        ));
        impl = impl.nextSibling;
      }
    }

    // Обработка тела
    const body = node.childForFieldName('body');
    if (body) {
      let child = body.firstChild;
      while (child) {
        this.processJavaNodes(child, filePath, content, classNode.id, nodes, edges, unresolvedRefs, errors, qualifiedName);
        child = child.nextSibling;
      }
    }
  }

  /** Обрабатывает объявление интерфейса. */
  protected processInterfaceDeclaration(
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

    const ifaceNode = this.createNode(
      filePath,
      NodeKind.Interface,
      name,
      node.startPosition.row + 1,
      node.endPosition.row + 1,
      node.startPosition.column,
      node.endPosition.column,
      {
        qualifiedName,
        docstring,
        visibility: this.extractVisibility(node),
      }
    );
    nodes.push(ifaceNode);
    edges.push(this.createEdge(parentId, ifaceNode.id, EdgeKind.Contains));

    // Параметры типов
    const typeParams = node.childForFieldName('type_parameters');
    if (typeParams) {
      this.processTypeParameters(typeParams, filePath, content, ifaceNode.id, nodes, edges, unresolvedRefs, errors);
    }

    // Наследование
    const extendsList = node.childForFieldName('interfaces');
    if (extendsList) {
      let ext = extendsList.firstChild;
      while (ext) {
        const extName = ext.text;
        edges.push(this.createEdge(ifaceNode.id, this.nodeId(filePath, NodeKind.Interface, extName, 0), EdgeKind.Extends, {
          metadata: { referenceName: extName },
          line: ext.startPosition.row + 1,
          column: ext.startPosition.column,
        }));
        unresolvedRefs.push(this.createUnresolvedRef(
          ifaceNode.id,
          extName,
          EdgeKind.Extends,
          ext.startPosition.row + 1,
          ext.startPosition.column,
          filePath
        ));
        ext = ext.nextSibling;
      }
    }

    // Обработка тела
    const body = node.childForFieldName('body');
    if (body) {
      let child = body.firstChild;
      while (child) {
        this.processJavaNodes(child, filePath, content, ifaceNode.id, nodes, edges, unresolvedRefs, errors, qualifiedName);
        child = child.nextSibling;
      }
    }
  }

  /** Обрабатывает объявление перечисления. */
  protected processEnumDeclaration(
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

    const enumNode = this.createNode(
      filePath,
      NodeKind.Enum,
      name,
      node.startPosition.row + 1,
      node.endPosition.row + 1,
      node.startPosition.column,
      node.endPosition.column,
      {
        qualifiedName,
        docstring,
        visibility: this.extractVisibility(node),
      }
    );
    nodes.push(enumNode);
    edges.push(this.createEdge(parentId, enumNode.id, EdgeKind.Contains));

    // Обработка тела для констант перечисления
    const body = node.childForFieldName('body');
    if (body) {
      let child = body.firstChild;
      while (child) {
        if (child.type === 'enum_constant') {
          const constName = child.text;
          const constNode = this.createNode(
            filePath,
            NodeKind.EnumMember,
            constName,
            child.startPosition.row + 1,
            child.endPosition.row + 1,
            child.startPosition.column,
            child.endPosition.column,
            {
              qualifiedName: `${qualifiedName}.${constName}`,
            }
          );
          nodes.push(constNode);
          edges.push(this.createEdge(enumNode.id, constNode.id, EdgeKind.Contains));
        }
        child = child.nextSibling;
      }
    }
  }

  /** Обрабатывает объявление метода. */
  protected processMethodDeclaration(
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
    const isStatic = this.hasModifier(node, 'static');
    const isAbstract = this.hasModifier(node, 'abstract');
    const isFinal = this.hasModifier(node, 'final');
    const isSynchronized = this.hasModifier(node, 'synchronized');
    const docstring = this.extractDocstring(content, node.startPosition.row + 1);
    const signature = this.extractMethodSignature(node, content);
    const returnType = this.extractReturnType(node);

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
        isStatic,
        isAbstract,
        isFinal,
        isSynchronized,
        returnType,
        visibility: this.extractVisibility(node),
      }
    );
    nodes.push(methodNode);
    edges.push(this.createEdge(parentId, methodNode.id, EdgeKind.Contains));

    // Параметры типов
    const typeParams = node.childForFieldName('type_parameters');
    if (typeParams) {
      this.processTypeParameters(typeParams, filePath, content, methodNode.id, nodes, edges, unresolvedRefs, errors);
    }

    // Параметры
    const params = node.childForFieldName('parameters');
    if (params) {
      this.processParameters(params, filePath, content, methodNode.id, nodes, edges, unresolvedRefs, errors);
    }

    // Обработка тела для вызовов и ссылок
    const body = node.childForFieldName('body');
    if (body) {
      this.processFunctionBody(body, filePath, content, methodNode.id, nodes, edges, unresolvedRefs, errors);
    }
  }

  /** Обрабатывает объявление конструктора. */
  protected processConstructorDeclaration(
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
    const signature = this.extractConstructorSignature(node, content);

    const funcNode = this.createNode(
      filePath,
      NodeKind.Function,
      name,
      node.startPosition.row + 1,
      node.endPosition.row + 1,
      node.startPosition.column,
      node.endPosition.column,
      {
        qualifiedName,
        docstring,
        signature,
        visibility: this.extractVisibility(node),
      }
    );
    nodes.push(funcNode);
    edges.push(this.createEdge(parentId, funcNode.id, EdgeKind.Contains));

    // Параметры
    const params = node.childForFieldName('parameters');
    if (params) {
      this.processParameters(params, filePath, content, funcNode.id, nodes, edges, unresolvedRefs, errors);
    }

    // Обработка тела
    const body = node.childForFieldName('body');
    if (body) {
      this.processFunctionBody(body, filePath, content, funcNode.id, nodes, edges, unresolvedRefs, errors);
    }
  }

  /** Обрабатывает объявление поля. */
  protected processFieldDeclaration(
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
    const declarators = node.childForFieldName('declarators');
    if (!declarators) return;

    let decl = declarators.firstChild;
    while (decl) {
      if (decl.type === 'variable_declarator') {
        const nameNode = decl.childForFieldName('name');
        if (nameNode) {
          const name = nameNode.text;
          const qualifiedName = qualifiedNamePrefix ? `${qualifiedNamePrefix}.${name}` : name;
          const isStatic = this.hasModifier(node, 'static');
          const isFinal = this.hasModifier(node, 'final');
          const docstring = this.extractDocstring(content, decl.startPosition.row + 1);

          const propNode = this.createNode(
            filePath,
            NodeKind.Property,
            name,
            decl.startPosition.row + 1,
            decl.endPosition.row + 1,
            decl.startPosition.column,
            decl.endPosition.column,
            {
              qualifiedName,
              docstring,
              isStatic,
              isFinal,
              visibility: this.extractVisibility(node),
            }
          );
          nodes.push(propNode);
          edges.push(this.createEdge(parentId, propNode.id, EdgeKind.Contains));
        }
      }
      decl = decl.nextSibling;
    }
  }

  /** Обрабатывает объявление локальной переменной. */
  protected processLocalVariableDeclaration(
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
    const declarators = node.childForFieldName('declarators');
    if (!declarators) return;

    let decl = declarators.firstChild;
    while (decl) {
      if (decl.type === 'variable_declarator') {
        const nameNode = decl.childForFieldName('name');
        if (nameNode) {
          const name = nameNode.text;
          const qualifiedName = qualifiedNamePrefix ? `${qualifiedNamePrefix}.${name}` : name;

          const varNode = this.createNode(
            filePath,
            NodeKind.Variable,
            name,
            decl.startPosition.row + 1,
            decl.endPosition.row + 1,
            decl.startPosition.column,
            decl.endPosition.column,
            {
              qualifiedName,
            }
          );
          nodes.push(varNode);
          edges.push(this.createEdge(parentId, varNode.id, EdgeKind.Contains));
        }
      }
      decl = decl.nextSibling;
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
      NodeKind.Try,
      'try',
      line,
      node.endPosition.row + 1,
      node.startPosition.column,
      node.endPosition.column
    );
    nodes.push(tryNode);
    edges.push(this.createEdge(parentId, tryNode.id, EdgeKind.Contains));

    // Обработка блоков catch
    let child = node.firstChild;
    while (child) {
      if (child.type === 'catch_clause') {
        this.processCatchClause(child, filePath, content, tryNode.id, nodes, edges, unresolvedRefs, errors);
      }
      child = child.nextSibling;
    }
  }

  /** Обрабатывает блок catch. */
  protected processCatchClause(
    node: any,
    filePath: string,
    content: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    errors: IExtractionError[]
  ): void {
    const catchNode = this.createNode(
      filePath,
      NodeKind.Catch,
      'catch',
      node.startPosition.row + 1,
      node.endPosition.row + 1,
      node.startPosition.column,
      node.endPosition.column
    );
    nodes.push(catchNode);
    edges.push(this.createEdge(parentId, catchNode.id, EdgeKind.Catches));

    // Параметр catch
    const param = node.childForFieldName('parameter');
    if (param) {
      const paramName = param.text;
      const paramNode = this.createNode(
        filePath,
        NodeKind.Parameter,
        paramName,
        param.startPosition.row + 1,
        param.endPosition.row + 1,
        param.startPosition.column,
        param.endPosition.column
      );
      nodes.push(paramNode);
      edges.push(this.createEdge(catchNode.id, paramNode.id, EdgeKind.Contains));
    }
  }

  /** Обрабатывает throw. */
  protected processThrowStatement(
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
    const argumentNode = node.childForFieldName('expression');

    const throwNode = this.createNode(
      filePath,
      NodeKind.Throw,
      'throw',
      line,
      line,
      node.startPosition.column,
      node.endPosition.column
    );
    nodes.push(throwNode);
    edges.push(this.createEdge(parentId, throwNode.id, EdgeKind.Contains));

    if (argumentNode) {
      edges.push(this.createEdge(throwNode.id, parentId, EdgeKind.Throws, {
        metadata: { expression: argumentNode.text },
        line,
        column: argumentNode.startPosition.column,
      }));
    }
  }

  /** Обрабатывает аннотацию (Decorator). */
  protected processAnnotation(
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
    const decoratorText = node.text.startsWith('@') ? node.text.slice(1) : node.text;

    const decNode = this.createNode(
      filePath,
      NodeKind.Decorator,
      decoratorText,
      line,
      line,
      node.startPosition.column,
      node.endPosition.column
    );
    nodes.push(decNode);
    edges.push(this.createEdge(decNode.id, parentId, EdgeKind.Decorates, {
      line,
      column: node.startPosition.column,
    }));
  }

  /** Обрабатывает параметр типа (TypeParameter). */
  protected processTypeParameter(
    node: any,
    filePath: string,
    content: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    errors: IExtractionError[]
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;

    const name = nameNode.text;

    const tpNode = this.createNode(
      filePath,
      NodeKind.TypeParameter,
      name,
      node.startPosition.row + 1,
      node.endPosition.row + 1,
      node.startPosition.column,
      node.endPosition.column
    );
    nodes.push(tpNode);
    edges.push(this.createEdge(parentId, tpNode.id, EdgeKind.Contains));

    // Ограниченный тип
    const bound = node.childForFieldName('bound');
    if (bound) {
      const boundName = bound.text;
      edges.push(this.createEdge(tpNode.id, this.nodeId(filePath, NodeKind.Class, boundName, 0), EdgeKind.Extends, {
        metadata: { referenceName: boundName },
        line: bound.startPosition.row + 1,
        column: bound.startPosition.column,
      }));
      unresolvedRefs.push(this.createUnresolvedRef(
        tpNode.id,
        boundName,
        EdgeKind.Extends,
        bound.startPosition.row + 1,
        bound.startPosition.column,
        filePath
      ));
    }
  }

  /** Обрабатывает аргумент типа (Generic). */
  protected processTypeArgument(
    node: any,
    filePath: string,
    content: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    errors: IExtractionError[]
  ): void {
    const name = node.text;
    const line = node.startPosition.row + 1;
    const column = node.startPosition.column;

    const genNode = this.createNode(
      filePath,
      NodeKind.Generic,
      name,
      line,
      line,
      column,
      node.endPosition.column
    );
    nodes.push(genNode);
    edges.push(this.createEdge(parentId, genNode.id, EdgeKind.Contains));

    unresolvedRefs.push(this.createUnresolvedRef(
      genNode.id,
      name,
      EdgeKind.References,
      line,
      column,
      filePath
    ));
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
      if (child.type === 'formal_parameter') {
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

  /** Обрабатывает параметры типов. */
  protected processTypeParameters(
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
      if (child.type === 'type_parameter') {
        this.processTypeParameter(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
      }
      child = child.nextSibling;
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
    errors: IExtractionError[]
  ): void {
    let child = node.firstChild;
    while (child) {
      if (child.type === 'try_statement') {
        this.processTryStatement(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
      } else if (child.type === 'throw_statement') {
        this.processThrowStatement(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
      } else if (child.type === 'local_variable_declaration') {
        this.processLocalVariableDeclaration(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, '');
      } else {
        // Рекурсия по управлению потоком и другим блокам
        let inner = child.firstChild;
        while (inner) {
          this.processFunctionBody(inner, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
          inner = inner.nextSibling;
        }
      }
      child = child.nextSibling;
    }
  }

  /** Проверяет наличие модификатора. */
  protected hasModifier(node: any, modifier: string): boolean {
    let child = node.firstChild;
    while (child) {
      if (child.type === 'modifier' && child.text === modifier) {
        return true;
      }
      child = child.nextSibling;
    }
    return false;
  }

  /** Извлекает видимость из модификаторов. */
  protected extractVisibility(node: any): 'public' | 'private' | 'protected' | 'internal' | undefined {
    let child = node.firstChild;
    while (child) {
      if (child.type === 'modifier') {
        const text = child.text;
        if (text === 'public' || text === 'private' || text === 'protected') {
          return text as 'public' | 'private' | 'protected';
        }
      }
      child = child.nextSibling;
    }
    return undefined;
  }

  /** Извлекает сигнатуру метода. */
  protected extractMethodSignature(node: any, content: string): string | undefined {
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
    return returnType ? `${returnType} ${sig}` : sig;
  }

  /** Извлекает сигнатуру конструктора. */
  protected extractConstructorSignature(node: any, content: string): string | undefined {
    const nameNode = node.childForFieldName('name');
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

    const name = nameNode.text;
    return `${name}(${params})`;
  }

  /** Извлекает тип возвращаемого значения. */
  protected extractReturnType(node: any): string | undefined {
    const retType = node.childForFieldName('type');
    if (retType) {
      return retType.text;
    }
    return undefined;
  }
}
