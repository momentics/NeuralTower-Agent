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
 */
export class InMemoryVectorStore implements IVectorStore {
  private embeddings: ChunkEmbedding[] = []
  private idIndex = new Map<string, number>()
  private fileIndex = new Map<string, Set<number>>()

  /**
   * Добавить эмбеддинги в хранилище.
   */
  async add(embeddings: ChunkEmbedding[]): Promise<void> {
    const startIndex = this.embeddings.length

    for (const emb of embeddings) {
      const idx = this.embeddings.length
      this.embeddings.push(emb)
      this.idIndex.set(emb.id, idx)

      // Индекс по файлу
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
      const similarity = cosineSimilarity(queryEmbedding, this.embeddings[i].embedding)
      if (similarity > 0) {
        scores.push({ index: i, score: similarity })
      }
    }

    // Быстрая сортировка по убыванию
    scores.sort((a, b) => b.score - a.score)

    const results: SearchResult[] = []
    const limit = Math.min(topK, scores.length)

    for (let i = 0; i < limit; i++) {
      const entry = scores[i]
      results.push({
        chunk: this.embeddings[entry.index].chunk,
        score: entry.score,
      })
    }

    return results
  }

  /**
   * Удалить все эмбеддинги для файла.
   */
  async deleteByFile(filePath: string): Promise<void> {
    const indices = this.fileIndex.get(filePath)
    if (!indices) return

    // Удалить по убыванию индексов (чтобы не сдвигать индексы)
    const sorted = Array.from(indices).sort((a, b) => b - a)

    for (const idx of sorted) {
      const emb = this.embeddings[idx]
      if (emb) {
        this.idIndex.delete(emb.id)
        this.embeddings.splice(idx, 1)
      }
    }

    this.fileIndex.delete(filePath)

    // Обновить индексы (пересоздать idIndex)
    this.rebuildIndex()
  }

  /**
   * Удалить конкретный эмбеддинг.
   */
  async deleteById(id: string): Promise<void> {
    const idx = this.idIndex.get(id)
    if (idx === undefined) return

    const emb = this.embeddings[idx]
    if (!emb) return

    this.idIndex.delete(id)

    // Удалить из fileIndex
    const fileSet = this.fileIndex.get(emb.chunk.filePath)
    if (fileSet) {
      fileSet.delete(idx)
      if (fileSet.size === 0) {
        this.fileIndex.delete(emb.chunk.filePath)
      }
    }

    this.embeddings.splice(idx, 1)
    this.rebuildIndex()
  }

  /**
   * Очистить хранилище.
   */
  async clear(): Promise<void> {
    this.embeddings = []
    this.idIndex.clear()
    this.fileIndex.clear()
  }

  /**
   * Число хранимых эмбеддингов.
   */
  count(): number {
    return this.embeddings.length
  }

  /**
   * Получить статистику хранилища.
   */
  stats(): { totalChunks: number; filesIndexed: number; avgChunkSize: number } {
    const totalChunks = this.embeddings.length
    const filesIndexed = this.fileIndex.size
    const avgChunkSize =
      totalChunks > 0
        ? Math.round(
            this.embeddings.reduce((s, e) => s + e.chunk.charLength, 0) / totalChunks
          )
        : 0

    return { totalChunks, filesIndexed, avgChunkSize }
  }

  /**
   * Пересоздать индексы после удаления элементов.
   */
  private rebuildIndex(): void {
    this.idIndex.clear()
    this.fileIndex.clear()

    for (let i = 0; i < this.embeddings.length; i++) {
      const emb = this.embeddings[i]
      this.idIndex.set(emb.id, i)

      const fileSet = this.fileIndex.get(emb.chunk.filePath) ?? new Set<number>()
      fileSet.add(i)
      this.fileIndex.set(emb.chunk.filePath, fileSet)
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
