/**
 * Дефолтный экстрактор для неподдерживаемых языков.
 *
 * Использует regex-эвристики для извлечения базовой структуры из любого файла.
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

export class DefaultExtractor extends ExtractorBase {
  public getLanguage(): Language {
    return 'unknown';
  }

  public getSupportedExtensions(): string[] {
    return [];
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
      const lines = content.split('\n');
      const totalLines = lines.length;

      const moduleNode = this.createNode(
        filePath,
        NodeKind.Module,
        filePath,
        1,
        totalLines,
        0,
        0
      );
      nodes.push(moduleNode);

      this.extractFunctions(filePath, content, lines, moduleNode.id, nodes, edges, unresolvedRefs);

      this.extractClasses(filePath, content, lines, moduleNode.id, nodes, edges, unresolvedRefs);

      this.extractImports(filePath, content, lines, moduleNode.id, nodes, edges, unresolvedRefs);

      this.extractCommentsAsDocstrings(filePath, content, lines, nodes);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(this.createError(
        `Ошибка извлечения: ${message}`,
        filePath,
        'error',
        'EXTRACTION_ERROR'
      ));
    }

    return { nodes, edges, unresolvedReferences: unresolvedRefs, errors, durationMs: 0 };
  }

  /** Извлекает функции по паттернам типа `func_name(`, `def func_name(` и т.д. */
  protected extractFunctions(
    filePath: string,
    content: string,
    lines: string[],
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[]
  ): void {
    const functionPatterns = [
      /^(?:\s*|\t*)(?:public\s+|private\s+|protected\s+|static\s+|async\s+|virtual\s+|override\s+)*def\s+([a-zA-Z_]\w*)\s*\(/,
      /^(?:\s*|\t*)(?:public\s+|private\s+|protected\s+|static\s+|async\s+|virtual\s+|override\s+)*func\s+([a-zA-Z_]\w*)\s*\(/,
      /^(?:\s*|\t*)(?:public\s+|private\s+|protected\s+|static\s+|async\s+|virtual\s+|override\s+)*function\s+([a-zA-Z_]\w*)\s*\(/,
      /^(?:\s*|\t*)(?:public\s+|private\s+|protected\s+|static\s+|async\s+|virtual\s+|override\s+)*(?:void|int|float|double|char|bool|boolean|string|auto|long|short|unsigned|signed|const\s+\w+|\w+)\s+([a-zA-Z_]\w*)\s*\(/,
      /^(?:\s*|\t*)(?:public\s+|private\s+|protected\s+|static\s+|async\s+|virtual\s+|override\s+)*([a-zA-Z_]\w*)\s*\(.*\)\s*[:{]/,
    ];

    const seen = new Set<string>();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
        continue;
      }

      for (const pattern of functionPatterns) {
        const match = trimmed.match(pattern);
        if (match) {
          const name = match[1];
          const key = `${name}:${i + 1}`;

          if (seen.has(key)) continue;
          seen.add(key);

          const docstring = this.extractDocstringForLine(content, i + 1);

          const funcNode = this.createNode(
            filePath,
            NodeKind.Function,
            name,
            i + 1,
            i + 1,
            0,
            trimmed.length,
            {
              qualifiedName: name,
              docstring,
            }
          );
          nodes.push(funcNode);
          edges.push(this.createEdge(parentId, funcNode.id, EdgeKind.Contains));
          break;
        }
      }
    }
  }

  /** Извлекает классы по паттернам типа `class ClassName`, `struct ClassName` и т.д. */
  protected extractClasses(
    filePath: string,
    content: string,
    lines: string[],
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[]
  ): void {
    const classPatterns = [
      /^(?:\s*|\t*)(?:public\s+|private\s+|protected\s+|abstract\s+|final\s+|sealed\s+)*class\s+([a-zA-Z_]\w*)/,
      /^(?:\s*|\t*)(?:public\s+|private\s+|protected\s+|abstract\s+|final\s+|sealed\s+)*struct\s+([a-zA-Z_]\w*)/,
      /^(?:\s*|\t*)(?:public\s+|private\s+|protected\s+|abstract\s+|final\s+|sealed\s+)*interface\s+([a-zA-Z_]\w*)/,
      /^(?:\s*|\t*)(?:public\s+|private\s+|protected\s+|abstract\s+|final\s+|sealed\s+)*enum\s+([a-zA-Z_]\w*)/,
      /^(?:\s*|\t*)(?:public\s+|private\s+|protected\s+|abstract\s+|final\s+|sealed\s+)*type\s+([a-zA-Z_]\w*)/,
      /^(?:\s*|\t*)(?:public\s+|private\s+|protected\s+|abstract\s+|final\s+|sealed\s+)*record\s+([a-zA-Z_]\w*)/,
      /^(?:\s*|\t*)(?:public\s+|private\s+|protected\s+|abstract\s+|final\s+|sealed\s+)*trait\s+([a-zA-Z_]\w*)/,
      /^(?:\s*|\t*)(?:public\s+|private\s+|protected\s+|abstract\s+|final\s+|sealed\s+)*namespace\s+([a-zA-Z_]\w*)/,
      /^(?:\s*|\t*)(?:public\s+|private\s+|protected\s+|abstract\s+|final\s+|sealed\s+)*module\s+([a-zA-Z_]\w*)/,
    ];

    const seen = new Set<string>();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
        continue;
      }

      for (const pattern of classPatterns) {
        const match = trimmed.match(pattern);
        if (match) {
          const name = match[1];
          const key = `${name}:${i + 1}`;

          if (seen.has(key)) continue;
          seen.add(key);

          const docstring = this.extractDocstringForLine(content, i + 1);

          const classNode = this.createNode(
            filePath,
            NodeKind.Class,
            name,
            i + 1,
            i + 1,
            0,
            trimmed.length,
            {
              qualifiedName: name,
              docstring,
            }
          );
          nodes.push(classNode);
          edges.push(this.createEdge(parentId, classNode.id, EdgeKind.Contains));
          break;
        }
      }
    }
  }

  /** Извлекает импорты по паттернам типа `import`, `include`, `require`, `from ... import` и т.д. */
  protected extractImports(
    filePath: string,
    content: string,
    lines: string[],
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[]
  ): void {
    const importPatterns = [
      /^(?:\s*|\t*)(?:import|from)\s+['"]([^'"]+)['"]/,
      /^(?:\s*|\t*)include\s+['"]([^'"]+)['"]/,
      /^(?:\s*|\t*)#include\s+['"]([^'"]+)['"]/,
      /^(?:\s*|\t*)#include\s+<([^>]+)>/,
      /^(?:\s*|\t*)require\s*\(\s*['"]([^'"]+)['"]\s*\)/,
      /^(?:\s*|\t*)require\s+['"]([^'"]+)['"]/,
      /^(?:\s*|\t*)use\s+([a-zA-Z_]\w*(?:\\[a-zA-Z_]\w*)*)/,
      /^(?:\s*|\t*)\bfrom\s+([a-zA-Z_]\w*)\s+import\b/,
      /^(?:\s*|\t*)\bimport\s+([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*)/,
    ];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      for (const pattern of importPatterns) {
        const match = trimmed.match(pattern);
        if (match) {
          const source = match[1];
          const lineNum = i + 1;

          const importNode = this.createNode(
            filePath,
            NodeKind.Import,
            source,
            lineNum,
            lineNum,
            0,
            trimmed.length
          );
          nodes.push(importNode);
          edges.push(this.createEdge(parentId, importNode.id, EdgeKind.Contains));

          unresolvedRefs.push(this.createUnresolvedRef(
            importNode.id,
            source,
            EdgeKind.Imports,
            lineNum,
            0,
            filePath
          ));
          break;
        }
      }
    }
  }

  /** Извлекает комментарии как docstrings и добавляет их к ближайшим узлам. */
  protected extractCommentsAsDocstrings(
    filePath: string,
    content: string,
    lines: string[],
    nodes: INode[]
  ): void {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (trimmed.startsWith('#')) {
        const nextLineIdx = i + 1;
        const nextLine = lines[nextLineIdx]?.trim() || '';

        if (this.looksLikeDeclaration(nextLine)) {
          const docstring = this.collectCommentBlock(lines, i);
          this.attachDocstringToNode(nodes, filePath, nextLineIdx + 1, docstring);
        }
      } else if (trimmed.startsWith('//')) {
        const nextLineIdx = i + 1;
        const nextLine = lines[nextLineIdx]?.trim() || '';

        if (this.looksLikeDeclaration(nextLine)) {
          const docstring = this.collectCommentBlock(lines, i);
          this.attachDocstringToNode(nodes, filePath, nextLineIdx + 1, docstring);
        }
      } else if (trimmed.startsWith('/*') || trimmed.startsWith('*')) {
        const docstring = this.collectBlockComment(lines, i);
        const nextLineIdx = i + docstring.lines;
        const nextLine = lines[nextLineIdx]?.trim() || '';

        if (this.looksLikeDeclaration(nextLine)) {
          this.attachDocstringToNode(nodes, filePath, nextLineIdx + 1, docstring.text);
        }
      }
    }
  }

  /** Проверяет, выглядит ли строка как объявление. */
  protected looksLikeDeclaration(line: string): boolean {
    const declPatterns = [
      /^(?:def|func|function|class|struct|interface|enum|type|record|trait|namespace|module|const|let|var|pub\s+fn|fn)\b/,
      /^(?:public\s+|private\s+|protected\s+|static\s+|async\s+|virtual\s+|override\s+)*(?:void|int|float|double|char|bool|boolean|string|auto|long|short|unsigned|signed|const\s+\w+|\w+)\s+\w+\s*\(/,
    ];

    for (const pattern of declPatterns) {
      if (pattern.test(line)) {
        return true;
      }
    }
    return false;
  }

  /** Собирает блок комментариев из строк, начиная с указанной строки. */
  protected collectCommentBlock(lines: string[], startIndex: number): string {
    const commentLines: string[] = [];
    let i = startIndex;

    while (i < lines.length) {
      const trimmed = lines[i].trim();

      if (trimmed.startsWith('#')) {
        commentLines.push(trimmed.slice(1).trim());
      } else if (trimmed.startsWith('//')) {
        commentLines.push(trimmed.slice(2).trim());
      } else {
        break;
      }
      i++;
    }

    return commentLines.join('\n');
  }

  /** Собирает блок-комментарий или документацию. */
  protected collectBlockComment(lines: string[], startIndex: number): { text: string; lines: number } {
    const commentLines: string[] = [];
    let i = startIndex;
    let closed = false;

    while (i < lines.length) {
      const trimmed = lines[i].trim();

      if (i === startIndex && trimmed.startsWith('/*')) {
        const rest = trimmed.slice(2).trim();
        if (rest.endsWith('*/')) {
          commentLines.push(rest.slice(0, -2).trim());
          closed = true;
        } else {
          commentLines.push(rest);
        }
      } else if (trimmed.startsWith('*')) {
        const rest = trimmed.slice(1).trim();
        if (rest.endsWith('*/')) {
          commentLines.push(rest.slice(0, -2).trim());
          closed = true;
        } else {
          commentLines.push(rest);
        }
      } else if (trimmed.endsWith('*/')) {
        commentLines.push(trimmed.slice(0, -2).trim());
        closed = true;
      } else {
        commentLines.push(trimmed);
      }

      if (closed) break;
      i++;
    }

    return { text: commentLines.join('\n'), lines: i - startIndex + 1 };
  }

  /** Извлекает docstring перед указанной строкой. */
  protected extractDocstringForLine(content: string, targetLine: number): string | undefined {
    const lines = content.split('\n');
    let i = targetLine - 2;

    while (i >= 0) {
      const trimmed = lines[i].trim();

      if (trimmed === '') {
        i--;
        continue;
      }

      if (trimmed.startsWith('#') || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
        return this.collectCommentBlock(lines, i);
      }

      break;
    }

    return undefined;
  }

  /** Прикрепляет docstring к узлу по файлу и номеру строки. */
  protected attachDocstringToNode(
    nodes: INode[],
    filePath: string,
    targetLine: number,
    docstring: string
  ): void {
    for (const node of nodes) {
      if (node.filePath === filePath && node.startLine === targetLine && node.kind !== NodeKind.Module) {
        if (node.metadata && typeof node.metadata === 'object') {
          (node.metadata as Record<string, unknown>).docstring = docstring;
        }
        break;
      }
    }
  }
}
