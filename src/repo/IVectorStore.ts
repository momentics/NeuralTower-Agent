/**
 * Интерфейс векторного хранилища для эмбеддингов кода.
 *
 * Хранит эмбеддинги фрагментов кода и предоставляет
 * поиск по косинусному сходству.
 */

import type { CodeChunk } from "./ChunkTypes"

/**
 * Эмбеддинг фрагмента кода.
 */
export interface ChunkEmbedding {
  /** Уникальный идентификатор. */
  id: string

  /** Фрагмент кода. */
  chunk: CodeChunk

  /** Вектор эмбеддинга. */
  embedding: number[]
}

/**
 * Результат поиска.
 */
export interface SearchResult {
  /** Фрагмент кода. */
  chunk: CodeChunk

  /** Оценка сходства (0-1, 1 = идентично). */
  score: number
}

/**
 * Векторное хранилище.
 */
export interface IVectorStore {
  /**
   * Добавить эмбеддинги в хранилище.
   */
  add(embeddings: ChunkEmbedding[]): Promise<void>

  /**
   * Поиск по вектору запроса.
   * @param queryEmbedding вектор запроса
   * @param topK число результатов
   * @returns результаты поиска, отсортированные по релевантности
   */
  search(queryEmbedding: number[], topK: number): Promise<SearchResult[]>

  /**
   * Удалить все эмбеддинги для файла.
   */
  deleteByFile(filePath: string): Promise<void>

  /**
   * Удалить конкретный эмбеддинг.
   */
  deleteById(id: string): Promise<void>

  /**
   * Очистить хранилище.
   */
  clear(): Promise<void>

  /**
   * Число хранимых эмбеддингов.
   */
  count(): number

  /**
   * Получить статистику хранилища.
   */
  stats(): { totalChunks: number; filesIndexed: number; avgChunkSize: number }
}
