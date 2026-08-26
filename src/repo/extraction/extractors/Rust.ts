/**
 * Экстрактор для Rust.
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

export class RustExtractor extends ExtractorBase {
  public getLanguage(): Language {
    return 'rust';
  }

  public getSupportedExtensions(): string[] {
    return ['.rs'];
  }

public extract(
    content: string,
    filePath: string,
    _frameworkNames?: string[]
  ): IExtractionResult {
    // Отслеживание времени извлечения
    const start = Date.now();
    const nodes: INode[] = [];
    const edges: IEdge[] = [];
    const unresolvedRefs: IUnresolvedReference[] = [];
    const errors: IExtractionError[] = [];

    try {
      const p = getParserForFile('rust', filePath);
      if (!p) {
        errors.push(this.createError(
          'WASM-грамматика rust не загружена',
          filePath,
          'error',
          'parse_error'
        ));
        return { nodes, edges, unresolvedReferences: unresolvedRefs, errors, durationMs: Date.now() - start };
      }

      const tree = p.parse(content);
      if (!tree) {
        errors.push(this.createError(
          'Не удалось распарсить файл',
          filePath,
          'error',
          'parse_error'
        ));
        return { nodes, edges, unresolvedReferences: unresolvedRefs, errors, durationMs: Date.now() - start };
      }

      const root = tree.rootNode;
      if (root.type === 'ERROR') {
        return { nodes, edges, unresolvedReferences: unresolvedRefs, errors, durationMs: Date.now() - start };
      }

      // Узел модуля
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

      // Обработка верхнего уровня
      this.processRustNodes(
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

  /** Обрабатывает узлы AST для Rust. */
  protected processRustNodes(
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

      case 'const_item':
        this.processConstItem(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'struct_item':
        this.processStructItem(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'function_item':
        this.processFunctionItem(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'function_declaration':
        this.processFunctionDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'impl_item':
        this.processImplItem(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'field_declaration':
        this.processFieldDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'enum_item':
        this.processEnumItem(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'trait_item':
        this.processTraitItem(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'type_item':
        this.processTypeItem(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'use_declaration':
        this.processUseDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      case 'try_expression':
        this.processTryExpression(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      case 'match_expression':
        this.processMatchExpression(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      case 'macro_invocation':
        this.processMacroInvocation(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      case 'item':
        this.processItem(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'mod_item':
        this.processModItem(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'let_declaration':
        this.processLetDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'attribute':
        this.processAttribute(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      default:
        // Рекурсия по детям
        let child = node.firstChild;
        while (child) {
          this.processRustNodes(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
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
      this.processRustNodes(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
      child = child.nextSibling;
    }
  }

  /** Обрабатывает объявление константы (Constant). */
  protected processConstItem(
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
    const qualifiedName = qualifiedNamePrefix ? `${qualifiedNamePrefix}::${name}` : name;
    const isPub = this.isPublic(node);
    const docstring = this.extractDocstring(content, node.startPosition.row + 1);

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
        docstring,
        visibility: isPub ? 'public' : undefined,
        isExported: isPub,
      }
    );
    nodes.push(constNode);
    edges.push(this.createEdge(parentId, constNode.id, EdgeKind.Contains));

    // Тип константы
    const constType = node.childForFieldName('type');
    if (constType) {
      const typeName = this.extractTypeName(constType.text);
      if (typeName) {
        edges.push(this.createEdge(constNode.id, this.nodeId(filePath, NodeKind.Class, typeName, 0), EdgeKind.References, {
          metadata: { referenceName: typeName },
          line: constType.startPosition.row + 1,
          column: constType.startPosition.column,
        }));
        unresolvedRefs.push(this.createUnresolvedRef(
          constNode.id,
          typeName,
          EdgeKind.References,
          constType.startPosition.row + 1,
          constType.startPosition.column,
          filePath
        ));
      }
    }
  }

  /** Обрабатывает объявление структуры (Class). */
  protected processStructItem(
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
    const qualifiedName = qualifiedNamePrefix ? `${qualifiedNamePrefix}::${name}` : name;
    const isPub = this.isPublic(node);
    const docstring = this.extractDocstring(content, node.startPosition.row + 1);
    const generics = this.extractGenerics(node, filePath, content, nodes, edges, unresolvedRefs, errors);
    const decorators = this.extractDeriveAttrs(node, content);

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
        visibility: isPub ? 'public' : undefined,
        isExported: isPub,
        decorators,
        typeParameters: generics,
      }
    );
    nodes.push(structNode);
    edges.push(this.createEdge(parentId, structNode.id, EdgeKind.Contains));

    // Типовые параметры
    const typeParamsNode = node.childForFieldName('type_parameters');
    if (typeParamsNode) {
      this.processTypeParameters(typeParamsNode, filePath, content, structNode.id, nodes, edges, unresolvedRefs, errors);
    }

    // Поля структуры
    const body = node.childForFieldName('body');
    if (body) {
      let field = body.firstChild;
      while (field) {
        if (field.type === 'field_declaration') {
          this.processFieldDeclaration(field, filePath, content, structNode.id, nodes, edges, unresolvedRefs, errors, qualifiedName);
        }
        field = field.nextSibling;
      }
    }
  }

  /** Обрабатывает объявление функции (Function). */
  protected processFunctionItem(
    node: any,
    filePath: string,
    content: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    errors: IExtractionError[],
    qualifiedNamePrefix: string,
    traitName: string | null = null
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;

    const name = nameNode.text;
    const qualifiedName = qualifiedNamePrefix ? `${qualifiedNamePrefix}::${name}` : name;
    const isPub = this.isPublic(node);
    const isAsync = this.hasModifier(node, 'async');
    const isUnsafe = this.hasModifier(node, 'unsafe');
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
        visibility: isPub ? 'public' : undefined,
        isExported: isPub,
        returnType,
      }
    );
    nodes.push(funcNode);
    edges.push(this.createEdge(parentId, funcNode.id, EdgeKind.Contains));

    // Ребро Overrides: метод impl Trait для Type переопределяет метод trait
    if (traitName) {
      edges.push(this.createEdge(funcNode.id, this.nodeId(filePath, NodeKind.Method, name, 0), EdgeKind.Overrides, {
        metadata: { referenceName: `${traitName}::${name}` },
        line: funcNode.startLine,
        column: funcNode.startColumn,
      }));
      unresolvedRefs.push(this.createUnresolvedRef(
        funcNode.id,
        `${traitName}::${name}`,
        EdgeKind.Overrides,
        funcNode.startLine,
        funcNode.startColumn,
        filePath
      ));
    }

    // Ребро Returns от функции к типу возвращаемого значения
    if (returnType) {
      const retTypeName = this.extractReturnType(node);
      if (retTypeName) {
        edges.push(this.createEdge(funcNode.id, this.nodeId(filePath, NodeKind.Class, retTypeName, 0), EdgeKind.Returns, {
          metadata: { referenceName: retTypeName },
          line: node.startPosition.row + 1,
          column: node.startPosition.column,
        }));
      }
    }

    // Типовые параметры
    const typeParamsNode = node.childForFieldName('type_parameters');
    if (typeParamsNode) {
      this.processTypeParameters(typeParamsNode, filePath, content, funcNode.id, nodes, edges, unresolvedRefs, errors);
    }

    // Параметры функции
    const paramsNode = node.childForFieldName('parameters');
    if (paramsNode) {
      this.processParameters(paramsNode, filePath, content, funcNode.id, nodes, edges, unresolvedRefs, errors);
    }

    // Тело функции
    const body = node.childForFieldName('body');
    if (body) {
      this.processFunctionBody(body, filePath, content, funcNode.id, nodes, edges, unresolvedRefs, errors);
    }
  }

  /** Обрабатывает объявление функции в trait (Method). */
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
    const qualifiedName = qualifiedNamePrefix ? `${qualifiedNamePrefix}::${name}` : name;
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
        isAbstract: true,
        returnType,
      }
    );
    nodes.push(methodNode);
    edges.push(this.createEdge(parentId, methodNode.id, EdgeKind.Contains));

    // Ребро Returns от метода к типу возвращаемого значения
    if (returnType) {
      const retTypeName = this.extractReturnType(node);
      if (retTypeName) {
        edges.push(this.createEdge(methodNode.id, this.nodeId(filePath, NodeKind.Class, retTypeName, 0), EdgeKind.Returns, {
          metadata: { referenceName: retTypeName },
          line: node.startPosition.row + 1,
          column: node.startPosition.column,
        }));
      }
    }

    // Типовые параметры
    const typeParamsNode = node.childForFieldName('type_parameters');
    if (typeParamsNode) {
      this.processTypeParameters(typeParamsNode, filePath, content, methodNode.id, nodes, edges, unresolvedRefs, errors);
    }

    // Параметры
    const paramsNode = node.childForFieldName('parameters');
    if (paramsNode) {
      this.processParameters(paramsNode, filePath, content, methodNode.id, nodes, edges, unresolvedRefs, errors);
    }
  }

  /** Обрабатывает блок impl (Method). */
  protected processImplItem(
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
    const forType = node.childForFieldName('for');
    const selfType = node.childForFieldName('type');

    if (!selfType) return;

    const typeName = selfType.text;
    const isTraitImpl = !!forType;
    const isPub = this.isPublic(node);
    const docstring = this.extractDocstring(content, node.startPosition.row + 1);

    const implNode = this.createNode(
      filePath,
      NodeKind.Class,
      `impl ${typeName}`,
      node.startPosition.row + 1,
      node.endPosition.row + 1,
      node.startPosition.column,
      node.endPosition.column,
      {
        qualifiedName: `${qualifiedNamePrefix}${typeName}`,
        docstring,
        isImpl: true,
        isTraitImpl,
        visibility: isPub ? 'public' : undefined,
      }
    );
    nodes.push(implNode);
    edges.push(this.createEdge(parentId, implNode.id, EdgeKind.Contains));

    // Типовые параметры impl
    const typeParamsNode = node.childForFieldName('type_parameters');
    if (typeParamsNode) {
      // Типовые параметры принадлежат типу, обрабатываются при создании узла типа
    }

    // Референс на тип
    edges.push(this.createEdge(implNode.id, this.nodeId(filePath, NodeKind.Class, typeName, 0), EdgeKind.References, {
      metadata: { referenceName: typeName },
      line: selfType.startPosition.row + 1,
      column: selfType.startPosition.column,
    }));
    unresolvedRefs.push(this.createUnresolvedRef(
      implNode.id,
      typeName,
      EdgeKind.References,
      selfType.startPosition.row + 1,
      selfType.startPosition.column,
      filePath
    ));

    // Ребро Implements от типа к trait, который он реализует
    if (forType) {
      const traitName = forType.text;
      edges.push(this.createEdge(implNode.id, this.nodeId(filePath, NodeKind.Interface, traitName, 0), EdgeKind.Implements, {
        metadata: { referenceName: traitName },
        line: forType.startPosition.row + 1,
        column: forType.startPosition.column,
      }));
      unresolvedRefs.push(this.createUnresolvedRef(
        implNode.id,
        traitName,
        EdgeKind.Implements,
        forType.startPosition.row + 1,
        forType.startPosition.column,
        filePath
      ));
    }

    // Тело impl
    const body = node.childForFieldName('body');
    if (body) {
      let child = body.firstChild;
      while (child) {
        if (child.type === 'function_item') {
          const traitName = forType ? forType.text : null;
          this.processFunctionItem(child, filePath, content, implNode.id, nodes, edges, unresolvedRefs, errors, `${qualifiedNamePrefix}${typeName}`, traitName);
        } else if (child.type === 'associated_type') {
          this.processAssociatedType(child, filePath, content, implNode.id, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        } else if (child.type === 'associated_constant') {
          this.processAssociatedConstant(child, filePath, content, implNode.id, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        }
        child = child.nextSibling;
      }
    }
  }

  /** Обрабатывает поле структуры (Property). */
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
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;

    const name = nameNode.text;
    const qualifiedName = qualifiedNamePrefix ? `${qualifiedNamePrefix}::${name}` : name;
    const isPub = this.isPublic(node);
    const docstring = this.extractDocstring(content, node.startPosition.row + 1);
    const fieldType = node.childForFieldName('type');

    // Поле структуры — используем Field
    const propNode = this.createNode(
      filePath,
      NodeKind.Field,
      name,
      node.startPosition.row + 1,
      node.endPosition.row + 1,
      node.startPosition.column,
      node.endPosition.column,
      {
        qualifiedName,
        docstring,
        visibility: isPub ? 'public' : undefined,
      }
    );
    nodes.push(propNode);
    edges.push(this.createEdge(parentId, propNode.id, EdgeKind.Contains));

    // Референс на тип поля
    if (fieldType) {
      const typeName = this.extractTypeName(fieldType.text);
      if (typeName) {
        edges.push(this.createEdge(propNode.id, this.nodeId(filePath, NodeKind.Class, typeName, 0), EdgeKind.References, {
          metadata: { referenceName: typeName },
          line: fieldType.startPosition.row + 1,
          column: fieldType.startPosition.column,
        }));
        unresolvedRefs.push(this.createUnresolvedRef(
          propNode.id,
          typeName,
          EdgeKind.References,
          fieldType.startPosition.row + 1,
          fieldType.startPosition.column,
          filePath
        ));
      }
    }
  }

  /** Обрабатывает перечисление (Enum). */
  protected processEnumItem(
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
    const qualifiedName = qualifiedNamePrefix ? `${qualifiedNamePrefix}::${name}` : name;
    const isPub = this.isPublic(node);
    const docstring = this.extractDocstring(content, node.startPosition.row + 1);
    const decorators = this.extractDeriveAttrs(node, content);

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
        visibility: isPub ? 'public' : undefined,
        isExported: isPub,
        decorators,
      }
    );
    nodes.push(enumNode);
    edges.push(this.createEdge(parentId, enumNode.id, EdgeKind.Contains));

    // Типовые параметры
    const typeParamsNode = node.childForFieldName('type_parameters');
    if (typeParamsNode) {
      this.processTypeParameters(typeParamsNode, filePath, content, enumNode.id, nodes, edges, unresolvedRefs, errors);
    }

    // Варианты перечисления
    const body = node.childForFieldName('body');
    if (body) {
      let variant = body.firstChild;
      while (variant) {
        if (variant.type === 'enum_variant') {
          const variantNameNode = variant.childForFieldName('name');
          if (variantNameNode) {
            const variantName = variantNameNode.text;
            const variantNode = this.createNode(
              filePath,
              NodeKind.EnumMember,
              variantName,
              variant.startPosition.row + 1,
              variant.endPosition.row + 1,
              variant.startPosition.column,
              variant.endPosition.column,
              {
                qualifiedName: `${qualifiedName}::${variantName}`,
              }
            );
            nodes.push(variantNode);
            edges.push(this.createEdge(enumNode.id, variantNode.id, EdgeKind.Contains));
          }
        }
        variant = variant.nextSibling;
      }
    }
  }

  /** Обрабатывает trait (Interface). */
  protected processTraitItem(
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
    const qualifiedName = qualifiedNamePrefix ? `${qualifiedNamePrefix}::${name}` : name;
    const isPub = this.isPublic(node);
    const docstring = this.extractDocstring(content, node.startPosition.row + 1);

    const traitNode = this.createNode(
      filePath,
      NodeKind.Trait,
      name,
      node.startPosition.row + 1,
      node.endPosition.row + 1,
      node.startPosition.column,
      node.endPosition.column,
      {
        qualifiedName,
        docstring,
        visibility: isPub ? 'public' : undefined,
        isExported: isPub,
      }
    );
    nodes.push(traitNode);
    edges.push(this.createEdge(parentId, traitNode.id, EdgeKind.Contains));

    // Типовые параметры
    const typeParamsNode = node.childForFieldName('type_parameters');
    if (typeParamsNode) {
      this.processTypeParameters(typeParamsNode, filePath, content, traitNode.id, nodes, edges, unresolvedRefs, errors);
    }

    // Наследование trait
    const supertraits = node.childForFieldName('supertraits');
    if (supertraits) {
      let trait = supertraits.firstChild;
      while (trait) {
        const traitName = trait.text;
        edges.push(this.createEdge(traitNode.id, this.nodeId(filePath, NodeKind.Interface, traitName, 0), EdgeKind.Extends, {
          metadata: { referenceName: traitName },
          line: trait.startPosition.row + 1,
          column: trait.startPosition.column,
        }));
        unresolvedRefs.push(this.createUnresolvedRef(
          traitNode.id,
          traitName,
          EdgeKind.Extends,
          trait.startPosition.row + 1,
          trait.startPosition.column,
          filePath
        ));
        trait = trait.nextSibling;
      }
    }

    // Тело trait
    const body = node.childForFieldName('body');
    if (body) {
      let child = body.firstChild;
      while (child) {
        if (child.type === 'function_declaration') {
          this.processFunctionDeclaration(child, filePath, content, traitNode.id, nodes, edges, unresolvedRefs, errors, qualifiedName);
        } else if (child.type === 'associated_type') {
          this.processAssociatedType(child, filePath, content, traitNode.id, nodes, edges, unresolvedRefs, errors, qualifiedName);
        }
        child = child.nextSibling;
      }
    }
  }

  /** Обрабатывает алиас типа (TypeAlias). */
  protected processTypeItem(
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
    const qualifiedName = qualifiedNamePrefix ? `${qualifiedNamePrefix}::${name}` : name;
    const isPub = this.isPublic(node);
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
        visibility: isPub ? 'public' : undefined,
        isExported: isPub,
      }
    );
    nodes.push(typeNode);
    edges.push(this.createEdge(parentId, typeNode.id, EdgeKind.Contains));

    // Типовые параметры
    const typeParamsNode = node.childForFieldName('type_parameters');
    if (typeParamsNode) {
      this.processTypeParameters(typeParamsNode, filePath, content, typeNode.id, nodes, edges, unresolvedRefs, errors);
    }

    // Референс на целевой тип
    const aliasType = node.childForFieldName('alias');
    if (aliasType) {
      const typeName = this.extractTypeName(aliasType.text);
      if (typeName) {
        edges.push(this.createEdge(typeNode.id, this.nodeId(filePath, NodeKind.Class, typeName, 0), EdgeKind.References, {
          metadata: { referenceName: typeName },
          line: aliasType.startPosition.row + 1,
          column: aliasType.startPosition.column,
        }));
        unresolvedRefs.push(this.createUnresolvedRef(
          typeNode.id,
          typeName,
          EdgeKind.References,
          aliasType.startPosition.row + 1,
          aliasType.startPosition.column,
          filePath
        ));
      }
    }
  }

  /** Обрабатывает импорт use (Import). */
  protected processUseDeclaration(
    node: any,
    filePath: string,
    content: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    errors: IExtractionError[]
  ): void {
    const useTree = node.childForFieldName('tree');
    if (!useTree) return;

    const sourceText = useTree.text;
    const line = node.startPosition.row + 1;
    const column = node.startPosition.column;

    const importNode = this.createNode(
      filePath,
      NodeKind.Import,
      sourceText,
      line,
      useTree.endPosition.row + 1,
      column,
      useTree.endPosition.column
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

    // Обработка импортированных спецификаторов
    this.processUseTree(useTree, filePath, content, importNode.id, nodes, edges, unresolvedRefs, errors, line, column);

    // Группированные use (например, use std::collections::{HashMap, HashSet}) — namespace
    this.processUseGroupNamespace(useTree, filePath, content, importNode.id, nodes, edges, unresolvedRefs, errors, line, column);
  }

  /** Создаёт Namespace узел для группированных use. */
  protected processUseGroupNamespace(
    node: any,
    filePath: string,
    content: string,
    importNodeId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    errors: IExtractionError[],
    line: number,
    column: number
  ): void {
    if (node.type !== 'use_tree') return;

    // Ищем scoped_identifier (базовый путь) и use_tree_list (группа)
    let scopedId: any = null;
    let useTreeList: any = null;
    let child = node.firstChild;
    while (child) {
      if (child.type === 'scoped_identifier') {
        scopedId = child;
      } else if (child.type === 'use_tree_list') {
        useTreeList = child;
      }
      child = child.nextSibling;
    }

    if (!scopedId || !useTreeList) return;

    const nsPath = scopedId.text;

    const nsNode = this.createNode(
      filePath,
      NodeKind.Namespace,
      nsPath,
      line,
      line,
      column,
      scopedId.endPosition.column
    );
    nodes.push(nsNode);
    edges.push(this.createEdge(importNodeId, nsNode.id, EdgeKind.Contains));

    unresolvedRefs.push(this.createUnresolvedRef(
      nsNode.id,
      nsPath,
      EdgeKind.Imports,
      line,
      column,
      filePath
    ));

    // Ребро References от namespace к каждому элементу группы
    let item = useTreeList.firstChild;
    while (item) {
      if (item.type === 'use_tree') {
        let inner = item.firstChild;
        while (inner) {
          if (inner.type === 'type_identifier' || inner.type === 'identifier') {
            const itemName = inner.text;
            edges.push(this.createEdge(nsNode.id, this.nodeId(filePath, NodeKind.Import, itemName, line), EdgeKind.References, {
              metadata: { referenceName: itemName },
              line,
              column,
            }));
          } else if (inner.type === 'scoped_identifier') {
            const nameNode = inner.childForFieldName('name');
            if (nameNode) {
              edges.push(this.createEdge(nsNode.id, this.nodeId(filePath, NodeKind.Import, nameNode.text, line), EdgeKind.References, {
                metadata: { referenceName: nameNode.text },
                line,
                column,
              }));
            }
          }
          inner = inner.nextSibling;
        }
      }
      item = item.nextSibling;
    }
  }

  /** Обрабатывает дерево use. */
  protected processUseTree(
    node: any,
    filePath: string,
    content: string,
    importNodeId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    errors: IExtractionError[],
    line: number,
    column: number
  ): void {
    if (node.type === 'scoped_identifier') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        const name = nameNode.text;
        edges.push(this.createEdge(importNodeId, this.nodeId(filePath, NodeKind.Import, name, line), EdgeKind.References, {
          metadata: { referenceName: name },
          line,
          column,
        }));
      }
    } else if (node.type === 'type_identifier' || node.type === 'identifier') {
      const name = node.text;
      edges.push(this.createEdge(importNodeId, this.nodeId(filePath, NodeKind.Import, name, line), EdgeKind.References, {
        metadata: { referenceName: name },
        line,
        column,
      }));
    } else if (node.type === 'use_tree') {
      let child = node.firstChild;
      while (child) {
        this.processUseTree(child, filePath, content, importNodeId, nodes, edges, unresolvedRefs, errors, line, column);
        child = child.nextSibling;
      }
    } else if (node.type === 'use_wildcard') {
       // Игнорируем импорты со звёздочкой
    }
  }

  /** Обрабатывает try выражение (Try). */
  protected processTryExpression(
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
  }

  /** Обрабатывает match выражение (Catch). */
  protected processMatchExpression(
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

    const catchNode = this.createNode(
      filePath,
      NodeKind.Function,
      'match',
      line,
      node.endPosition.row + 1,
      node.startPosition.column,
      node.endPosition.column
    );
    nodes.push(catchNode);
    edges.push(this.createEdge(parentId, catchNode.id, EdgeKind.Contains));

    // Обработка match_arm с catch_all паттерном
    let arm = node.firstChild;
    while (arm) {
      if (arm.type === 'match_arm') {
        const pattern = arm.childForFieldName('pattern');
        if (pattern && pattern.text === '_') {
          // catch_all ветвь
          const catchAllNode = this.createNode(
            filePath,
            NodeKind.Function,
            'catch_all',
            arm.startPosition.row + 1,
            arm.endPosition.row + 1,
            arm.startPosition.column,
            arm.endPosition.column
          );
          nodes.push(catchAllNode);
          edges.push(this.createEdge(catchNode.id, catchAllNode.id, EdgeKind.Contains));
        }
      }
      arm = arm.nextSibling;
    }
  }

  /** Обрабатывает макрос (Throw для panic!, unwrap, expect). */
  protected processMacroInvocation(
    node: any,
    filePath: string,
    content: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    errors: IExtractionError[]
  ): void {
    const macroNameNode = node.childForFieldName('macro_name');
    if (!macroNameNode) return;

    const macroName = macroNameNode.text;
    const line = node.startPosition.row + 1;
    const column = node.startPosition.column;

    if (macroName === 'panic' || macroName === 'panic!' || macroName === 'unimplemented' || macroName === 'unimplemented!') {
      // panic! — Throw
      const throwNode = this.createNode(
        filePath,
        NodeKind.Function,
        'panic!',
        line,
        line,
        column,
        node.endPosition.column
      );
      nodes.push(throwNode);
      edges.push(this.createEdge(parentId, throwNode.id, EdgeKind.Contains));
    } else if (macroName === 'unreachable' || macroName === 'unreachable!') {
      // unreachable! — Throw
      const throwNode = this.createNode(
        filePath,
        NodeKind.Function,
        'unreachable!',
        line,
        line,
        column,
        node.endPosition.column
      );
      nodes.push(throwNode);
      edges.push(this.createEdge(parentId, throwNode.id, EdgeKind.Contains));
    }
  }

  /** Обрабатывает элемент (Export). */
  protected processItem(
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
    const isPub = this.isPublic(node);

    if (isPub) {
      const nameNode = this.extractItemName(node);
      if (nameNode) {
        const name = nameNode.text;
        const line = node.startPosition.row + 1;

        const exportNode = this.createNode(
          filePath,
          NodeKind.Export,
          name,
          line,
          line,
          node.startPosition.column,
          node.endPosition.column
        );
        nodes.push(exportNode);
        edges.push(this.createEdge(parentId, exportNode.id, EdgeKind.Contains));
        edges.push(this.createEdge(parentId, exportNode.id, EdgeKind.Exports));
      }
    }

    let child = node.firstChild;
    while (child) {
      this.processRustNodes(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
      child = child.nextSibling;
    }
  }

  /** Обрабатывает модуль mod (Namespace). */
  protected processModItem(
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
    const qualifiedName = qualifiedNamePrefix ? `${qualifiedNamePrefix}::${name}` : name;
    const isPub = this.isPublic(node);
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
        visibility: isPub ? 'public' : undefined,
        isExported: isPub,
      }
    );
    nodes.push(nsNode);
    edges.push(this.createEdge(parentId, nsNode.id, EdgeKind.Contains));

    // Тело модуля
    const body = node.childForFieldName('body');
    if (body) {
      let child = body.firstChild;
      while (child) {
        this.processRustNodes(child, filePath, content, nsNode.id, nodes, edges, unresolvedRefs, errors, qualifiedName);
        child = child.nextSibling;
      }
    }
  }

  /** Обрабатывает объявление переменной let (Variable). */
  protected processLetDeclaration(
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
    const pattern = node.childForFieldName('pattern');
    const value = node.childForFieldName('value');
    if (!pattern) return;

    const name = pattern.text;
    const qualifiedName = qualifiedNamePrefix ? `${qualifiedNamePrefix}::${name}` : name;

    const isMutable = this.hasModifier(node, 'mut');

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
      }
    );
    nodes.push(varNode);
    edges.push(this.createEdge(parentId, varNode.id, EdgeKind.Contains));

    // Тип переменной — ребро TypeOf
    const varType = node.childForFieldName('type');
    if (varType) {
      const typeName = this.extractTypeName(varType.text);
      if (typeName) {
        edges.push(this.createEdge(varNode.id, this.nodeId(filePath, NodeKind.Class, typeName, 0), EdgeKind.TypeOf, {
          metadata: { referenceName: typeName },
          line: varType.startPosition.row + 1,
          column: varType.startPosition.column,
        }));
        edges.push(this.createEdge(varNode.id, this.nodeId(filePath, NodeKind.Class, typeName, 0), EdgeKind.References, {
          metadata: { referenceName: typeName },
          line: varType.startPosition.row + 1,
          column: varType.startPosition.column,
        }));
        unresolvedRefs.push(this.createUnresolvedRef(
          varNode.id,
          typeName,
          EdgeKind.References,
          varType.startPosition.row + 1,
          varType.startPosition.column,
          filePath
        ));
      }
    }
  }

  /** Обрабатывает атрибут (Decorator). */
  protected processAttribute(
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
    const attrText = node.text.slice(1); // Убираем #

    const decNode = this.createNode(
      filePath,
      NodeKind.Function,
      attrText,
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

  /** Обрабатывает ассоциированный тип. */
  protected processAssociatedType(
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
    const qualifiedName = qualifiedNamePrefix ? `${qualifiedNamePrefix}::${name}` : name;

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
      }
    );
    nodes.push(assocNode);
    edges.push(this.createEdge(parentId, assocNode.id, EdgeKind.Contains));
  }

  /** Обрабатывает ассоциированную константу. */
  protected processAssociatedConstant(
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
    const qualifiedName = qualifiedNamePrefix ? `${qualifiedNamePrefix}::${name}` : name;

    const constNode = this.createNode(
      filePath,
      NodeKind.Variable,
      name,
      node.startPosition.row + 1,
      node.endPosition.row + 1,
      node.startPosition.column,
      node.endPosition.column,
      {
        qualifiedName,
        isStatic: true,
      }
    );
    nodes.push(constNode);
    edges.push(this.createEdge(parentId, constNode.id, EdgeKind.Contains));
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

          // Ребро TypeOf от параметра к его типу
          const paramType = child.childForFieldName('type');
          if (paramType) {
            const typeName = this.extractTypeName(paramType.text);
            if (typeName) {
              edges.push(this.createEdge(paramNode.id, this.nodeId(filePath, NodeKind.Class, typeName, 0), EdgeKind.TypeOf, {
                metadata: { referenceName: typeName },
                line: paramType.startPosition.row + 1,
                column: paramType.startPosition.column,
              }));
            }
          }
        }
      } else if (child.type === 'self_parameter') {
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
          NodeKind.Parameter,
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
      if (child.type === 'expression_statement') {
        let expr = child.firstChild;
        while (expr) {
          if (expr.type === 'macro_invocation') {
            this.processMacroInvocation(expr, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
          } else if (expr.type === 'try_expression') {
            this.processTryExpression(expr, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
          } else if (expr.type === 'match_expression') {
            this.processMatchExpression(expr, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
          } else if (expr.type === 'call_expression') {
            this.processCallExpression(expr, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
          }
          expr = expr.nextSibling;
        }
      } else if (child.type === 'macro_invocation') {
        this.processMacroInvocation(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
      } else if (child.type === 'try_expression') {
        this.processTryExpression(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
      } else if (child.type === 'match_expression') {
        this.processMatchExpression(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
      } else if (child.type === 'call_expression') {
        this.processCallExpression(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
      } else if (child.type === 'if_expression' || child.type === 'loop_expression' || child.type === 'for_expression' || child.type === 'while_expression') {
        // Рекурсия по управляющим конструкциям
        let inner = child.firstChild;
        while (inner) {
          this.processFunctionBody(inner, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
          inner = inner.nextSibling;
        }
      } else if (child.type === 'block') {
        let inner = child.firstChild;
        while (inner) {
          this.processFunctionBody(inner, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
          inner = inner.nextSibling;
        }
      } else if (child.type === 'return_expression') {
        // Игнорируем return
      }
      child = child.nextSibling;
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
    let isScopedNew = false;
    let scopedTypeName: string | undefined;
    if (funcNode.type === 'identifier') {
      funcName = funcNode.text;
    } else if (funcNode.type === 'field_expression') {
      const fieldName = funcNode.childForFieldName('name');
      if (fieldName) {
        funcName = fieldName.text;
      }
    } else if (funcNode.type === 'scoped_identifier') {
      const nameNode = funcNode.childForFieldName('name');
      if (nameNode) {
        funcName = nameNode.text;
        if (funcName === 'new') {
          isScopedNew = true;
          const namespaceNode = funcNode.childForFieldName('namespace');
          if (namespaceNode) {
            scopedTypeName = namespaceNode.text;
          }
        }
      }
    }

    if (funcName) {
      // ::new() — ребро instantiates
      if (isScopedNew && scopedTypeName) {
        edges.push(this.createEdge(parentId, this.nodeId(filePath, NodeKind.Class, scopedTypeName, 0), EdgeKind.Instantiates, {
          metadata: { referenceName: scopedTypeName },
          line,
          column,
        }));
        unresolvedRefs.push(this.createUnresolvedRef(
          parentId,
          scopedTypeName,
          EdgeKind.Instantiates,
          line,
          column,
          filePath
        ));
      } else if (funcName === 'unwrap' || funcName === 'expect') {
        const throwNode = this.createNode(
          filePath,
          NodeKind.Function,
          `${funcName}()`,
          line,
          line,
          column,
          node.endPosition.column
        );
        nodes.push(throwNode);
        edges.push(this.createEdge(parentId, throwNode.id, EdgeKind.Contains));
      } else {
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
  }

  /** Проверяет, является ли узел публичным. */
  protected isPublic(node: any): boolean {
    let child = node.firstChild;
    while (child) {
      if (child.type === 'visibility_modifier' || child.text === 'pub') {
        return true;
      }
      child = child.nextSibling;
    }
    return false;
  }

  /** Проверяет наличие модификатора. */
  protected hasModifier(node: any, modifier: string): boolean {
    let child = node.firstChild;
    while (child) {
      if (child.text === modifier) {
        return true;
      }
      child = child.nextSibling;
    }
    return false;
  }

  /** Извлекает derive-атрибуты перед узлом. */
  protected extractDeriveAttrs(node: any, content: string): string[] {
    const decorators: string[] = [];
    const lineIdx = node.startPosition.row - 1;
    const lines = content.split('\n');

    if (lineIdx < 0) return decorators;

    let i = lineIdx;
    while (i >= 0) {
      const line = lines[i]?.trim();
      if (!line) break;
      if (line.startsWith('#[') && line.includes('derive')) {
        const inner = line.slice(2, -1);
        const deriveMatch = inner.match(/derive\s*\(\s*(.*?)\s*\)/);
        if (deriveMatch) {
          const derives = deriveMatch[1].split(',').map(d => d.trim()).filter(Boolean);
          decorators.push(...derives);
        }
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

  /** Извлекает типовые параметры из узла. */
  protected extractGenerics(node: any, filePath: string, content: string, nodes: INode[], edges: IEdge[], unresolvedRefs: IUnresolvedReference[], errors: IExtractionError[]): string[] {
    const typeParamsNode = node.childForFieldName('type_parameters');
    if (!typeParamsNode) return [];

    const generics: string[] = [];
    let child = typeParamsNode.firstChild;
    while (child) {
      if (child.type === 'type_identifier') {
        generics.push(child.text);
      }
      child = child.nextSibling;
    }
    return generics;
  }

  /** Извлекает имя типа из текстового представления типа. */
  protected extractTypeName(typeText: string): string | undefined {
    const trimmed = typeText.trim();

    // Убираем указатели
    const withoutPointers = trimmed.replace(/\*/g, '').trim();

    // Убираем рефы
    const withoutRefs = withoutPointers.replace(/&/g, '').trim();

    // Убираем время жизни
    const withoutLifetime = withoutRefs.replace(/'<\w+>/g, '').trim();

    // Убираем аннотации mut
    const withoutMut = withoutLifetime.replace(/mut\s+/g, '').trim();

    // Убираем угловые скобки для обобщений
    const withoutGenerics = withoutMut.replace(/<[^>]*>/g, '').trim();

    // Берём базовое имя типа
    const parts = withoutGenerics.split('::');
    if (parts.length > 0) {
      return parts[parts.length - 1];
    }

    return undefined;
  }

  /** Извлекает имя из элемента. */
  protected extractItemName(node: any): any {
    let child = node.firstChild;
    while (child) {
      if (child.type === 'type_identifier' || child.type === 'identifier') {
        return child;
      }
      child = child.nextSibling;
    }
    return null;
  }
}
