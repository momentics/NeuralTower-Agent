/**
 * Экстрактор для Svelte SFC (Single File Component).
 *
 * Разбивает файл на блоки: <script>, <template>, <style>.
 * Скрипт парсится через tree-sitter-typescript, шаблон — через регулярные выражения.
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

/** Блок файла Svelte. */
interface SvelteBlock {
  content: string;
  startLine: number;
}

export class SvelteExtractor extends ExtractorBase {
  public getLanguage(): Language {
    return 'svelte';
  }

  public getSupportedExtensions(): string[] {
    return ['.svelte'];
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

      // Обработка <script> блока
      if (blocks.script.content.length > 0) {
        this.extractScript(
          blocks.script.content,
          blocks.script.startLine,
          filePath,
          moduleNode.id,
          nodes,
          edges,
          unresolvedRefs,
          errors
        );
      }

      // Обработка шаблона — извлечение обработчиков событий и ссылок на компоненты
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
        `Ошибка парсинга Svelte: ${message}`,
        filePath,
        'error',
        'parse_error'
      ));
    }

    return { nodes, edges, unresolvedReferences: unresolvedRefs, errors, durationMs: Date.now() - start };
  }

  /** Разделяет содержимое файла Svelte на блоки script, template, style. */
  private splitBlocks(content: string): {
    script: SvelteBlock;
    template: SvelteBlock;
    style: SvelteBlock;
  } {
    const scriptBlock = this.extractBlock(content, 'script');
    const styleBlock = this.extractBlock(content, 'style');

    // Шаблон — всё, что не входит в <script> и <style>
    const templateContent = this.getTemplateContent(content, scriptBlock, styleBlock);

    return {
      script: scriptBlock,
      template: { content: templateContent, startLine: 1 },
      style: styleBlock,
    };
  }

  /** Извлекает содержимое блока по тегу (script или style). */
  private extractBlock(content: string, tag: string): SvelteBlock {
    const openRegex = new RegExp(`<${tag}(\\s[^>]*)?>`, 'i');
    const closeRegex = new RegExp(`</${tag}>`, 'i');

    const openMatch = content.match(openRegex);
    if (!openMatch) {
      return { content: '', startLine: 0 };
    }

    const openEnd = openMatch.index! + openMatch[0].length;
    const closeMatch = content.match(closeRegex);
    if (!closeMatch) {
      return { content: '', startLine: 0 };
    }

    const startLine = this.getLine(content, openMatch.index!) + 1;
    const blockContent = content.substring(openEnd, closeMatch.index);

    return {
      content: blockContent,
      startLine,
    };
  }

  /** Получает шаблонную часть файла (вне <script> и <style>). */
  private getTemplateContent(
    content: string,
    _scriptBlock: SvelteBlock,
    _styleBlock: SvelteBlock
  ): string {
    let result = content;

    // Удаляем <script> блок, сохраняя число строк
    const scriptOpenRegex = /<script(\s[^>]*)?>[\s\S]*?<\/script>/i;
    result = result.replace(scriptOpenRegex, (match) => {
      return '\n'.repeat(match.split('\n').length);
    });

    // Удаляем <style> блок, сохраняя число строк
    const styleOpenRegex = /<style(\s[^>]*)?>[\s\S]*?<\/style>/i;
    result = result.replace(styleOpenRegex, (match) => {
      return '\n'.repeat(match.split('\n').length);
    });

    return result;
  }

  /** Извлекает содержимое <script> блока и парсит его через tree-sitter. */
  private extractScript(
    scriptContent: string,
    scriptStartLine: number,
    filePath: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    errors: IExtractionError[]
  ): void {
    try {
      const parser = require('tree-sitter');
      const tsGrammar = require('tree-sitter-typescript');

      const p = new parser.Parser();
      p.setLanguage(tsGrammar.TSTypeScript);

      const tree = p.parse(scriptContent);
      if (!tree) {
        errors.push(this.createError(
          'Не удалось разобрать <script> блок',
          filePath,
          'error',
          'parse_error'
        ));
        return;
      }

      const root = tree.rootNode;
      let child = root.firstChild;
      while (child) {
        this.processScriptNode(
          child,
          scriptStartLine,
          filePath,
          scriptContent,
          parentId,
          nodes,
          edges,
          unresolvedRefs,
          errors
        );
        child = child.nextSibling;
      }
    } catch (err) {
      // Фолбэк: регулярные выражения для извлечения функций и методов
      this.extractScriptRegex(
        scriptContent,
        scriptStartLine,
        filePath,
        parentId,
        nodes,
        edges,
        unresolvedRefs
      );
    }
  }

  /** Обрабатывает узел AST скриптовой части. */
  private processScriptNode(
    node: any,
    lineOffset: number,
    filePath: string,
    content: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    errors: IExtractionError[]
  ): void {
    if (!node || node.isMissing || node.isError) return;

    const line = node.startPosition.row + 1 + lineOffset;
    const endLine = node.endPosition.row + 1 + lineOffset;
    const column = node.startPosition.column;
    const endColumn = node.endPosition.column;

    if (node.type === 'function_declaration') {
      const nameNode = node.childForFieldName('name');
      if (!nameNode) return;

      const name = nameNode.text;
      const funcNode = this.createNode(
        filePath,
        NodeKind.Function,
        name,
        line,
        endLine,
        column,
        endColumn,
        {
          qualifiedName: name,
          isAsync: this.hasModifier(node, 'async'),
        }
      );
      nodes.push(funcNode);
      edges.push(this.createEdge(parentId, funcNode.id, EdgeKind.Contains));

      // Параметры
      const params = node.childForFieldName('parameters');
      if (params) {
        let p = params.firstChild;
        while (p) {
          if (p.type === 'identifier') {
            const paramNode = this.createNode(
              filePath,
              NodeKind.Parameter,
              p.text,
              p.startPosition.row + 1 + lineOffset,
              p.endPosition.row + 1 + lineOffset,
              p.startPosition.column,
              p.endPosition.column
            );
            nodes.push(paramNode);
            edges.push(this.createEdge(funcNode.id, paramNode.id, EdgeKind.Contains));
          }
          p = p.nextSibling;
        }
      }
    } else if (node.type === 'method_definition') {
      const nameNode = node.childForFieldName('name');
      if (!nameNode) return;

      const name = nameNode.text;
      const methodNode = this.createNode(
        filePath,
        NodeKind.Method,
        name,
        line,
        endLine,
        column,
        endColumn,
        {
          qualifiedName: name,
          isAsync: this.hasModifier(node, 'async'),
          isStatic: this.hasModifier(node, 'static'),
        }
      );
      nodes.push(methodNode);
      edges.push(this.createEdge(parentId, methodNode.id, EdgeKind.Contains));
    } else if (node.type === 'class_declaration') {
      const nameNode = node.childForFieldName('name');
      if (!nameNode) return;

      const name = nameNode.text;
      const classNode = this.createNode(
        filePath,
        NodeKind.Class,
        name,
        line,
        endLine,
        column,
        endColumn,
        { qualifiedName: name }
      );
      nodes.push(classNode);
      edges.push(this.createEdge(parentId, classNode.id, EdgeKind.Contains));

      // Наследование
      const superClass = node.childForFieldName('superclass');
      if (superClass) {
        const superName = superClass.text;
        const sl = superClass.startPosition.row + 1 + lineOffset;
        const sc = superClass.startPosition.column;
        edges.push(this.createEdge(classNode.id, this.nodeId(filePath, NodeKind.Class, superName, 0), EdgeKind.Extends, {
          metadata: { referenceName: superName },
          line: sl,
          column: sc,
        }));
        unresolvedRefs.push(this.createUnresolvedRef(
          classNode.id,
          superName,
          EdgeKind.Extends,
          sl,
          sc,
          filePath
        ));
      }

      // Тело класса
      const body = node.childForFieldName('body');
      if (body) {
        let c = body.firstChild;
        while (c) {
          this.processScriptNode(c, lineOffset, filePath, content, classNode.id, nodes, edges, unresolvedRefs, errors);
          c = c.nextSibling;
        }
      }
    } else if (node.type === 'lexical_declaration' || node.type === 'variable_declaration') {
      let child = node.firstChild;
      while (child) {
        if (child.type === 'variable_declarator') {
          const nameNode = child.childForFieldName('name');
          const valueNode = child.childForFieldName('value');
          if (nameNode) {
            const name = nameNode.text;
            const isConst = node.type === 'lexical_declaration';
            const isUpper = /^[A-Z][A-Z0-9_]*$/.test(name);
            const varKind = isConst && isUpper ? NodeKind.Constant : NodeKind.Variable;
            const varNode = this.createNode(
              filePath,
              varKind,
              name,
              child.startPosition.row + 1 + lineOffset,
              child.endPosition.row + 1 + lineOffset,
              child.startPosition.column,
              child.endPosition.column,
              { qualifiedName: name }
            );
            nodes.push(varNode);
            edges.push(this.createEdge(parentId, varNode.id, EdgeKind.Contains));
          }

          // Если значение — класс, рекурсивно обрабатываем
          if (valueNode && valueNode.type === 'class_expression') {
            this.processScriptNode(child, lineOffset, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
          }
        }
        child = child.nextSibling;
      }
    } else if (node.type === 'import_statement') {
      const sourceNode = node.childForFieldName('source');
      if (!sourceNode) return;

      const sourceText = sourceNode.text.replace(/['"]/g, '');
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
    } else if (node.type === 'export_statement' || node.type === 'export_named_declaration') {
      let child = node.firstChild;
      while (child) {
        if (child.type !== 'string') {
          this.processScriptNode(child, lineOffset, filePath, content, parentId, nodes, edges, unresolvedRefs, errors);
        }
        child = child.nextSibling;
      }
    } else if (node.type === 'arrow_function' || node.type === 'function_expression') {
      const nameNode = node.childForFieldName('name');
      const name = nameNode ? nameNode.text : 'СтрелочнаяФункция';
      const funcNode = this.createNode(
        filePath,
        NodeKind.Function,
        name,
        line,
        endLine,
        column,
        endColumn,
        {
          qualifiedName: name,
          isAsync: this.hasModifier(node, 'async'),
        }
      );
      nodes.push(funcNode);
      edges.push(this.createEdge(parentId, funcNode.id, EdgeKind.Contains));
    }
  }

  /** Fallback: извлечение из скрипта через регулярные выражения. */
  private extractScriptRegex(
    scriptContent: string,
    scriptStartLine: number,
    filePath: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[]
  ): void {
    // Функции: function name(
    const funcRegex = /function\s+(\w+)\s*\(/g;
    let m;
    while ((m = funcRegex.exec(scriptContent)) !== null) {
      const name = m[1];
      const line = scriptStartLine + this.getLine(scriptContent, m.index);
      const funcNode = this.createNode(
        filePath,
        NodeKind.Function,
        name,
        line,
        line,
        m.index,
        m.index + m[0].length,
        { qualifiedName: name }
      );
      nodes.push(funcNode);
      edges.push(this.createEdge(parentId, funcNode.id, EdgeKind.Contains));
    }

    // Методы в классах: name(
    const methodRegex = /\b(\w+)\s*\(.*\)\s*\{/g;
    while ((m = methodRegex.exec(scriptContent)) !== null) {
      const name = m[1];
      if (name === 'function' || name === 'if' || name === 'for' || name === 'while' || name === 'catch') continue;
      const line = scriptStartLine + this.getLine(scriptContent, m.index);
      const methodNode = this.createNode(
        filePath,
        NodeKind.Method,
        name,
        line,
        line,
        m.index,
        m.index + m[0].length,
        { qualifiedName: name }
      );
      nodes.push(methodNode);
      edges.push(this.createEdge(parentId, methodNode.id, EdgeKind.Contains));
    }

    // Импорт: import ... from '...'
    const importRegex = /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g;
    while ((m = importRegex.exec(scriptContent)) !== null) {
      const sourceText = m[1];
      const line = scriptStartLine + this.getLine(scriptContent, m.index);
      const importNode = this.createNode(
        filePath,
        NodeKind.Import,
        sourceText,
        line,
        line,
        m.index,
        m.index + m[0].length
      );
      nodes.push(importNode);
      edges.push(this.createEdge(parentId, importNode.id, EdgeKind.Contains));
      edges.push(this.createEdge(parentId, importNode.id, EdgeKind.Imports, { line, column: m.index }));

      unresolvedRefs.push(this.createUnresolvedRef(
        importNode.id,
        sourceText,
        EdgeKind.Imports,
        line,
        m.index,
        filePath
      ));
    }
  }

  /** Извлекает обработчики событий и ссылки на компоненты из шаблона. */
  private extractTemplate(
    templateContent: string,
    templateStartLine: number,
    filePath: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[]
  ): void {
    // Обработчики событий: on:click={handler}, on:change={handler}, on:keydown={handler}
    const eventHandlerRegex = /on:(\w+)\s*=\s*\{([^}]+)\}/g;
    let m;
    while ((m = eventHandlerRegex.exec(templateContent)) !== null) {
      const eventName = m[1];
      const handlerName = m[2].trim();

      // Извлекаем имя функции (без !, без параметров)
      const fnName = handlerName.replace(/^!/, '').split('(')[0].trim();

      if (fnName) {
        const line = templateStartLine + this.getLine(templateContent, m.index) + 1;
        const column = m.index;

        // Создаём узел обработчика события
        const handlerNode = this.createNode(
          filePath,
          NodeKind.Method,
          `${eventName}:${fnName}`,
          line,
          line,
          column,
          m.index + m[0].length,
          {
            qualifiedName: fnName,
            eventType: eventName,
          }
        );
        nodes.push(handlerNode);
        edges.push(this.createEdge(parentId, handlerNode.id, EdgeKind.Contains));

        // Неразрешённая ссылка на обработчик
        unresolvedRefs.push(this.createUnresolvedRef(
          handlerNode.id,
          fnName,
          EdgeKind.Calls,
          line,
          column,
          filePath
        ));
      }
    }

    // Ссылки на компоненты: <ComponentName ...
    const componentRegex = /<([A-Z]\w*)\b/g;
    while ((m = componentRegex.exec(templateContent)) !== null) {
      const compName = m[1];
      const line = templateStartLine + this.getLine(templateContent, m.index) + 1;
      const column = m.index;

      edges.push(this.createEdge(parentId, this.nodeId(filePath, NodeKind.Component, compName, 0), EdgeKind.References, {
        metadata: { referenceName: compName },
        line,
        column,
      }));
      unresolvedRefs.push(this.createUnresolvedRef(
        parentId,
        compName,
        EdgeKind.References,
        line,
        column,
        filePath
      ));
    }

    // Действия (actions): use:action={param}
    const actionRegex = /use:(\w+)\s*(?:=\s*\{([^}]+)\})?/g;
    while ((m = actionRegex.exec(templateContent)) !== null) {
      const actionName = m[1];
      const line = templateStartLine + this.getLine(templateContent, m.index) + 1;
      const column = m.index;

      unresolvedRefs.push(this.createUnresolvedRef(
        parentId,
        actionName,
        EdgeKind.References,
        line,
        column,
        filePath
      ));
    }

    // Ссылки на директивы: bind:value={var}
    const bindRegex = /bind:(\w+)\s*=\s*\{([^}]+)\}/g;
    while ((m = bindRegex.exec(templateContent)) !== null) {
      const bindName = m[1];
      const varName = m[2].trim();

      if (varName) {
        const line = templateStartLine + this.getLine(templateContent, m.index) + 1;
        const column = m.index;

        unresolvedRefs.push(this.createUnresolvedRef(
          parentId,
          varName,
          EdgeKind.References,
          line,
          column,
          filePath
        ));
      }
    }
  }

  /** Проверяет, имеет ли узел модификатор (async, static и т.д.). */
  private hasModifier(node: any, modifier: string): boolean {
    let child = node.firstChild;
    while (child) {
      if (child.type === 'modifier' && child.text === modifier) return true;
      child = child.nextSibling;
    }
    return false;
  }

  /** Возвращает номер строки для позиции в строке (0-индексный). */
  private getLine(content: string, index: number): number {
    let line = 0;
    for (let i = 0; i < index && i < content.length; i++) {
      if (content[i] === '\n') line++;
    }
    return line;
  }
}
