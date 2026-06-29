/**
 * Извлекатель по умолчанию для неподдерживаемых языков.
 *
 * Создаёт единственный узел файла без извлечения AST.
 */

import { basename } from 'path';
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
    const start = Date.now();
    const fileBasename = basename(filePath);
    const lines = content.split('\n');
    const endLine = lines.length;
    const endColumn = lines[endLine - 1]?.length ?? 0;

    const fileNode = this.createNode(
      filePath,
      NodeKind.File,
      fileBasename,
      1,
      endLine,
      0,
      endColumn,
      { qualifiedName: filePath }
    );

    const durationMs = Date.now() - start;
    return { nodes: [fileNode], edges: [], unresolvedReferences: [], errors: [], durationMs };
  }
}
