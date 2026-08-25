/**
 * Экстрактор для Vue SFC (Single File Component).
 *
 * Разбирает файлы .vue, разделяя их на блоки <script>, <template>, <style>.
 * Скрипт парсится через tree-sitter (TypeScript/JavaScript) или через regex-фоллбэк.
 * Шаблон парсится через regex для извлечения обработчиков событий и ссылок на компоненты.
 */

import { basename, extname } from 'path';
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

/** Состояние извлечения для одного файла. */
interface ExtractionState {
  nodes: INode[];
  edges: IEdge[];
  unresolvedRefs: IUnresolvedReference[];
  errors: IExtractionError[];
}

export class VueExtractor extends ExtractorBase {
  public getLanguage(): Language {
    return 'vue';
  }

  public getSupportedExtensions(): string[] {
    return ['.vue'];
  }

  public extract(
    content: string,
    filePath: string,
    _frameworkNames?: string[]
  ): IExtractionResult {
    const start = Date.now();
    const state: ExtractionState = {
      nodes: [],
      edges: [],
      unresolvedRefs: [],
      errors: [],
    };

    try {
      const fileNode = this.createNode(
        filePath,
        NodeKind.File,
        basename(filePath),
        1,
        content.split('\n').length,
        0,
        0,
        { qualifiedName: filePath }
      );
      state.nodes.push(fileNode);

      const moduleName = filePath.replace(/.*[/\\]/, '').replace(/\.[^.]+$/, '');
      const moduleNode = this.createNode(
        filePath,
        NodeKind.Module,
        moduleName,
        1,
        content.split('\n').length,
        0,
        0
      );
      state.nodes.push(moduleNode);
      state.edges.push(this.createEdge(fileNode.id, moduleNode.id, EdgeKind.Contains));

      const blocks = this.splitBlocks(content);

      for (const block of blocks) {
        if (block.type === 'script') {
          this.extractScriptBlock(
            block.content,
            block.startLine,
            filePath,
            moduleNode.id,
            state
          );
        } else if (block.type === 'template') {
          this.extractTemplateBlock(
            block.content,
            block.startLine,
            filePath,
            moduleNode.id,
            state
          );
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      state.errors.push(this.createError(
        `Ошибка извлечения Vue: ${message}`,
        filePath,
        'error',
        'parse_error'
      ));
    }

    return {
      nodes: state.nodes,
      edges: state.edges,
      unresolvedReferences: state.unresolvedRefs,
      errors: state.errors,
      durationMs: Date.now() - start,
    };
  }

  /** Разделяет содержимое SFC на блоки <script>, <template>, <style>. */
  protected splitBlocks(content: string): Array<{
    type: 'script' | 'template' | 'style';
    content: string;
    startLine: number;
    endLine: number;
    lang?: string;
    isSetup?: boolean;
  }> {
    const blocks: Array<{
      type: 'script' | 'template' | 'style';
      content: string;
      startLine: number;
      endLine: number;
      lang?: string;
      isSetup?: boolean;
    }> = [];

    const blockRegex = /<(script|template|style)([^>]*)>([\s\S]*?)<\/\1>/g;
    let match: RegExpExecArray | null;

    while ((match = blockRegex.exec(content)) !== null) {
      const tag = match[1] as 'script' | 'template' | 'style';
      const attrs = match[2];
      const blockContent = match[3];

      const blockStart = content.substring(0, match.index).split('\n').length;

      const blockEndLine =
        blockStart + blockContent.split('\n').length;

      const langMatch = attrs.match(/\blang\s*=\s*["']?(\w+)["']?/);
      const lang = langMatch ? langMatch[1] : undefined;

      const isSetup = tag === 'script' && /\bsetup\b/.test(attrs);

      blocks.push({
        type: tag,
        content: blockContent,
        startLine: blockStart,
        endLine: blockEndLine,
        lang,
        isSetup,
      });
    }

    return blocks;
  }

  /** Извлекает узлы из блока <script>. */
  protected extractScriptBlock(
    content: string,
    startLine: number,
    filePath: string,
    parentId: string,
    state: ExtractionState
  ): void {
    if (!content.trim()) return;

    const componentInfo = this.extractComponentInfo(content, filePath);

    const componentNode = this.createNode(
      filePath,
      NodeKind.Component,
      componentInfo.name,
      startLine,
      startLine + content.split('\n').length - 1,
      0,
      0,
      {
        qualifiedName: componentInfo.name,
      }
    );
    state.nodes.push(componentNode);
    state.edges.push(this.createEdge(parentId, componentNode.id, EdgeKind.Contains));

    try {
      this.parseScriptWithTreeSitter(
        content,
        startLine,
        filePath,
        componentNode.id,
        state
      );
    } catch {
      this.parseScriptWithRegex(
        content,
        startLine,
        filePath,
        componentNode.id,
        state
      );
    }
  }

  /** Парсит блок скрипта через tree-sitter. */
  protected parseScriptWithTreeSitter(
    content: string,
    startLine: number,
    filePath: string,
    componentId: string,
    state: ExtractionState
  ): void {
    let parser: any;
    let tsGrammar: any;
    try {
      parser = require('tree-sitter');
      tsGrammar = require('tree-sitter-typescript');
    } catch {
      // tree-sitter недоступен — парсинг скрипта пропускается
      state.errors.push(this.createError(
        'tree-sitter недоступен',
        filePath,
        'error',
        'parse_error'
      ));
      return;
    }

    const p = new parser.Parser();
    p.setLanguage(tsGrammar.TSTypeScript);

    const tree = p.parse(content);
    if (!tree) {
      state.errors.push(this.createError(
        'Не удалось разобрать блок script',
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
        content,
        startLine,
        filePath,
        componentId,
        state
      );
      child = child.nextSibling;
    }
  }

  /** Обрабатывает узел скрипта из tree-sitter AST. */
  protected processScriptNode(
    node: any,
    content: string,
    startLine: number,
    filePath: string,
    parentId: string,
    state: ExtractionState
  ): void {
    if (!node || node.isMissing || node.isError) return;

    const lineOffset = startLine - 1;

    switch (node.type) {
      case 'function_declaration': {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          const name = nameNode.text;
          const line = node.startPosition.row + 1 + lineOffset;
          const endLine = node.endPosition.row + 1 + lineOffset;

          const funcNode = this.createNode(
            filePath,
            NodeKind.Function,
            name,
            line,
            endLine,
            node.startPosition.column,
            node.endPosition.column,
            {
              qualifiedName: name,
              isAsync: this.hasModifier(node, 'async'),
            }
          );
          state.nodes.push(funcNode);
          state.edges.push(this.createEdge(parentId, funcNode.id, EdgeKind.Contains));
        }
        break;
      }

      case 'method_definition': {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          const name = nameNode.text;
          const line = node.startPosition.row + 1 + lineOffset;
          const endLine = node.endPosition.row + 1 + lineOffset;
          const isAsync = this.hasModifier(node, 'async');
          const isStatic = this.hasModifier(node, 'static');

          const methodNode = this.createNode(
            filePath,
            NodeKind.Method,
            name,
            line,
            endLine,
            node.startPosition.column,
            node.endPosition.column,
            {
              qualifiedName: name,
              isAsync,
              isStatic,
            }
          );
          state.nodes.push(methodNode);
          state.edges.push(this.createEdge(parentId, methodNode.id, EdgeKind.Contains));
        }
        break;
      }

      case 'lexical_declaration':
      case 'variable_declaration': {
        let decl = node.firstChild;
        while (decl) {
          if (decl.type === 'variable_declarator') {
            const nameNode = decl.childForFieldName('name');
            const valueNode = decl.childForFieldName('value');
            if (nameNode) {
              const name = nameNode.text;
              const line = decl.startPosition.row + 1 + lineOffset;
              const endLine = decl.endPosition.row + 1 + lineOffset;

              if (valueNode && (valueNode.type === 'arrow_function' || valueNode.type === 'function_expression')) {
                const funcNode = this.createNode(
                  filePath,
                  NodeKind.Function,
                  name,
                  line,
                  endLine,
                  decl.startPosition.column,
                  decl.endPosition.column,
                  {
                    qualifiedName: name,
                    isAsync: valueNode.type === 'arrow_function'
                      ? this.hasModifier(valueNode, 'async')
                      : false,
                  }
                );
                state.nodes.push(funcNode);
                state.edges.push(this.createEdge(parentId, funcNode.id, EdgeKind.Contains));
              } else {
                const varKind = node.type === 'lexical_declaration' && /^[A-Z][A-Z0-9_]*$/.test(name)
                  ? NodeKind.Constant
                  : NodeKind.Variable;

                const varNode = this.createNode(
                  filePath,
                  varKind,
                  name,
                  line,
                  endLine,
                  decl.startPosition.column,
                  decl.endPosition.column,
                  {
                    qualifiedName: name,
                  }
                );
                state.nodes.push(varNode);
                state.edges.push(this.createEdge(parentId, varNode.id, EdgeKind.Contains));
              }
            }
          }
          decl = decl.nextSibling;
        }
        break;
      }

      case 'class_declaration': {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          const name = nameNode.text;
          const line = node.startPosition.row + 1 + lineOffset;
          const endLine = node.endPosition.row + 1 + lineOffset;

          const classNode = this.createNode(
            filePath,
            NodeKind.Class,
            name,
            line,
            endLine,
            node.startPosition.column,
            node.endPosition.column,
            {
              qualifiedName: name,
            }
          );
          state.nodes.push(classNode);
          state.edges.push(this.createEdge(parentId, classNode.id, EdgeKind.Contains));

          const body = node.childForFieldName('body');
          if (body) {
            let mchild = body.firstChild;
            while (mchild) {
              if (mchild.type === 'method_definition') {
                this.processScriptNode(mchild, content, startLine, filePath, classNode.id, state);
              }
              mchild = mchild.nextSibling;
            }
          }
        }
        break;
      }

      case 'import_statement': {
        const sourceNode = node.childForFieldName('source');
        if (sourceNode) {
          const sourceText = sourceNode.text.replace(/['"]/g, '');
          const line = node.startPosition.row + 1 + lineOffset;

          const importNode = this.createNode(
            filePath,
            NodeKind.Import,
            sourceText,
            line,
            line,
            node.startPosition.column,
            node.endPosition.column
          );
          state.nodes.push(importNode);
          state.edges.push(this.createEdge(parentId, importNode.id, EdgeKind.Contains));
          state.edges.push(this.createEdge(parentId, importNode.id, EdgeKind.Imports, {
            line,
            column: node.startPosition.column,
          }));

          state.unresolvedRefs.push(this.createUnresolvedRef(
            importNode.id,
            sourceText,
            EdgeKind.Imports,
            line,
            node.startPosition.column,
            filePath
          ));
        }
        break;
      }

      case 'export_statement':
      case 'export_named_declaration': {
        let child = node.firstChild;
        while (child) {
          if (child.type !== 'string') {
            this.processScriptNode(child, content, startLine, filePath, parentId, state);
          }
          child = child.nextSibling;
        }
        break;
      }

      default: {
        let child = node.firstChild;
        while (child) {
          this.processScriptNode(child, content, startLine, filePath, parentId, state);
          child = child.nextSibling;
        }
      }
    }
  }

  /** Фоллбэк: парсит блок скрипта через regex. */
  protected parseScriptWithRegex(
    content: string,
    startLine: number,
    filePath: string,
    parentId: string,
    state: ExtractionState
  ): void {
    const lines = content.split('\n');

    // Извлекает функции: function name(...) или const name = (...) => / async
    const funcRegex = /^\s*(?:export\s+)?(?:async\s+)?(?:function\s+)(\w+)\s*\(/gm;
    let m;
    while ((m = funcRegex.exec(content)) !== null) {
      const name = m[1];
      const line = content.substring(0, m.index).split('\n').length + startLine;
      const endLine = this.findBlockEnd(lines, line - startLine, '{', '}') + startLine;

      const funcNode = this.createNode(
        filePath,
        NodeKind.Function,
        name,
        line,
        endLine,
        m[0].search(/\S/),
        m[0].length,
        {
          qualifiedName: name,
          isAsync: /\basync\b/.test(m[0]),
        }
      );
      state.nodes.push(funcNode);
      state.edges.push(this.createEdge(parentId, funcNode.id, EdgeKind.Contains));
    }

    // Стрелочные функции: const name = (...) =>
    const arrowRegex = /^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(?[\s\S]*?\)?\s*=>/gm;
    while ((m = arrowRegex.exec(content)) !== null) {
      const name = m[1];
      const line = content.substring(0, m.index).split('\n').length + startLine;

      const funcNode = this.createNode(
        filePath,
        NodeKind.Function,
        name,
        line,
        line + 5,
        m[0].search(/\S/),
        m[0].length,
        {
          qualifiedName: name,
          isAsync: /\basync\b/.test(m[0]),
        }
      );
      state.nodes.push(funcNode);
      state.edges.push(this.createEdge(parentId, funcNode.id, EdgeKind.Contains));
    }

    // Методы в объекте methods: name(...) {
    const methodRegex = /^\s*(\w+)\s*\([^)]*\)\s*\{/gm;
    while ((m = methodRegex.exec(content)) !== null) {
      const name = m[1];
      if (name === 'if' || name === 'for' || name === 'while' || name === 'switch' || name === 'catch') continue;
      if (name === 'function') continue;

      const line = content.substring(0, m.index).split('\n').length + startLine;

      const methodNode = this.createNode(
        filePath,
        NodeKind.Method,
        name,
        line,
        line + 3,
        m[0].search(/\S/),
        m[0].length,
        {
          qualifiedName: name,
        }
      );
      state.nodes.push(methodNode);
      state.edges.push(this.createEdge(parentId, methodNode.id, EdgeKind.Contains));
    }

    // Импорт: import ... from '...'
    const importRegex = /^\s*import\s+.*?\s+from\s+['"]([^'"]+)['"]/gm;
    while ((m = importRegex.exec(content)) !== null) {
      const sourceText = m[1];
      const line = content.substring(0, m.index).split('\n').length + startLine;

      const importNode = this.createNode(
        filePath,
        NodeKind.Import,
        sourceText,
        line,
        line,
        m[0].search(/\S/),
        m[0].length
      );
      state.nodes.push(importNode);
      state.edges.push(this.createEdge(parentId, importNode.id, EdgeKind.Contains));
      state.edges.push(this.createEdge(parentId, importNode.id, EdgeKind.Imports, {
        line,
        column: m[0].search(/\S/),
      }));

      state.unresolvedRefs.push(this.createUnresolvedRef(
        importNode.id,
        sourceText,
        EdgeKind.Imports,
        line,
        m[0].search(/\S/),
        filePath
      ));
    }
  }

  /** Извлекает информацию о компоненте из скрипта. */
  protected extractComponentInfo(content: string, filePath: string): { name: string } {
    // Ищем name: 'ComponentName'
    const nameMatch = content.match(/\bname\s*:\s*['"]([^'"]+)['"]/);
    if (nameMatch) {
      return { name: nameMatch[1] };
    }

    // Иначе используем имя файла
    return { name: basename(filePath, extname(filePath)) };
  }

  /** Извлекает узлы из блока <template>. */
  protected extractTemplateBlock(
    content: string,
    startLine: number,
    filePath: string,
    parentId: string,
    state: ExtractionState
  ): void {
    if (!content.trim()) return;

    // Обработчики событий: @click="handler", v-on:click="handler"
    const eventHandlerRegex = /@(\w+)\s*=\s*["']([^"']+)["']/g;
    let m;
    while ((m = eventHandlerRegex.exec(content)) !== null) {
      const eventName = m[1];
      const handlerName = m[2].trim().split('.')[0].split('(')[0].trim();
      const line = content.substring(0, m.index).split('\n').length + startLine;
      const column = m.index - content.lastIndexOf('\n', m.index) - 1;

      state.unresolvedRefs.push(this.createUnresolvedRef(
        parentId,
        handlerName,
        EdgeKind.Calls,
        line,
        column,
        filePath
      ));
    }

    // v-on:event="handler"
    const vOnRegex = /v-on:(\w+)\s*=\s*["']([^"']+)["']/g;
    while ((m = vOnRegex.exec(content)) !== null) {
      const handlerName = m[2].trim().split('.')[0].split('(')[0].trim();
      const line = content.substring(0, m.index).split('\n').length + startLine;
      const column = m.index - content.lastIndexOf('\n', m.index) - 1;

      state.unresolvedRefs.push(this.createUnresolvedRef(
        parentId,
        handlerName,
        EdgeKind.Calls,
        line,
        column,
        filePath
      ));
    }

    // v-model="modelName"
    const vModelRegex = /v-model\s*=\s*["']([^"']+)["']/g;
    while ((m = vModelRegex.exec(content)) !== null) {
      const modelName = m[1];
      const line = content.substring(0, m.index).split('\n').length + startLine;
      const column = m.index - content.lastIndexOf('\n', m.index) - 1;

      state.unresolvedRefs.push(this.createUnresolvedRef(
        parentId,
        modelName,
        EdgeKind.References,
        line,
        column,
        filePath
      ));
    }

    // Ссылки на компоненты: <ComponentName>
    const componentRefRegex = /<([A-Z][a-zA-Z0-9]*)/g;
    while ((m = componentRefRegex.exec(content)) !== null) {
      const compName = m[1];
      // Пропускаем встроенные HTML-теги, написанные с заглавной буквы (редко, но бывает)
      const builtins = new Set(['HTML', 'SVG', 'HEAD', 'BODY', 'META', 'LINK', 'SCRIPT', 'STYLE']);
      if (builtins.has(compName.toUpperCase())) continue;

      const line = content.substring(0, m.index).split('\n').length + startLine;
      const column = m.index - content.lastIndexOf('\n', m.index) - 1;

      state.unresolvedRefs.push(this.createUnresolvedRef(
        parentId,
        compName,
        EdgeKind.References,
        line,
        column,
        filePath
      ));
    }
  }

  /** Проверяет наличие модификатора в узле. */
  protected hasModifier(node: any, modifier: string): boolean {
    let child = node.firstChild;
    while (child) {
      if (child.type === modifier) return true;
      child = child.nextSibling;
    }
    return false;
  }

  /** Находит конец блока по открывающей и закрывающей скобке. */
  protected findBlockEnd(lines: string[], startIdx: number, open: string, close: string): number {
    let depth = 0;
    for (let i = startIdx; i < lines.length; i++) {
      for (const ch of lines[i]) {
        if (ch === open) depth++;
        if (ch === close) {
          depth--;
          if (depth === 0) return i + 1;
        }
      }
    }
    return lines.length;
  }
}
