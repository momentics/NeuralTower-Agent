/**
 * Векторное хранилище в памяти.
 *
 * Хранит эмбеддинги в памяти с использованием
 * косинусного сходства для поиска.
 *
 * Подходит для репозиториев до ~10 000 фрагментов.
 * Для больших репозиториев рекомендуется использовать
 * LanceDB или аналогичное хранилище.
 */

import type {
  ChunkEmbedding,
  SearchResult,
  IVectorStore,
} from "./IVectorStore"

/**
 * Векторное хранилище в памяти.
 * Использует tombstone-подход для O(1) удаления.
 */
export class InMemoryVectorStore implements IVectorStore {
  private embeddings: (ChunkEmbedding | null)[] = []
  private deleted = new Set<number>()
  private idIndex = new Map<string, number>()
  private fileIndex = new Map<string, Set<number>>()

  /**
   * Добавить эмбеддинги в хранилище.
   */
  async add(embeddings: ChunkEmbedding[]): Promise<void> {
    for (const emb of embeddings) {
      let idx: number | undefined
      // Переиспользовать слот удалённого эмбеддинга
      for (const d of this.deleted) {
        if (d >= this.embeddings.length) continue
        idx = d
        this.deleted.delete(d)
        break
      }
      // Новый слот
      if (idx === undefined) {
        idx = this.embeddings.length
        this.embeddings.push(null)
      }

      this.embeddings[idx] = emb
      this.idIndex.set(emb.id, idx)

      const fileSet = this.fileIndex.get(emb.chunk.filePath) ?? new Set<number>()
      fileSet.add(idx)
      this.fileIndex.set(emb.chunk.filePath, fileSet)
    }
  }

  /**
   * Поиск по вектору запроса с использованием
   * косинусного сходства.
   */
  async search(queryEmbedding: number[], topK: number): Promise<SearchResult[]> {
    if (this.embeddings.length === 0) return []

    const scores: Array<{ index: number; score: number }> = []

    for (let i = 0; i < this.embeddings.length; i++) {
      if (this.deleted.has(i)) continue
      const emb = this.embeddings[i]
      if (!emb) continue

      const similarity = cosineSimilarity(queryEmbedding, emb.embedding)
      if (similarity > 0) {
        scores.push({ index: i, score: similarity })
      }
    }

    scores.sort((a, b) => b.score - a.score)

    const results: SearchResult[] = []
    const limit = Math.min(topK, scores.length)

    for (let i = 0; i < limit; i++) {
      const entry = scores[i]
      results.push({
        chunk: this.embeddings[entry.index]!.chunk,
        score: entry.score,
      })
    }

    return results
  }

  /**
   * Удалить все эмбеддинги для файла — O(1) через tombstone.
   */
  async deleteByFile(filePath: string): Promise<void> {
    const indices = this.fileIndex.get(filePath)
    if (!indices) return

    for (const idx of indices) {
      const emb = this.embeddings[idx]
      if (emb) {
        this.idIndex.delete(emb.id)
        this.embeddings[idx] = null
        this.deleted.add(idx)
      }
    }

    this.fileIndex.delete(filePath)
  }

  /**
   * Удалить конкретный эмбеддинг — O(1) через tombstone.
   */
  async deleteById(id: string): Promise<void> {
    const idx = this.idIndex.get(id)
    if (idx === undefined) return

    const emb = this.embeddings[idx]
    if (!emb) return

    this.idIndex.delete(id)

    const fileSet = this.fileIndex.get(emb.chunk.filePath)
    if (fileSet) {
      fileSet.delete(idx)
      if (fileSet.size === 0) {
        this.fileIndex.delete(emb.chunk.filePath)
      }
    }

    this.embeddings[idx] = null
    this.deleted.add(idx)
  }

  /**
   * Очистить хранилище.
   */
  async clear(): Promise<void> {
    this.embeddings = []
    this.deleted.clear()
    this.idIndex.clear()
    this.fileIndex.clear()
  }

  /**
   * Число хранимых эмбеддингов.
   */
  count(): number {
    return this.embeddings.length - this.deleted.size
  }

  /**
   * Получить статистику хранилища.
   */
  stats(): { totalChunks: number; filesIndexed: number; avgChunkSize: number } {
    let totalChunks = 0
    let totalSize = 0

    for (let i = 0; i < this.embeddings.length; i++) {
      const emb = this.embeddings[i]
      if (emb && !this.deleted.has(i)) {
        totalChunks++
        totalSize += emb.chunk.charLength
      }
    }

    return {
      totalChunks,
      filesIndexed: this.fileIndex.size,
      avgChunkSize: totalChunks > 0 ? Math.round(totalSize / totalChunks) : 0,
    }
  }
}

/**
 * Вычислить косинусное сходство между двумя векторами.
 * @returns значение от -1 до 1 (1 = идентичные направления)
 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0
  let normA = 0
  let normB = 0

  const len = Math.min(a.length, b.length)

  for (let i = 0; i < len; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  normA = Math.sqrt(normA)
  normB = Math.sqrt(normB)

  if (normA === 0 || normB === 0) return 0

  return dotProduct / (normA * normB)
}
