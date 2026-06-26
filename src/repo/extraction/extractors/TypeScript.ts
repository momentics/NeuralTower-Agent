/**
 * Экстрактор для TypeScript/JavaScript.
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

export class TypeScriptExtractor extends ExtractorBase {
  public getLanguage(): string {
    return 'typescript';
  }

  public getSupportedExtensions(): string[] {
    return ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
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
      const tsGrammar = require('tree-sitter-typescript');

      const p = new parser.Parser();
      const grammar = filePath.endsWith('.tsx')
        ? tsGrammar.TSX
        : tsGrammar.TSTypeScript;
      p.setLanguage(grammar);

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
      if (root.type === 'lexical_declaration' || root.type === 'statement_block') {
        // Пустой или повреждённый файл
        return { nodes, edges, unresolvedRefs, errors, durationMs: 0 };
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

      // Обработка объявлений верхнего уровня
      this.processTsNodes(
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

  /** Обрабатывает узлы AST для TypeScript. */
  protected processTsNodes(
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

      case 'class_declaration':
        this.processClassDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'class_expression':
        this.processClassExpression(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'function_declaration':
        this.processFunctionDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'function_expression':
      case 'arrow_function':
        this.processFunctionExpression(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'method_definition':
        this.processMethodDefinition(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'property_definition':
        this.processPropertyDefinition(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'lexical_declaration':
      case 'variable_declaration':
        this.processVariableDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'interface_declaration':
        this.processInterfaceDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'type_alias_declaration':
        this.processTypeAliasDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'enum_declaration':
        this.processEnumDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'import_statement':
        this.processImportStatement(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      case 'export_statement':
      case 'export_named_declaration':
      case 'export_all_declaration':
        this.processExportStatement(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      case 'try_statement':
        this.processTryStatement(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      case 'throw_statement':
        this.processThrowStatement(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      case 'namespace':
      case 'ambient_declaration':
        this.processNamespace(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'call_expression':
        this.processCallExpression(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      case 'decorator':
        this.processDecorator(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      default:
        // Рекурсия по дочерним узлам
        let child = node.firstChild;
        while (child) {
          this.processTsNodes(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
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
      this.processTsNodes(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
      child = child.nextSibling;
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
    const decorators = this.extractDecorators(node, content);
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
        decorators,
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
    const implementsList = node.childForFieldName('implements');
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
        this.processTsNodes(child, filePath, content, classNode.id, nodes, edges, unresolvedRefs, errors, qualifiedName);
        child = child.nextSibling;
      }
    }
  }

  /** Обрабатывает выражение класса. */
  protected processClassExpression(
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
    const name = nameNode ? nameNode.text : 'АнонимныйКласс';
    const qualifiedName = qualifiedNamePrefix ? `${qualifiedNamePrefix}.${name}` : name;
    const isAbstract = this.hasModifier(node, 'abstract');
    const decorators = this.extractDecorators(node, content);

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
        isAbstract,
        decorators,
      }
    );
    nodes.push(classNode);
    edges.push(this.createEdge(parentId, classNode.id, EdgeKind.Contains));

    const body = node.childForFieldName('body');
    if (body) {
      let child = body.firstChild;
      while (child) {
        this.processTsNodes(child, filePath, content, classNode.id, nodes, edges, unresolvedRefs, errors, qualifiedName);
        child = child.nextSibling;
      }
    }
  }

  /** Обрабатывает объявление функции. */
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
    const isAsync = this.hasModifier(node, 'async');
    const decorators = this.extractDecorators(node, content);
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
        isAsync,
        decorators,
        returnType,
        visibility: this.extractVisibility(node),
      }
    );
    nodes.push(funcNode);
    edges.push(this.createEdge(parentId, funcNode.id, EdgeKind.Contains));

    // Параметры типов
    const typeParams = node.childForFieldName('type_parameters');
    if (typeParams) {
      this.processTypeParameters(typeParams, filePath, content, funcNode.id, nodes, edges, unresolvedRefs, errors);
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

  /** Обрабатывает выражение функции. */
  protected processFunctionExpression(
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
    const name = nameNode ? nameNode.text : (node.type === 'arrow_function' ? 'СтрелочнаяФункция' : 'АнонимнаяФункция');
    const qualifiedName = qualifiedNamePrefix ? `${qualifiedNamePrefix}.${name}` : name;
    const isAsync = this.hasModifier(node, 'async');
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
        signature,
        isAsync,
        returnType,
      }
    );
    nodes.push(funcNode);
    edges.push(this.createEdge(parentId, funcNode.id, EdgeKind.Contains));

    const params = node.childForFieldName('parameters');
    if (params) {
      this.processParameters(params, filePath, content, funcNode.id, nodes, edges, unresolvedRefs, errors);
    }

    const body = node.childForFieldName('body');
    if (body) {
      this.processFunctionBody(body, filePath, content, funcNode.id, nodes, edges, unresolvedRefs, errors);
    }
  }

  /** Обрабатывает определение метода. */
  protected processMethodDefinition(
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
    const isAsync = this.hasModifier(node, 'async');
    const isStatic = this.hasModifier(node, 'static');
    const isAbstract = this.hasModifier(node, 'abstract');
    const decorators = this.extractDecorators(node, content);
    const docstring = this.extractDocstring(content, node.startPosition.row + 1);
    const signature = this.extractFunctionSignature(node, content);
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
        isAsync,
        isStatic,
        isAbstract,
        decorators,
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

    // Обработка тела
    const body = node.childForFieldName('body');
    if (body) {
      this.processFunctionBody(body, filePath, content, methodNode.id, nodes, edges, unresolvedRefs, errors);
    }
  }

  /** Обрабатывает определение свойства. */
  protected processPropertyDefinition(
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
    const decorators = this.extractDecorators(node, content);
    const docstring = this.extractDocstring(content, node.startPosition.row + 1);

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
        isStatic,
        decorators,
        visibility: this.extractVisibility(node),
      }
    );
    nodes.push(propNode);
    edges.push(this.createEdge(parentId, propNode.id, EdgeKind.Contains));
  }

  /** Обрабатывает объявление переменной. */
  protected processVariableDeclaration(
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
      if (child.type === 'variable_declarator') {
        const nameNode = child.childForFieldName('name');
        const valueNode = child.childForFieldName('value');
        if (nameNode) {
          const name = nameNode.text;
          const qualifiedName = qualifiedNamePrefix ? `${qualifiedNamePrefix}.${name}` : name;

          // Проверка, является ли значение выражением класса
          if (valueNode && valueNode.type === 'class_expression') {
            const classNode = this.createNode(
              filePath,
              NodeKind.Class,
              name,
              child.startPosition.row + 1,
              child.endPosition.row + 1,
              child.startPosition.column,
              child.endPosition.column,
              {
                qualifiedName,
                visibility: this.extractVisibility(node),
              }
            );
            nodes.push(classNode);
            edges.push(this.createEdge(parentId, classNode.id, EdgeKind.Contains));

            let cchild = valueNode.firstChild;
            while (cchild) {
              this.processTsNodes(cchild, filePath, content, classNode.id, nodes, edges, unresolvedRefs, errors, qualifiedName);
              cchild = cchild.nextSibling;
            }
          } else {
            const varNode = this.createNode(
              filePath,
              NodeKind.Variable,
              name,
              child.startPosition.row + 1,
              child.endPosition.row + 1,
              child.startPosition.column,
              child.endPosition.column,
              {
                qualifiedName,
                visibility: this.extractVisibility(node),
              }
            );
            nodes.push(varNode);
            edges.push(this.createEdge(parentId, varNode.id, EdgeKind.Contains));
          }
        }
      }
      child = child.nextSibling;
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

    // Наследование
    const extendsList = node.childForFieldName('extends');
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

    // Параметры типов
    const typeParams = node.childForFieldName('type_parameters');
    if (typeParams) {
      this.processTypeParameters(typeParams, filePath, content, ifaceNode.id, nodes, edges, unresolvedRefs, errors);
    }

    // Обработка тела
    const body = node.childForFieldName('body');
    if (body) {
      let child = body.firstChild;
      while (child) {
        this.processTsNodes(child, filePath, content, ifaceNode.id, nodes, edges, unresolvedRefs, errors, qualifiedName);
        child = child.nextSibling;
      }
    }
  }

  /** Обрабатывает объявление алиаса типа. */
  protected processTypeAliasDeclaration(
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

    // Обработка членов
    const body = node.childForFieldName('body');
    if (body) {
      let child = body.firstChild;
      while (child) {
        if (child.type === 'formal_parameter') {
          const memberName = child.text;
          const memberNode = this.createNode(
            filePath,
            NodeKind.EnumMember,
            memberName,
            child.startPosition.row + 1,
            child.endPosition.row + 1,
            child.startPosition.column,
            child.endPosition.column,
            {
              qualifiedName: `${qualifiedName}.${memberName}`,
            }
          );
          nodes.push(memberNode);
          edges.push(this.createEdge(enumNode.id, memberNode.id, EdgeKind.Contains));
        }
        child = child.nextSibling;
      }
    }
  }

  /** Обрабатывает импорт. */
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
    const sourceNode = node.childForFieldName('source');
    if (!sourceNode) return;

    const sourceText = sourceNode.text.replace(/['"]/g, '');
    const line = node.startPosition.row + 1;
    const column = node.startPosition.column;

    const importNode = this.createNode(
      filePath,
      NodeKind.Import,
      sourceText,
      line,
      line,
      column,
      sourceNode.endPosition.column
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

    // Обработка импортируемых спецификаторов
    let child = node.firstChild;
    while (child) {
      if (child.type === 'import_clause') {
        let spec = child.firstChild;
        while (spec) {
          if (spec.type === 'import_specifier') {
            const nameNode = spec.childForFieldName('name');
            const aliasNode = spec.childForFieldName('alias');
            if (nameNode) {
              const importedName = nameNode.text;
              const localName = aliasNode ? aliasNode.text : importedName;
              edges.push(this.createEdge(importNode.id, this.nodeId(filePath, NodeKind.Import, localName, line), EdgeKind.ReExports, {
                metadata: { importedName, localName },
                line,
                column,
              }));
            }
          }
          spec = spec.nextSibling;
        }
      }
      child = child.nextSibling;
    }
  }

  /** Обрабатывает экспорт. */
  protected processExportStatement(
    node: any,
    filePath: string,
    content: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    errors: IExtractionError[]
  ): void {
    if (node.type === 'export_all_declaration') {
      const sourceNode = node.childForFieldName('source');
      if (sourceNode) {
        const sourceText = sourceNode.text.replace(/['"]/g, '');
        const line = node.startPosition.row + 1;

        const exportNode = this.createNode(
          filePath,
          NodeKind.Export,
          `* from ${sourceText}`,
          line,
          line,
          node.startPosition.column,
          node.endPosition.column
        );
        nodes.push(exportNode);
        edges.push(this.createEdge(parentId, exportNode.id, EdgeKind.Contains));

        unresolvedRefs.push(this.createUnresolvedRef(
          exportNode.id,
          sourceText,
          EdgeKind.ReExports,
          line,
          node.startPosition.column,
          filePath
        ));
      }
    } else if (node.type === 'export_named_declaration') {
      const sourceNode = node.childForFieldName('source');
      if (sourceNode) {
        const sourceText = sourceNode.text.replace(/['"]/g, '');
        const line = node.startPosition.row + 1;

        const exportNode = this.createNode(
          filePath,
          NodeKind.Export,
          sourceText,
          line,
          line,
          node.startPosition.column,
          node.endPosition.column
        );
        nodes.push(exportNode);
        edges.push(this.createEdge(parentId, exportNode.id, EdgeKind.Contains));

        unresolvedRefs.push(this.createUnresolvedRef(
          exportNode.id,
          sourceText,
          EdgeKind.ReExports,
          line,
          node.startPosition.column,
          filePath
        ));
      }

      // Обработка экспортируемых объявлений
      let child = node.firstChild;
      while (child) {
        if (child.type !== 'string' && child.type !== 'import_clause') {
          this.processTsNodes(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
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
      NodeKind.Try,
      'try',
      line,
      node.endPosition.row + 1,
      node.startPosition.column,
      node.endPosition.column
    );
    nodes.push(tryNode);
    edges.push(this.createEdge(parentId, tryNode.id, EdgeKind.Contains));

    const catchClause = node.childForFieldName('handler');
    if (catchClause) {
      const catchNode = this.createNode(
        filePath,
        NodeKind.Catch,
        'catch',
        catchClause.startPosition.row + 1,
        catchClause.endPosition.row + 1,
        catchClause.startPosition.column,
        catchClause.endPosition.column
      );
      nodes.push(catchNode);
      edges.push(this.createEdge(tryNode.id, catchNode.id, EdgeKind.Catches));

      const catchParam = catchClause.childForFieldName('parameter');
      if (catchParam) {
        const paramName = catchParam.text;
        const paramNode = this.createNode(
          filePath,
          NodeKind.Parameter,
          paramName,
          catchParam.startPosition.row + 1,
          catchParam.endPosition.row + 1,
          catchParam.startPosition.column,
          catchParam.endPosition.column
        );
        nodes.push(paramNode);
        edges.push(this.createEdge(catchNode.id, paramNode.id, EdgeKind.Contains));
      }
    }

    // Обработка finally
    const finallyClause = node.childForFieldName('finalizer');
    if (finallyClause) {
      let child = finallyClause.firstChild;
      while (child) {
        this.processTsNodes(child, filePath, content, tryNode.id, nodes, edges, unresolvedRefs, errors);
        child = child.nextSibling;
      }
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
    const argumentNode = node.childForFieldName('argument');

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

  /** Обрабатывает namespace. */
  protected processNamespace(
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

    const nsNode = this.createNode(
      filePath,
      NodeKind.Namespace,
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
    nodes.push(nsNode);
    edges.push(this.createEdge(parentId, nsNode.id, EdgeKind.Contains));

    const body = node.childForFieldName('body');
    if (body) {
      let child = body.firstChild;
      while (child) {
        this.processTsNodes(child, filePath, content, nsNode.id, nodes, edges, unresolvedRefs, errors, qualifiedName);
        child = child.nextSibling;
      }
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
    } else if (funcNode.type === 'member_expression') {
      const prop = funcNode.childForFieldName('property');
      if (prop) {
        funcName = prop.text;
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

  /** Обрабатывает декоратор. */
  protected processDecorator(
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
    const decoratorText = node.text.slice(1); // Удаляем @

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
        const nameNode = child.childForFieldName('pattern');
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
      if (child.type === 'type_identifier') {
        const tpName = child.text;
        const tpNode = this.createNode(
          filePath,
          NodeKind.TypeParameter,
          tpName,
          child.startPosition.row + 1,
          child.endPosition.row + 1,
          child.startPosition.column,
          child.endPosition.column
        );
        nodes.push(tpNode);
        edges.push(this.createEdge(parentId, tpNode.id, EdgeKind.Contains));
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
      } else if (child.type === 'throw_statement') {
        this.processThrowStatement(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
      } else if (child.type === 'try_statement') {
        this.processTryStatement(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
      } else if (child.type === 'return_statement') {
        // Пропускаем операторы return
      } else if (child.type === 'expression_statement') {
        let expr = child.firstChild;
        while (expr) {
          if (expr.type === 'call_expression') {
            this.processCallExpression(expr, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
          }
          expr = expr.nextSibling;
        }
      } else if (child.type === 'if_statement' || child.type === 'for_statement' || child.type === 'while_statement' || child.type === 'do_statement') {
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
    return returnType ? `${sig}: ${returnType}` : sig;
  }

  /** Извлекает тип возвращаемого значения. */
  protected extractReturnType(node: any): string | undefined {
    const retType = node.childForFieldName('return_type');
    if (retType) {
      return retType.text;
    }
    return undefined;
  }
}
