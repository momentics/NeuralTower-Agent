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
 * Полнотекстовый поиск по фрагментам кода.
 */
export class FullTextSearch {
  private chunks: CodeChunk[] = []
  private tokenIndex = new Map<string, Set<number>>()

  /**
   * Добавить фрагменты для индексации.
   */
  add(chunks: CodeChunk[]): void {
    for (const chunk of chunks) {
      const idx = this.chunks.length
      this.chunks.push(chunk)

      // Разбить на токены и добавить в индекс
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
    const tokens = this.tokenize(query).filter((t) => t.length > 2)

    if (tokens.length === 0) return []

    // Найти фрагменты, содержащие хотя бы один токен
    const candidateIndices = new Set<number>()
    for (const token of tokens) {
      const indices = this.tokenIndex.get(token)
      if (indices) {
        for (const idx of indices) {
          candidateIndices.add(idx)
        }
      }
    }

    // Рассчитать оценку для каждого кандидата
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

      // Оценка: учитывает число совпаждений токенов и частоту
      const tokenRatio = tokenMatches / tokens.length
      const lengthPenalty = Math.min(1, 2000 / chunk.charLength)
      const score = tokenRatio * lengthPenalty * (0.5 + 0.5 * Math.min(matchCount, 10) / 10)

      if (score > 0) {
        scores.push({ index: idx, score, matchCount })
      }
    }

    // Сортировка по убыванию оценки
    scores.sort((a, b) => b.score - a.score)

    const limit = Math.min(topK, scores.length)
    const results: FtsResult[] = []

    for (let i = 0; i < limit; i++) {
      const entry = scores[i]
      results.push({
        chunk: this.chunks[entry.index],
        score: entry.score,
        matchCount: entry.matchCount,
      })
    }

    return results
  }

  /**
   * Удалить фрагменты для файла.
   */
  deleteByFile(filePath: string): void {
    const indicesToRemove: number[] = []

    for (let i = 0; i < this.chunks.length; i++) {
      if (this.chunks[i].filePath === filePath) {
        indicesToRemove.push(i)
      }
    }

    // Удалить из индекса токенов
    for (const idx of indicesToRemove) {
      const chunk = this.chunks[idx]
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

    // Удалить из массива (по убыванию)
    for (let i = indicesToRemove.length - 1; i >= 0; i--) {
      this.chunks.splice(indicesToRemove[i], 1)
    }
  }

  /**
   * Очистить индекс.
   */
  clear(): void {
    this.chunks = []
    this.tokenIndex.clear()
  }

  /**
   * Число фрагментов в индексе.
   */
  count(): number {
    return this.chunks.length
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
