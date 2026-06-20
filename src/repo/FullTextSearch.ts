/**
 * Полнотекстовый поиск по коду.
 *
 * Использует простой BM25-подобный алгоритм для поиска
 * по фрагментам кода. Не требует внешних зависимостей.
 *
 * В будущем может быть заменён на SQLite FTS5 для
 * больших репозиториев.
 */

import type { CodeChunk } from "./ChunkTypes"

const FTS_MIN_TOKEN_LENGTH = 2
const FTS_LENGTH_PENALTY = 2000
const FTS_MAX_MATCH_COUNT = 10

/**
 * Результат полнотекстового поиска.
 */
export interface FtsResult {
  /** Фрагмент кода. */
  chunk: CodeChunk

  /** Оценка релевантности (0-1). */
  score: number

  /** Число вхождений запроса. */
  matchCount: number
}

/**
 * Интерфейс полнотекстового поиска.
 */
export interface IFullTextSearch {
  add(chunks: CodeChunk[]): void
  search(query: string, topK: number): FtsResult[]
  deleteByFile(filePath: string): void
  clear(): void
  count(): number
}

/**
 * Полнотекстовый поиск по фрагментам кода.
 * Использует tombstone-подход для O(1) удаления без перестроения индекса.
 */
export class FullTextSearch implements IFullTextSearch {
  private chunks: (CodeChunk | null)[] = []
  private deleted = new Set<number>()
  private tokenIndex = new Map<string, Set<number>>()

  /**
 * Добавить фрагменты для индексации.
 */
  add(chunks: CodeChunk[]): void {
    for (const chunk of chunks) {
      let idx: number | undefined
      // Переиспользовать слот удалённого фрагмента
      for (const d of this.deleted) {
        if (d >= this.chunks.length) continue
        idx = d
        this.deleted.delete(d)
        break
      }
      // Новый слот
      if (idx === undefined) {
        idx = this.chunks.length
        this.chunks.push(null)
      }

      this.chunks[idx] = chunk

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
  search(query: string, topK: number): FtsResult[] {
    const tokens = this.tokenize(query).filter((t) => t.length > FTS_MIN_TOKEN_LENGTH)

    if (tokens.length === 0) return []

    const candidateIndices = new Set<number>()
    for (const token of tokens) {
      const indices = this.tokenIndex.get(token)
      if (indices) {
        for (const idx of indices) {
          if (!this.deleted.has(idx)) {
            candidateIndices.add(idx)
          }
        }
      }
    }

    const scores: Array<{ index: number; score: number; matchCount: number }> = []

    for (const idx of candidateIndices) {
      const chunk = this.chunks[idx]
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
    const results: FtsResult[] = []

    for (let i = 0; i < limit; i++) {
      const entry = scores[i]
      results.push({
        chunk: this.chunks[entry.index]!,
        score: entry.score,
        matchCount: entry.matchCount,
      })
    }

    return results
  }

  /**
   * Удалить фрагменты для файла — O(1) через tombstone.
   */
  deleteByFile(filePath: string): void {
    const indicesToRemove: number[] = []

    for (let i = 0; i < this.chunks.length; i++) {
      const chunk = this.chunks[i]
      if (chunk && chunk.filePath === filePath) {
        indicesToRemove.push(i)
      }
    }

    if (indicesToRemove.length === 0) return

    for (const idx of indicesToRemove) {
      const chunk = this.chunks[idx]
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
      this.chunks[idx] = null
      this.deleted.add(idx)
    }
  }

  /**
   * Очистить индекс.
   */
  clear(): void {
    this.chunks = []
    this.deleted.clear()
    this.tokenIndex.clear()
  }

  /**
   * Число фрагментов в индексе.
   */
  count(): number {
    return this.chunks.length - this.deleted.size
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
