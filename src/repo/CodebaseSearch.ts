/**
 * Объединённый поиск по репозиторию.
 *
 * Комбинирует семантический поиск (векторное хранилище),
 * полнотекстовый поиск (FTS5 через NtGraphDb) и графовый поиск
 * (ContextBuilder) для получения лучших результатов.
 *
 * Режимы поиска:
 * - semantic: только векторное хранилище
 * - keyword: только полнотекстовый поиск
 * - hybrid: семантический + полнотекстовый
 * - graph: графовый поиск через ContextBuilder
 * - hybrid_graph: семантический + полнотекстовый + графовый
 */

import type { IEmbeddingProvider } from "../backend/IEmbeddingProvider"
import type { IVectorStore } from "./IVectorStore"
import type { ICodeChunk, ISearchConfig, SearchMode } from "./ChunkTypes"
import { errorMessage } from "../core/Errors"
import type { IFullTextSearch } from "./FullTextSearch"
import { SqliteFullTextSearch } from "./SqliteFullTextSearch"
import { NtGraphDb } from "./ntgraph"
import { createDomainLogger } from "../core/Logger"
import type { INode, ISubgraph } from "./ntgraph/Types"
import { ContextBuilder } from "./context/Builder"

const log = createDomainLogger("CodebaseSearch")

const SEARCH_MULTIPLIER = 2

/**
 * Результат объединённого поиска.
 */
export interface IUnifiedSearchResult {
  /** Фрагмент кода. */
  chunk: ICodeChunk

  /** Оценка релевантности (0-1). */
  score: number

  /** Источник результата. */
  source: "semantic" | "keyword" | "hybrid" | "graph" | "hybrid_graph"
}

/**
 * Интерфейс поиска по кодовой базе.
 */
export interface ICodebaseSearch {
  search(query: string, config?: Partial<ISearchConfig>, signal?: AbortSignal): Promise<IUnifiedSearchResult[]>
  indexChunks(chunks: ICodeChunk[], signal?: AbortSignal): Promise<void>
  deleteByFile(filePath: string): Promise<void>
  clear(): Promise<void>
  compactIfNeeded(): void
  stats(): { vectorChunks: number; ftsChunks: number; embeddingAvailable: boolean }
}

/**
 * Объединённый поиск по репозиторию.
 */
export class CodebaseSearch implements ICodebaseSearch {
  private readonly fts: IFullTextSearch
  private _contextBuilder: ContextBuilder | null = null

  constructor(
    private readonly vectorStore: IVectorStore,
    private readonly embeddingProvider: IEmbeddingProvider | null,
    ftsOrGraphDb: IFullTextSearch | NtGraphDb | null,
    private readonly graphDb?: NtGraphDb
  ) {
    // Если передан NtGraphDb — создаём SQLite-реализацию FTS
    if (ftsOrGraphDb instanceof NtGraphDb) {
      this.fts = new SqliteFullTextSearch(ftsOrGraphDb)
      this.graphDb = ftsOrGraphDb
    } else {
      // Иначе используем переданный IFullTextSearch
      this.fts = ftsOrGraphDb ?? new (require("./FullTextSearch").FullTextSearch)()
    }
  }

  /**
   * Фабричный метод для создания поиска с NtGraphDb.
   */
  static withGraphDb(
    vectorStore: IVectorStore,
    embeddingProvider: IEmbeddingProvider | null,
    graphDb: NtGraphDb
  ): CodebaseSearch {
    return new CodebaseSearch(vectorStore, embeddingProvider, graphDb, graphDb)
  }

  /**
   * Поиск по запросу.
   * @param query строка запроса
   * @param config конфигурация поиска
   */
  async search(
    query: string,
    config?: Partial<ISearchConfig>,
    signal?: AbortSignal,
  ): Promise<IUnifiedSearchResult[]> {
    if (signal?.aborted) return []
    const topK = config?.topK ?? 10
    const minScore = config?.minScore ?? 0.1
    const mode = config?.searchMode ?? "hybrid"

    if (mode === "semantic") {
      return this.semanticSearch(query, topK, minScore, signal)
    }

    if (mode === "keyword") {
      return this.keywordSearch(query, topK, minScore)
    }

    if (mode === "graph") {
      return this.graphSearch(query, topK, minScore)
    }

    if (mode === "hybrid_graph") {
      return this.hybridGraphSearch(query, topK, minScore, signal)
    }

    return this.hybridSearch(query, topK, minScore, signal)
  }

  /**
   * Семантический поиск через векторное хранилище.
   */
  private async semanticSearch(
    query: string,
    topK: number,
    minScore: number,
    signal?: AbortSignal,
  ): Promise<IUnifiedSearchResult[]> {
    if (!this.embeddingProvider) return []
    if (signal?.aborted) return []

    try {
      const [queryEmbedding] = await this.embeddingProvider.embed([query])

      const results = await this.vectorStore.search(queryEmbedding, topK * SEARCH_MULTIPLIER)

      return results
        .filter((r) => r.score >= minScore)
        .slice(0, topK)
        .map((r) => ({
          chunk: r.chunk,
          score: r.score,
          source: "semantic" as const,
        }))
    } catch (err: unknown) {
      const msg = errorMessage(err)
      log.warn(`Семантический поиск не выполнен: ${msg}`)
      return []
    }
  }

  /**
   * Полнотекстовый поиск.
   */
  private async keywordSearch(
    query: string,
    topK: number,
    minScore: number
  ): Promise<IUnifiedSearchResult[]> {
    const results = this.fts.search(query, topK * SEARCH_MULTIPLIER)

    return results
      .filter((r) => r.score >= minScore)
      .slice(0, topK)
      .map((r) => ({
        chunk: r.chunk,
        score: r.score,
        source: "keyword" as const,
      }))
  }

  /**
   * Гибридный поиск: объединение семантического и полнотекстового.
   *
   * Результаты из обоих источников объединяются и ранжируются
   * по взвешенной оценке.
   */
  private async hybridSearch(
    query: string,
    topK: number,
    minScore: number,
    signal?: AbortSignal,
  ): Promise<IUnifiedSearchResult[]> {
    const [semanticResults, keywordResults] = await Promise.all([
      this.semanticSearch(query, topK * SEARCH_MULTIPLIER, 0, signal),
      this.keywordSearch(query, topK * SEARCH_MULTIPLIER, 0),
    ])

    // Объединить результаты, удалив дубликаты
    const seen = new Set<string>()
    const merged: Array<{
      chunk: ICodeChunk
      score: number
      source: "semantic" | "keyword" | "hybrid"
    }> = []

    for (const r of semanticResults) {
      if (seen.has(r.chunk.id)) continue
      seen.add(r.chunk.id)
      merged.push({
        chunk: r.chunk,
        score: r.score,
        source: "semantic",
      })
    }

    for (const r of keywordResults) {
      if (seen.has(r.chunk.id)) {
        // Уже есть из семантического поиска — повысить оценку
        const existing = merged.find((m) => m.chunk.id === r.chunk.id)
        if (existing) {
          existing.score = Math.max(existing.score, r.score)
          existing.source = "hybrid"
        }
        continue
      }
      seen.add(r.chunk.id)
      merged.push({
        chunk: r.chunk,
        score: r.score,
        source: "keyword",
      })
    }

    // Сортировка по убыванию оценки
    merged.sort((a, b) => b.score - a.score)

    return merged
      .filter((r) => r.score >= minScore)
      .slice(0, topK)
  }

  /**
   * Графовый поиск через ContextBuilder.
   */
  private async graphSearch(
    query: string,
    topK: number,
    minScore: number,
  ): Promise<IUnifiedSearchResult[]> {
    const builder = this.getContextBuilder()
    if (!builder) return []

    try {
      const subgraph = await builder.findRelevantContext(query, {
        searchLimit: topK * SEARCH_MULTIPLIER,
        traversalDepth: 1,
        maxNodes: topK * SEARCH_MULTIPLIER,
        minScore: 0,
      })

      return this.subgraphToResults(subgraph, topK, minScore)
    } catch (err: unknown) {
      const msg = errorMessage(err)
      log.warn(`Графовый поиск не выполнен: ${msg}`)
      return []
    }
  }

  /**
   * Гибридный графовый поиск: семантический + полнотекстовый + графовый.
   */
  private async hybridGraphSearch(
    query: string,
    topK: number,
    minScore: number,
    signal?: AbortSignal,
  ): Promise<IUnifiedSearchResult[]> {
    const [semanticResults, keywordResults, graphResults] = await Promise.all([
      this.semanticSearch(query, topK * SEARCH_MULTIPLIER, 0, signal),
      this.keywordSearch(query, topK * SEARCH_MULTIPLIER, 0),
      this.graphSearch(query, topK * SEARCH_MULTIPLIER, 0),
    ])

    const seen = new Set<string>()
    const merged: Array<{
      chunk: ICodeChunk
      score: number
      source: "semantic" | "keyword" | "hybrid" | "graph" | "hybrid_graph"
    }> = []

    for (const r of semanticResults) {
      if (seen.has(r.chunk.id)) continue
      seen.add(r.chunk.id)
      merged.push({ chunk: r.chunk, score: r.score, source: "semantic" })
    }

    for (const r of keywordResults) {
      if (seen.has(r.chunk.id)) {
        const existing = merged.find((m) => m.chunk.id === r.chunk.id)
        if (existing) {
          existing.score = Math.max(existing.score, r.score)
          existing.source = "hybrid"
        }
        continue
      }
      seen.add(r.chunk.id)
      merged.push({ chunk: r.chunk, score: r.score, source: "keyword" })
    }

    for (const r of graphResults) {
      if (seen.has(r.chunk.id)) {
        const existing = merged.find((m) => m.chunk.id === r.chunk.id)
        if (existing) {
          existing.score = Math.max(existing.score, r.score)
          existing.source = "hybrid_graph"
        }
        continue
      }
      seen.add(r.chunk.id)
      merged.push({ chunk: r.chunk, score: r.score, source: "graph" })
    }

    merged.sort((a, b) => b.score - a.score)

    return merged
      .filter((r) => r.score >= minScore)
      .slice(0, topK)
  }

  /**
   * Получение ContextBuilder с ленивой инициализацией.
   */
  private getContextBuilder(): ContextBuilder | null {
    if (this._contextBuilder) return this._contextBuilder
    if (!this.graphDb) return null

    try {
      const qb = this.graphDb.queryBuilder
      const traverser = new (require("./ntgraph/Traversal").GraphTraverser)(qb)
      this._contextBuilder = new ContextBuilder(this.graphDb.getProjectRoot(), qb, traverser)
      return this._contextBuilder
    } catch {
      return null
    }
  }

  /**
   * Преобразование подграфа в результаты поиска.
   */
  private subgraphToResults(
    subgraph: ISubgraph,
    topK: number,
    minScore: number,
  ): IUnifiedSearchResult[] {
    const rootIds = new Set(subgraph.roots)
    const results: IUnifiedSearchResult[] = []

    for (const [, node] of subgraph.nodes) {
      const isRoot = rootIds.has(node.id)
      const score = isRoot ? 0.9 : 0.5

      if (score < minScore) continue

      results.push({
        chunk: this.nodeToChunk(node),
        score,
        source: "graph",
      })
    }

    results.sort((a, b) => b.score - a.score)
    return results.slice(0, topK)
  }

  /**
   * Преобразование узла графа в фрагмент кода.
   */
  private nodeToChunk(node: INode): ICodeChunk {
    return {
      id: node.id,
      filePath: node.filePath,
      content: node.signature ?? node.name,
      startLine: node.startLine,
      endLine: node.endLine,
      language: node.language,
      nodeKind: this.mapNodeKind(node.kind),
      symbolName: node.name,
      charLength: (node.signature ?? node.name).length,
    }
  }

  /**
   * Преобразование NodeKind в ChunkNodeKind.
   */
  private mapNodeKind(kind: INode["kind"]): ICodeChunk["nodeKind"] {
    switch (kind) {
      case "class":
        return "class"
      case "function":
        return "function"
      case "method":
        return "method"
      case "interface":
        return "interface"
      case "type_alias":
        return "type"
      case "enum":
        return "enum"
      case "constant":
        return "const"
      default:
        return "block"
    }
  }

  /**
   * Добавить фрагменты в оба индекса.
   */
  async indexChunks(chunks: ICodeChunk[], signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return
    // Добавить в FTS
    this.fts.add(chunks)

    // Добавить в векторное хранилище (если провайдер доступен)
    if (this.embeddingProvider) {
      try {
        const embeddings = await this.embeddingProvider.embed(
          chunks.map((c) => c.content)
        )

        const chunkEmbeddings = chunks.map((chunk, i) => ({
          id: chunk.id,
          chunk,
          embedding: embeddings[i] ?? new Array(this.embeddingProvider!.dimension()).fill(0),
        }))

        await this.vectorStore.add(chunkEmbeddings)
      } catch (err: unknown) {
        const msg = errorMessage(err)
        log.warn(`Эмбеддинги недоступны: ${msg}`)
      }
    }
  }

  /**
   * Удалить фрагменты для файла из обоих индексов.
   */
  async deleteByFile(filePath: string): Promise<void> {
    this.fts.deleteByFile(filePath)
    await this.vectorStore.deleteByFile(filePath)
  }

  /**
   * Очистить оба индекса.
   */
  async clear(): Promise<void> {
    this.fts.clear()
    await this.vectorStore.clear()
  }

  /**
   * Получить статистику.
   */
  stats(): {
    vectorChunks: number
    ftsChunks: number
    embeddingAvailable: boolean
  } {
    return {
      vectorChunks: this.vectorStore.count(),
      ftsChunks: this.fts.count(),
      embeddingAvailable: this.embeddingProvider?.isAvailable() ?? false,
    }
  }

  /**
   * Выполнить compaction обоих индексов если tombstone превышает порог.
   */
  compactIfNeeded(): void {
    this.vectorStore.compactIfNeeded()
    this.fts.compactIfNeeded()
  }
}
