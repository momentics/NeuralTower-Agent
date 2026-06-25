/**
 * Экстрактор для Go.
 *
 * Использует tree-sitter для парсинга и извлечения узлов, рёбер и неразрешённых ссылок.
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

export class GoExtractor extends ExtractorBase {
  public getLanguage(): string {
    return 'go';
  }

  public getSupportedExtensions(): string[] {
    return ['.go'];
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
      const Parser = require('tree-sitter');
      const GoGrammar = require('tree-sitter-go');

      const p = new Parser();
      p.setLanguage(GoGrammar);

      const tree = p.parse(content);
      if (!tree) {
        errors.push(this.createError(
          'Failed to parse file',
          filePath,
          'error',
          'PARSE_FAILED'
        ));
        return { nodes, edges, unresolvedRefs, errors };
      }

      const root = tree.rootNode;
      if (!root || root.type === 'translation_unit') {
        // Пустой файл
        return { nodes, edges, unresolvedRefs, errors };
      }

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

      // Обработка узлов верхнего уровня
      this.processGoNodes(
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
        `Tree-sitter error: ${message}`,
        filePath,
        'error',
        'TREE_SITTER_ERROR'
      ));
    }

    return { nodes, edges, unresolvedRefs, errors };
  }

  /** Обрабатывает узлы AST для Go. */
  protected processGoNodes(
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
      case 'translation_unit':
        this.processTranslationUnit(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      case 'package_clause':
        this.processPackageClause(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      case 'import_declaration':
        this.processImportDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      case 'type_spec':
        this.processTypeSpec(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'function_declaration':
        this.processFunctionDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'method_declaration':
        this.processMethodDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'var_declaration':
        this.processVarDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'const_declaration':
        this.processConstDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'call_expression':
        this.processCallExpression(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      case 'defer_statement':
        this.processDeferStatement(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      default:
        // Рекурсия по детям
        let child = node.firstChild;
        while (child) {
          this.processGoNodes(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
          child = child.nextSibling;
        }
    }
  }

  /** Обрабатывает корневой узел. */
  protected processTranslationUnit(
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
      this.processGoNodes(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
      child = child.nextSibling;
    }
  }

  /** Обрабатывает объявление пакета — извлекает Namespace. */
  protected processPackageClause(
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
    // Обработка группового импорта
    if (node.childForFieldName('path')) {
      this.processSingleImport(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
    } else {
      let child = node.firstChild;
      while (child) {
        if (child.type === 'import_spec') {
          this.processSingleImport(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        }
        child = child.nextSibling;
      }
    }
  }

  /** Обрабатывает одиночный импорт. */
  protected processSingleImport(
    node: any,
    filePath: string,
    content: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    errors: IExtractionError[]
  ): void {
    const pathNode = node.childForFieldName('path');
    if (!pathNode) return;

    const sourceText = pathNode.text.replace(/"/g, '');
    const line = node.startPosition.row + 1;
    const column = node.startPosition.column;

    const importNode = this.createNode(
      filePath,
      NodeKind.Import,
      sourceText,
      line,
      line,
      column,
      pathNode.endPosition.column
    );
    nodes.push(importNode);
    edges.push(this.createEdge(parentId, importNode.id, EdgeKind.Contains));

    unresolvedRefs.push(this.createUnresolvedRef(
      importNode.id,
      sourceText,
      EdgeKind.Imports,
      line,
      column,
      filePath
    ));

    // Алиас импорта
    const nameNode = node.childForFieldName('name');
    if (nameNode && nameNode.text !== '.') {
      const aliasName = nameNode.text;
      edges.push(this.createEdge(importNode.id, this.nodeId(filePath, NodeKind.Import, aliasName, line), EdgeKind.ReExports, {
        metadata: { importedName: sourceText, localName: aliasName },
        line,
        column,
      }));
    }
  }

  /** Обрабатывает спецификацию типа: struct, interface, алиас, перечисление. */
  protected processTypeSpec(
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
    const typeNode = node.childForFieldName('type');

    if (!typeNode) return;

    switch (typeNode.type) {
      case 'struct_type':
        this.processStructType(node, name, qualifiedName, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, docstring);
        break;

      case 'interface_type':
        this.processInterfaceType(node, name, qualifiedName, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, docstring);
        break;

      case 'type_identifier':
        // TypeAlias: type Foo = Bar
        this.processTypeAlias(node, name, qualifiedName, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, docstring);
        break;

      default:
        // Проверка на перечисление через iota
        const hasIota = this.nodeContainsText(node, 'iota');
        if (hasIota) {
          this.processEnumType(node, name, qualifiedName, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, docstring);
        }
    }
  }

  /** Обрабатывает тип структуры — извлекает Class. */
  protected processStructType(
    typeSpecNode: any,
    name: string,
    qualifiedName: string,
    filePath: string,
    content: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    errors: IExtractionError[],
    docstring: string | undefined
  ): void {
    const classNode = this.createNode(
      filePath,
      NodeKind.Class,
      name,
      typeSpecNode.startPosition.row + 1,
      typeSpecNode.endPosition.row + 1,
      typeSpecNode.startPosition.column,
      typeSpecNode.endPosition.column,
      {
        qualifiedName,
        docstring,
      }
    );
    nodes.push(classNode);
    edges.push(this.createEdge(parentId, classNode.id, EdgeKind.Contains));

    // Поля структуры
    const structType = typeSpecNode.childForFieldName('type');
    if (structType) {
      let field = structType.firstChild;
      while (field) {
        if (field.type === 'field_declaration') {
          this.processStructField(field, filePath, content, classNode.id, nodes, edges, unresolvedRefs, errors, qualifiedName);
        }
        field = field.nextSibling;
      }
    }
  }

  /** Обрабатывает поле структуры — извлекает Property. */
  protected processStructField(
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
    const qualifiedName = `${qualifiedNamePrefix}.${name}`;
    const typeNode = node.childForFieldName('type');
    const docstring = this.extractDocstring(content, node.startPosition.row + 1);

    const isTag = node.childForFieldName('tag') !== null;
    const tagNode = node.childForFieldName('tag');

    const propNode = this.createNode(
      filePath,
      NodeKind.Property,
      name,
      node.startPosition.row + 1,
      node.endPosition.row + 1,
      node.startPosition.column,
      node.endPosition.column,
      {
        qualifiedName,
        docstring,
        type: typeNode ? typeNode.text : undefined,
        isTag,
        tag: tagNode ? tagNode.text : undefined,
      }
    );
    nodes.push(propNode);
    edges.push(this.createEdge(parentId, propNode.id, EdgeKind.Contains));
  }

  /** Обрабатывает тип интерфейса — извлекает Interface. */
  protected processInterfaceType(
    typeSpecNode: any,
    name: string,
    qualifiedName: string,
    filePath: string,
    content: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    errors: IExtractionError[],
    docstring: string | undefined
  ): void {
    const ifaceNode = this.createNode(
      filePath,
      NodeKind.Interface,
      name,
      typeSpecNode.startPosition.row + 1,
      typeSpecNode.endPosition.row + 1,
      typeSpecNode.startPosition.column,
      typeSpecNode.endPosition.column,
      {
        qualifiedName,
        docstring,
      }
    );
    nodes.push(ifaceNode);
    edges.push(this.createEdge(parentId, ifaceNode.id, EdgeKind.Contains));

    // Методы интерфейса
    const interfaceType = typeSpecNode.childForFieldName('type');
    if (interfaceType) {
      let child = interfaceType.firstChild;
      while (child) {
        if (child.type === 'method_spec') {
          const mNameNode = child.childForFieldName('name');
          if (mNameNode) {
            const mName = mNameNode.text;
            const mQualifiedName = `${qualifiedName}.${mName}`;
            const methodNode = this.createNode(
              filePath,
              NodeKind.Method,
              mName,
              child.startPosition.row + 1,
              child.endPosition.row + 1,
              child.startPosition.column,
              child.endPosition.column,
              {
                qualifiedName: mQualifiedName,
              }
            );
            nodes.push(methodNode);
            edges.push(this.createEdge(ifaceNode.id, methodNode.id, EdgeKind.Contains));

            // Параметры метода интерфейса
            const paramsNode = child.childForFieldName('parameters');
            if (paramsNode) {
              this.processParameters(paramsNode, filePath, content, methodNode.id, nodes, edges, unresolvedRefs, errors);
            }

            // Результат метода интерфейса
            const resultNode = child.childForFieldName('result');
            if (resultNode) {
              this.processResult(resultNode, filePath, content, methodNode.id, nodes, edges, unresolvedRefs, errors);
            }
          }
        }
        child = child.nextSibling;
      }
    }
  }

  /** Обрабатывает алиас типа — извлекает TypeAlias. */
  protected processTypeAlias(
    typeSpecNode: any,
    name: string,
    qualifiedName: string,
    filePath: string,
    content: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    errors: IExtractionError[],
    docstring: string | undefined
  ): void {
    const typeNode = typeSpecNode.childForFieldName('type');
    const underlyingType = typeNode ? typeNode.text : undefined;

    const aliasNode = this.createNode(
      filePath,
      NodeKind.TypeAlias,
      name,
      typeSpecNode.startPosition.row + 1,
      typeSpecNode.endPosition.row + 1,
      typeSpecNode.startPosition.column,
      typeSpecNode.endPosition.column,
      {
        qualifiedName,
        docstring,
        underlyingType,
      }
    );
    nodes.push(aliasNode);
    edges.push(this.createEdge(parentId, aliasNode.id, EdgeKind.Contains));

    if (underlyingType) {
      unresolvedRefs.push(this.createUnresolvedRef(
        aliasNode.id,
        underlyingType,
        EdgeKind.Extends,
        (typeNode?.startPosition.row ?? -1) + 1,
        typeNode?.startPosition.column ?? 0,
        filePath
      ));
    }
  }

  /** Обрабатывает перечисление через iota — извлекает Enum. */
  protected processEnumType(
    typeSpecNode: any,
    name: string,
    qualifiedName: string,
    filePath: string,
    content: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    errors: IExtractionError[],
    docstring: string | undefined
  ): void {
    const enumNode = this.createNode(
      filePath,
      NodeKind.Enum,
      name,
      typeSpecNode.startPosition.row + 1,
      typeSpecNode.endPosition.row + 1,
      typeSpecNode.startPosition.column,
      typeSpecNode.endPosition.column,
      {
        qualifiedName,
        docstring,
      }
    );
    nodes.push(enumNode);
    edges.push(this.createEdge(parentId, enumNode.id, EdgeKind.Contains));
  }

  /** Обрабатывает объявление функции — извлекает Function. */
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
    const docstring = this.extractDocstring(content, node.startPosition.row + 1);
    const signature = this.extractFunctionSignature(node, content);
    const returnType = this.extractReturnType(node);

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
        returnType,
      }
    );
    nodes.push(funcNode);
    edges.push(this.createEdge(parentId, funcNode.id, EdgeKind.Contains));

    // Параметры
    const params = node.childForFieldName('parameters');
    if (params) {
      this.processParameters(params, filePath, content, funcNode.id, nodes, edges, unresolvedRefs, errors);
    }

    // Результат
    const result = node.childForFieldName('result');
    if (result) {
      this.processResult(result, filePath, content, funcNode.id, nodes, edges, unresolvedRefs, errors);
    }

    // Тело функции
    const body = node.childForFieldName('body');
    if (body) {
      this.processFunctionBody(body, filePath, content, funcNode.id, nodes, edges, unresolvedRefs, errors);
    }
  }

  /** Обрабатывает объявление метода — извлекает Method. */
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
    const receiver = node.childForFieldName('receiver');
    let receiverType: string | undefined;
    if (receiver) {
      const paramList = receiver.firstChild;
      if (paramList) {
        const typeField = paramList.childForFieldName('type');
        if (typeField) {
          receiverType = typeField.text;
        }
      }
    }

    const qualifiedName = qualifiedNamePrefix ? `${qualifiedNamePrefix}.${name}` : name;
    const docstring = this.extractDocstring(content, node.startPosition.row + 1);
    const signature = this.extractFunctionSignature(node, content);
    const returnType = this.extractReturnType(node);

    const isPointer = receiver ? this.isPointerReceiver(receiver) : false;

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
        returnType,
        receiverType,
        isPointer,
      }
    );
    nodes.push(methodNode);
    edges.push(this.createEdge(parentId, methodNode.id, EdgeKind.Contains));

    // Параметры
    const params = node.childForFieldName('parameters');
    if (params) {
      this.processParameters(params, filePath, content, methodNode.id, nodes, edges, unresolvedRefs, errors);
    }

    // Результат
    const result = node.childForFieldName('result');
    if (result) {
      this.processResult(result, filePath, content, methodNode.id, nodes, edges, unresolvedRefs, errors);
    }

    // Тело метода
    const body = node.childForFieldName('body');
    if (body) {
      this.processFunctionBody(body, filePath, content, methodNode.id, nodes, edges, unresolvedRefs, errors);
    }
  }

  /** Обрабатывает объявление переменной — извлекает Variable. */
  protected processVarDeclaration(
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
    let child = node.firstChild;
    while (child) {
      if (child.type === 'var_spec') {
        this.processVarSpec(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
      }
      child = child.nextSibling;
    }
  }

  /** Обрабатывает спецификацию переменной. */
  protected processVarSpec(
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
    const namesNode = node.childForFieldName('name');
    if (!namesNode) return;

    let nameNode = namesNode.firstChild;
    while (nameNode) {
      const name = nameNode.text;
      const qualifiedName = qualifiedNamePrefix ? `${qualifiedNamePrefix}.${name}` : name;
      const typeNode = node.childForFieldName('type');
      const docstring = this.extractDocstring(content, node.startPosition.row + 1);

      const varNode = this.createNode(
        filePath,
        NodeKind.Variable,
        name,
        node.startPosition.row + 1,
        node.endPosition.row + 1,
        node.startPosition.column,
        node.endPosition.column,
        {
          qualifiedName,
          docstring,
          type: typeNode ? typeNode.text : undefined,
        }
      );
      nodes.push(varNode);
      edges.push(this.createEdge(parentId, varNode.id, EdgeKind.Contains));

      nameNode = nameNode.nextSibling;
    }
  }

  /** Обрабатывает объявление константы — извлекает Variable. */
  protected processConstDeclaration(
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
    let child = node.firstChild;
    while (child) {
      if (child.type === 'const_spec') {
        this.processConstSpec(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
      }
      child = child.nextSibling;
    }
  }

  /** Обрабатывает спецификацию константы. */
  protected processConstSpec(
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
    const namesNode = node.childForFieldName('name');
    if (!namesNode) return;

    let nameNode = namesNode.firstChild;
    while (nameNode) {
      const name = nameNode.text;
      const qualifiedName = qualifiedNamePrefix ? `${qualifiedNamePrefix}.${name}` : name;
      const typeNode = node.childForFieldName('type');
      const valueNode = node.childForFieldName('value');
      const docstring = this.extractDocstring(content, node.startPosition.row + 1);

      const varNode = this.createNode(
        filePath,
        NodeKind.Variable,
        name,
        node.startPosition.row + 1,
        node.endPosition.row + 1,
        node.startPosition.column,
        node.endPosition.column,
        {
          qualifiedName,
          docstring,
          type: typeNode ? typeNode.text : undefined,
          value: valueNode ? valueNode.text : undefined,
        }
      );
      nodes.push(varNode);
      edges.push(this.createEdge(parentId, varNode.id, EdgeKind.Contains));

      nameNode = nameNode.nextSibling;
    }
  }

  /** Обрабатывает вызов функции. */
  protected processCallExpression(
    node: any,
    filePath: string,
    content: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    errors: IExtractionError[]
  ): void {
    const funcNode = node.childForFieldName('function');
    if (!funcNode) return;

    const line = node.startPosition.row + 1;
    const column = node.startPosition.column;

    let funcName: string | undefined;

    if (funcNode.type === 'identifier') {
      funcName = funcNode.text;

      // panic — извлекаем Throw
      if (funcName === 'panic') {
        const throwNode = this.createNode(
          filePath,
          NodeKind.Throw,
          'panic',
          line,
          line,
          column,
          node.endPosition.column
        );
        nodes.push(throwNode);
        edges.push(this.createEdge(parentId, throwNode.id, EdgeKind.Contains));

        const argNode = node.childForFieldName('arguments');
        if (argNode) {
          edges.push(this.createEdge(throwNode.id, parentId, EdgeKind.Throws, {
            metadata: { expression: argNode.text },
            line,
            column: argNode.startPosition.column,
          }));
        }
        return;
      }

      // recover — извлекаем Catch
      if (funcName === 'recover') {
        const catchNode = this.createNode(
          filePath,
          NodeKind.Catch,
          'recover',
          line,
          line,
          column,
          node.endPosition.column
        );
        nodes.push(catchNode);
        edges.push(this.createEdge(parentId, catchNode.id, EdgeKind.Contains));
        return;
      }
    } else if (funcNode.type === 'selector_expression') {
      const sel = funcNode.childForFieldName('selector');
      if (sel) {
        funcName = sel.text;
      }
    }

    if (funcName) {
      edges.push(this.createEdge(parentId, this.nodeId(filePath, NodeKind.Function, funcName, 0), EdgeKind.Calls, {
        metadata: { referenceName: funcName },
        line,
        column,
      }));
    }
  }

  /** Обрабатывает defer — извлекает Try. */
  protected processDeferStatement(
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
      'defer',
      line,
      node.endPosition.row + 1,
      node.startPosition.column,
      node.endPosition.column
    );
    nodes.push(tryNode);
    edges.push(this.createEdge(parentId, tryNode.id, EdgeKind.Contains));

    // Рекурсивно обрабатываем вызов внутри defer
    let child = node.firstChild;
    while (child) {
      if (child.type === 'call_expression') {
        this.processCallExpression(child, filePath, content, tryNode.id, nodes, edges, unresolvedRefs, errors);
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
      if (child.type === 'parameter_declaration') {
        const nameNode = child.childForFieldName('name');
        if (nameNode && nameNode.text !== '_') {
          let paramName = nameNode.text;
          // Несколько параметров одного типа
          let nameChild = nameNode.firstChild;
          while (nameChild) {
            if (nameChild.type === 'identifier' && nameChild.text !== '_') {
              const paramNode = this.createNode(
                filePath,
                NodeKind.Parameter,
                nameChild.text,
                child.startPosition.row + 1,
                child.endPosition.row + 1,
                child.startPosition.column,
                child.endPosition.column
              );
              nodes.push(paramNode);
              edges.push(this.createEdge(parentId, paramNode.id, EdgeKind.Contains));
            }
            nameChild = nameChild.nextSibling;
          }
        }
      }
      child = child.nextSibling;
    }
  }

  /** Обрабатывает результат функции. */
  protected processResult(
    node: any,
    filePath: string,
    content: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    errors: IExtractionError[]
  ): void {
    // Результат может быть параметрами или типом
    let child = node.firstChild;
    while (child) {
      if (child.type === 'parameter_declaration') {
        const nameNode = child.childForFieldName('name');
        if (nameNode && nameNode.text !== '_') {
          let nameChild = nameNode.firstChild;
          while (nameChild) {
            if (nameChild.type === 'identifier' && nameChild.text !== '_') {
              const paramNode = this.createNode(
                filePath,
                NodeKind.Parameter,
                nameChild.text,
                child.startPosition.row + 1,
                child.endPosition.row + 1,
                child.startPosition.column,
                child.endPosition.column
              );
              nodes.push(paramNode);
              edges.push(this.createEdge(parentId, paramNode.id, EdgeKind.Contains));
            }
            nameChild = nameChild.nextSibling;
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
      } else if (child.type === 'defer_statement') {
        this.processDeferStatement(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
      } else if (child.type === 'expression_statement') {
        let expr = child.firstChild;
        while (expr) {
          if (expr.type === 'call_expression') {
            this.processCallExpression(expr, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
          }
          expr = expr.nextSibling;
        }
      } else if (child.type === 'if_statement' || child.type === 'for_statement' || child.type === 'range_clause') {
        // Рекурсия по управлению потоком
        let inner = child.firstChild;
        while (inner) {
          this.processFunctionBody(inner, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
          inner = inner.nextSibling;
        }
      }
      child = child.nextSibling;
    }
  }

  /** Проверяет, является ли получатель указателем. */
  protected isPointerReceiver(receiver: any): boolean {
    const paramList = receiver.firstChild;
    if (!paramList) return false;
    const typeField = paramList.childForFieldName('type');
    return typeField?.type === 'pointer_type' || false;
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
    return returnType ? `${sig} ${returnType}` : sig;
  }

  /** Извлекает тип возвращаемого значения. */
  protected extractReturnType(node: any): string | undefined {
    const resultNode = node.childForFieldName('result');
    if (!resultNode) return undefined;

    // Если результат — параметр с именем, берём тип
    const firstParam = resultNode.firstChild;
    if (firstParam && firstParam.type === 'parameter_declaration') {
      const typeNode = firstParam.childForFieldName('type');
      if (typeNode) return typeNode.text;
    }

    // Если результат — просто тип
    if (resultNode.type === 'type_identifier' || resultNode.type === 'pointer_type' || resultNode.type === 'map_type' || resultNode.type === 'slice_type' || resultNode.type === 'channel_type') {
      return resultNode.text;
    }

    return undefined;
  }

  /** Проверяет, содержит ли узел указанный текст. */
  protected nodeContainsText(node: any, text: string): boolean {
    const lines = [];
    const startRow = node.startPosition.row;
    const endRow = node.endPosition.row;
    const allLines = this._getContentLines(node);
    for (let i = startRow; i <= endRow; i++) {
      lines.push(allLines[i] ?? '');
    }
    return lines.join('\n').includes(text);
  }

  /** Получает строки контента из узла. */
  protected _getContentLines(node: any): string[] {
    // Кэшируем строки контента
    if (!(node as any)._cachedLines) {
      const content = this._extractContentFromNode(node);
      (node as any)._cachedLines = content.split('\n');
    }
    return (node as any)._cachedLines;
  }

  /** Извлекает контент из узла через source field. */
  protected _extractContentFromNode(node: any): string {
    // tree-sitter node.text содержит текст узла
    return node.text || '';
  }
}
