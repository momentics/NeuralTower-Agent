/**
 * SQLite-реализация IFullTextSearch через NtGraphDb.
 *
 * Маппинг ICodeChunk → INode при вставке, ISearchResult → IFtsResult при поиске.
 * compactIfNeeded — no-op (FTS5 не требует компактификации).
 */

import type { ICodeChunk, ChunkNodeKind } from "./ChunkTypes"
import type { IFtsResult, IFullTextSearch } from "./FullTextSearch"
import { NtGraphDb } from "./ntgraph"
import type { INode, NodeKind, Language } from "./ntgraph/Types"

/** Маппинг ChunkNodeKind → NodeKind. */
const CHUNK_KIND_TO_NODE_KIND: Record<ChunkNodeKind, NodeKind> = {
  class: "class",
  function: "function",
  method: "method",
  interface: "interface",
  type: "type_alias",
  enum: "enum",
  const: "constant",
  block: "variable",
  top_level: "variable",
}

/** Обратный маппинг NodeKind → ChunkNodeKind. */
const NODE_KIND_TO_CHUNK_KIND: Record<string, ChunkNodeKind> = {
  class: "class",
  function: "function",
  method: "method",
  interface: "interface",
  type_alias: "type",
  enum: "enum",
  constant: "const",
  variable: "block",
}

/**
 * Конвертирует ICodeChunk в INode для вставки в БД.
 */
function chunkToNode(chunk: ICodeChunk): INode {
  const qualifiedName = chunk.parentName
    ? `${chunk.parentName}.${chunk.symbolName ?? chunk.id}`
    : chunk.symbolName ?? chunk.id

  return {
    id: chunk.id,
    kind: CHUNK_KIND_TO_NODE_KIND[chunk.nodeKind] ?? "variable",
    name: chunk.symbolName ?? chunk.id,
    qualifiedName,
    filePath: chunk.filePath,
    language: chunk.language as Language,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    startColumn: 0,
    endColumn: 0,
    docstring: chunk.docComment,
    signature: chunk.signature ?? chunk.content,
    isExported: false,
    updatedAt: Date.now(),
  }
}

/**
 * Конвертирует INode обратно в ICodeChunk для результатов поиска.
 */
function nodeToChunk(node: INode): ICodeChunk {
  const parts = node.qualifiedName.split(".")
  const symbolName = parts.length > 1 ? parts[parts.length - 1] : node.name
  const parentName = parts.length > 1 ? parts.slice(0, -1).join(".") : undefined

  return {
    id: node.id,
    filePath: node.filePath,
    content: node.signature ?? "",
    startLine: node.startLine,
    endLine: node.endLine,
    nodeKind: NODE_KIND_TO_CHUNK_KIND[node.kind] ?? "block",
    symbolName,
    parentName,
    language: node.language,
    signature: node.signature,
    docComment: node.docstring,
    charLength: (node.signature ?? "").length,
  }
}

/**
 * Полнотекстовый поиск на базе SQLite FTS5 через NtGraphDb.
 */
export class SqliteFullTextSearch implements IFullTextSearch {
  constructor(private readonly graphDb: NtGraphDb) {}

  /**
   * Добавить фрагменты для индексации.
   * Каждый ICodeChunk конвертируется в INode и вставляется в БД.
   */
  add(chunks: ICodeChunk[]): void {
    const nodes: INode[] = chunks.map(chunkToNode)
    this.graphDb.insertNodes(nodes)
  }

  /**
   * Поиск по запросу через FTS5.
   * Результаты конвертируются из ISearchResult в IFtsResult.
   */
  search(query: string, topK: number): IFtsResult[] {
    const results = this.graphDb.search(query, { limit: topK })
    return results.map((r) => ({
      chunk: nodeToChunk(r.node),
      score: r.score,
      matchCount: r.highlights?.length ?? 0,
    }))
  }

  /**
   * Удалить фрагменты для файла из БД.
   */
  deleteByFile(filePath: string): void {
    this.graphDb.deleteNodesByFile(filePath)
  }

  /**
   * Очистить индекс — удалить все узлы из БД.
   */
  clear(): void {
    this.graphDb.clear()
  }

  /**
   * Число фрагментов в индексе.
   */
  count(): number {
    const { nodes } = this.graphDb.getNodeAndEdgeCount()
    return nodes
  }

  /**
   * No-op для FTS5 — компактификация не требуется.
   */
  compactIfNeeded(_threshold?: number): boolean {
    return false
  }
}
