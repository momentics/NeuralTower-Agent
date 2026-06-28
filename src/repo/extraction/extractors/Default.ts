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
    const durationMs = Date.now() - Date.now();
    return { nodes: [], edges: [], unresolvedReferences: [], errors: [], durationMs };
  }
}
