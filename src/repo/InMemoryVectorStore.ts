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
import { TombstoneStore } from "../shared/TombstoneStore"

/**
 * Векторное хранилище в памяти.
 * Использует TombstoneStore для O(1) удаления.
 */
export class InMemoryVectorStore implements IVectorStore {
  private store = new TombstoneStore<ChunkEmbedding>()
  private idIndex = new Map<string, number>()
  private fileIndex = new Map<string, Set<number>>()

  /**
   * Добавить эмбеддинги в хранилище.
   */
  async add(embeddings: ChunkEmbedding[]): Promise<void> {
    for (const emb of embeddings) {
      const idx = this.store.acquireSlot()
      this.store.put(idx, emb)
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
    const items = this.store.getItems()
    if (items.length === 0) return []

    const scores: Array<{ index: number; score: number }> = []

    for (let i = 0; i < items.length; i++) {
      const emb = items[i]
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
      const emb = items[entry.index]
      if (emb) {
        results.push({
          chunk: emb.chunk,
          score: entry.score,
        })
      }
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
      const emb = this.store.get(idx)
      if (emb) {
        this.idIndex.delete(emb.id)
        this.store.tombstone(idx)
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

    const emb = this.store.get(idx)
    if (!emb) return

    this.idIndex.delete(id)

    const fileSet = this.fileIndex.get(emb.chunk.filePath)
    if (fileSet) {
      fileSet.delete(idx)
      if (fileSet.size === 0) {
        this.fileIndex.delete(emb.chunk.filePath)
      }
    }

    this.store.tombstone(idx)
  }

  /**
   * Очистить хранилище.
   */
  async clear(): Promise<void> {
    this.store.clear()
    this.idIndex.clear()
    this.fileIndex.clear()
  }

  /**
   * Число хранимых эмбеддингов.
   */
  count(): number {
    return this.store.count()
  }

  /**
   * Получить статистику хранилища.
   */
  stats(): { totalChunks: number; filesIndexed: number; avgChunkSize: number } {
    let totalChunks = 0
    let totalSize = 0

    const items = this.store.getItems()
    for (const emb of items) {
      if (emb) {
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

  /**
   * Выполнить compaction если tombstone превышает порог.
   */
  compactIfNeeded(threshold = 0.5): boolean {
    return this.store.compact(threshold)
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
