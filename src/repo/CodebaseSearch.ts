/**
 * Объединённый поиск по репозиторию.
 *
 * Комбинирует семантический поиск (векторное хранилище)
 * и полнотекстовый поиск (FTS) для получения лучших результатов.
 *
 * Режимы поиска:
 * - semantic: только векторное хранилище
 * - keyword: только полнотекстовый поиск
 * - hybrid: оба источника, объединённые по релевантности
 */

import type { IEmbeddingProvider } from "../backend/IEmbeddingProvider"
import type { IVectorStore } from "./IVectorStore"
import type { ICodeChunk, ISearchConfig, SearchMode } from "./ChunkTypes"
import { errorMessage } from "../core/Errors"
import type { IFullTextSearch } from "./FullTextSearch"
import { createDomainLogger } from "../core/Logger"

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
  source: "semantic" | "keyword" | "hybrid"
}

/**
 * Интерфейс поиска по кодовой базе.
 */
export interface ICodebaseSearch {
  search(query: string, config?: Partial<ISearchConfig>, signal?: AbortSignal): Promise<IUnifiedSearchResult[]>
 indexChunks(chunks: ICodeChunk[], signal?: AbortSignal): Promise<void>
  deleteByFile(filePath: string): Promise<void>
  clear(): Promise<void>
  stats(): { vectorChunks: number; ftsChunks: number; embeddingAvailable: boolean }
}

/**
 * Объединённый поиск по репозиторию.
 */
export class CodebaseSearch implements ICodebaseSearch {
  constructor(
    private readonly vectorStore: IVectorStore,
    private readonly embeddingProvider: IEmbeddingProvider | null,
    private readonly fts: IFullTextSearch
  ) {}

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
}
