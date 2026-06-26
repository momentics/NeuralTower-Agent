/**
 * Экстрактор для C/C++.
 *
 * Использует tree-sitter-c и tree-sitter-cpp для парсинга и извлечения узлов, рёбер и неразрешённых ссылок.
 * Для .h файлов используется двойной парсинг: сначала C++, затем C.
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

export class CppExtractor extends ExtractorBase {
  public getLanguage(): string {
    return 'cpp';
  }

  public getSupportedExtensions(): string[] {
    return ['.cpp', '.cc', '.cxx', '.c++', '.h', '.hpp', '.hxx', '.h++', '.c'];
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
      const cppGrammar = require('tree-sitter-cpp');
      const cGrammar = require('tree-sitter-c');

      const p = new parser.Parser();

      // Для .h файлов используется двойной парсинг: C++ сначала, затем C
      if (filePath.endsWith('.h')) {
        const result = this.extractWithDualGrammar(
          p, cppGrammar, cGrammar, filePath, content,
          nodes, edges, unresolvedRefs, errors
        );
        if (result) {
          return { nodes, edges, unresolvedRefs, errors, durationMs: 0 };
        }
      } else {
        // .c — только C, остальные — C++
        if (filePath.endsWith('.c')) {
          p.setLanguage(cGrammar.C);
        } else {
          p.setLanguage(cppGrammar.CPP);
        }
      }

      const tree = p.parse(content);
      if (!tree) {
        errors.push(this.createError(
          'Не удалось распарсить файл',
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

      // Обработка верхнего уровня
      this.processCppNodes(
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

  /** Двойной парсинг для .h файлов: C++ сначала, затем C. */
  protected extractWithDualGrammar(
    p: any,
    cppGrammar: any,
    cGrammar: any,
    filePath: string,
    content: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    errors: IExtractionError[]
  ): boolean {
    // Пробуем C++ сначала
    p.setLanguage(cppGrammar.CPP);
    const cppTree = p.parse(content);

    if (cppTree && !cppTree.rootNode.hasError) {
      const root = cppTree.rootNode;
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
      this.processCppNodes(
        root,
        filePath,
        content,
        moduleNode.id,
        nodes,
        edges,
        unresolvedRefs,
        errors
      );
      return true;
    }

    // Откат на C
    p.setLanguage(cGrammar.C);
    const cTree = p.parse(content);

    if (cTree && !cTree.rootNode.hasError) {
      const root = cTree.rootNode;
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
      this.processCppNodes(
        root,
        filePath,
        content,
        moduleNode.id,
        nodes,
        edges,
        unresolvedRefs,
        errors
      );
      return true;
    }

    errors.push(this.createError(
      'Не удалось распарсить файл ни как C++, ни как C',
      filePath,
      'error',
      'DUAL_PARSE_FAILED'
    ));
    return false;
  }

  /** Обрабатывает узлы AST для C/C++. */
  protected processCppNodes(
    node: any,
    filePath: string,
    content: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    errors: IExtractionError[],
    qualifiedNamePrefix: string = '',
    insideClass: boolean = false
  ): void {
    if (!node || node.isMissing || node.isError) return;

    switch (node.type) {
      case 'translation_unit':
        this.processTranslationUnit(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      case 'class_specifier':
        this.processClassSpecifier(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'struct_specifier':
        this.processStructSpecifier(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'function_definition':
        this.processFunctionDefinition(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix, insideClass);
        break;

      case 'field_declaration':
        this.processFieldDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'declaration':
        this.processDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'init_statement':
        this.processInitStatement(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'type_definition':
        this.processTypeDefinition(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'using_declaration':
        this.processUsingDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'enum_specifier':
        this.processEnumSpecifier(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'preproc_include':
        this.processPreprocInclude(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
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

      case 'parameter_declaration':
        this.processParameterDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      case 'attribute':
        this.processAttribute(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      case 'template_parameter':
        this.processTemplateParameter(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      case 'namespace_definition':
        this.processNamespaceDefinition(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix);
        break;

      case 'template_argument':
        this.processTemplateArgument(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      default:
        // Рекурсия по дочерним узлам
        let child = node.firstChild;
        while (child) {
          this.processCppNodes(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors, qualifiedNamePrefix, insideClass);
          child = child.nextSibling;
        }
    }
  }

  /** Обрабатывает корневой узел трансляции. */
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
      this.processCppNodes(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
      child = child.nextSibling;
    }
  }

  /** Обрабатывает спецификатор класса. */
  protected processClassSpecifier(
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
    const isAbstract = this.hasVirtualDestructor(node);

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
      }
    );
    nodes.push(classNode);
    edges.push(this.createEdge(parentId, classNode.id, EdgeKind.Contains));

    // Параметры шаблона
    const templateParams = node.childForFieldName('type_parameters');
    if (templateParams) {
      this.processTemplateParameters(templateParams, filePath, content, classNode.id, nodes, edges, unresolvedRefs, errors);
    }

    // Базовые классы
    const baseClasses = node.childForFieldName('base_classes');
    if (baseClasses) {
      let base = baseClasses.firstChild;
      while (base) {
        const baseNameNode = this.extractBaseClassName(base);
        if (baseNameNode) {
          const baseName = baseNameNode.text;
          edges.push(this.createEdge(classNode.id, this.nodeId(filePath, NodeKind.Class, baseName, 0), EdgeKind.Extends, {
            metadata: { referenceName: baseName },
            line: baseNameNode.startPosition.row + 1,
            column: baseNameNode.startPosition.column,
          }));
          unresolvedRefs.push(this.createUnresolvedRef(
            classNode.id,
            baseName,
            EdgeKind.Extends,
            baseNameNode.startPosition.row + 1,
            baseNameNode.startPosition.column,
            filePath
          ));
        }
        base = base.nextSibling;
      }
    }

    // Обработка тела класса
    const body = node.childForFieldName('body');
    if (body) {
      let child = body.firstChild;
      while (child) {
        this.processCppNodes(child, filePath, content, classNode.id, nodes, edges, unresolvedRefs, errors, qualifiedName, true);
        child = child.nextSibling;
      }
    }
  }

  /** Обрабатывает спецификатор структуры. */
  protected processStructSpecifier(
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

    const structNode = this.createNode(
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
    nodes.push(structNode);
    edges.push(this.createEdge(parentId, structNode.id, EdgeKind.Contains));

    // Параметры шаблона
    const templateParams = node.childForFieldName('type_parameters');
    if (templateParams) {
      this.processTemplateParameters(templateParams, filePath, content, structNode.id, nodes, edges, unresolvedRefs, errors);
    }

    // Базовые классы
    const baseClasses = node.childForFieldName('base_classes');
    if (baseClasses) {
      let base = baseClasses.firstChild;
      while (base) {
        const baseNameNode = this.extractBaseClassName(base);
        if (baseNameNode) {
          const baseName = baseNameNode.text;
          edges.push(this.createEdge(structNode.id, this.nodeId(filePath, NodeKind.Class, baseName, 0), EdgeKind.Extends, {
            metadata: { referenceName: baseName },
            line: baseNameNode.startPosition.row + 1,
            column: baseNameNode.startPosition.column,
          }));
          unresolvedRefs.push(this.createUnresolvedRef(
            structNode.id,
            baseName,
            EdgeKind.Extends,
            baseNameNode.startPosition.row + 1,
            baseNameNode.startPosition.column,
            filePath
          ));
        }
        base = base.nextSibling;
      }
    }

    // Обработка тела
    const body = node.childForFieldName('body');
    if (body) {
      let child = body.firstChild;
      while (child) {
        this.processCppNodes(child, filePath, content, structNode.id, nodes, edges, unresolvedRefs, errors, qualifiedName, true);
        child = child.nextSibling;
      }
    }
  }

  /** Обрабатывает определение функции. */
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
    insideClass: boolean
  ): void {
    const declarator = node.childForFieldName('declarator');
    if (!declarator) return;

    const nameNode = this.extractFunctionName(declarator);
    if (!nameNode) return;

    const name = nameNode.text;
    const qualifiedName = qualifiedNamePrefix ? `${qualifiedNamePrefix}::${name}` : name;
    const isVirtual = this.hasSpecifier(node, 'virtual');
    const isStatic = this.hasSpecifier(node, 'static');
    const docstring = this.extractDocstring(content, node.startPosition.row + 1);
    const signature = this.extractFunctionSignature(node, content);
    const returnType = this.extractReturnType(node);

    const nodeKind = insideClass ? NodeKind.Method : NodeKind.Function;

    const funcNode = this.createNode(
      filePath,
      nodeKind,
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
        isAbstract: isVirtual,
        returnType,
        visibility: this.extractVisibility(node),
      }
    );
    nodes.push(funcNode);
    edges.push(this.createEdge(parentId, funcNode.id, EdgeKind.Contains));

    // Параметры шаблона
    const templateParams = node.childForFieldName('type_parameters');
    if (templateParams) {
      this.processTemplateParameters(templateParams, filePath, content, funcNode.id, nodes, edges, unresolvedRefs, errors);
    }

    // Параметры функции
    const params = node.childForFieldName('parameters');
    if (params) {
      this.processFunctionParameters(params, filePath, content, funcNode.id, nodes, edges, unresolvedRefs, errors);
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
    const declarator = node.childForFieldName('declarator');
    if (!declarator) return;

    const nameNode = this.extractFieldName(declarator);
    if (!nameNode) return;

    const name = nameNode.text;
    const qualifiedName = qualifiedNamePrefix ? `${qualifiedNamePrefix}::${name}` : name;
    const isStatic = this.hasSpecifier(node, 'static');
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
        visibility: this.extractVisibility(node),
      }
    );
    nodes.push(propNode);
    edges.push(this.createEdge(parentId, propNode.id, EdgeKind.Contains));
  }

  /** Обрабатывает объявление переменной. */
  protected processDeclaration(
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
      if (decl.type === 'init_declarator') {
        const nameNode = decl.childForFieldName('declarator');
        if (nameNode) {
          const name = nameNode.text;
          const qualifiedName = qualifiedNamePrefix ? `${qualifiedNamePrefix}::${name}` : name;

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
              visibility: this.extractVisibility(node),
            }
          );
          nodes.push(varNode);
          edges.push(this.createEdge(parentId, varNode.id, EdgeKind.Contains));
        }
      }
      decl = decl.nextSibling;
    }
  }

  /** Обрабатывает инициализирующее объявление. */
  protected processInitStatement(
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
    const declaration = node.childForFieldName('declaration');
    if (!declaration) return;

    const declarators = declaration.childForFieldName('declarators');
    if (!declarators) return;

    let decl = declarators.firstChild;
    while (decl) {
      if (decl.type === 'init_declarator') {
        const nameNode = decl.childForFieldName('declarator');
        if (nameNode) {
          const name = nameNode.text;
          const qualifiedName = qualifiedNamePrefix ? `${qualifiedNamePrefix}::${name}` : name;

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

  /** Обрабатывает определение типа. */
  protected processTypeDefinition(
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
    const declarator = node.childForFieldName('declarator');
    if (!declarator) return;

    const nameNode = this.extractTypeName(declarator);
    if (!nameNode) return;

    const name = nameNode.text;
    const qualifiedName = qualifiedNamePrefix ? `${qualifiedNamePrefix}::${name}` : name;
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
      }
    );
    nodes.push(typeNode);
    edges.push(this.createEdge(parentId, typeNode.id, EdgeKind.Contains));
  }

  /** Обрабатывает using-объявление (включая using-алиасы). */
  protected processUsingDeclaration(
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
    // using TypeAlias = SomeType;
    const alias = node.childForFieldName('alias');
    if (alias) {
      const name = alias.text;
      const qualifiedName = qualifiedNamePrefix ? `${qualifiedNamePrefix}::${name}` : name;
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
        }
      );
      nodes.push(typeNode);
      edges.push(this.createEdge(parentId, typeNode.id, EdgeKind.Contains));
    }
  }

  /** Обрабатывает спецификатор перечисления. */
  protected processEnumSpecifier(
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
      }
    );
    nodes.push(enumNode);
    edges.push(this.createEdge(parentId, enumNode.id, EdgeKind.Contains));

    // Члены перечисления
    const body = node.childForFieldName('body');
    if (body) {
      let child = body.firstChild;
      while (child) {
        if (child.type === 'enumerator') {
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
                qualifiedName: `${qualifiedName}::${memberName}`,
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

  /** Обрабатывает директиву #include. */
  protected processPreprocInclude(
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

    const sourceText = pathNode.text.replace(/["<>/]/g, '');
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
  }

  /** Обрабатывает try. */
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

    // Обработка catch-блоков
    let child = node.firstChild;
    while (child) {
      if (child.type === 'catch_clause') {
        this.processCatchClause(child, filePath, content, tryNode.id, nodes, edges, unresolvedRefs, errors);
      }
      child = child.nextSibling;
    }
  }

  /** Обрабатывает catch. */
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

  /** Обрабатывает объявление параметра. */
  protected processParameterDeclaration(
    node: any,
    filePath: string,
    content: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    errors: IExtractionError[]
  ): void {
    const declarator = node.childForFieldName('declarator');
    if (!declarator) return;

    const nameNode = this.extractParamName(declarator);
    if (!nameNode) return;

    const paramName = nameNode.text;
    const paramNode = this.createNode(
      filePath,
      NodeKind.Parameter,
      paramName,
      node.startPosition.row + 1,
      node.endPosition.row + 1,
      node.startPosition.column,
      node.endPosition.column
    );
    nodes.push(paramNode);
    edges.push(this.createEdge(parentId, paramNode.id, EdgeKind.Contains));
  }

  /** Обрабатывает атрибут. */
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
    const attrText = node.text;

    const attrNode = this.createNode(
      filePath,
      NodeKind.Decorator,
      attrText,
      line,
      line,
      node.startPosition.column,
      node.endPosition.column
    );
    nodes.push(attrNode);
    edges.push(this.createEdge(attrNode.id, parentId, EdgeKind.Decorates, {
      line,
      column: node.startPosition.column,
    }));
  }

  /** Обрабатывает параметр шаблона. */
  protected processTemplateParameter(
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

    const tpName = nameNode.text;
    const tpNode = this.createNode(
      filePath,
      NodeKind.TypeParameter,
      tpName,
      node.startPosition.row + 1,
      node.endPosition.row + 1,
      node.startPosition.column,
      node.endPosition.column
    );
    nodes.push(tpNode);
    edges.push(this.createEdge(parentId, tpNode.id, EdgeKind.Contains));
  }

  /** Обрабатывает определение пространства имён. */
  protected processNamespaceDefinition(
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

    // Обработка тела
    const body = node.childForFieldName('body');
    if (body) {
      let child = body.firstChild;
      while (child) {
        this.processCppNodes(child, filePath, content, nsNode.id, nodes, edges, unresolvedRefs, errors, qualifiedName);
        child = child.nextSibling;
      }
    }
  }

  /** Обрабатывает аргумент шаблона (обобщение). */
  protected processTemplateArgument(
    node: any,
    filePath: string,
    content: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    errors: IExtractionError[]
  ): void {
    const argText = node.text;
    const line = node.startPosition.row + 1;

    const genericNode = this.createNode(
      filePath,
      NodeKind.Generic,
      argText,
      line,
      line,
      node.startPosition.column,
      node.endPosition.column
    );
    nodes.push(genericNode);
    edges.push(this.createEdge(parentId, genericNode.id, EdgeKind.Contains));

    unresolvedRefs.push(this.createUnresolvedRef(
      genericNode.id,
      argText,
      EdgeKind.Calls,
      line,
      node.startPosition.column,
      filePath
    ));
  }

  /** Обрабатывает параметры шаблона. */
  protected processTemplateParameters(
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
      if (child.type === 'template_type') {
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
      } else if (child.type === 'template_parameter') {
        this.processTemplateParameter(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
      }
      child = child.nextSibling;
    }
  }

  /** Обрабатывает параметры функции. */
  protected processFunctionParameters(
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
        this.processParameterDeclaration(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
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
      } else if (child.type === 'if_statement' || child.type === 'for_statement' ||
                 child.type === 'while_statement' || child.type === 'do_statement') {
        // Рекурсия по управляющим конструкциям
        let inner = child.firstChild;
        while (inner) {
          this.processFunctionBody(inner, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
          inner = inner.nextSibling;
        }
      } else if (child.type === 'expression_statement') {
        let expr = child.firstChild;
        while (expr) {
          if (expr.type === 'call_expression') {
            this.processCallExpression(expr, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
          }
          expr = expr.nextSibling;
        }
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
    if (funcNode.type === 'identifier') {
      funcName = funcNode.text;
    } else if (funcNode.type === 'field_expression') {
      const field = funcNode.childForFieldName('field');
      if (field) {
        funcName = field.text;
      }
    } else if (funcNode.type === 'scope_resolution') {
      const name = funcNode.childForFieldName('name');
      if (name) {
        funcName = name.text;
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

  /** Проверяет наличие спецификатора (virtual, static, inline и т.д.). */
  protected hasSpecifier(node: any, specifier: string): boolean {
    let child = node.firstChild;
    while (child) {
      if (child.type === 'specifier' && child.text === specifier) {
        return true;
      }
      child = child.nextSibling;
    }
    return false;
  }

  /** Извлекает видимость из спецификаторов доступа. */
  protected extractVisibility(node: any): 'public' | 'private' | 'protected' | 'internal' | undefined {
    let child = node.firstChild;
    while (child) {
      if (child.type === 'specifier') {
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
    const declarator = node.childForFieldName('declarator');
    if (!declarator) return undefined;

    const nameNode = this.extractFunctionName(declarator);
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
    const typeNode = node.childForFieldName('type');
    if (typeNode) {
      return typeNode.text;
    }
    return undefined;
  }

  /** Извлекает имя функции из декларатора. */
  protected extractFunctionName(declarator: any): any {
    if (declarator.type === 'function_declarator') {
      return declarator.childForFieldName('declarator');
    }
    if (declarator.type === 'identifier') {
      return declarator;
    }
    // Для приведённого декларатора (например, ~Destructor)
    const inner = declarator.childForFieldName('declarator');
    if (inner) {
      return this.extractFunctionName(inner);
    }
    // Для разрешения области видимости (например, MyClass::method)
    const nameNode = declarator.childForFieldName('name');
    if (nameNode) {
      return nameNode;
    }
    return null;
  }

  /** Извлекает имя поля из декларатора. */
  protected extractFieldName(declarator: any): any {
    if (declarator.type === 'identifier') {
      return declarator;
    }
    const inner = declarator.childForFieldName('declarator');
    if (inner) {
      return this.extractFieldName(inner);
    }
    return null;
  }

  /** Извлекает имя типа из декларатора. */
  protected extractTypeName(declarator: any): any {
    if (declarator.type === 'identifier') {
      return declarator;
    }
    if (declarator.type === 'type_identifier') {
      return declarator;
    }
    const inner = declarator.childForFieldName('declarator');
    if (inner) {
      return this.extractTypeName(inner);
    }
    return null;
  }

  /** Извлекает имя параметра из декларатора. */
  protected extractParamName(declarator: any): any {
    if (declarator.type === 'identifier') {
      return declarator;
    }
    if (declarator.type === 'type_identifier') {
      return declarator;
    }
    const inner = declarator.childForFieldName('declarator');
    if (inner) {
      return this.extractParamName(inner);
    }
    return null;
  }

  /** Извлекает имя базового класса из элемента списка наследования. */
  protected extractBaseClassName(base: any): any {
    const nameNode = base.childForFieldName('name');
    if (nameNode) return nameNode;

    const typeNode = base.childForFieldName('type');
    if (typeNode) {
      if (typeNode.type === 'type_identifier') {
        return typeNode;
      }
      const inner = typeNode.childForFieldName('name');
      if (inner) return inner;
    }
    return null;
  }

  /** Проверяет, есть ли виртуальный деструктор (абстрактный класс). */
  protected hasVirtualDestructor(node: any): boolean {
    const body = node.childForFieldName('body');
    if (!body) return false;

    let child = body.firstChild;
    while (child) {
      if (child.type === 'function_definition' || child.type === 'declaration') {
        if (this.hasSpecifier(child, 'virtual')) {
          const declarator = child.childForFieldName('declarator');
          if (declarator) {
            const nameNode = this.extractFunctionName(declarator);
            if (nameNode && nameNode.text.startsWith('~')) {
              return true;
            }
          }
        }
      }
      child = child.nextSibling;
    }
    return false;
  }
}
