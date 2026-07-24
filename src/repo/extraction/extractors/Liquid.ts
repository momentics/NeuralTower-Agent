/**
 * Экстрактор для Liquid-шаблонов.
 *
 * Использует regex-парсинг для извлечения узлов, рёбер и неразрешённых ссылок.
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

export class LiquidExtractor extends ExtractorBase {
  public getLanguage(): Language {
    return 'liquid';
  }

  public getSupportedExtensions(): string[] {
    return ['.liquid'];
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
    const start = Date.now();

    try {
      const lines = content.split('\n');
      const endLine = lines.length;
      const endColumn = lines[endLine - 1]?.length ?? 0;

      const fileNode = this.createNode(
        filePath,
        NodeKind.File,
        filePath,
        1,
        endLine,
        0,
        endColumn
      );
      nodes.push(fileNode);

      const moduleNode = this.createNode(
        filePath,
        NodeKind.Module,
        filePath,
        1,
        endLine,
        0,
        endColumn
      );
      nodes.push(moduleNode);
      edges.push(this.createEdge(fileNode.id, moduleNode.id, EdgeKind.Contains));

      this.processLiquidTags(content, filePath, moduleNode.id, nodes, edges, unresolvedRefs, errors);
      this.processLiquidOutputs(content, filePath, moduleNode.id, nodes, edges, unresolvedRefs, errors);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(this.createError(
        `Ошибка парсинга: ${message}`,
        filePath,
        'error',
        'parse_error'
      ));
    }

    return { nodes, edges, unresolvedReferences: unresolvedRefs, errors, durationMs: Date.now() - start };
  }

  /** Обрабатывает Liquid-теги. */
  protected processLiquidTags(
    content: string,
    filePath: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    errors: IExtractionError[]
  ): void {
    const tagRegex = /\{%\s*(\w+)(.*?)\s*%\}/g;
    let match: RegExpExecArray | null;

    while ((match = tagRegex.exec(content)) !== null) {
      const tagName = match[1];
      const tagBody = match[2].trim();
      const line = content.substring(0, match.index).split('\n').length;
      const currentLine = content.split('\n')[line - 1] ?? '';
      const column = match.index - content.split('\n').slice(0, line - 1).join('\n').length - 1;
      const endColumn = column + match[0].length;

      switch (tagName) {
        case 'include':
          this.processInclude(tagBody, filePath, line, column, endColumn, parentId, nodes, edges, unresolvedRefs);
          break;

        case 'render':
          this.processRender(tagBody, filePath, line, column, endColumn, parentId, nodes, edges, unresolvedRefs);
          break;

        case 'assign':
          this.processAssign(tagBody, filePath, line, column, endColumn, parentId, nodes, edges);
          break;

        case 'for':
          this.processForLoop(tagBody, filePath, line, column, endColumn, parentId, nodes, edges);
          break;

        case 'if':
          this.processIf(tagBody, filePath, line, column, endColumn, parentId, nodes, edges);
          break;

        case 'elsif':
          this.processElsif(tagBody, filePath, line, column, endColumn, parentId, nodes, edges);
          break;

        case 'else':
          this.processElse(filePath, line, column, endColumn, parentId, nodes, edges);
          break;

        case 'capture':
          this.processCapture(tagBody, filePath, line, column, endColumn, parentId, nodes, edges);
          break;

        case 'case':
          this.processCase(tagBody, filePath, line, column, endColumn, parentId, nodes, edges);
          break;

        case 'when':
          this.processWhen(tagBody, filePath, line, column, endColumn, parentId, nodes, edges);
          break;

        case 'unless':
          this.processUnless(tagBody, filePath, line, column, endColumn, parentId, nodes, edges);
          break;

        case 'cycle':
          this.processCycle(tagBody, filePath, line, column, endColumn, parentId, nodes, edges);
          break;

        case 'tablerow':
          this.processTableRow(tagBody, filePath, line, column, endColumn, parentId, nodes, edges);
          break;

        default:
          break;
      }
    }
  }

  /** Обрабатывает `{% include 'snippet' %}`. */
  protected processInclude(
    tagBody: string,
    filePath: string,
    line: number,
    column: number,
    endColumn: number,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[]
  ): void {
    const includeName = this.extractStringLiteral(tagBody);
    if (!includeName) return;

    const importNode = this.createNode(
      filePath,
      NodeKind.Import,
      includeName,
      line,
      line,
      column,
      endColumn
    );
    nodes.push(importNode);
    edges.push(this.createEdge(parentId, importNode.id, EdgeKind.Contains));
    edges.push(this.createEdge(parentId, importNode.id, EdgeKind.Imports));

    unresolvedRefs.push(this.createUnresolvedRef(
      importNode.id,
      includeName,
      EdgeKind.Imports,
      line,
      column,
      filePath
    ));
  }

  /** Обрабатывает `{% render 'component' %}`. */
  protected processRender(
    tagBody: string,
    filePath: string,
    line: number,
    column: number,
    endColumn: number,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[]
  ): void {
    const renderName = this.extractStringLiteral(tagBody);
    if (!renderName) return;

    const importNode = this.createNode(
      filePath,
      NodeKind.Import,
      renderName,
      line,
      line,
      column,
      endColumn
    );
    nodes.push(importNode);
    edges.push(this.createEdge(parentId, importNode.id, EdgeKind.Contains));
    edges.push(this.createEdge(parentId, importNode.id, EdgeKind.Imports));

    unresolvedRefs.push(this.createUnresolvedRef(
      importNode.id,
      renderName,
      EdgeKind.Imports,
      line,
      column,
      filePath
    ));
  }

  /** Обрабатывает `{% assign var = value %}`. */
  protected processAssign(
    tagBody: string,
    filePath: string,
    line: number,
    column: number,
    endColumn: number,
    parentId: string,
    nodes: INode[],
    edges: IEdge[]
  ): void {
    const eqIdx = tagBody.indexOf('=');
    if (eqIdx === -1) return;

    const varName = tagBody.substring(0, eqIdx).trim();
    if (!varName) return;

    const varNode = this.createNode(
      filePath,
      NodeKind.Variable,
      varName,
      line,
      line,
      column,
      endColumn
    );
    nodes.push(varNode);
    edges.push(this.createEdge(parentId, varNode.id, EdgeKind.Contains));
  }

  /** Обрабатывает `{% for item in collection %}`. */
  protected processForLoop(
    tagBody: string,
    filePath: string,
    line: number,
    column: number,
    endColumn: number,
    parentId: string,
    nodes: INode[],
    edges: IEdge[]
  ): void {
    const forNode = this.createNode(
      filePath,
      NodeKind.Function,
      'for',
      line,
      line,
      column,
      endColumn,
      {
        signature: tagBody,
      }
    );
    nodes.push(forNode);
    edges.push(this.createEdge(parentId, forNode.id, EdgeKind.Contains));

    const inIdx = tagBody.indexOf('in');
    if (inIdx !== -1) {
      const itemName = tagBody.substring(0, inIdx).trim();
      if (itemName) {
        const paramNode = this.createNode(
          filePath,
          NodeKind.Parameter,
          itemName,
          line,
          line,
          column,
          endColumn
        );
        nodes.push(paramNode);
        edges.push(this.createEdge(forNode.id, paramNode.id, EdgeKind.Contains));
      }
    }
  }

  /** Обрабатывает `{% if condition %}`. */
  protected processIf(
    tagBody: string,
    filePath: string,
    line: number,
    column: number,
    endColumn: number,
    parentId: string,
    nodes: INode[],
    edges: IEdge[]
  ): void {
    const ifNode = this.createNode(
      filePath,
      NodeKind.Function,
      'if',
      line,
      line,
      column,
      endColumn,
      {
        signature: tagBody,
      }
    );
    nodes.push(ifNode);
    edges.push(this.createEdge(parentId, ifNode.id, EdgeKind.Contains));
  }

  /** Обрабатывает `{% elsif condition %}`. */
  protected processElsif(
    tagBody: string,
    filePath: string,
    line: number,
    column: number,
    endColumn: number,
    parentId: string,
    nodes: INode[],
    edges: IEdge[]
  ): void {
    const elsifNode = this.createNode(
      filePath,
      NodeKind.Function,
      'elsif',
      line,
      line,
      column,
      endColumn,
      {
        signature: tagBody,
      }
    );
    nodes.push(elsifNode);
    edges.push(this.createEdge(parentId, elsifNode.id, EdgeKind.Contains));
  }

  /** Обрабатывает `{% else %}`. */
  protected processElse(
    filePath: string,
    line: number,
    column: number,
    endColumn: number,
    parentId: string,
    nodes: INode[],
    edges: IEdge[]
  ): void {
    const elseNode = this.createNode(
      filePath,
      NodeKind.Function,
      'else',
      line,
      line,
      column,
      endColumn
    );
    nodes.push(elseNode);
    edges.push(this.createEdge(parentId, elseNode.id, EdgeKind.Contains));
  }

  /** Обрабатывает `{% capture var %}`. */
  protected processCapture(
    tagBody: string,
    filePath: string,
    line: number,
    column: number,
    endColumn: number,
    parentId: string,
    nodes: INode[],
    edges: IEdge[]
  ): void {
    const varName = tagBody.trim();
    if (!varName) return;

    const varNode = this.createNode(
      filePath,
      NodeKind.Variable,
      varName,
      line,
      line,
      column,
      endColumn
    );
    nodes.push(varNode);
    edges.push(this.createEdge(parentId, varNode.id, EdgeKind.Contains));
  }

  /** Обрабатывает `{% case value %}`. */
  protected processCase(
    tagBody: string,
    filePath: string,
    line: number,
    column: number,
    endColumn: number,
    parentId: string,
    nodes: INode[],
    edges: IEdge[]
  ): void {
    const caseNode = this.createNode(
      filePath,
      NodeKind.Function,
      'case',
      line,
      line,
      column,
      endColumn,
      {
        signature: tagBody,
      }
    );
    nodes.push(caseNode);
    edges.push(this.createEdge(parentId, caseNode.id, EdgeKind.Contains));
  }

  /** Обрабатывает `{% when value %}`. */
  protected processWhen(
    tagBody: string,
    filePath: string,
    line: number,
    column: number,
    endColumn: number,
    parentId: string,
    nodes: INode[],
    edges: IEdge[]
  ): void {
    const whenNode = this.createNode(
      filePath,
      NodeKind.Function,
      'when',
      line,
      line,
      column,
      endColumn,
      {
        signature: tagBody,
      }
    );
    nodes.push(whenNode);
    edges.push(this.createEdge(parentId, whenNode.id, EdgeKind.Contains));
  }

  /** Обрабатывает `{% unless condition %}`. */
  protected processUnless(
    tagBody: string,
    filePath: string,
    line: number,
    column: number,
    endColumn: number,
    parentId: string,
    nodes: INode[],
    edges: IEdge[]
  ): void {
    const unlessNode = this.createNode(
      filePath,
      NodeKind.Function,
      'unless',
      line,
      line,
      column,
      endColumn,
      {
        signature: tagBody,
      }
    );
    nodes.push(unlessNode);
    edges.push(this.createEdge(parentId, unlessNode.id, EdgeKind.Contains));
  }

  /** Обрабатывает `{% cycle ... %}`. */
  protected processCycle(
    tagBody: string,
    filePath: string,
    line: number,
    column: number,
    endColumn: number,
    parentId: string,
    nodes: INode[],
    edges: IEdge[]
  ): void {
    const cycleNode = this.createNode(
      filePath,
      NodeKind.Function,
      'cycle',
      line,
      line,
      column,
      endColumn,
      {
        signature: tagBody,
      }
    );
    nodes.push(cycleNode);
    edges.push(this.createEdge(parentId, cycleNode.id, EdgeKind.Contains));
  }

  /** Обрабатывает `{% tablerow ... %}`. */
  protected processTableRow(
    tagBody: string,
    filePath: string,
    line: number,
    column: number,
    endColumn: number,
    parentId: string,
    nodes: INode[],
    edges: IEdge[]
  ): void {
    const trNode = this.createNode(
      filePath,
      NodeKind.Function,
      'tablerow',
      line,
      line,
      column,
      endColumn,
      {
        signature: tagBody,
      }
    );
    nodes.push(trNode);
    edges.push(this.createEdge(parentId, trNode.id, EdgeKind.Contains));
  }

  /** Обрабатывает Liquid-выводы с фильтрами `{{ value | filter }}`. */
  protected processLiquidOutputs(
    content: string,
    filePath: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    _errors: IExtractionError[]
  ): void {
    const outputRegex = /\{\{(.*?)\}\}/g;
    let match: RegExpExecArray | null;

    while ((match = outputRegex.exec(content)) !== null) {
      const outputBody = match[1].trim();
      if (!outputBody) continue;

      const line = content.substring(0, match.index).split('\n').length;
      const currentLineContent = content.split('\n')[line - 1] ?? '';
      const column = match.index - content.split('\n').slice(0, line - 1).join('\n').length - 1;
      const endColumn = column + match[0].length;

      const parts = outputBody.split('|').map(p => p.trim());
      if (parts.length < 2) continue;

      const valueExpr = parts[0];
      const filters = parts.slice(1);

      const filterNode = this.createNode(
        filePath,
        NodeKind.Function,
        `filter:${filters.join('+')}`,
        line,
        line,
        column,
        endColumn,
        {
          signature: outputBody,
        }
      );
      nodes.push(filterNode);
      edges.push(this.createEdge(parentId, filterNode.id, EdgeKind.Contains));

      for (const filter of filters) {
        const filterName = filter.split('(')[0].trim();
        if (filterName) {
          edges.push(this.createEdge(parentId, this.nodeId(filePath, NodeKind.Function, filterName, 0), EdgeKind.Calls, {
            metadata: { referenceName: filterName },
            line,
            column,
          }));
          unresolvedRefs.push(this.createUnresolvedRef(
            filterNode.id,
            filterName,
            EdgeKind.Calls,
            line,
            column,
            filePath
          ));
        }
      }
    }
  }

  /** Извлекает строковый литерал из тела тега. */
  protected extractStringLiteral(text: string): string | undefined {
    const quoteMatch = text.match(/^['"]([^'"]+)['"]/);
    if (quoteMatch) return quoteMatch[1];

    const varMatch = text.match(/^(\w+)/);
    if (varMatch) return varMatch[1];

    return undefined;
  }
}
