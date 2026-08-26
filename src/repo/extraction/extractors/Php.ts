/**
 * Экстрактор для PHP.
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

export class PhpExtractor extends ExtractorBase {
  public getLanguage(): Language {
    return 'php';
  }

  public getSupportedExtensions(): string[] {
    return ['.php'];
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
      const p = getParserForFile('php', filePath);
      if (!p) {
        errors.push(this.createError(
          'WASM-грамматика php не загружена',
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

      this.processPhpNodes(
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

      const sameFileFunctionNames = new Set(
          nodes.filter(n => n.kind === NodeKind.Function || n.kind === NodeKind.Method).map(n => n.name)
      );
      const importedNames = new Set(
        edges
          .filter(e => e.kind === EdgeKind.Imports)
          .map(e => {
            const targetNode = nodes.find(n => n.id === e.target);
            return targetNode ? targetNode.name : '';
          })
          .filter(Boolean)
      );
      const fnRefUnresolved = this.flushFnRefCandidates(sameFileFunctionNames, importedNames);
      unresolvedRefs.push(...fnRefUnresolved);
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

  /** Обрабатывает узлы AST для PHP. */
  protected processPhpNodes(
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

      case 'interface_declaration':
        this.processInterfaceDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'trait_declaration':
        this.processTraitDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'function_definition':
        this.processFunctionDefinition(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'method_declaration':
        this.processMethodDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'property_declaration':
        this.processPropertyDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'const_declaration':
        this.processConstDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'use_declaration':
        this.processUseDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      case 'namespace_definition':
        this.processNamespace(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'call_expression':
        this.processCallExpression(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      default:
        let child = node.firstChild;
        while (child) {
          this.processPhpNodes(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
          child = child.nextSibling;
        }
    }
  }

  /** Обрабатывает программу верхнего уровня. */
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
      this.processPhpNodes(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
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
    const qualifiedName = qualifiedNamePrefix ? `${qualifiedNamePrefix}\\${name}` : name;
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

    // Наследование — extends
    const superClass = node.childForFieldName('extends');
    if (superClass) {
      const baseType = this.extractBaseType(superClass.text);
      if (baseType) {
        edges.push(this.createEdge(classNode.id, this.nodeId(filePath, NodeKind.Class, baseType, 0), EdgeKind.Extends, {
          metadata: { referenceName: baseType },
          line: superClass.startPosition.row + 1,
          column: superClass.startPosition.column,
        }));
        unresolvedRefs.push(this.createUnresolvedRef(
          classNode.id,
          baseType,
          EdgeKind.Extends,
          superClass.startPosition.row + 1,
          superClass.startPosition.column,
          filePath
        ));
      }
    }

    // Реализация — implements
    const implementsClause = node.childForFieldName('implements');
    if (implementsClause) {
      let impl = implementsClause.firstChild;
      while (impl) {
        const baseType = this.extractBaseType(impl.text);
        if (baseType) {
          edges.push(this.createEdge(classNode.id, this.nodeId(filePath, NodeKind.Interface, baseType, 0), EdgeKind.Implements, {
            metadata: { referenceName: baseType },
            line: impl.startPosition.row + 1,
            column: impl.startPosition.column,
          }));
          unresolvedRefs.push(this.createUnresolvedRef(
            classNode.id,
            baseType,
            EdgeKind.Implements,
            impl.startPosition.row + 1,
            impl.startPosition.column,
            filePath
          ));
        }
        impl = impl.nextSibling;
      }
    }

    // Обработка тела класса
    const body = node.childForFieldName('body');
    if (body) {
      let child = body.firstChild;
      while (child) {
        this.processPhpNodes(child, filePath, content, classNode.id, nodes, edges, unresolvedRefs, errors, qualifiedName);
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
    const qualifiedName = qualifiedNamePrefix ? `${qualifiedNamePrefix}\\${name}` : name;
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

    // Наследование интерфейса — extends
    const extendsClause = node.childForFieldName('extends');
    if (extendsClause) {
      let ext = extendsClause.firstChild;
      while (ext) {
        const extName = ext.text;
        const baseType = this.extractBaseType(extName);
        if (baseType) {
          edges.push(this.createEdge(ifaceNode.id, this.nodeId(filePath, NodeKind.Interface, baseType, 0), EdgeKind.Extends, {
            metadata: { referenceName: baseType },
            line: ext.startPosition.row + 1,
            column: ext.startPosition.column,
          }));
          unresolvedRefs.push(this.createUnresolvedRef(
            ifaceNode.id,
            baseType,
            EdgeKind.Extends,
            ext.startPosition.row + 1,
            ext.startPosition.column,
            filePath
          ));
        }
        ext = ext.nextSibling;
      }
    }

    // Обработка тела интерфейса
    const body = node.childForFieldName('body');
    if (body) {
      let child = body.firstChild;
      while (child) {
        this.processPhpNodes(child, filePath, content, ifaceNode.id, nodes, edges, unresolvedRefs, errors, qualifiedName);
        child = child.nextSibling;
      }
    }
  }

  /** Обрабатывает объявление trait. */
  protected processTraitDeclaration(
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
    const qualifiedName = qualifiedNamePrefix ? `${qualifiedNamePrefix}\\${name}` : name;
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
      }
    );
    nodes.push(traitNode);
    edges.push(this.createEdge(parentId, traitNode.id, EdgeKind.Contains));

    // Обработка тела trait
    const body = node.childForFieldName('body');
    if (body) {
      let child = body.firstChild;
      while (child) {
        this.processPhpNodes(child, filePath, content, traitNode.id, nodes, edges, unresolvedRefs, errors, qualifiedName);
        child = child.nextSibling;
      }
    }
  }

  /** Обрабатывает определение функции верхнего уровня. */
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
    const qualifiedName = qualifiedNamePrefix ? `${qualifiedNamePrefix}\\${name}` : name;
    const isStatic = this.hasModifier(node, 'static');
    const docstring = this.extractDocstring(content, node.startPosition.row + 1);

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
        isStatic,
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

    // Возвращаемый тип
    const returnType = this.extractReturnType(node);
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

    // Захват function-ref кандидатов из аргументов
    this.captureFnRefCandidates(node);
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
    const qualifiedName = qualifiedNamePrefix ? `${qualifiedNamePrefix}\\${name}` : name;
    const isStatic = this.hasModifier(node, 'static');
    const isAbstract = this.hasModifier(node, 'abstract');
    const isFinal = this.hasModifier(node, 'final');
    const docstring = this.extractDocstring(content, node.startPosition.row + 1);

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
        isStatic,
        isAbstract,
        isFinal,
        visibility: this.extractVisibility(node),
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
    const returnType = this.extractReturnType(node);
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
    let child = node.firstChild;
    while (child) {
      if (child.type === 'property_element') {
        const nameNode = child.childForFieldName('name');
        if (!nameNode) {
          child = child.nextSibling;
          continue;
        }

        const name = nameNode.text.replace(/^\$/, '');
        const qualifiedName = qualifiedNamePrefix ? `${qualifiedNamePrefix}\\${name}` : name;
        const isStatic = this.hasModifier(node, 'static');
        const docstring = this.extractDocstring(content, child.startPosition.row + 1);

        const propNode = this.createNode(
          filePath,
          NodeKind.Field,
          name,
          child.startPosition.row + 1,
          child.endPosition.row + 1,
          child.startPosition.column,
          child.endPosition.column,
          {
            qualifiedName,
            docstring,
            isStatic,
            visibility: this.extractVisibility(node),
          }
        );
        nodes.push(propNode);
        edges.push(this.createEdge(parentId, propNode.id, EdgeKind.Contains));

        // Тип свойства
        const typeAnnotation = child.childForFieldName('type');
        if (typeAnnotation) {
          const baseType = this.extractBaseType(typeAnnotation.text);
          if (baseType && !this.isPrimitiveType(baseType)) {
            edges.push(this.createEdge(propNode.id, this.nodeId(filePath, NodeKind.Class, baseType, 0), EdgeKind.TypeOf, {
              metadata: { referenceName: baseType },
              line: child.startPosition.row + 1,
              column: child.startPosition.column,
            }));
            unresolvedRefs.push(this.createUnresolvedRef(
              propNode.id,
              baseType,
              EdgeKind.TypeOf,
              child.startPosition.row + 1,
              child.startPosition.column,
              filePath
            ));
          }
        }
      }
      child = child.nextSibling;
    }
  }

  /** Обрабатывает объявление константы. */
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
      if (child.type === 'const_element') {
        const nameNode = child.childForFieldName('name');
        if (!nameNode) {
          child = child.nextSibling;
          continue;
        }

        const name = nameNode.text;
        const qualifiedName = qualifiedNamePrefix ? `${qualifiedNamePrefix}\\${name}` : name;

        const constNode = this.createNode(
          filePath,
          NodeKind.Constant,
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
        nodes.push(constNode);
        edges.push(this.createEdge(parentId, constNode.id, EdgeKind.Contains));
      }
      child = child.nextSibling;
    }
  }

  /** Обрабатывает use-объявление (импорт). */
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
    // use Declaration может содержать список импортов
    let child = node.firstChild;
    while (child) {
      if (child.type === 'group_use_declaration' || child.type === 'use_clause') {
        this.processUseClause(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
      } else if (child.type === 'use_use_clause') {
        const fullNameNode = child.childForFieldName('name');
        if (fullNameNode) {
          const fullName = fullNameNode.text;
          const aliasNode = child.childForFieldName('alias');
          const alias = aliasNode ? aliasNode.text : fullName.split('\\').pop() || fullName;
          const line = child.startPosition.row + 1;
          const column = child.startPosition.column;

          const importNode = this.createNode(
            filePath,
            NodeKind.Import,
            fullName,
            line,
            line,
            column,
            child.endPosition.column
          );
          nodes.push(importNode);
          edges.push(this.createEdge(parentId, importNode.id, EdgeKind.Contains));
          edges.push(this.createEdge(parentId, importNode.id, EdgeKind.Imports, {
            line,
            column,
          }));

          unresolvedRefs.push(this.createUnresolvedRef(
            importNode.id,
            fullName,
            EdgeKind.Imports,
            line,
            column,
            filePath
          ));
        }
      }
      child = child.nextSibling;
    }
  }

  /** Обрабатывает use-клаузу с группой импортов. */
  protected processUseClause(
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
      if (child.type === 'use_use_clause') {
        const fullNameNode = child.childForFieldName('name');
        if (fullNameNode) {
          const fullName = fullNameNode.text;
          const aliasNode = child.childForFieldName('alias');
          const alias = aliasNode ? aliasNode.text : fullName.split('\\').pop() || fullName;
          const line = child.startPosition.row + 1;
          const column = child.startPosition.column;

          const importNode = this.createNode(
            filePath,
            NodeKind.Import,
            fullName,
            line,
            line,
            column,
            child.endPosition.column
          );
          nodes.push(importNode);
          edges.push(this.createEdge(parentId, importNode.id, EdgeKind.Contains));
          edges.push(this.createEdge(parentId, importNode.id, EdgeKind.Imports, {
            line,
            column,
          }));

          unresolvedRefs.push(this.createUnresolvedRef(
            importNode.id,
            fullName,
            EdgeKind.Imports,
            line,
            column,
            filePath
          ));
        }
      } else if (child.type === 'group_use_declaration') {
        const prefixNode = child.childForFieldName('prefix');
        const prefix = prefixNode ? prefixNode.text : '';
        let inner = child.firstChild;
        while (inner) {
          if (inner.type === 'use_use_clause') {
            const nameNode = inner.childForFieldName('name');
            if (nameNode) {
              const fullName = prefix ? `${prefix}\\${nameNode.text}` : nameNode.text;
              const aliasNode = inner.childForFieldName('alias');
              const alias = aliasNode ? aliasNode.text : nameNode.text.split('\\').pop() || nameNode.text;
              const line = inner.startPosition.row + 1;
              const column = inner.startPosition.column;

              const importNode = this.createNode(
                filePath,
                NodeKind.Import,
                fullName,
                line,
                line,
                column,
                inner.endPosition.column
              );
              nodes.push(importNode);
              edges.push(this.createEdge(parentId, importNode.id, EdgeKind.Contains));
              edges.push(this.createEdge(parentId, importNode.id, EdgeKind.Imports, {
                line,
                column,
              }));

              unresolvedRefs.push(this.createUnresolvedRef(
                importNode.id,
                fullName,
                EdgeKind.Imports,
                line,
                column,
                filePath
              ));
            }
          }
          inner = inner.nextSibling;
        }
      }
      child = child.nextSibling;
    }
  }

  /** Обрабатывает объявление пространства имён. */
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
    const qualifiedName = qualifiedNamePrefix ? `${qualifiedNamePrefix}\\${name}` : name;

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
      }
    );
    nodes.push(nsNode);
    edges.push(this.createEdge(parentId, nsNode.id, EdgeKind.Contains));

    // Обработка тела namespace
    const body = node.childForFieldName('body');
    if (body) {
      let child = body.firstChild;
      while (child) {
        this.processPhpNodes(child, filePath, content, nsNode.id, nodes, edges, unresolvedRefs, errors, qualifiedName);
        child = child.nextSibling;
      }
    }
  }

  /** Обрабатывает выражение вызова. */
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
    if (funcNode.type === 'name' || funcNode.type === 'identifier') {
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

    // Захват function-ref кандидатов из аргументов
    this.captureFnRefCandidates(node);
  }

  /** Обрабатывает параметры функции/метода. */
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
      if (child.type === 'simple_parameter') {
        const nameNode = child.childForFieldName('name');
        if (!nameNode) {
          child = child.nextSibling;
          continue;
        }

        const paramName = nameNode.text.replace(/^\$/, '');
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
        const typeAnnotation = child.childForFieldName('type');
        if (typeAnnotation) {
          const baseType = this.extractBaseType(typeAnnotation.text);
          if (baseType && !this.isPrimitiveType(baseType)) {
            edges.push(this.createEdge(paramNode.id, this.nodeId(filePath, NodeKind.Class, baseType, 0), EdgeKind.TypeOf, {
              metadata: { referenceName: baseType },
              line: child.startPosition.row + 1,
              column: child.startPosition.column,
            }));
            unresolvedRefs.push(this.createUnresolvedRef(
              paramNode.id,
              baseType,
              EdgeKind.TypeOf,
              child.startPosition.row + 1,
              child.startPosition.column,
              filePath
            ));
          }
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

  /** Извлекает тип возвращаемого значения. */
  protected extractReturnType(node: any): string | undefined {
    const retType = node.childForFieldName('return_type');
    if (retType) {
      return retType.text;
    }
    return undefined;
  }

  /** Извлекает базовый тип из аннотации типа. */
  protected extractBaseType(typeText: string): string | undefined {
    const trimmed = typeText.trim();
    if (trimmed.length === 0) return undefined;
    if (!/[A-Z]/.test(trimmed[0])) return undefined;
    const match = trimmed.match(/^([A-Z]\w*)/);
    if (match) return match[1];
    return undefined;
  }

  /** Проверяет, является ли тип примитивом PHP или встроенным типом. */
  protected isPrimitiveType(typeName: string): boolean {
    const primitives = new Set([
      'string', 'int', 'integer', 'bool', 'boolean', 'float', 'double',
      'void', 'null', 'mixed', 'array', 'object', 'resource',
      'callable', 'iterable', 'never', 'false', 'true', 'static',
      'self', 'parent',
      'stdClass', 'Closure', 'Generator', 'DateTime', 'DateTimeImmutable',
      'Throwable', 'Exception', 'Error', 'RuntimeException',
    ]);
    return primitives.has(typeName);
  }
}
