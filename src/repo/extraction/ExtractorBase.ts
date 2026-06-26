/**
 * Базовый класс экстрактора.
 *
 * Интерфейс IExtractor: extract(), getLanguage(), getSupportedExtensions().
 * Абстрактный — конкретные экстракторы наследуются от него.
 */

import {
  INode,
  IEdge,
  IUnresolvedReference,
  IExtractionResult,
  IExtractionError,
  NodeKind,
  Language,
} from '../ntgraph/Types';

/** Интерфейс экстрактора. */
export interface IExtractor {
  extract(filePath: string, content: string, frameworkNames?: string[]): IExtractionResult;
  getLanguage(): string;
  getSupportedExtensions(): string[];
}

/** Базовый класс экстрактора. */
export abstract class ExtractorBase implements IExtractor {
  /** Извлекает узлы, рёбра и неразрешённые ссылки из файла. */
  public abstract extract(
    filePath: string,
    content: string,
    frameworkNames?: string[]
  ): IExtractionResult;

  /** Возвращает имя языка. */
  public abstract getLanguage(): string;

  /** Возвращает список поддерживаемых расширений файлов. */
  public abstract getSupportedExtensions(): string[];

  /** Генерирует ID узла: sha256(filePath:kind:name:line). */
  protected nodeId(filePath: string, kind: NodeKind, name: string, line: number): string {
    const crypto = require('crypto');
    const raw = `${filePath}:${kind}:${name}:${line}`;
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  /** Создаёт узел графа. */
  protected createNode(
    filePath: string,
    kind: NodeKind,
    name: string,
    startLine: number,
    endLine: number,
    startColumn: number,
    endColumn: number,
    opts: {
      qualifiedName?: string;
      docstring?: string;
      signature?: string;
      visibility?: 'public' | 'private' | 'protected' | 'internal';
      isExported?: boolean;
      isAsync?: boolean;
      isStatic?: boolean;
      isAbstract?: boolean;
      decorators?: string[];
      typeParameters?: string[];
      returnType?: string;
    } & Record<string, unknown> = {}
  ): INode {
    const id = this.nodeId(filePath, kind, name, startLine);
    const knownKeys = new Set([
      'qualifiedName', 'docstring', 'signature', 'visibility',
      'isExported', 'isAsync', 'isStatic', 'isAbstract',
      'decorators', 'typeParameters', 'returnType'
    ]);
    const metadata: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(opts)) {
      if (!knownKeys.has(key)) {
        metadata[key] = value;
      }
    }
    return {
      id,
      kind,
      name,
      qualifiedName: opts.qualifiedName ?? name,
      filePath,
      language: this.getLanguage() as Language,
      startLine,
      endLine,
      startColumn,
      endColumn,
      docstring: opts.docstring,
      signature: opts.signature,
      visibility: opts.visibility,
      isExported: opts.isExported,
      isAsync: opts.isAsync,
      isStatic: opts.isStatic,
      isAbstract: opts.isAbstract,
      decorators: opts.decorators,
      typeParameters: opts.typeParameters,
      returnType: opts.returnType,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      updatedAt: Date.now(),
    };
  }

  /** Создаёт ребро графа. */
  protected createEdge(
    source: string,
    target: string,
    kind: string,
    opts: {
      metadata?: Record<string, unknown>;
      line?: number;
      column?: number;
    } = {}
  ): IEdge {
    return {
      source,
      target,
      kind: kind as IEdge['kind'],
      metadata: opts.metadata,
      line: opts.line,
      column: opts.column,
      provenance: 'tree-sitter',
    };
  }

  /** Создаёт неразрешённую ссылку. */
  protected createUnresolvedRef(
    fromNodeId: string,
    referenceName: string,
    referenceKind: string,
    line: number,
    column: number,
    filePath?: string,
    candidates?: string[]
  ): IUnresolvedReference {
    return {
      fromNodeId,
      referenceName,
      referenceKind: referenceKind as IUnresolvedReference['referenceKind'],
      line,
      column,
      filePath,
      language: this.getLanguage(),
      candidates,
    };
  }

  /** Создаёт ошибку извлечения. */
  protected createError(
    message: string,
    filePath: string,
    severity: 'error' | 'warning',
    code: string,
    line?: number,
    column?: number
  ): IExtractionError {
    return {
      message,
      filePath,
      severity,
      code: code as IExtractionError['code'],
      line,
      column,
    };
  }

  /** Извлекает docstring из комментариев перед узлом. */
  protected extractDocstring(content: string, startLine: number): string | undefined {
    const lines = content.split('\n');
    const lineIdx = startLine - 2;

    if (lineIdx < 0) return undefined;

    const line = lines[lineIdx]?.trim();
    if (!line) return undefined;

    // Паттерны JSDoc / docstring
    if (line.startsWith('/**') || line.startsWith('*') || line.startsWith('#')) {
      let docLines: string[] = [];
      let i = lineIdx;

      while (i >= 0) {
        const l = lines[i]?.trim();
        if (!l) break;

        if (l.startsWith('/**')) {
          docLines.unshift(l.slice(3).trim());
        } else if (l.startsWith('*/')) {
          break;
        } else if (l.startsWith('*')) {
          docLines.unshift(l.slice(1).trim());
        } else if (l.startsWith('#')) {
          docLines.unshift(l.slice(1).trim());
        } else {
          break;
        }
        i--;
      }

      const doc = docLines.join(' ').trim();
      return doc || undefined;
    }

    return undefined;
  }

  /** Нормализует строку строковых литералов в массив. */
  protected splitStringArray(str: string): string[] {
    if (!str) return [];
    return str.split(',').map(s => s.trim()).filter(Boolean);
  }
}
