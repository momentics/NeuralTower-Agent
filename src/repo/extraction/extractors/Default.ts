/**
 * Извлекатель по умолчанию для неподдерживаемых языков.
 *
 * Создаёт единственный узел файла без извлечения AST.
 */

import {
  INode,
  IEdge,
  IUnresolvedReference,
  IExtractionResult,
  IExtractionError,
  NodeKind,
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
    // Измеряем время извлечения
    const start = Date.now();
    const nodes: INode[] = [];
    const edges: IEdge[] = [];
    const unresolvedRefs: IUnresolvedReference[] = [];
    const errors: IExtractionError[] = [];

    const lines = content.split('\n');
    // Создаём узел файла с полными границами
    const fileNode = this.createNode(filePath, NodeKind.File, filePath, 1, lines.length, 0, 0);
    nodes.push(fileNode);

    return { nodes, edges, unresolvedReferences: unresolvedRefs, errors, durationMs: Date.now() - start };
  }
}
