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
  Language,
} from '../../ntgraph/Types';
import { ExtractorBase } from '../ExtractorBase';

export class JavaExtractor extends ExtractorBase {
  private isSpringBoot: boolean = false;

  public getLanguage(): Language {
    return 'java';
  }

  public getSupportedExtensions(): string[] {
    return ['.java'];
  }

  public extract(
    content: string,
    filePath: string,
    frameworkNames?: string[]
  ): IExtractionResult {
    this.isSpringBoot = frameworkNames?.includes('springboot') ?? false;
    // Измеряем время извлечения
    const start = Date.now();
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
          'parse_error'
        ));
        // Измеряем время извлечения
        return { nodes, edges, unresolvedReferences: unresolvedRefs, errors, durationMs: Date.now() - start };
      }

      const root = tree.rootNode;

      // Корневой узел — файл
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

      // Проверяем, является ли файл module-info.java
      const isModuleInfo = filePath.endsWith('module-info.java');

      let moduleNodeId: string;

      if (isModuleInfo) {
        // Для module-info.java извлекаем имя модуля из module_declaration
        const modDecl = root.childForFieldName('name') || root.firstChild;
        const modName = modDecl ? modDecl.text : 'unnamed';
        const moduleNode = this.createNode(
          filePath,
          NodeKind.Module,
          modName,
          1,
          content.split('\n').length,
          0,
          0,
          {
            qualifiedName: modName,
          }
        );
        nodes.push(moduleNode);
        edges.push(this.createEdge(fileNode.id, moduleNode.id, EdgeKind.Contains));
        moduleNodeId = moduleNode.id;
      } else {
        // Для обычных Java-файлов создаём Module-узел с именем файла
        const fileName = filePath.split('/').pop()?.split('\\').pop() || 'unnamed';
        const modName = fileName.replace(/\.java$/, '');
        const moduleNode = this.createNode(
          filePath,
          NodeKind.Module,
          modName,
          1,
          content.split('\n').length,
          0,
          0,
          {
            qualifiedName: modName,
          }
        );
        nodes.push(moduleNode);
        edges.push(this.createEdge(fileNode.id, moduleNode.id, EdgeKind.Contains));
        moduleNodeId = moduleNode.id;
      }

      // Обработка объявлений верхнего уровня
      this.processJavaNodes(
        root,
        filePath,
        content,
        moduleNodeId,
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

    // Измеряем время извлечения
    return { nodes, edges, unresolvedReferences: unresolvedRefs, errors, durationMs: Date.now() - start };
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

      case 'module_declaration':
        this.processModuleDeclaration(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
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

      case 'type_parameter':
        this.processTypeParameter(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      case 'type_argument':
        this.processTypeArgument(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      case 'method_invocation':
        this.processMethodInvocation(node, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
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

  /** Обрабатывает объявление модуля (Java 9+ module-info.java). */
  protected processModuleDeclaration(
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
    const moduleNode = this.createNode(
      filePath,
      NodeKind.Module,
      name,
      node.startPosition.row + 1,
      node.endPosition.row + 1,
      node.startPosition.column,
      node.endPosition.column,
      {
        qualifiedName: name,
      }
    );
    nodes.push(moduleNode);
    edges.push(this.createEdge(parentId, moduleNode.id, EdgeKind.Contains));

    // Обработка тела модуля (requires, exports, opens, uses, provides)
    const body = node.childForFieldName('body');
    if (body) {
      let child = body.firstChild;
      while (child) {
        if (child.type === 'requires_statement') {
          this.processRequiresStatement(child, filePath, content, moduleNode.id, nodes, edges, unresolvedRefs, errors);
        } else if (child.type === 'exports_statement') {
          this.processExportsStatement(child, filePath, content, moduleNode.id, nodes, edges, unresolvedRefs, errors);
        } else {
          this.processJavaNodes(child, filePath, content, moduleNode.id, nodes, edges, unresolvedRefs, errors);
        }
        child = child.nextSibling;
      }
    }
  }

  /** Обрабатывает requires_statement в module-info.java. */
  protected processRequiresStatement(
    node: any,
    filePath: string,
    _content: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    _errors: IExtractionError[]
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;

    const name = nameNode.text;
    const line = node.startPosition.row + 1;
    const column = node.startPosition.column;
    const isTransitive = this.hasModifier(node, 'transitive');

    const importNode = this.createNode(
      filePath,
      NodeKind.Import,
      name,
      line,
      line,
      column,
      node.endPosition.column,
      {
        isTransitive,
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
  }

  /** Обрабатывает exports_statement в module-info.java. */
  protected processExportsStatement(
    node: any,
    filePath: string,
    _content: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    _errors: IExtractionError[]
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;

    const name = nameNode.text;
    const line = node.startPosition.row + 1;
    const column = node.startPosition.column;

    const exportNode = this.createNode(
      filePath,
      NodeKind.Export,
      name,
      line,
      line,
      column,
      node.endPosition.column
    );
    nodes.push(exportNode);
    edges.push(this.createEdge(parentId, exportNode.id, EdgeKind.Contains));
    edges.push(this.createEdge(parentId, exportNode.id, EdgeKind.Exports));

    unresolvedRefs.push(this.createUnresolvedRef(
      exportNode.id,
      name,
      EdgeKind.Exports,
      line,
      column,
      filePath
    ));
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
    // Ребро Imports от файла к узлу импорта
    edges.push(this.createEdge(parentId, importNode.id, EdgeKind.Imports));

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

    // Извлечение аннотаций
    const decorators: string[] = [];
    {
      let child = node.firstChild;
      while (child) {
        if (child.type === 'annotation') {
          const decText = child.text.startsWith('@') ? child.text.slice(1) : child.text;
          decorators.push(decText);
        }
        child = child.nextSibling;
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

    // Export node для публичных символов
    const classVisibility = this.extractVisibility(node);
    if (classVisibility === 'public') {
      const exportNode = this.createNode(
        filePath,
        NodeKind.Export,
        name,
        classNode.startLine,
        classNode.startLine,
        classNode.startColumn,
        classNode.endColumn
      );
      nodes.push(exportNode);
      edges.push(this.createEdge(parentId, exportNode.id, EdgeKind.Contains));
      edges.push(this.createEdge(parentId, classNode.id, EdgeKind.Exports));
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

    // Обработка Spring Boot: компонент, маршруты, внедрение зависимостей
    if (this.isSpringBoot) {
      this.processSpringClass(node, filePath, content, classNode, nodes, edges, unresolvedRefs, errors);
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
      let child = node.firstChild;
      while (child) {
        if (child.type === 'annotation') {
          const decText = child.text.startsWith('@') ? child.text.slice(1) : child.text;
          decorators.push(decText);
        }
        child = child.nextSibling;
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

    // Export node для публичных символов
    const ifaceVisibility = this.extractVisibility(node);
    if (ifaceVisibility === 'public') {
      const exportNode = this.createNode(
        filePath,
        NodeKind.Export,
        name,
        ifaceNode.startLine,
        ifaceNode.startLine,
        ifaceNode.startColumn,
        ifaceNode.endColumn
      );
      nodes.push(exportNode);
      edges.push(this.createEdge(parentId, exportNode.id, EdgeKind.Contains));
      edges.push(this.createEdge(parentId, ifaceNode.id, EdgeKind.Exports));
    }

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

    // Извлечение аннотаций
    const decorators: string[] = [];
    {
      let child = node.firstChild;
      while (child) {
        if (child.type === 'annotation') {
          const decText = child.text.startsWith('@') ? child.text.slice(1) : child.text;
          decorators.push(decText);
        }
        child = child.nextSibling;
      }
    }

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
        decorators,
      }
    );
    nodes.push(enumNode);
    edges.push(this.createEdge(parentId, enumNode.id, EdgeKind.Contains));

    // Export node для публичных символов
    const enumVisibility = this.extractVisibility(node);
    if (enumVisibility === 'public') {
      const exportNode = this.createNode(
        filePath,
        NodeKind.Export,
        name,
        enumNode.startLine,
        enumNode.startLine,
        enumNode.startColumn,
        enumNode.endColumn
      );
      nodes.push(exportNode);
      edges.push(this.createEdge(parentId, exportNode.id, EdgeKind.Contains));
      edges.push(this.createEdge(parentId, enumNode.id, EdgeKind.Exports));
    }

    // Ребра decorates от перечисления к типам аннотаций
    for (const decText of decorators) {
      edges.push(this.createEdge(enumNode.id, this.nodeId(filePath, NodeKind.Class, decText, 0), EdgeKind.Decorates, {
        metadata: { referenceName: decText },
        line: enumNode.startLine,
        column: enumNode.startColumn,
      }));
      unresolvedRefs.push(this.createUnresolvedRef(
        enumNode.id,
        decText,
        EdgeKind.Decorates,
        enumNode.startLine,
        enumNode.startColumn,
        filePath
      ));
    }

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

    // Извлечение аннотаций и проверка @Override
    const decorators: string[] = [];
    let hasOverride = false;
    {
      let child = node.firstChild;
      while (child) {
        if (child.type === 'annotation') {
          const decText = child.text.startsWith('@') ? child.text.slice(1) : child.text;
          decorators.push(decText);
          if (decText === 'Override') {
            hasOverride = true;
          }
        }
        child = child.nextSibling;
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
        isStatic,
        isAbstract,
        isFinal,
        isSynchronized,
        returnType,
        visibility: this.extractVisibility(node),
        decorators,
      }
    );
    nodes.push(methodNode);
    edges.push(this.createEdge(parentId, methodNode.id, EdgeKind.Contains));

    // Export node для публичных символов
    const methodVisibility = this.extractVisibility(node);
    if (methodVisibility === 'public') {
      const exportNode = this.createNode(
        filePath,
        NodeKind.Export,
        name,
        methodNode.startLine,
        methodNode.startLine,
        methodNode.startColumn,
        methodNode.endColumn
      );
      nodes.push(exportNode);
      edges.push(this.createEdge(parentId, exportNode.id, EdgeKind.Contains));
      edges.push(this.createEdge(parentId, methodNode.id, EdgeKind.Exports));
    }

    // Ребро Returns от метода к типу возвращаемого значения
    if (returnType) {
      edges.push(this.createEdge(methodNode.id, this.nodeId(filePath, NodeKind.Class, returnType, methodNode.startLine), EdgeKind.Returns, { line: methodNode.startLine }));
    }

    // Ребро overrides если есть @Override
    if (hasOverride) {
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

    // Export node для публичных символов
    const ctorVisibility = this.extractVisibility(node);
    if (ctorVisibility === 'public') {
      const exportNode = this.createNode(
        filePath,
        NodeKind.Export,
        name,
        funcNode.startLine,
        funcNode.startLine,
        funcNode.startColumn,
        funcNode.endColumn
      );
      nodes.push(exportNode);
      edges.push(this.createEdge(parentId, exportNode.id, EdgeKind.Contains));
      edges.push(this.createEdge(parentId, funcNode.id, EdgeKind.Exports));
    }

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
          // Константа: final + UPPER_CASE
          const isConstant = isFinal && /^[A-Z_][A-Z0-9_]*$/.test(name);
          const fieldKind = isConstant ? NodeKind.Constant : NodeKind.Field;

          // Поле класса — используем Field
          const fieldNode = this.createNode(
            filePath,
            fieldKind,
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
          nodes.push(fieldNode);
          edges.push(this.createEdge(parentId, fieldNode.id, EdgeKind.Contains));

          // Export node для публичных символов
          const fieldVisibility = this.extractVisibility(node);
          if (fieldVisibility === 'public') {
            const exportNode = this.createNode(
              filePath,
              NodeKind.Export,
              name,
              fieldNode.startLine,
              fieldNode.startLine,
              fieldNode.startColumn,
              fieldNode.endColumn
            );
            nodes.push(exportNode);
            edges.push(this.createEdge(parentId, exportNode.id, EdgeKind.Contains));
            edges.push(this.createEdge(parentId, fieldNode.id, EdgeKind.Exports));
          }
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
      NodeKind.Function,
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
      NodeKind.Function,
      'catch',
      node.startPosition.row + 1,
      node.endPosition.row + 1,
      node.startPosition.column,
      node.endPosition.column
    );
    nodes.push(catchNode);
    edges.push(this.createEdge(parentId, catchNode.id, EdgeKind.References));

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
      NodeKind.Function,
      'throw',
      line,
      line,
      node.startPosition.column,
      node.endPosition.column
    );
    nodes.push(throwNode);
    edges.push(this.createEdge(parentId, throwNode.id, EdgeKind.Contains));

    if (argumentNode) {
      edges.push(this.createEdge(throwNode.id, parentId, EdgeKind.References, {
        metadata: { expression: argumentNode.text },
        line,
        column: argumentNode.startPosition.column,
      }));
    }
  }

  /** Обрабатывает аннотацию (Decorator). */
  protected processAnnotation(
    _node: any,
    _filePath: string,
    _content: string,
    _parentId: string,
    _nodes: INode[],
    _edges: IEdge[],
    _unresolvedRefs: IUnresolvedReference[],
    _errors: IExtractionError[]
  ): void {
    // Аннотации обрабатываются в родительских обработчиках
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
      NodeKind.Parameter,
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
      NodeKind.Variable,
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
          const typeNode = child.childForFieldName('type');
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
           if (typeNode) {
            edges.push(this.createEdge(paramNode.id, this.nodeId(filePath, NodeKind.Class, typeNode.text, paramNode.startLine), EdgeKind.TypeOf, { line: paramNode.startLine }));
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
        this.processTypeParameter(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
      }
      child = child.nextSibling;
    }
  }

  /** Обрабатывает вызов метода (MethodInvocation). */
  protected processMethodInvocation(
    node: any,
    filePath: string,
    _content: string,
    parentId: string,
    _nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    _errors: IExtractionError[]
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;

    const methodName = nameNode.text;
    const line = node.startPosition.row + 1;
    const column = node.startPosition.column;

    // Создаём ребро calls от текущего метода к вызываемому
    edges.push(this.createEdge(parentId, this.nodeId(filePath, NodeKind.Method, methodName, 0), EdgeKind.Calls, {
      metadata: { referenceName: methodName },
      line,
      column,
    }));

    unresolvedRefs.push(this.createUnresolvedRef(
      parentId,
      methodName,
      EdgeKind.Calls,
      line,
      column,
      filePath
    ));

    // Если вызов на объекте, проверяем new-выражение для instantiates
    const objectNode = node.childForFieldName('object');
    if (objectNode && objectNode.type === 'object_creation_expression') {
      const typeNameNode = objectNode.childForFieldName('type');
      if (typeNameNode) {
        const typeName = typeNameNode.text;
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
      if (child.type === 'method_invocation') {
        this.processMethodInvocation(child, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
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
      } else if (child.type === 'try_statement') {
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

  /** Определяет, является ли класс Spring-стереотипом. */
  protected detectSpringStereotype(node: any): string | undefined {
    const stereotypes = ['Controller', 'RestController', 'Service', 'Repository', 'Component'];
    let child = node.firstChild;
    while (child) {
      if (child.type === 'annotation') {
        const idNode = child.childForFieldName('name');
        if (idNode && stereotypes.includes(idNode.text)) {
          return idNode.text;
        }
      }
      child = child.nextSibling;
    }
    return undefined;
  }

  /** Извлекает маршруты из аннотаций методов. */
  protected extractSpringRoutes(node: any): Array<{ method: string; path: string }> {
    const results: Array<{ method: string; path: string }> = [];
    const mappingAnns: Record<string, string> = {
      'GetMapping': 'GET',
      'PostMapping': 'POST',
      'PutMapping': 'PUT',
      'DeleteMapping': 'DELETE',
      'PatchMapping': 'PATCH',
    };

    let child = node.firstChild;
    while (child) {
      if (child.type === 'annotation') {
        const idNode = child.childForFieldName('name');
        if (!idNode) {
          child = child.nextSibling;
          continue;
        }

        const annName = idNode.text;

        if (mappingAnns[annName]) {
          const httpMethod = mappingAnns[annName];
          const path = this.extractAnnotationPath(child);
          results.push({ method: httpMethod, path });
        } else if (annName === 'RequestMapping') {
          const path = this.extractAnnotationPath(child);
          const httpMethod = this.extractRequestMappingMethod(child);
          if (httpMethod) {
            results.push({ method: httpMethod, path });
          }
        }
      }
      child = child.nextSibling;
    }
    return results;
  }

  /** Извлекает путь из аргументов аннотации. */
  protected extractAnnotationPath(annotationNode: any): string {
    const args = annotationNode.childForFieldName('arguments');
    if (!args) return '/';

    const firstArg = args.firstChild;
    if (!firstArg) return '/';

    if (firstArg.type === 'string_literal') {
      return firstArg.text.replace(/^"/, '').replace(/"$/, '');
    }
    return '/';
  }

  /** Извлекает HTTP-метод из аннотации RequestMapping. */
  protected extractRequestMappingMethod(annotationNode: any): string | undefined {
    const args = annotationNode.childForFieldName('arguments');
    if (!args) return undefined;

    let child = args.firstChild;
    while (child) {
      if (child.type === 'annotation_attribute') {
        const nameNode = child.childForFieldName('name');
        if (nameNode && nameNode.text === 'method') {
          const valueNode = child.childForFieldName('value');
          if (valueNode && valueNode.type === 'enum_constant') {
            return valueNode.text;
          }
          if (valueNode) {
            let vc = valueNode.firstChild;
            while (vc) {
              if (vc.type === 'enum_constant') {
                return vc.text;
              }
              vc = vc.nextSibling;
            }
          }
        }
      }
      child = child.nextSibling;
    }
    return undefined;
  }

  /** Проверяет наличие аннотации Autowired на узле. */
  protected hasAutowired(node: any): boolean {
    let child = node.firstChild;
    while (child) {
      if (child.type === 'annotation') {
        const idNode = child.childForFieldName('name');
        if (idNode && idNode.text === 'Autowired') {
          return true;
        }
      }
      child = child.nextSibling;
    }
    return false;
  }

  /** Проверяет наличие аннотации Autowired на параметре. */
  protected hasParamAutowired(paramNode: any): boolean {
    let child = paramNode.firstChild;
    while (child) {
      if (child.type === 'annotation') {
        const idNode = child.childForFieldName('name');
        if (idNode && idNode.text === 'Autowired') {
          return true;
        }
      }
      child = child.nextSibling;
    }
    return false;
  }

  /** Обрабатывает Spring Boot логику для класса. */
  protected processSpringClass(
    node: any,
    filePath: string,
    content: string,
    classNode: INode,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    errors: IExtractionError[]
  ): void {
    const stereotype = this.detectSpringStereotype(node);
    if (!stereotype) return;

    // Создание узла компонента
    const compNode = this.createNode(
      filePath,
      NodeKind.Component,
      classNode.name,
      classNode.startLine,
      classNode.endLine,
      classNode.startColumn,
      classNode.endColumn,
      {
        qualifiedName: classNode.qualifiedName,
        stereotype,
      }
    );
    nodes.push(compNode);
    edges.push(this.createEdge(classNode.id, compNode.id, EdgeKind.TypeOf));

    // Извлечение маршрутов из методов класса
    const body = node.childForFieldName('body');
    if (body) {
      let child = body.firstChild;
      while (child) {
        if (child.type === 'method_declaration') {
          const routes = this.extractSpringRoutes(child);
          for (const route of routes) {
            const routeName = `route:${route.method}:${route.path}`;
            const line = child.startPosition.row + 1;
            const column = child.startPosition.column;

            const routeNode = this.createNode(
              filePath,
              NodeKind.Route,
              routeName,
              line,
              line,
              column,
              child.endPosition.column,
              {
                method: route.method,
                path: route.path,
              }
            );
            nodes.push(routeNode);
            edges.push(this.createEdge(compNode.id, routeNode.id, EdgeKind.Contains));

            const nameNode = child.childForFieldName('name');
            if (nameNode) {
              const methodName = nameNode.text;
              edges.push(this.createEdge(routeNode.id, this.nodeId(filePath, NodeKind.Method, methodName, line), EdgeKind.Calls, {
                metadata: { referenceName: methodName },
                line,
                column,
              }));
            }
          }
        }
        child = child.nextSibling;
      }

      // Внедрение зависимостей через поля
      let fchild = body.firstChild;
      while (fchild) {
        if (fchild.type === 'field_declaration' && this.hasAutowired(fchild)) {
          const fieldTypeNode = fchild.childForFieldName('type');
          if (fieldTypeNode) {
            const typeName = fieldTypeNode.text;
            const line = fchild.startPosition.row + 1;
            const column = fchild.startPosition.column;

            edges.push(this.createEdge(classNode.id, this.nodeId(filePath, NodeKind.Class, typeName, 0), EdgeKind.References, {
              metadata: { referenceName: typeName },
              line,
              column,
            }));
            unresolvedRefs.push(this.createUnresolvedRef(
              classNode.id,
              typeName,
              EdgeKind.References,
              line,
              column,
              filePath
            ));
          }
        }
        fchild = fchild.nextSibling;
      }

      // Внедрение зависимостей через конструктор
      let cchild = body.firstChild;
      while (cchild) {
        if (cchild.type === 'constructor_declaration' && this.hasAutowired(cchild)) {
          const params = cchild.childForFieldName('parameters');
          if (params) {
            let param = params.firstChild;
            while (param) {
              if (param.type === 'formal_parameter') {
                const paramTypeNode = param.childForFieldName('type');
                if (paramTypeNode) {
                  const typeName = paramTypeNode.text;
                  const line = param.startPosition.row + 1;
                  const column = param.startPosition.column;

                  edges.push(this.createEdge(classNode.id, this.nodeId(filePath, NodeKind.Class, typeName, 0), EdgeKind.References, {
                    metadata: { referenceName: typeName },
                    line,
                    column,
                  }));
                  unresolvedRefs.push(this.createUnresolvedRef(
                    classNode.id,
                    typeName,
                    EdgeKind.References,
                    line,
                    column,
                    filePath
                  ));
                }
              }
              param = param.nextSibling;
            }
          }
        }
        cchild = cchild.nextSibling;
      }
    }
  }
}
