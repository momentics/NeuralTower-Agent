/**
 * Полнотекстовый поиск по коду.
 *
 * Использует простой BM25-подобный алгоритм для поиска
 * по фрагментам кода. Не требует внешних зависимостей.
 *
 * В будущем может быть заменён на SQLite FTS5 для
 * больших репозиториев.
 */

import type { ICodeChunk } from "./ChunkTypes"
import { TombstoneStore } from "../shared/TombstoneStore"

const FTS_MIN_TOKEN_LENGTH = 2
const FTS_LENGTH_PENALTY = 2_000
const FTS_MAX_MATCH_COUNT = 10

/**
 * Результат полнотекстового поиска.
 */
export interface IFtsResult {
  /** Фрагмент кода. */
  chunk: ICodeChunk

  /** Оценка релевантности (0-1). */
  score: number

  /** Число вхождений запроса. */
  matchCount: number
}

/**
 * Интерфейс полнотекстового поиска.
 */
export interface IFullTextSearch {
 add(chunks: ICodeChunk[]): void
 search(query: string, topK: number): IFtsResult[]
  deleteByFile(filePath: string): void
  clear(): void
  count(): number
}

/**
 * Полнотекстовый поиск по фрагментам кода.
 * Использует TombstoneStore для O(1) удаления и fileIndex для O(1) поиска по файлу.
 */
export class FullTextSearch implements IFullTextSearch {
  private store = new TombstoneStore<ICodeChunk>()
  private tokenIndex = new Map<string, Set<number>>()
  private fileIndex = new Map<string, Set<number>>()

  /**
  * Добавить фрагменты для индексации.
  */
  add(chunks: ICodeChunk[]): void {
    for (const chunk of chunks) {
      const idx = this.store.acquireSlot()
      this.store.put(idx, chunk)

      const fileSet = this.fileIndex.get(chunk.filePath) ?? new Set<number>()
      fileSet.add(idx)
      this.fileIndex.set(chunk.filePath, fileSet)

      const tokens = this.tokenize(chunk.content)
      for (const token of tokens) {
        const set = this.tokenIndex.get(token) ?? new Set<number>()
        set.add(idx)
        this.tokenIndex.set(token, set)
      }
    }
  }

  /**
   * Поиск по запросу.
   * @param query строка запроса
   * @param topK число результатов
   */
  search(query: string, topK: number): IFtsResult[] {
    const tokens = this.tokenize(query).filter((t) => t.length > FTS_MIN_TOKEN_LENGTH)

    if (tokens.length === 0) return []

    const candidateIndices = new Set<number>()
    for (const token of tokens) {
      const indices = this.tokenIndex.get(token)
      if (indices) {
        for (const idx of indices) {
          if (!this.store.isDeleted(idx)) {
            candidateIndices.add(idx)
          }
        }
      }
    }

    const scores: Array<{ index: number; score: number; matchCount: number }> = []

    for (const idx of candidateIndices) {
      const chunk = this.store.get(idx)
      if (!chunk) continue

      let matchCount = 0
      let tokenMatches = 0

      const content = chunk.content.toLowerCase()

      for (const token of tokens) {
        const count = content.split(token.toLowerCase()).length - 1
        if (count > 0) {
          matchCount += count
          tokenMatches++
        }
      }

      const tokenRatio = tokenMatches / tokens.length
  const lengthPenalty = Math.min(1, FTS_LENGTH_PENALTY / chunk.charLength)
      const score = tokenRatio * lengthPenalty * (0.5 + 0.5 * Math.min(matchCount, FTS_MAX_MATCH_COUNT) / FTS_MAX_MATCH_COUNT)

      if (score > 0) {
        scores.push({ index: idx, score, matchCount })
      }
    }

    scores.sort((a, b) => b.score - a.score)

    const limit = Math.min(topK, scores.length)
    const results: IFtsResult[] = []

    for (let i = 0; i < limit; i++) {
      const entry = scores[i]
      const chunk = this.store.get(entry.index)
      if (chunk) {
        results.push({
          chunk,
          score: entry.score,
          matchCount: entry.matchCount,
        })
      }
    }

    return results
  }

  /**
   * Удалить фрагменты для файла — O(1) через fileIndex + tombstone.
   */
  deleteByFile(filePath: string): void {
    const indices = this.fileIndex.get(filePath)
    if (!indices) return

    for (const idx of indices) {
      const chunk = this.store.get(idx)
      if (chunk) {
        const tokens = this.tokenize(chunk.content)
        for (const token of tokens) {
          const set = this.tokenIndex.get(token)
          if (set) {
            set.delete(idx)
            if (set.size === 0) {
              this.tokenIndex.delete(token)
            }
          }
        }
      }
      this.store.tombstone(idx)
    }

    this.fileIndex.delete(filePath)
  }

  /**
   * Очистить индекс.
   */
  clear(): void {
    this.store.clear()
    this.tokenIndex.clear()
    this.fileIndex.clear()
  }

  /**
   * Число фрагментов в индексе.
   */
  count(): number {
    return this.store.count()
  }

  /**
   * Выполнить compaction если tombstone превышает порог.
   */
  compactIfNeeded(threshold = 0.5): boolean {
    return this.store.compact(threshold)
  }

  /**
   * Разбить текст на токены.
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, " ")
      .split(" ")
      .filter((t) => t.length > 0)
  }
}
