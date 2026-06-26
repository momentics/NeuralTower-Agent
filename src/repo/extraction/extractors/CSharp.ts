/**
 * Экстрактор для C#.
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
  Language,
} from '../../ntgraph/Types';
import { ExtractorBase } from '../ExtractorBase';

export class CSharpExtractor extends ExtractorBase {
  public getLanguage(): Language {
    return 'csharp';
  }

  public getSupportedExtensions(): string[] {
    return ['.cs'];
  }

  public extract(
    content: string,
    filePath: string,
    _frameworkNames?: string[]
  ): IExtractionResult {
    const nodes: INode[] = [];
    const edges: IEdge[] = [];
    const unresolvedRefs: IUnresolvedReference[] = [];
    const errors: IExtractionError[] = [];

    try {
      const parser = require('tree-sitter');
      const csGrammar = require('tree-sitter-c-sharp');

      const p = new parser.Parser();
      p.setLanguage(csGrammar);

      const tree = p.parse(content);
      if (!tree) {
        errors.push(this.createError(
          'Не удалось разобрать файл',
          filePath,
          'error',
          'PARSE_FAILED'
        ));
        return { nodes, edges, unresolvedReferences: unresolvedRefs, errors, durationMs: 0 };
      }

      const root = tree.rootNode;
      if (root.type === 'compilation_unit' && root.childCount === 0) {
        return { nodes, edges, unresolvedReferences: unresolvedRefs, errors, durationMs: 0 };
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

      // Обработка верхнеуровневых объявлений
      this.processCsNodes(
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

    return { nodes, edges, unresolvedReferences: unresolvedRefs, errors, durationMs: 0 };
  }

  /** Обрабатывает узлы AST для C#. */
  protected processCsNodes(
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
      case 'compilation_unit':
        this.processCompilationUnit(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      case 'class_declaration':
        this.processClassDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'constructor_declaration':
        this.processConstructorDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'method_declaration':
        this.processMethodDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'property_declaration':
        this.processPropertyDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'field_declaration':
        this.processFieldDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'local_declaration_statement':
        this.processLocalDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'interface_declaration':
        this.processInterfaceDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'using_alias_directive':
        this.processUsingAliasDirective(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'enum_declaration':
        this.processEnumDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'using_directive':
        this.processUsingDirective(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      case 'try_statement':
        this.processTryStatement(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      case 'throw_statement':
        this.processThrowStatement(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      case 'attribute_declaration':
        this.processAttributeDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      case 'namespace_declaration':
        this.processNamespaceDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'type_argument_list':
        this.processTypeArgumentList(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      default:
        // Рекурсия по дочерним узлам
        let child = node.firstChild;
        while (child) {
          this.processCsNodes(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
          child = child.nextSibling;
        }
    }
  }

  /** Обрабатывает единицу компиляции. */
  protected processCompilationUnit(
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
      this.processCsNodes(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
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
    const isSealed = this.hasModifier(node, 'sealed');
    const decorators = this.extractAttributes(node, content);
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
        isSealed,
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
    const baseList = node.childForFieldName('bases');
    if (baseList) {
      let base = baseList.firstChild;
      while (base) {
        if (base.type === 'base_list') {
          let item = base.firstChild;
          while (item) {
            const baseName = item.text;
            edges.push(this.createEdge(classNode.id, this.nodeId(filePath, NodeKind.Class, baseName, 0), EdgeKind.Extends, {
              metadata: { referenceName: baseName },
              line: item.startPosition.row + 1,
              column: item.startPosition.column,
            }));
            unresolvedRefs.push(this.createUnresolvedRef(
              classNode.id,
              baseName,
              EdgeKind.Extends,
              item.startPosition.row + 1,
              item.startPosition.column,
              filePath
            ));
            item = item.nextSibling;
          }
        }
        base = base.nextSibling;
      }
    }

    // Обработка тела
    const body = node.childForFieldName('body');
    if (body) {
      let child = body.firstChild;
      while (child) {
        this.processCsNodes(child, filePath, content, classNode.id, nodes, edges, unresolvedRefs, errors, qualifiedName);
        child = child.nextSibling;
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
    const isStatic = this.hasModifier(node, 'static');
    const decorators = this.extractAttributes(node, content);
    const docstring = this.extractDocstring(content, node.startPosition.row + 1);
    const signature = this.extractMethodSignature(node, content);

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
        isStatic,
        decorators,
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
    const isAsync = this.hasModifier(node, 'async');
    const isStatic = this.hasModifier(node, 'static');
    const isAbstract = this.hasModifier(node, 'abstract');
    const isVirtual = this.hasModifier(node, 'virtual');
    const isOverride = this.hasModifier(node, 'override');
    const isSealed = this.hasModifier(node, 'sealed');
    const decorators = this.extractAttributes(node, content);
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
        isAsync,
        isStatic,
        isAbstract,
        isVirtual,
        isOverride,
        isSealed,
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
    const isStatic = this.hasModifier(node, 'static');
    const isAbstract = this.hasModifier(node, 'abstract');
    const isVirtual = this.hasModifier(node, 'virtual');
    const isOverride = this.hasModifier(node, 'override');
    const decorators = this.extractAttributes(node, content);
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
        isAbstract,
        isVirtual,
        isOverride,
        decorators,
        visibility: this.extractVisibility(node),
      }
    );
    nodes.push(propNode);
    edges.push(this.createEdge(parentId, propNode.id, EdgeKind.Contains));
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

    const decorators = this.extractAttributes(node, content);
    const docstring = this.extractDocstring(content, node.startPosition.row + 1);
    const isStatic = this.hasModifier(node, 'static');
    const isConst = this.hasModifier(node, 'const');
    const isReadonly = this.hasModifier(node, 'readonly');

    let decl = declarators.firstChild;
    while (decl) {
      if (decl.type === 'variable_declarator') {
        const nameNode = decl.childForFieldName('name');
        if (nameNode) {
          const name = nameNode.text;
          const qualifiedName = qualifiedNamePrefix ? `${qualifiedNamePrefix}.${name}` : name;

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
              isConst,
              isReadonly,
              decorators,
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

  /** Обрабатывает локальное объявление переменной. */
  protected processLocalDeclaration(
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

    // Базовые интерфейсы
    const baseList = node.childForFieldName('bases');
    if (baseList) {
      let base = baseList.firstChild;
      while (base) {
        if (base.type === 'base_list') {
          let item = base.firstChild;
          while (item) {
            const baseName = item.text;
            edges.push(this.createEdge(ifaceNode.id, this.nodeId(filePath, NodeKind.Interface, baseName, 0), EdgeKind.Extends, {
              metadata: { referenceName: baseName },
              line: item.startPosition.row + 1,
              column: item.startPosition.column,
            }));
            unresolvedRefs.push(this.createUnresolvedRef(
              ifaceNode.id,
              baseName,
              EdgeKind.Extends,
              item.startPosition.row + 1,
              item.startPosition.column,
              filePath
            ));
            item = item.nextSibling;
          }
        }
        base = base.nextSibling;
      }
    }

    // Обработка тела
    const body = node.childForFieldName('body');
    if (body) {
      let child = body.firstChild;
      while (child) {
        this.processCsNodes(child, filePath, content, ifaceNode.id, nodes, edges, unresolvedRefs, errors, qualifiedName);
        child = child.nextSibling;
      }
    }
  }

  /** Обрабатывает директиву псевдонима using. */
  protected processUsingAliasDirective(
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
      }
    );
    nodes.push(typeNode);
    edges.push(this.createEdge(parentId, typeNode.id, EdgeKind.Contains));

    const target = node.childForFieldName('target');
    if (target) {
      const targetName = target.text;
      edges.push(this.createEdge(typeNode.id, this.nodeId(filePath, NodeKind.TypeAlias, targetName, 0), EdgeKind.References, {
        metadata: { referenceName: targetName },
        line: target.startPosition.row + 1,
        column: target.startPosition.column,
      }));
      unresolvedRefs.push(this.createUnresolvedRef(
        typeNode.id,
        targetName,
        EdgeKind.References,
        target.startPosition.row + 1,
        target.startPosition.column,
        filePath
      ));
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
        if (child.type === 'enum_member_declaration') {
          const memberNameNode = child.childForFieldName('name');
          if (memberNameNode) {
            const memberName = memberNameNode.text;
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
        }
        child = child.nextSibling;
      }
    }
  }

  /** Обрабатывает директиву using. */
  protected processUsingDirective(
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

    const namespaceText = nameNode.text;
    const line = node.startPosition.row + 1;
    const column = node.startPosition.column;

    const importNode = this.createNode(
      filePath,
      NodeKind.Import,
      namespaceText,
      line,
      line,
      column,
      nameNode.endPosition.column
    );
    nodes.push(importNode);
    edges.push(this.createEdge(parentId, importNode.id, EdgeKind.Contains));

    unresolvedRefs.push(this.createUnresolvedRef(
      importNode.id,
      namespaceText,
      EdgeKind.Imports,
      line,
      column,
      filePath
    ));
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

    // Обработка catch
    let child = node.firstChild;
    while (child) {
      if (child.type === 'catch_clause') {
        const catchNode = this.createNode(
          filePath,
          NodeKind.Catch,
          'catch',
          child.startPosition.row + 1,
          child.endPosition.row + 1,
          child.startPosition.column,
          child.endPosition.column
        );
        nodes.push(catchNode);
        edges.push(this.createEdge(tryNode.id, catchNode.id, EdgeKind.Catches));

        const catchParam = child.childForFieldName('declaration');
        if (catchParam) {
          const nameNode = catchParam.childForFieldName('name');
          if (nameNode) {
            const paramName = nameNode.text;
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
      }
      child = child.nextSibling;
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
    const argumentNode = node.childForFieldName('throw_value');

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

  /** Обрабатывает объявление атрибута (декоратора). */
  protected processAttributeDeclaration(
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
    const decoratorText = node.text.replace(/[\[\]]/g, '').trim();

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

  /** Обрабатывает объявление пространства имён. */
  protected processNamespaceDeclaration(
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
        this.processCsNodes(child, filePath, content, nsNode.id, nodes, edges, unresolvedRefs, errors, qualifiedName);
        child = child.nextSibling;
      }
    }
  }

  /** Обрабатывает список аргументов типов (генерики). */
  protected processTypeArgumentList(
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
      if (child.type === 'generic_name') {
        const genericName = child.text;
        const genericNode = this.createNode(
          filePath,
          NodeKind.Generic,
          genericName,
          child.startPosition.row + 1,
          child.endPosition.row + 1,
          child.startPosition.column,
          child.endPosition.column
        );
        nodes.push(genericNode);
        edges.push(this.createEdge(parentId, genericNode.id, EdgeKind.Contains));

        unresolvedRefs.push(this.createUnresolvedRef(
          parentId,
          genericName,
          EdgeKind.References,
          child.startPosition.row + 1,
          child.startPosition.column,
          filePath
        ));
      }
      child = child.nextSibling;
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
      if (child.type === 'parameter') {
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
        const nameNode = child.childForFieldName('name');
        if (nameNode) {
          const tpName = nameNode.text;
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
      if (child.type === 'throw_statement') {
        this.processThrowStatement(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
      } else if (child.type === 'try_statement') {
        this.processTryStatement(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
      } else if (child.type === 'local_declaration_statement') {
        // Локальные переменные обрабатываются как дочерние узлы
        this.processCsNodes(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
      } else if (child.type === 'if_statement' || child.type === 'for_statement' || child.type === 'while_statement' || child.type === 'do_statement') {
        // Рекурсия по управляющим конструкциям
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

  /** Извлекает атрибуты перед узлом. */
  protected extractAttributes(node: any, content: string): string[] {
    const attributes: string[] = [];
    const lineIdx = node.startPosition.row - 1;
    const lines = content.split('\n');

    if (lineIdx < 0) return attributes;

    let i = lineIdx;
    while (i >= 0) {
      const line = lines[i]?.trim();
      if (!line) break;
      if (line.startsWith('[')) {
        const attr = line.replace(/[\[\]]/g, '').trim();
        attributes.unshift(attr);
      } else {
        break;
      }
      i--;
    }

    return attributes;
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

  /** Извлекает тип возвращаемого значения. */
  protected extractReturnType(node: any): string | undefined {
    const retType = node.childForFieldName('type');
    if (retType) {
      return retType.text;
    }
    return undefined;
  }
}
