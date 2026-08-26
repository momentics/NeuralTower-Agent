/**
 * Экстрактор для Astro SFC (Single File Component).
 *
 * Разбивает файл на блоки: frontmatter (---), HTML-шаблон, <style>.
 * Frontmatter парсится через WASM-грамматики web-tree-sitter
 * (WasmRuntime, TypeScript) или regex.
 * Шаблон разбирается через регулярные выражения для извлечения
 * компонент, обработчиков событий и клиентских директив.
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

/** Блок файла Astro. */
interface AstroBlock {
  content: string;
  startLine: number;
}

export class AstroExtractor extends ExtractorBase {
  public getLanguage(): Language {
    return 'astro';
  }

  public getSupportedExtensions(): string[] {
    return ['.astro'];
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
      const totalLines = content.split('\n').length;

      // Узел файла
      const fileNode = this.createNode(
        filePath,
        NodeKind.File,
        filePath,
        1,
        totalLines,
        0,
        0
      );
      nodes.push(fileNode);

      // Узел модуля
      const moduleName = filePath.replace(/.*[/\\]/, '').replace(/\.[^.]+$/, '');
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

      // Разбиение на блоки
      const blocks = this.splitBlocks(content);

      // Обработка frontmatter — парсинг как JavaScript/TypeScript
      if (blocks.frontmatter.content.length > 0) {
        this.extractFrontmatter(
          blocks.frontmatter.content,
          blocks.frontmatter.startLine,
          filePath,
          moduleNode.id,
          nodes,
          edges,
          unresolvedRefs,
          errors
        );
      }

      // Обработка HTML-шаблона — извлечение компонент, обработчиков, директив
      if (blocks.template.content.length > 0) {
        this.extractTemplate(
          blocks.template.content,
          blocks.template.startLine,
          filePath,
          moduleNode.id,
          nodes,
          edges,
          unresolvedRefs
        );
      }

      // <style> блок пропускается
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(this.createError(
        `Ошибка парсинга Astro: ${message}`,
        filePath,
        'error',
        'parse_error'
      ));
    }

    return { nodes, edges, unresolvedReferences: unresolvedRefs, errors, durationMs: Date.now() - start };
  }

  /** Разделяет содержимое файла Astro на блоки frontmatter и шаблона. */
  private splitBlocks(content: string): {
    frontmatter: AstroBlock;
    template: AstroBlock;
  } {
    const frontmatter = this.extractFrontmatterBlock(content);

    // Шаблон — всё, что не входит в frontmatter
    const templateContent = this.getTemplateContent(content, frontmatter);

    return {
      frontmatter,
      template: { content: templateContent, startLine: 1 },
    };
  }

  /** Извлекает frontmatter блок (между --- маркерами). */
  private extractFrontmatterBlock(content: string): AstroBlock {
    const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!frontmatterMatch) {
      return { content: '', startLine: 0 };
    }

    const startLine = 1;
    const blockContent = frontmatterMatch[1];

    return {
      content: blockContent,
      startLine,
    };
  }

  /** Получает шаблонную часть файла (вне frontmatter). */
  private getTemplateContent(content: string, frontmatter: AstroBlock): string {
    let result = content;

    // Удаляем frontmatter блок, сохраняя число строк
    const fmRegex = /^---\r?\n[\s\S]*?\r?\n---/;
    result = result.replace(fmRegex, (match) => {
      return '\n'.repeat(match.split('\n').length);
    });

    return result;
  }

  /** Извлекает содержимое frontmatter и парсит через tree-sitter или regex. */
  private extractFrontmatter(
    frontmatterContent: string,
    frontmatterStartLine: number,
    filePath: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    errors: IExtractionError[]
  ): void {
    try {
      this.extractFrontmatterWithTreeSitter(
        frontmatterContent,
        frontmatterStartLine,
        filePath,
        parentId,
        nodes,
        edges,
        unresolvedRefs,
        errors
      );
      return;
    } catch {
      // tree-sitter недоступен — используем regex
    }

    this.extractFrontmatterWithRegex(
      frontmatterContent,
      frontmatterStartLine,
      filePath,
      parentId,
      nodes,
      edges,
      unresolvedRefs,
      errors
    );
  }

  /** Парсит frontmatter через tree-sitter-typescript. */
  private extractFrontmatterWithTreeSitter(
    content: string,
    offsetLine: number,
    filePath: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    errors: IExtractionError[]
  ): void {
    const p = getParserForFile('typescript', filePath);
    if (!p) {
      // WASM-грамматика недоступна — парсинг frontmatter пропускается
      errors.push(this.createError(
        'WASM-грамматика typescript не загружена',
        filePath,
        'error',
        'parse_error'
      ));
      return;
    }

    const tree = p.parse(content);
    if (!tree) {
      errors.push(this.createError(
        'Не удалось разобрать frontmatter',
        filePath,
        'error',
        'parse_error'
      ));
      return;
    }

    const root = tree.rootNode;
    if (root.type === 'lexical_declaration' || root.type === 'statement_block') {
      return;
    }

    this.processFrontmatterNode(
      root,
      offsetLine,
      filePath,
      content,
      parentId,
      nodes,
      edges,
      unresolvedRefs,
      errors
    );
    tree.delete();
  }

  /** Обрабатывает узел AST frontmatter с коррекцией номеров строк. */
  private processFrontmatterNode(
    node: any,
    offsetLine: number,
    filePath: string,
    content: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    errors: IExtractionError[]
  ): void {
    if (!node || node.isMissing || node.isError) return;

    switch (node.type) {
      case 'function_declaration':
        this.processFmFunction(node, offsetLine, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      case 'arrow_function':
        this.processFmArrowFunction(node, offsetLine, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      case 'lexical_declaration':
      case 'variable_declaration':
        this.processFmVariables(node, offsetLine, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      case 'class_declaration':
        this.processFmClass(node, offsetLine, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      case 'method_definition':
        this.processFmMethod(node, offsetLine, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      case 'import_statement':
        this.processFmImport(node, offsetLine, filePath, parentId, nodes, edges, unresolvedRefs);
        break;

      case 'export_statement':
      case 'export_named_declaration':
      case 'export_all_declaration':
        this.processFmExport(node, offsetLine, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      case 'interface_declaration':
        this.processFmInterface(node, offsetLine, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      case 'type_alias_declaration':
        this.processFmTypeAlias(node, offsetLine, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        break;

      default:
        let child = node.firstChild;
        while (child) {
          this.processFrontmatterNode(child, offsetLine, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
          child = child.nextSibling;
        }
        break;
    }
  }

  /** Обрабатывает объявление функции в frontmatter. */
  private processFmFunction(
    node: any,
    offsetLine: number,
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
    const isAsync = this.hasModifier(node, 'async');
    const docstring = this.extractDocstring(content, node.startPosition.row + 1 + offsetLine);
    const signature = this.extractFunctionSignature(node, content);
    const returnType = this.extractReturnType(node);
    const isExported = this.hasModifier(node, 'export');

    const funcNode = this.createNode(
      filePath,
      NodeKind.Function,
      name,
      node.startPosition.row + 1 + offsetLine,
      node.endPosition.row + 1 + offsetLine,
      node.startPosition.column,
      node.endPosition.column,
      {
        qualifiedName: name,
        docstring,
        signature,
        isAsync,
        returnType,
        isExported,
      }
    );
    nodes.push(funcNode);
    edges.push(this.createEdge(parentId, funcNode.id, EdgeKind.Contains));
  }

  /** Обрабатывает стрелочную функцию в frontmatter. */
  private processFmArrowFunction(
    node: any,
    offsetLine: number,
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
    const isAsync = this.hasModifier(node, 'async');
    const docstring = this.extractDocstring(content, node.startPosition.row + 1 + offsetLine);
    const signature = this.extractFunctionSignature(node, content);
    const returnType = this.extractReturnType(node);

    const funcNode = this.createNode(
      filePath,
      NodeKind.Function,
      name,
      node.startPosition.row + 1 + offsetLine,
      node.endPosition.row + 1 + offsetLine,
      node.startPosition.column,
      node.endPosition.column,
      {
        qualifiedName: name,
        docstring,
        signature,
        isAsync,
        returnType,
      }
    );
    nodes.push(funcNode);
    edges.push(this.createEdge(parentId, funcNode.id, EdgeKind.Contains));
  }

  /** Обрабатывает объявление переменных в frontmatter. */
  private processFmVariables(
    node: any,
    offsetLine: number,
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
      if (child.type === 'variable_declarator') {
        const nameNode = child.childForFieldName('name');
        if (nameNode) {
          const name = nameNode.text;
          const isConst = node.type === 'lexical_declaration';
          const isUpper = /^[A-Z][A-Z0-9_]*$/.test(name);
          const kind = isConst && isUpper ? NodeKind.Constant : NodeKind.Variable;

          const varNode = this.createNode(
            filePath,
            kind,
            name,
            child.startPosition.row + 1 + offsetLine,
            child.endPosition.row + 1 + offsetLine,
            child.startPosition.column,
            child.endPosition.column,
            { qualifiedName: name }
          );
          nodes.push(varNode);
          edges.push(this.createEdge(parentId, varNode.id, EdgeKind.Contains));
        }
      }
      child = child.nextSibling;
    }
  }

  /** Обрабатывает объявление класса в frontmatter. */
  private processFmClass(
    node: any,
    offsetLine: number,
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
    const isExported = this.hasModifier(node, 'export');
    const isAbstract = this.hasModifier(node, 'abstract');
    const docstring = this.extractDocstring(content, node.startPosition.row + 1 + offsetLine);

    const classNode = this.createNode(
      filePath,
      NodeKind.Class,
      name,
      node.startPosition.row + 1 + offsetLine,
      node.endPosition.row + 1 + offsetLine,
      node.startPosition.column,
      node.endPosition.column,
      {
        qualifiedName: name,
        docstring,
        isAbstract,
        isExported,
      }
    );
    nodes.push(classNode);
    edges.push(this.createEdge(parentId, classNode.id, EdgeKind.Contains));

    const body = node.childForFieldName('body');
    if (body) {
      let cchild = body.firstChild;
      while (cchild) {
        this.processFrontmatterNode(cchild, offsetLine, filePath, content, classNode.id, nodes, edges, unresolvedRefs, errors);
        cchild = cchild.nextSibling;
      }
    }
  }

  /** Обрабатывает определение метода в frontmatter. */
  private processFmMethod(
    node: any,
    offsetLine: number,
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
    const isAsync = this.hasModifier(node, 'async');
    const isStatic = this.hasModifier(node, 'static');
    const docstring = this.extractDocstring(content, node.startPosition.row + 1 + offsetLine);
    const signature = this.extractFunctionSignature(node, content);
    const returnType = this.extractReturnType(node);

    const methodNode = this.createNode(
      filePath,
      NodeKind.Method,
      name,
      node.startPosition.row + 1 + offsetLine,
      node.endPosition.row + 1 + offsetLine,
      node.startPosition.column,
      node.endPosition.column,
      {
        qualifiedName: name,
        docstring,
        signature,
        isAsync,
        isStatic,
        returnType,
      }
    );
    nodes.push(methodNode);
    edges.push(this.createEdge(parentId, methodNode.id, EdgeKind.Contains));
  }

  /** Обрабатывает импорт в frontmatter. */
  private processFmImport(
    node: any,
    offsetLine: number,
    filePath: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[]
  ): void {
    const sourceNode = node.childForFieldName('source');
    if (!sourceNode) return;

    const sourceText = sourceNode.text.replace(/['"]/g, '');
    const line = node.startPosition.row + 1 + offsetLine;
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
    edges.push(this.createEdge(parentId, importNode.id, EdgeKind.Imports, { line, column }));

    unresolvedRefs.push(this.createUnresolvedRef(
      importNode.id,
      sourceText,
      EdgeKind.Imports,
      line,
      column,
      filePath
    ));
  }

  /** Обрабатывает экспорт в frontmatter. */
  private processFmExport(
    node: any,
    offsetLine: number,
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
        const line = node.startPosition.row + 1 + offsetLine;

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
        edges.push(this.createEdge(parentId, exportNode.id, EdgeKind.Exports));

        unresolvedRefs.push(this.createUnresolvedRef(
          exportNode.id,
          sourceText,
          EdgeKind.Exports,
          line,
          node.startPosition.column,
          filePath
        ));
      }
    } else if (node.type === 'export_named_declaration') {
      const sourceNode = node.childForFieldName('source');
      if (sourceNode) {
        const sourceText = sourceNode.text.replace(/['"]/g, '');
        const line = node.startPosition.row + 1 + offsetLine;

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
        edges.push(this.createEdge(parentId, exportNode.id, EdgeKind.Exports));

        unresolvedRefs.push(this.createUnresolvedRef(
          exportNode.id,
          sourceText,
          EdgeKind.Exports,
          line,
          node.startPosition.column,
          filePath
        ));
      }
    }

    // Обработка экспортируемых объявлений — для всех видов export
    // (plain export_statement, export { ... }, export * from '...').
    let child = node.firstChild;
    while (child) {
      if (child.type !== 'string' && child.type !== 'import_clause') {
        this.processFrontmatterNode(child, offsetLine, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
      }
      child = child.nextSibling;
    }
  }

  /** Обрабатывает объявление интерфейса в frontmatter. */
  private processFmInterface(
    node: any,
    offsetLine: number,
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
    const docstring = this.extractDocstring(content, node.startPosition.row + 1 + offsetLine);

    const ifaceNode = this.createNode(
      filePath,
      NodeKind.Interface,
      name,
      node.startPosition.row + 1 + offsetLine,
      node.endPosition.row + 1 + offsetLine,
      node.startPosition.column,
      node.endPosition.column,
      {
        qualifiedName: name,
        docstring,
      }
    );
    nodes.push(ifaceNode);
    edges.push(this.createEdge(parentId, ifaceNode.id, EdgeKind.Contains));
  }

  /** Обрабатывает объявление алиаса типа в frontmatter. */
  private processFmTypeAlias(
    node: any,
    offsetLine: number,
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
    const docstring = this.extractDocstring(content, node.startPosition.row + 1 + offsetLine);

    const typeNode = this.createNode(
      filePath,
      NodeKind.TypeAlias,
      name,
      node.startPosition.row + 1 + offsetLine,
      node.endPosition.row + 1 + offsetLine,
      node.startPosition.column,
      node.endPosition.column,
      {
        qualifiedName: name,
        docstring,
      }
    );
    nodes.push(typeNode);
    edges.push(this.createEdge(parentId, typeNode.id, EdgeKind.Contains));
  }

  /** Парсит frontmatter через regex (резервный метод). */
  private extractFrontmatterWithRegex(
    content: string,
    offsetLine: number,
    filePath: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    _errors: IExtractionError[]
  ): void {
    // Извлечение импортов
    const importRegex = /import\s+.*?from\s+['"]([^'"]+)['"]/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      const sourceText = match[1];
      const line = content.slice(0, match.index).split('\n').length + offsetLine;
      const column = match[0].indexOf('import');

      const importNode = this.createNode(
        filePath,
        NodeKind.Import,
        sourceText,
        line,
        line,
        column,
        column + match[0].length
      );
      nodes.push(importNode);
      edges.push(this.createEdge(parentId, importNode.id, EdgeKind.Contains));
      edges.push(this.createEdge(parentId, importNode.id, EdgeKind.Imports, { line, column }));

      unresolvedRefs.push(this.createUnresolvedRef(
        importNode.id,
        sourceText,
        EdgeKind.Imports,
        line,
        column,
        filePath
      ));
    }

    // Извлечение функций
    const funcRegex = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g;
    while ((match = funcRegex.exec(content)) !== null) {
      const name = match[1];
      const isAsync = match[0].includes('async');
      const isExported = match[0].includes('export');
      const line = content.slice(0, match.index).split('\n').length + offsetLine;
      const column = match[0].indexOf('function');

      const funcNode = this.createNode(
        filePath,
        NodeKind.Function,
        name,
        line,
        line + 1,
        column,
        column + match[0].length,
        {
          qualifiedName: name,
          signature: `${name}(${match[2]})`,
          isAsync,
          isExported,
        }
      );
      nodes.push(funcNode);
      edges.push(this.createEdge(parentId, funcNode.id, EdgeKind.Contains));
    }

    // Извлечение констант
    const constRegex = /(?:export\s+)?const\s+(\w+)\s*[=;]/g;
    while ((match = constRegex.exec(content)) !== null) {
      const name = match[1];
      const isUpper = /^[A-Z][A-Z0-9_]*$/.test(name);
      const kind = isUpper ? NodeKind.Constant : NodeKind.Variable;
      const line = content.slice(0, match.index).split('\n').length + offsetLine;
      const column = match[0].indexOf('const');

      const varNode = this.createNode(
        filePath,
        kind,
        name,
        line,
        line,
        column,
        column + match[0].length,
        { qualifiedName: name }
      );
      nodes.push(varNode);
      edges.push(this.createEdge(parentId, varNode.id, EdgeKind.Contains));
    }

    // Извлечение классов
    const classRegex = /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/g;
    while ((match = classRegex.exec(content)) !== null) {
      const name = match[1];
      const isAbstract = match[0].includes('abstract');
      const isExported = match[0].includes('export');
      const line = content.slice(0, match.index).split('\n').length + offsetLine;
      const column = match[0].indexOf('class');

      const classNode = this.createNode(
        filePath,
        NodeKind.Class,
        name,
        line,
        line + 1,
        column,
        column + match[0].length,
        {
          qualifiedName: name,
          isAbstract,
          isExported,
        }
      );
      nodes.push(classNode);
      edges.push(this.createEdge(parentId, classNode.id, EdgeKind.Contains));
    }
  }

  /** Извлекает компоненты, обработчики событий и директивы из HTML-шаблона. */
  private extractTemplate(
    content: string,
    offsetLine: number,
    filePath: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[]
  ): void {
    // Извлечение компонентных ссылок — теги с заглавной буквы или с точкой
    const componentRegex = /<(?![\/!])(([A-Z][\w.]*)|([\w.-]+))[\s>]/g;
    let match;
    while ((match = componentRegex.exec(content)) !== null) {
      const fullName = match[1];

      // Пропуск встроенных HTML-тегов
      if (this.isHtmlTag(fullName)) continue;

      const line = content.slice(0, match.index).split('\n').length + offsetLine;
      const column = match.index + 1;

      const compNode = this.createNode(
        filePath,
        NodeKind.Component,
        fullName,
        line,
        line,
        column,
        column + fullName.length,
        { qualifiedName: fullName }
      );
      nodes.push(compNode);
      edges.push(this.createEdge(parentId, compNode.id, EdgeKind.Contains));

      unresolvedRefs.push(this.createUnresolvedRef(
        compNode.id,
        fullName,
        EdgeKind.References,
        line,
        column,
        filePath
      ));
    }

    // Извлечение обработчиков событий (on:click, on:mouseover и т.д.)
    const eventHandlerRegex = /\bon:([\w]+)\s*=\s*\{([^}]*)\}/g;
    while ((match = eventHandlerRegex.exec(content)) !== null) {
      const eventName = match[1];
      const handlerExpr = match[2].trim();
      const line = content.slice(0, match.index).split('\n').length + offsetLine;
      const column = match.index + match[0].indexOf('on:');

      const handlerNode = this.createNode(
        filePath,
        NodeKind.Function,
        `on:${eventName}`,
        line,
        line,
        column,
        column + match[0].length,
        {
          qualifiedName: `on:${eventName}`,
          signature: handlerExpr,
        }
      );
      nodes.push(handlerNode);
      edges.push(this.createEdge(parentId, handlerNode.id, EdgeKind.Contains));

      // Если обработчик — вызов функции, создаём неразрешённую ссылку
      const fnCallMatch = handlerExpr.match(/^(\w+)\s*\(/);
      if (fnCallMatch) {
        unresolvedRefs.push(this.createUnresolvedRef(
          handlerNode.id,
          fnCallMatch[1],
          EdgeKind.Calls,
          line,
          column,
          filePath
        ));
      }
    }

    // Извлечение клиентских директив (client:load, client:visible, client:only, client:media)
    const clientDirectiveRegex = /\bclient:(load|visible|only|media)\b/g;
    while ((match = clientDirectiveRegex.exec(content)) !== null) {
      const directiveName = `client:${match[1]}`;
      const line = content.slice(0, match.index).split('\n').length + offsetLine;
      const column = match.index;

      const directiveNode = this.createNode(
        filePath,
        NodeKind.Variable,
        directiveName,
        line,
        line,
        column,
        column + directiveName.length
      );
      nodes.push(directiveNode);
      edges.push(this.createEdge(parentId, directiveNode.id, EdgeKind.Contains));
    }

    // Извлечение client:only компонента
    const clientOnlyRegex = /client:only=\{(['"])([\w.]+)\1\}/g;
    while ((match = clientOnlyRegex.exec(content)) !== null) {
      const compName = match[2];
      const line = content.slice(0, match.index).split('\n').length + offsetLine;
      const column = match.index + match[0].indexOf(compName);

      unresolvedRefs.push(this.createUnresolvedRef(
        parentId,
        compName,
        EdgeKind.References,
        line,
        column,
        filePath
      ));
    }
  }

  /** Проверяет, является ли тег встроенным HTML-элементом. */
  private isHtmlTag(tag: string): boolean {
    const svgTags = new Set([
      'svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon',
      'ellipse', 'text', 'tspan', 'g', 'use', 'defs', 'clipPath',
      'linearGradient', 'radialGradient', 'stop', 'filter', 'feGaussianBlur',
    ]);

    if (svgTags.has(tag.toLowerCase())) return true;

    // Теги с точкой — это компонентные пути (не HTML)
    if (tag.includes('.')) return false;

    // SVG-теги в нижнем регистре
    if (svgTags.has(tag)) return true;

    // Остальные HTML-теги — только нижний регистр
    return tag === tag.toLowerCase();
  }

  /** Проверяет наличие модификатора (export, async и т.д.). */
  private hasModifier(node: any, modifier: string): boolean {
    let child = node.firstChild;
    while (child) {
      if (child.type === 'export_keyword' && modifier === 'export') return true;
      if (child.type === 'async_keyword' && modifier === 'async') return true;
      if (child.type === 'abstract' && modifier === 'abstract') return true;
      if (child.type === 'static' && modifier === 'static') return true;
      child = child.nextSibling;
    }
    return false;
  }

  /** Извлекает сигнатуру функции. */
  private extractFunctionSignature(node: any, content: string): string | undefined {
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
  private extractReturnType(node: any): string | undefined {
    const retType = node.childForFieldName('return_type');
    if (retType) {
      return retType.text;
    }
    return undefined;
  }
}
