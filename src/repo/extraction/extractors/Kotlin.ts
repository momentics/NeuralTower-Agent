/**
 * Экстрактор для Kotlin.
 *
 * Использует tree-sitter-kotlin для парсинга и извлечения узлов, рёбер и неразрешённых ссылок.
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

export class KotlinExtractor extends ExtractorBase {
  public getLanguage(): Language {
    return 'kotlin';
  }

  public getSupportedExtensions(): string[] {
    return ['.kt', '.kts'];
  }

  public extract(
    content: string,
    filePath: string,
    frameworkNames?: string[]
  ): IExtractionResult {
    const start = Date.now();
    const nodes: INode[] = [];
    const edges: IEdge[] = [];
    const unresolvedRefs: IUnresolvedReference[] = [];
    const errors: IExtractionError[] = [];

    try {
      const parser = require('tree-sitter');
      let ktGrammar: any;
      try {
        ktGrammar = require('tree-sitter-kotlin');
      } catch {
        errors.push(this.createError(
          'Грамматику tree-sitter-kotlin не удалось загрузить — извлечение выполнено без AST',
          filePath,
          'warning',
          'parse_error'
        ));
        return { nodes, edges, unresolvedReferences: unresolvedRefs, errors, durationMs: Date.now() - start };
      }

      const p = new parser.Parser();
      p.setLanguage(ktGrammar);

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

      // Узел файла
      const fileNode = this.createNode(
        filePath,
        NodeKind.File,
        filePath,
        1,
        content.split('\n').length,
        0,
        0
      );
      nodes.push(fileNode);

      // Узел модуля
      const moduleName = filePath.replace(/.*[/\\]/, '').replace(/\.[^.]+$/, '');
      const totalLines = content.split('\n').length;
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

      // Обработка объявлений верхнего уровня
      this.processKtNodes(
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
        'parse_error'
      ));
    }

    return { nodes, edges, unresolvedReferences: unresolvedRefs, errors, durationMs: Date.now() - start };
  }

  /** Обрабатывает узлы AST для Kotlin. */
  protected processKtNodes(
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
      case 'file':
        this.processFile(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      case 'package_declaration':
        this.processPackageDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      case 'import_list':
        this.processImportList(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      case 'class_declaration':
        this.processClassDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'interface_declaration':
        this.processInterfaceDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'function_declaration':
        this.processFunctionDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'function_definition':
        this.processFunctionDefinition(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'property_declaration':
        this.processPropertyDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'object_declaration':
        this.processObjectDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'constructor_delegation_call':
        break;

      case 'constructor_declaration':
        this.processConstructorDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'enum_entry':
        this.processEnumEntry(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'type_alias':
        this.processTypeAlias(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'call_expression':
        this.processCallExpression(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      default:
        // Рекурсия по дочерним узлам
        let child = node.firstChild;
        while (child) {
          this.processKtNodes(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
          child = child.nextSibling;
        }
    }
  }

  /** Обрабатывает корневой узел файла. */
  protected processFile(
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
      this.processKtNodes(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
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

  /** Обрабатывает список импортов. */
  protected processImportList(
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
      if (child.type === 'import_header') {
        this.processImportHeader(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
      }
      child = child.nextSibling;
    }
  }

  /** Обрабатывает объявление импорта. */
  protected processImportHeader(
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
    edges.push(this.createEdge(parentId, importNode.id, EdgeKind.Imports));

    unresolvedRefs.push(this.createUnresolvedRef(
      importNode.id,
      name,
      EdgeKind.Imports,
      line,
      column,
      filePath
    ));

    // Обработка алиасов импорта
    const aliasNode = node.childForFieldName('alias');
    if (aliasNode) {
      const aliasName = aliasNode.text;
      const aliasImportNode = this.createNode(
        filePath,
        NodeKind.Import,
        aliasName,
        line,
        line,
        aliasNode.startPosition.column,
        aliasNode.endPosition.column
      );
      nodes.push(aliasImportNode);
      edges.push(this.createEdge(parentId, aliasImportNode.id, EdgeKind.Contains));
      edges.push(this.createEdge(aliasImportNode.id, importNode.id, EdgeKind.References, {
        metadata: { importedName: name, localName: aliasName },
        line,
        column,
      }));
    }
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
    const isSealed = this.hasModifier(node, 'sealed');
    const isData = this.hasModifier(node, 'data');
    const isInline = this.hasModifier(node, 'inline');
    const isInner = this.hasModifier(node, 'inner');
    const isValue = this.hasModifier(node, 'value');
    const docstring = this.extractDocstring(content, node.startPosition.row + 1);

    // Извлечение аннотаций
    const decorators: string[] = [];
    {
      let ch = node.firstChild;
      while (ch) {
        if (ch.type === 'annotation') {
          const decText = ch.text.startsWith('@') ? ch.text.slice(1) : ch.text;
          decorators.push(decText);
        }
        ch = ch.nextSibling;
      }
    }

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
        decorators,
      }
    );
    nodes.push(classNode);
    edges.push(this.createEdge(parentId, classNode.id, EdgeKind.Contains));

    // Метаданные для специфичных типов классов
    if (isData) {
      classNode.metadata = { ...(classNode.metadata || {}), isDataClass: true };
    }
    if (isSealed) {
      classNode.metadata = { ...(classNode.metadata || {}), isSealed: true };
    }
    if (isInline) {
      classNode.metadata = { ...(classNode.metadata || {}), isInline: true };
    }
    if (isInner) {
      classNode.metadata = { ...(classNode.metadata || {}), isInner: true };
    }
    if (isValue) {
      classNode.metadata = { ...(classNode.metadata || {}), isValueClass: true };
    }

    // Ребра decorates от класса к типам аннотаций
    for (const decText of decorators) {
      edges.push(this.createEdge(classNode.id, this.nodeId(filePath, NodeKind.Class, decText, 0), EdgeKind.Decorates, {
        metadata: { referenceName: decText },
        line: classNode.startLine,
        column: classNode.startColumn,
      }));
      unresolvedRefs.push(this.createUnresolvedRef(
        classNode.id,
        decText,
        EdgeKind.Decorates,
        classNode.startLine,
        classNode.startColumn,
        filePath
      ));
    }

    // Параметры типов
    const typeParams = node.childForFieldName('type_parameters');
    if (typeParams) {
      this.processTypeParameters(typeParams, filePath, content, classNode.id, nodes, edges, unresolvedRefs, errors);
    }

    // Наследование — superclass
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

    // Реализует — interfaces
    const interfacesNode = node.childForFieldName('interfaces');
    if (interfacesNode) {
      let iface = interfacesNode.firstChild;
      while (iface) {
        const ifaceName = iface.text;
        edges.push(this.createEdge(classNode.id, this.nodeId(filePath, NodeKind.Interface, ifaceName, 0), EdgeKind.Implements, {
          metadata: { referenceName: ifaceName },
          line: iface.startPosition.row + 1,
          column: iface.startPosition.column,
        }));
        unresolvedRefs.push(this.createUnresolvedRef(
          classNode.id,
          ifaceName,
          EdgeKind.Implements,
          iface.startPosition.row + 1,
          iface.startPosition.column,
          filePath
        ));
        iface = iface.nextSibling;
      }
    }

    // Обработка тела
    const body = node.childForFieldName('body');
    if (body) {
      let ch = body.firstChild;
      while (ch) {
        this.processKtNodes(ch, filePath, content, classNode.id, nodes, edges, unresolvedRefs, errors, qualifiedName);
        ch = ch.nextSibling;
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

    // Извлечение аннотаций
    const decorators: string[] = [];
    {
      let ch = node.firstChild;
      while (ch) {
        if (ch.type === 'annotation') {
          const decText = ch.text.startsWith('@') ? ch.text.slice(1) : ch.text;
          decorators.push(decText);
        }
        ch = ch.nextSibling;
      }
    }

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
        decorators,
      }
    );
    nodes.push(ifaceNode);
    edges.push(this.createEdge(parentId, ifaceNode.id, EdgeKind.Contains));

    // Ребра decorates от интерфейса к типам аннотаций
    for (const decText of decorators) {
      edges.push(this.createEdge(ifaceNode.id, this.nodeId(filePath, NodeKind.Class, decText, 0), EdgeKind.Decorates, {
        metadata: { referenceName: decText },
        line: ifaceNode.startLine,
        column: ifaceNode.startColumn,
      }));
      unresolvedRefs.push(this.createUnresolvedRef(
        ifaceNode.id,
        decText,
        EdgeKind.Decorates,
        ifaceNode.startLine,
        ifaceNode.startColumn,
        filePath
      ));
    }

    // Параметры типов
    const typeParams = node.childForFieldName('type_parameters');
    if (typeParams) {
      this.processTypeParameters(typeParams, filePath, content, ifaceNode.id, nodes, edges, unresolvedRefs, errors);
    }

    // Наследование интерфейсов
    const extendsList = node.childForFieldName('superclass');
    if (extendsList) {
      const extName = extendsList.text;
      edges.push(this.createEdge(ifaceNode.id, this.nodeId(filePath, NodeKind.Interface, extName, 0), EdgeKind.Extends, {
        metadata: { referenceName: extName },
        line: extendsList.startPosition.row + 1,
        column: extendsList.startPosition.column,
      }));
      unresolvedRefs.push(this.createUnresolvedRef(
        ifaceNode.id,
        extName,
        EdgeKind.Extends,
        extendsList.startPosition.row + 1,
        extendsList.startPosition.column,
        filePath
      ));
    }

    // Обработка тела
    const body = node.childForFieldName('body');
    if (body) {
      let ch = body.firstChild;
      while (ch) {
        this.processKtNodes(ch, filePath, content, ifaceNode.id, nodes, edges, unresolvedRefs, errors, qualifiedName);
        ch = ch.nextSibling;
      }
    }
  }

  /** Обрабатывает объявление функции верхнего уровня. */
  protected processFunctionDeclaration(
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
    const isSuspend = this.hasModifier(node, 'suspend');
    const isInline = this.hasModifier(node, 'inline');
    const isTailrec = this.hasModifier(node, 'tailrec');
    const isAbstract = this.hasModifier(node, 'abstract');
    const isOperator = this.hasModifier(node, 'operator');
    const isInfix = this.hasModifier(node, 'infix');
    const docstring = this.extractDocstring(content, node.startPosition.row + 1);
    const signature = this.extractFunctionSignature(node, content);
    const returnType = this.extractReturnType(node);

    // Извлечение аннотаций
    const decorators: string[] = [];
    {
      let ch = node.firstChild;
      while (ch) {
        if (ch.type === 'annotation') {
          const decText = ch.text.startsWith('@') ? ch.text.slice(1) : ch.text;
          decorators.push(decText);
        }
        ch = ch.nextSibling;
      }
    }

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
        isAsync: isSuspend,
        isAbstract,
        returnType,
        visibility: this.extractVisibility(node),
        decorators,
      }
    );
    nodes.push(funcNode);
    edges.push(this.createEdge(parentId, funcNode.id, EdgeKind.Contains));

    // Метаданные для специфичных модификаторов
    if (isSuspend) {
      funcNode.metadata = { ...(funcNode.metadata || {}), isSuspend: true };
    }
    if (isInline) {
      funcNode.metadata = { ...(funcNode.metadata || {}), isInline: true };
    }
    if (isTailrec) {
      funcNode.metadata = { ...(funcNode.metadata || {}), isTailrec: true };
    }
    if (isOperator) {
      funcNode.metadata = { ...(funcNode.metadata || {}), isOperator: true };
    }
    if (isInfix) {
      funcNode.metadata = { ...(funcNode.metadata || {}), isInfix: true };
    }

    // Параметры типов
    const typeParams = node.childForFieldName('type_parameters');
    if (typeParams) {
      this.processTypeParameters(typeParams, filePath, content, funcNode.id, nodes, edges, unresolvedRefs, errors);
    }

    // Возвращаемый тип
    if (returnType) {
      const baseType = this.extractBaseTypeName(returnType);
      if (baseType && !this.isPrimitiveKotlinType(baseType)) {
        edges.push(this.createEdge(funcNode.id, this.nodeId(filePath, NodeKind.Class, baseType, 0), EdgeKind.Returns, {
          metadata: { referenceName: baseType },
          line: funcNode.startLine,
          column: funcNode.startColumn,
        }));
        unresolvedRefs.push(this.createUnresolvedRef(
          funcNode.id,
          baseType,
          EdgeKind.Returns,
          funcNode.startLine,
          funcNode.startColumn,
          filePath
        ));
      }
    }

    // Параметры
    const params = node.childForFieldName('parameters');
    if (params) {
      this.processParameters(params, filePath, content, funcNode.id, nodes, edges, unresolvedRefs, errors);
    }

    // Обработка тела для вызовов и ссылок
    const body = node.childForFieldName('body');
    if (body) {
      this.processFunctionBody(body, filePath, content, funcNode.id, nodes, edges, unresolvedRefs, errors);
    }
  }

  /** Обрабатывает определение метода внутри класса. */
  protected processFunctionDefinition(
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
    const isSuspend = this.hasModifier(node, 'suspend');
    const isInline = this.hasModifier(node, 'inline');
    const isTailrec = this.hasModifier(node, 'tailrec');
    const isAbstract = this.hasModifier(node, 'abstract');
    const isOverride = this.hasModifier(node, 'override');
    const isOperator = this.hasModifier(node, 'operator');
    const isInfix = this.hasModifier(node, 'infix');
    const isStatic = this.hasModifier(node, 'companion');
    const docstring = this.extractDocstring(content, node.startPosition.row + 1);
    const signature = this.extractFunctionSignature(node, content);
    const returnType = this.extractReturnType(node);

    // Извлечение аннотаций
    const decorators: string[] = [];
    {
      let ch = node.firstChild;
      while (ch) {
        if (ch.type === 'annotation') {
          const decText = ch.text.startsWith('@') ? ch.text.slice(1) : ch.text;
          decorators.push(decText);
        }
        ch = ch.nextSibling;
      }
    }

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
        isAsync: isSuspend,
        isAbstract,
        returnType,
        visibility: this.extractVisibility(node),
        decorators,
      }
    );
    nodes.push(methodNode);
    edges.push(this.createEdge(parentId, methodNode.id, EdgeKind.Contains));

    // Метаданные
    if (isSuspend) {
      methodNode.metadata = { ...(methodNode.metadata || {}), isSuspend: true };
    }
    if (isInline) {
      methodNode.metadata = { ...(methodNode.metadata || {}), isInline: true };
    }
    if (isTailrec) {
      methodNode.metadata = { ...(methodNode.metadata || {}), isTailrec: true };
    }
    if (isOperator) {
      methodNode.metadata = { ...(methodNode.metadata || {}), isOperator: true };
    }
    if (isInfix) {
      methodNode.metadata = { ...(methodNode.metadata || {}), isInfix: true };
    }

    // Ребро overrides если есть override
    if (isOverride) {
      edges.push(this.createEdge(methodNode.id, this.nodeId(filePath, NodeKind.Method, name, 0), EdgeKind.Overrides, {
        metadata: { referenceName: name },
        line: methodNode.startLine,
        column: methodNode.startColumn,
      }));
      unresolvedRefs.push(this.createUnresolvedRef(
        methodNode.id,
        name,
        EdgeKind.Overrides,
        methodNode.startLine,
        methodNode.startColumn,
        filePath
      ));
    }

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

    // Обработка тела
    const body = node.childForFieldName('body');
    if (body) {
      this.processFunctionBody(body, filePath, content, methodNode.id, nodes, edges, unresolvedRefs, errors);
    }
  }

  /** Обрабатывает объявление свойства. */
  protected processPropertyDeclaration(
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
    const isVal = this.hasModifier(node, 'val');
    const isConst = isVal && this.hasModifier(node, 'const');
    const isLateinit = this.hasModifier(node, 'lateinit');
    const isVararg = this.hasModifier(node, 'vararg');
    const isAbstract = this.hasModifier(node, 'abstract');
    const isOverride = this.hasModifier(node, 'override');
    const docstring = this.extractDocstring(content, node.startPosition.row + 1);

    // Извлечение аннотаций
    const decorators: string[] = [];
    {
      let ch = node.firstChild;
      while (ch) {
        if (ch.type === 'annotation') {
          const decText = ch.text.startsWith('@') ? ch.text.slice(1) : ch.text;
          decorators.push(decText);
        }
        ch = ch.nextSibling;
      }
    }

    // Константа: val + const + UPPER_CASE
    const isUpper = /^[A-Z_][A-Z0-9_]*$/.test(name);
    const propKind = isConst && isUpper ? NodeKind.Constant : NodeKind.Property;

    const propNode = this.createNode(
      filePath,
      propKind,
      name,
      node.startPosition.row + 1,
      node.endPosition.row + 1,
      node.startPosition.column,
      node.endPosition.column,
      {
        qualifiedName,
        docstring,
        isAbstract,
        visibility: this.extractVisibility(node),
        decorators,
      }
    );
    nodes.push(propNode);
    edges.push(this.createEdge(parentId, propNode.id, EdgeKind.Contains));

    // Метаданные
    if (isLateinit) {
      propNode.metadata = { ...(propNode.metadata || {}), isLateinit: true };
    }
    if (isVararg) {
      propNode.metadata = { ...(propNode.metadata || {}), isVararg: true };
    }

    // Тип свойства
    const typeNode = node.childForFieldName('type');
    if (typeNode) {
      const typeName = typeNode.text;
      const baseType = this.extractBaseTypeName(typeName);
      if (baseType && !this.isPrimitiveKotlinType(baseType)) {
        edges.push(this.createEdge(propNode.id, this.nodeId(filePath, NodeKind.Class, baseType, 0), EdgeKind.TypeOf, {
          metadata: { referenceName: baseType },
          line: propNode.startLine,
          column: propNode.startColumn,
        }));
        unresolvedRefs.push(this.createUnresolvedRef(
          propNode.id,
          baseType,
          EdgeKind.TypeOf,
          propNode.startLine,
          propNode.startColumn,
          filePath
        ));
      }
    }
  }

  /** Обрабатывает объявление объекта (companion object и др.). */
  protected processObjectDeclaration(
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
    const isCompanion = this.hasModifier(node, 'companion');

    const name = nameNode ? nameNode.text : (isCompanion ? 'Companion' : 'Object');
    const qualifiedName = qualifiedNamePrefix ? `${qualifiedNamePrefix}.${name}` : name;
    const docstring = this.extractDocstring(content, node.startPosition.row + 1);

    // Извлечение аннотаций
    const decorators: string[] = [];
    {
      let ch = node.firstChild;
      while (ch) {
        if (ch.type === 'annotation') {
          const decText = ch.text.startsWith('@') ? ch.text.slice(1) : ch.text;
          decorators.push(decText);
        }
        ch = ch.nextSibling;
      }
    }

    const objNode = this.createNode(
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
        isStatic: isCompanion,
        visibility: this.extractVisibility(node),
        decorators,
      }
    );
    nodes.push(objNode);
    edges.push(this.createEdge(parentId, objNode.id, EdgeKind.Contains));

    if (isCompanion) {
      objNode.metadata = { ...(objNode.metadata || {}), isCompanionObject: true };
    }

    // Наследование
    const superClass = node.childForFieldName('superclass');
    if (superClass) {
      const superName = superClass.text;
      edges.push(this.createEdge(objNode.id, this.nodeId(filePath, NodeKind.Class, superName, 0), EdgeKind.Extends, {
        metadata: { referenceName: superName },
        line: superClass.startPosition.row + 1,
        column: superClass.startPosition.column,
      }));
      unresolvedRefs.push(this.createUnresolvedRef(
        objNode.id,
        superName,
        EdgeKind.Extends,
        superClass.startPosition.row + 1,
        superClass.startPosition.column,
        filePath
      ));
    }

    // Реализует
    const interfacesNode = node.childForFieldName('interfaces');
    if (interfacesNode) {
      let iface = interfacesNode.firstChild;
      while (iface) {
        const ifaceName = iface.text;
        edges.push(this.createEdge(objNode.id, this.nodeId(filePath, NodeKind.Interface, ifaceName, 0), EdgeKind.Implements, {
          metadata: { referenceName: ifaceName },
          line: iface.startPosition.row + 1,
          column: iface.startPosition.column,
        }));
        unresolvedRefs.push(this.createUnresolvedRef(
          objNode.id,
          ifaceName,
          EdgeKind.Implements,
          iface.startPosition.row + 1,
          iface.startPosition.column,
          filePath
        ));
        iface = iface.nextSibling;
      }
    }

    // Обработка тела
    const body = node.childForFieldName('body');
    if (body) {
      let ch = body.firstChild;
      while (ch) {
        this.processKtNodes(ch, filePath, content, objNode.id, nodes, edges, unresolvedRefs, errors, qualifiedName);
        ch = ch.nextSibling;
      }
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

  /** Обрабатывает запись перечисления. */
  protected processEnumEntry(
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

    const enumNode = this.createNode(
      filePath,
      NodeKind.EnumMember,
      name,
      node.startPosition.row + 1,
      node.endPosition.row + 1,
      node.startPosition.column,
      node.endPosition.column,
      {
        qualifiedName: `${qualifiedNamePrefix}.${name}`,
      }
    );
    nodes.push(enumNode);
    edges.push(this.createEdge(parentId, enumNode.id, EdgeKind.Contains));

    // Обработка тела enum entry (может содержать методы)
    const body = node.childForFieldName('body');
    if (body) {
      let ch = body.firstChild;
      while (ch) {
        this.processKtNodes(ch, filePath, content, enumNode.id, nodes, edges, unresolvedRefs, errors, `${qualifiedNamePrefix}.${name}`);
        ch = ch.nextSibling;
      }
    }
  }

  /** Обрабатывает алиас типа. */
  protected processTypeAlias(
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

    const typeNode = this.createNode(
      filePath,
      NodeKind.TypeAlias,
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
    nodes.push(typeNode);
    edges.push(this.createEdge(parentId, typeNode.id, EdgeKind.Contains));

    // Параметры типов
    const typeParams = node.childForFieldName('type_parameters');
    if (typeParams) {
      this.processTypeParameters(typeParams, filePath, content, typeNode.id, nodes, edges, unresolvedRefs, errors);
    }

    // Ссылка на базовый тип
    const aliasedType = node.childForFieldName('aliased_type');
    if (aliasedType) {
      const baseType = this.extractBaseTypeName(aliasedType.text);
      if (baseType && !this.isPrimitiveKotlinType(baseType)) {
        edges.push(this.createEdge(typeNode.id, this.nodeId(filePath, NodeKind.Class, baseType, 0), EdgeKind.References, {
          metadata: { referenceName: baseType },
          line: typeNode.startLine,
          column: typeNode.startColumn,
        }));
        unresolvedRefs.push(this.createUnresolvedRef(
          typeNode.id,
          baseType,
          EdgeKind.References,
          typeNode.startLine,
          typeNode.startColumn,
          filePath
        ));
      }
    }
  }

  /** Обрабатывает вызов функции. */
  protected processCallExpression(
    node: any,
    filePath: string,
    content: string,
    parentId: string,
    _nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    _errors: IExtractionError[]
  ): void {
    const funcNode = node.childForFieldName('function');
    if (!funcNode) return;

    const line = node.startPosition.row + 1;
    const column = node.startPosition.column;

    let funcName: string | undefined;

    if (funcNode.type === 'simple_identifier') {
      funcName = funcNode.text;
    } else if (funcNode.type === 'dot_expression') {
      const namePart = funcNode.childForFieldName('name');
      if (namePart) {
        funcName = namePart.text;
      }
    } else if (funcNode.type === 'simple_identifier') {
      funcName = funcNode.text;
    }

    if (funcName) {
      edges.push(this.createEdge(parentId, this.nodeId(filePath, NodeKind.Function, funcName, 0), EdgeKind.Calls, {
        metadata: { referenceName: funcName },
        line,
        column,
      }));
      unresolvedRefs.push(this.createUnresolvedRef(
        parentId,
        funcName,
        EdgeKind.Calls,
        line,
        column,
        filePath
      ));
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
      if (child.type === 'function_parameter') {
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

          // Тип параметра
          const typeNode = child.childForFieldName('type');
          if (typeNode) {
            const typeName = this.extractBaseTypeName(typeNode.text);
            if (typeName && !this.isPrimitiveKotlinType(typeName)) {
              edges.push(this.createEdge(paramNode.id, this.nodeId(filePath, NodeKind.Class, typeName, paramNode.startLine), EdgeKind.TypeOf, {
              }));
              unresolvedRefs.push(this.createUnresolvedRef(
                paramNode.id,
                typeName,
                EdgeKind.TypeOf,
                paramNode.startLine,
                paramNode.startColumn,
                filePath
              ));
            }
          }
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
        const nameNode = child.childForFieldName('name');
        if (nameNode) {
          const name = nameNode.text;

          const tpNode = this.createNode(
            filePath,
            NodeKind.Parameter,
            name,
            child.startPosition.row + 1,
            child.endPosition.row + 1,
            child.startPosition.column,
            child.endPosition.column
          );
          nodes.push(tpNode);
          edges.push(this.createEdge(parentId, tpNode.id, EdgeKind.Contains));

          // Ограниченный тип
          const varianceNode = child.childForFieldName('variance');
          if (varianceNode) {
            const boundName = varianceNode.text;
            if (!this.isPrimitiveKotlinType(boundName)) {
              edges.push(this.createEdge(tpNode.id, this.nodeId(filePath, NodeKind.Class, boundName, 0), EdgeKind.Extends, {
                metadata: { referenceName: boundName },
                line: varianceNode.startPosition.row + 1,
                column: varianceNode.startPosition.column,
              }));
              unresolvedRefs.push(this.createUnresolvedRef(
                tpNode.id,
                boundName,
                EdgeKind.Extends,
                varianceNode.startPosition.row + 1,
                varianceNode.startPosition.column,
                filePath
              ));
            }
          }
        }
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
      if (child.type === 'call_expression') {
        this.processCallExpression(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
      } else if (child.type === 'object_creation_expression') {
        const typeNameNode = child.childForFieldName('type');
        if (typeNameNode) {
          const typeName = typeNameNode.text;
          const line = child.startPosition.row + 1;
          const column = child.startPosition.column;
          edges.push(this.createEdge(parentId, this.nodeId(filePath, NodeKind.Class, typeName, 0), EdgeKind.Instantiates, {
            metadata: { referenceName: typeName },
            line,
            column,
          }));
          unresolvedRefs.push(this.createUnresolvedRef(
            parentId,
            typeName,
            EdgeKind.Instantiates,
            line,
            column,
            filePath
          ));
        }
      } else {
        // Рекурсия по вложенным блокам
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
        if (text === 'public' || text === 'private' || text === 'protected' || text === 'internal') {
          return text as 'public' | 'private' | 'protected' | 'internal';
        }
      }
      child = child.nextSibling;
    }
    return undefined;
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
    const retType = node.childForFieldName('return_type');
    if (retType) {
      return retType.text;
    }
    return undefined;
  }

  /** Извлекает базовое имя типа из составного типа (например, List<String> → List). */
  protected extractBaseTypeName(typeText: string): string | undefined {
    if (!typeText) return undefined;
    const idx = typeText.indexOf('<');
    if (idx > 0) return typeText.substring(0, idx).trim();
    const dotIdx = typeText.lastIndexOf('.');
    if (dotIdx >= 0) return typeText.substring(dotIdx + 1);
    return typeText.trim();
  }

  /** Проверяет, является ли тип встроенным типом Kotlin. */
  protected isPrimitiveKotlinType(typeName: string): boolean {
    const primitives = new Set([
      'Int', 'Long', 'Short', 'Byte', 'Float', 'Double', 'Boolean', 'Char',
      'String', 'Unit', 'Nothing', 'Any', 'kotlin.Any', 'kotlin.Unit',
      'kotlin.Nothing', 'kotlin.Int', 'kotlin.Long', 'kotlin.Short',
      'kotlin.Byte', 'kotlin.Float', 'kotlin.Double', 'kotlin.Boolean',
      'kotlin.Char', 'kotlin.String', 'kotlin.collections.List',
      'kotlin.collections.Map', 'kotlin.collections.Set',
    ]);
    return primitives.has(typeName);
  }
}
