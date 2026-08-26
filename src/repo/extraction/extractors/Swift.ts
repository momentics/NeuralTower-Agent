/**
 * Экстрактор для Swift.
 *
 * Парсинг через WASM-грамматики web-tree-sitter (WasmRuntime).
 * Поддержка классов, структур, перечислений, протоколов, функций, методов, свойств
 * и связанных типов.
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

export class SwiftExtractor extends ExtractorBase {
  public getLanguage(): Language {
    return 'swift';
  }

  public getSupportedExtensions(): string[] {
    return ['.swift'];
  }

  public extract(
    content: string,
    filePath: string,
    _frameworkNames?: string[]
  ): IExtractionResult {
    const start = Date.now();
    const nodes: INode[] = [];
    const edges: IEdge[] = [];
    const unresolvedRefs: IUnresolvedReference[] = [];
    const errors: IExtractionError[] = [];

    try {
      const p = getParserForFile('swift', filePath);
      if (!p) {
        errors.push(this.createError(
          'WASM-грамматика swift не загружена',
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
      if (!root || root.type !== 'source_file') {
        errors.push(this.createError(
          'Не удалось получить корневой узел',
          filePath,
          'error',
          'parse_error'
        ));
        return { nodes, edges, unresolvedReferences: unresolvedRefs, errors, durationMs: Date.now() - start };
      }

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

      // Обработка узлов верхнего уровня
      this.processSwiftNodes(
        root,
        filePath,
        content,
        moduleNode.id,
        nodes,
        edges,
        unresolvedRefs,
        errors
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

  /** Обрабатывает узлы AST для Swift. */
  protected processSwiftNodes(
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
      case 'source_file':
        this.processSourceFile(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      case 'class_declaration':
        this.processClassDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'struct_declaration':
        this.processStructDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'enum_declaration':
        this.processEnumDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'protocol_declaration':
        this.processProtocolDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'extension_declaration':
        this.processExtensionDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'function_declaration':
        this.processFunctionDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'method_declaration':
        this.processMethodDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'property_declaration':
        this.processPropertyDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'variable_declaration':
        this.processVariableDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'typealias_declaration':
        this.processTypealiasDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'import_declaration':
        this.processImportDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      case 'actor_declaration':
        this.processActorDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      default:
        // Рекурсия по дочерним узлам
        let child = node.firstChild;
        while (child) {
          this.processSwiftNodes(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
          child = child.nextSibling;
        }
    }
  }

  /** Обрабатывает исходный файл. */
  protected processSourceFile(
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
      this.processSwiftNodes(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
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
    const docstring = this.extractDocstring(content, node.startPosition.row + 1);
    const visibility = this.extractVisibility(node);

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
        visibility,
      }
    );
    nodes.push(classNode);
    edges.push(this.createEdge(parentId, classNode.id, EdgeKind.Contains));

    // Наследование и протоколы
    const inheritance = node.childForFieldName('inheritance');
    if (inheritance) {
      let spec = inheritance.firstChild;
      while (spec) {
        const specText = spec.text;
        const specLine = spec.startPosition.row + 1;
        const specColumn = spec.startPosition.column;
        const isFirst = spec === inheritance.firstChild;

        if (isFirst) {
          edges.push(this.createEdge(classNode.id, this.nodeId(filePath, NodeKind.Class, specText, 0), EdgeKind.Extends, {
            metadata: { referenceName: specText },
            line: specLine,
            column: specColumn,
          }));
          unresolvedRefs.push(this.createUnresolvedRef(
            classNode.id,
            specText,
            EdgeKind.Extends,
            specLine,
            specColumn,
            filePath
          ));
        } else {
          edges.push(this.createEdge(classNode.id, this.nodeId(filePath, NodeKind.Protocol, specText, 0), EdgeKind.Implements, {
            metadata: { referenceName: specText },
            line: specLine,
            column: specColumn,
          }));
          unresolvedRefs.push(this.createUnresolvedRef(
            classNode.id,
            specText,
            EdgeKind.Implements,
            specLine,
            specColumn,
            filePath
          ));
        }
        spec = spec.nextSibling;
      }
    }

    // Обработка тела
    const body = node.childForFieldName('body');
    if (body) {
      let child = body.firstChild;
      while (child) {
        this.processSwiftNodes(child, filePath, content, classNode.id, nodes, edges, unresolvedRefs, errors, qualifiedName);
        child = child.nextSibling;
      }
    }
  }

  /** Обрабатывает объявление структуры. */
  protected processStructDeclaration(
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
    const visibility = this.extractVisibility(node);

    const structNode = this.createNode(
      filePath,
      NodeKind.Struct,
      name,
      node.startPosition.row + 1,
      node.endPosition.row + 1,
      node.startPosition.column,
      node.endPosition.column,
      {
        qualifiedName,
        docstring,
        visibility,
      }
    );
    nodes.push(structNode);
    edges.push(this.createEdge(parentId, structNode.id, EdgeKind.Contains));

    // Протоколы (у структур нет суперклассов, только протоколы)
    const inheritance = node.childForFieldName('inheritance');
    if (inheritance) {
      let spec = inheritance.firstChild;
      while (spec) {
        const specText = spec.text;
        const specLine = spec.startPosition.row + 1;
        const specColumn = spec.startPosition.column;

        edges.push(this.createEdge(structNode.id, this.nodeId(filePath, NodeKind.Protocol, specText, 0), EdgeKind.Implements, {
          metadata: { referenceName: specText },
          line: specLine,
          column: specColumn,
        }));
        unresolvedRefs.push(this.createUnresolvedRef(
          structNode.id,
          specText,
          EdgeKind.Implements,
          specLine,
          specColumn,
          filePath
        ));
        spec = spec.nextSibling;
      }
    }

    // Обработка тела
    const body = node.childForFieldName('body');
    if (body) {
      let child = body.firstChild;
      while (child) {
        this.processSwiftNodes(child, filePath, content, structNode.id, nodes, edges, unresolvedRefs, errors, qualifiedName);
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
    const visibility = this.extractVisibility(node);

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
        visibility,
      }
    );
    nodes.push(enumNode);
    edges.push(this.createEdge(parentId, enumNode.id, EdgeKind.Contains));

    // Протоколы
    const inheritance = node.childForFieldName('inheritance');
    if (inheritance) {
      let spec = inheritance.firstChild;
      while (spec) {
        const specText = spec.text;
        const specLine = spec.startPosition.row + 1;
        const specColumn = spec.startPosition.column;

        edges.push(this.createEdge(enumNode.id, this.nodeId(filePath, NodeKind.Protocol, specText, 0), EdgeKind.Implements, {
          metadata: { referenceName: specText },
          line: specLine,
          column: specColumn,
        }));
        unresolvedRefs.push(this.createUnresolvedRef(
          enumNode.id,
          specText,
          EdgeKind.Implements,
          specLine,
          specColumn,
          filePath
        ));
        spec = spec.nextSibling;
      }
    }

    // Обработка тела — члены перечисления и методы
    const body = node.childForFieldName('body');
    if (body) {
      let child = body.firstChild;
      while (child) {
        if (child.type === 'enum_case_declaration') {
          this.processEnumCaseDeclaration(child, filePath, content, enumNode.id, nodes, edges, unresolvedRefs, errors, qualifiedName);
        } else {
          this.processSwiftNodes(child, filePath, content, enumNode.id, nodes, edges, unresolvedRefs, errors, qualifiedName);
        }
        child = child.nextSibling;
      }
    }
  }

  /** Обрабатывает объявление члена перечисления. */
  protected processEnumCaseDeclaration(
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
      if (child.type === 'enum_case_member') {
        const nameNode = child.childForFieldName('name');
        if (nameNode) {
          const memberName = nameNode.text;
          const memberQualifiedName = `${qualifiedNamePrefix}.${memberName}`;

          const memberNode = this.createNode(
            filePath,
            NodeKind.EnumMember,
            memberName,
            child.startPosition.row + 1,
            child.endPosition.row + 1,
            child.startPosition.column,
            child.endPosition.column,
            {
              qualifiedName: memberQualifiedName,
            }
          );
          nodes.push(memberNode);
          edges.push(this.createEdge(parentId, memberNode.id, EdgeKind.Contains));
        }
      }
      child = child.nextSibling;
    }
  }

  /** Обрабатывает объявление протокола. */
  protected processProtocolDeclaration(
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
    const visibility = this.extractVisibility(node);

    const protocolNode = this.createNode(
      filePath,
      NodeKind.Protocol,
      name,
      node.startPosition.row + 1,
      node.endPosition.row + 1,
      node.startPosition.column,
      node.endPosition.column,
      {
        qualifiedName,
        docstring,
        visibility,
      }
    );
    nodes.push(protocolNode);
    edges.push(this.createEdge(parentId, protocolNode.id, EdgeKind.Contains));

    // Наследование протоколов
    const inheritance = node.childForFieldName('inheritance');
    if (inheritance) {
      let spec = inheritance.firstChild;
      while (spec) {
        const specText = spec.text;
        const specLine = spec.startPosition.row + 1;
        const specColumn = spec.startPosition.column;

        edges.push(this.createEdge(protocolNode.id, this.nodeId(filePath, NodeKind.Protocol, specText, 0), EdgeKind.Extends, {
          metadata: { referenceName: specText },
          line: specLine,
          column: specColumn,
        }));
        unresolvedRefs.push(this.createUnresolvedRef(
          protocolNode.id,
          specText,
          EdgeKind.Extends,
          specLine,
          specColumn,
          filePath
        ));
        spec = spec.nextSibling;
      }
    }

    // Связанные типы (associatedtype)
    const body = node.childForFieldName('body');
    if (body) {
      let child = body.firstChild;
      while (child) {
        if (child.type === 'associatedtype_declaration') {
          this.processAssociatedtypeDeclaration(child, filePath, content, protocolNode.id, nodes, edges, unresolvedRefs, errors, qualifiedName);
        } else {
          this.processSwiftNodes(child, filePath, content, protocolNode.id, nodes, edges, unresolvedRefs, errors, qualifiedName);
        }
        child = child.nextSibling;
      }
    }
  }

  /** Обрабатывает объявление связанного типа. */
  protected processAssociatedtypeDeclaration(
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
    const docstring = this.extractDocstring(content, node.startPosition.row + 1);

    const assocNode = this.createNode(
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
      }
    );
    nodes.push(assocNode);
    edges.push(this.createEdge(parentId, assocNode.id, EdgeKind.Contains));

    // Ограничения типа
    const inheritance = node.childForFieldName('inheritance');
    if (inheritance) {
      let spec = inheritance.firstChild;
      while (spec) {
        const specText = spec.text;
        const specLine = spec.startPosition.row + 1;
        const specColumn = spec.startPosition.column;

        edges.push(this.createEdge(assocNode.id, this.nodeId(filePath, NodeKind.Protocol, specText, 0), EdgeKind.Extends, {
          metadata: { referenceName: specText },
          line: specLine,
          column: specColumn,
        }));
        unresolvedRefs.push(this.createUnresolvedRef(
          assocNode.id,
          specText,
          EdgeKind.Extends,
          specLine,
          specColumn,
          filePath
        ));
        spec = spec.nextSibling;
      }
    }
  }

  /** Обрабатывает объявление расширения. */
  protected processExtensionDeclaration(
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
    const typeNode = node.childForFieldName('type');
    if (!typeNode) return;

    const typeName = typeNode.text;
    const qualifiedName = qualifiedNamePrefix ? `${qualifiedNamePrefix}.${typeName}` : typeName;
    const docstring = this.extractDocstring(content, node.startPosition.row + 1);
    const visibility = this.extractVisibility(node);

    const extNode = this.createNode(
      filePath,
      NodeKind.Namespace,
      `extension_${typeName}`,
      node.startPosition.row + 1,
      node.endPosition.row + 1,
      node.startPosition.column,
      node.endPosition.column,
      {
        qualifiedName,
        docstring,
        visibility,
        extendedType: typeName,
      }
    );
    nodes.push(extNode);
    edges.push(this.createEdge(parentId, extNode.id, EdgeKind.Contains));

    // Ссылка на расширяемый тип
    const typeLine = typeNode.startPosition.row + 1;
    const typeColumn = typeNode.startPosition.column;
    edges.push(this.createEdge(extNode.id, this.nodeId(filePath, NodeKind.Class, typeName, 0), EdgeKind.References, {
      metadata: { referenceName: typeName },
      line: typeLine,
      column: typeColumn,
    }));
    unresolvedRefs.push(this.createUnresolvedRef(
      extNode.id,
      typeName,
      EdgeKind.References,
      typeLine,
      typeColumn,
      filePath
    ));

    // Протоколы расширения
    const inheritance = node.childForFieldName('inheritance');
    if (inheritance) {
      let spec = inheritance.firstChild;
      while (spec) {
        const specText = spec.text;
        const specLine = spec.startPosition.row + 1;
        const specColumn = spec.startPosition.column;

        edges.push(this.createEdge(extNode.id, this.nodeId(filePath, NodeKind.Protocol, specText, 0), EdgeKind.Implements, {
          metadata: { referenceName: specText },
          line: specLine,
          column: specColumn,
        }));
        unresolvedRefs.push(this.createUnresolvedRef(
          extNode.id,
          specText,
          EdgeKind.Implements,
          specLine,
          specColumn,
          filePath
        ));
        spec = spec.nextSibling;
      }
    }

    // Обработка тела
    const body = node.childForFieldName('body');
    if (body) {
      let child = body.firstChild;
      while (child) {
        this.processSwiftNodes(child, filePath, content, extNode.id, nodes, edges, unresolvedRefs, errors, qualifiedName);
        child = child.nextSibling;
      }
    }
  }

  /** Обрабатывает объявление актора. */
  protected processActorDeclaration(
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
    const visibility = this.extractVisibility(node);

    const actorNode = this.createNode(
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
        visibility,
        isActor: true,
      }
    );
    nodes.push(actorNode);
    edges.push(this.createEdge(parentId, actorNode.id, EdgeKind.Contains));

    // Протоколы
    const inheritance = node.childForFieldName('inheritance');
    if (inheritance) {
      let spec = inheritance.firstChild;
      while (spec) {
        const specText = spec.text;
        const specLine = spec.startPosition.row + 1;
        const specColumn = spec.startPosition.column;

        edges.push(this.createEdge(actorNode.id, this.nodeId(filePath, NodeKind.Protocol, specText, 0), EdgeKind.Implements, {
          metadata: { referenceName: specText },
          line: specLine,
          column: specColumn,
        }));
        unresolvedRefs.push(this.createUnresolvedRef(
          actorNode.id,
          specText,
          EdgeKind.Implements,
          specLine,
          specColumn,
          filePath
        ));
        spec = spec.nextSibling;
      }
    }

    // Обработка тела
    const body = node.childForFieldName('body');
    if (body) {
      let child = body.firstChild;
      while (child) {
        this.processSwiftNodes(child, filePath, content, actorNode.id, nodes, edges, unresolvedRefs, errors, qualifiedName);
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
    const docstring = this.extractDocstring(content, node.startPosition.row + 1);
    const visibility = this.extractVisibility(node);
    const returnType = this.extractReturnType(node);
    const isAsync = this.hasModifier(node, 'async');
    const isStatic = this.hasModifier(node, 'static');

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
        visibility,
        isAsync,
        isStatic,
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

    // Возвращаемый тип
    if (returnType) {
      const baseType = this.extractBaseType(returnType);
      if (baseType && !this.isPrimitiveType(baseType)) {
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
    const docstring = this.extractDocstring(content, node.startPosition.row + 1);
    const visibility = this.extractVisibility(node);
    const returnType = this.extractReturnType(node);
    const isAsync = this.hasModifier(node, 'async');
    const isStatic = this.hasModifier(node, 'static');
    const isMutating = this.hasModifier(node, 'mutating');

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
        visibility,
        isAsync,
        isStatic,
        isMutating,
        returnType,
      }
    );
    nodes.push(methodNode);
    edges.push(this.createEdge(parentId, methodNode.id, EdgeKind.Contains));

    // Параметры
    const params = node.childForFieldName('parameters');
    if (params) {
      this.processParameters(params, filePath, content, methodNode.id, nodes, edges, unresolvedRefs, errors);
    }

    // Возвращаемый тип
    if (returnType) {
      const baseType = this.extractBaseType(returnType);
      if (baseType && !this.isPrimitiveType(baseType)) {
        edges.push(this.createEdge(methodNode.id, this.nodeId(filePath, NodeKind.Class, baseType, 0), EdgeKind.Returns, {
          metadata: { referenceName: baseType },
          line: methodNode.startLine,
          column: methodNode.startColumn,
        }));
        unresolvedRefs.push(this.createUnresolvedRef(
          methodNode.id,
          baseType,
          EdgeKind.Returns,
          methodNode.startLine,
          methodNode.startColumn,
          filePath
        ));
      }
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
    const patternNode = node.childForFieldName('pattern');
    if (!patternNode) return;

    const nameNode = patternNode.firstChild;
    if (!nameNode || nameNode.type !== 'identifier') return;

    const name = nameNode.text;
    const qualifiedName = qualifiedNamePrefix ? `${qualifiedNamePrefix}.${name}` : name;
    const docstring = this.extractDocstring(content, node.startPosition.row + 1);
    const visibility = this.extractVisibility(node);
    const isStatic = this.hasModifier(node, 'static');
    const isLazy = this.hasModifier(node, 'lazy');
    const isLet = this.hasModifier(node, 'let');

    const propKind = isLet ? NodeKind.Property : NodeKind.Field;

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
        visibility,
        isStatic,
        isLazy,
      }
    );
    nodes.push(propNode);
    edges.push(this.createEdge(parentId, propNode.id, EdgeKind.Contains));

    // Тип свойства
    const typeNode = node.childForFieldName('type');
    if (typeNode) {
      const typeText = typeNode.text;
      const baseType = this.extractBaseType(typeText);
      if (baseType && !this.isPrimitiveType(baseType)) {
        edges.push(this.createEdge(propNode.id, this.nodeId(filePath, NodeKind.Class, baseType, 0), EdgeKind.TypeOf, {
          metadata: { referenceName: baseType },
          line: typeNode.startPosition.row + 1,
          column: typeNode.startPosition.column,
        }));
        unresolvedRefs.push(this.createUnresolvedRef(
          propNode.id,
          baseType,
          EdgeKind.TypeOf,
          typeNode.startPosition.row + 1,
          typeNode.startPosition.column,
          filePath
        ));
      }
    }
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
    const patternNode = node.childForFieldName('pattern');
    if (!patternNode) return;

    let pchild = patternNode.firstChild;
    while (pchild) {
      if (pchild.type === 'identifier') {
        const name = pchild.text;
        const qualifiedName = qualifiedNamePrefix ? `${qualifiedNamePrefix}.${name}` : name;
        const docstring = this.extractDocstring(content, node.startPosition.row + 1);
        const visibility = this.extractVisibility(node);
        const isStatic = this.hasModifier(node, 'static');
        const isLet = this.hasModifier(node, 'let');

        const varKind = isLet ? NodeKind.Constant : NodeKind.Variable;

        const varNode = this.createNode(
          filePath,
          varKind,
          name,
          node.startPosition.row + 1,
          node.endPosition.row + 1,
          node.startPosition.column,
          node.endPosition.column,
          {
            qualifiedName,
            docstring,
            visibility,
            isStatic,
          }
        );
        nodes.push(varNode);
        edges.push(this.createEdge(parentId, varNode.id, EdgeKind.Contains));

        // Тип переменной
        const typeNode = node.childForFieldName('type');
        if (typeNode) {
          const baseType = this.extractBaseType(typeNode.text);
          if (baseType && !this.isPrimitiveType(baseType)) {
            edges.push(this.createEdge(varNode.id, this.nodeId(filePath, NodeKind.Class, baseType, 0), EdgeKind.TypeOf, {
              metadata: { referenceName: baseType },
              line: typeNode.startPosition.row + 1,
              column: typeNode.startPosition.column,
            }));
            unresolvedRefs.push(this.createUnresolvedRef(
              varNode.id,
              baseType,
              EdgeKind.TypeOf,
              typeNode.startPosition.row + 1,
              typeNode.startPosition.column,
              filePath
            ));
          }
        }
        pchild = pchild.nextSibling;
      }
    }
  }

  /** Обрабатывает объявление псевдонима типа. */
  protected processTypealiasDeclaration(
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
    const visibility = this.extractVisibility(node);

    const typeAliasNode = this.createNode(
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
        visibility,
      }
    );
    nodes.push(typeAliasNode);
    edges.push(this.createEdge(parentId, typeAliasNode.id, EdgeKind.Contains));

    // Подлежащий тип
    const underlying = node.childForFieldName('type');
    if (underlying) {
      const underlyingText = underlying.text;
      const baseType = this.extractBaseType(underlyingText);
      if (baseType) {
        unresolvedRefs.push(this.createUnresolvedRef(
          typeAliasNode.id,
          baseType,
          EdgeKind.Extends,
          underlying.startPosition.row + 1,
          underlying.startPosition.column,
          filePath
        ));
      }
    }
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
    const pathNode = node.childForFieldName('path');
    if (!pathNode) return;

    const sourceText = pathNode.text;
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
    edges.push(this.createEdge(parentId, importNode.id, EdgeKind.Imports, {
      line,
      column,
    }));

    unresolvedRefs.push(this.createUnresolvedRef(
      importNode.id,
      sourceText,
      EdgeKind.Imports,
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
      if (child.type === 'parameter') {
        const secondNameNode = child.childForFieldName('second_name');
        const firstNameNode = child.childForFieldName('first_name');
        let paramName: string | undefined;

        if (secondNameNode) {
          paramName = secondNameNode.text;
        } else if (firstNameNode && firstNameNode.text !== '_') {
          paramName = firstNameNode.text;
        }

        if (paramName) {
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
            const baseType = this.extractBaseType(typeNode.text);
            if (baseType && !this.isPrimitiveType(baseType)) {
              edges.push(this.createEdge(paramNode.id, this.nodeId(filePath, NodeKind.Class, baseType, 0), EdgeKind.TypeOf, {
              metadata: { referenceName: baseType },
              line: typeNode.startPosition.row + 1,
              column: typeNode.startPosition.column,
            }));
            unresolvedRefs.push(this.createUnresolvedRef(
              paramNode.id,
              baseType,
              EdgeKind.TypeOf,
              typeNode.startPosition.row + 1,
              typeNode.startPosition.column,
              filePath
            ));
          }
        }
      }
      }
      child = child.nextSibling;
    }
  }

  /** Извлекает тип возвращаемого значения. */
  protected extractReturnType(node: any): string | undefined {
    const returnClause = node.childForFieldName('return_clause');
    if (!returnClause) return undefined;

    const typeNode = returnClause.firstChild;
    if (typeNode) {
      return typeNode.text;
    }
    return undefined;
  }

  /** Извлекает базовый тип из строки типа. */
  protected extractBaseType(typeText: string): string | undefined {
    if (!typeText) return undefined;

    let cleaned = typeText.trim();

    // Убираем опциональность
    cleaned = cleaned.replace(/\??$/, '');

    // Убираем ссылки на класс
    cleaned = cleaned.replace(/^&/, '');

    // Убираем указатели
    cleaned = cleaned.replace(/^\*+/, '');

    // Убираем ключевые слова обёрток
    cleaned = cleaned.replace(/^(Optional|ImplicitlyUnwrappedOptional)\(.+\)/, '$1');

    // Извлекаем имя типа
    const match = cleaned.match(/^[A-Z][a-zA-Z0-9_]*(?:\.[A-Z][a-zA-Z0-9_]*)*/);
    if (match) {
      return match[0];
    }

    return undefined;
  }

  /** Проверяет, является ли тип примитивным. */
  protected isPrimitiveType(typeName: string): boolean {
    const primitives = new Set([
      'Int', 'Int8', 'Int16', 'Int32', 'Int64',
      'UInt', 'UInt8', 'UInt16', 'UInt32', 'UInt64',
      'Float', 'Float32', 'Float64', 'Double',
      'Bool', 'String', 'Character',
      'Void', 'Never',
    ]);
    return primitives.has(typeName);
  }

  /** Проверяет наличие модификатора. */
  protected hasModifier(node: any, modifier: string): boolean {
    let child = node.firstChild;
    while (child) {
      if (child.type === 'modifiers') {
        let mod = child.firstChild;
        while (mod) {
          if (mod.text === modifier) return true;
          mod = mod.nextSibling;
        }
      }
      child = child.nextSibling;
    }
    return false;
  }

  /** Извлекает видимость из модификаторов. */
  protected extractVisibility(node: any): 'public' | 'private' | 'protected' | 'internal' | undefined {
    let child = node.firstChild;
    while (child) {
      if (child.type === 'modifiers') {
        let mod = child.firstChild;
        while (mod) {
          const text = mod.text;
          switch (text) {
            case 'public':
              return 'public';
            case 'private':
              return 'private';
            case 'fileprivate':
              return 'private';
            case 'internal':
              return 'internal';
            case 'private(set)':
              return 'private';
            case 'open':
              return 'public';
            default:
              break;
          }
          mod = mod.nextSibling;
        }
      }
      child = child.nextSibling;
    }
    return undefined;
  }
}
