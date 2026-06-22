/**
 * Интерфейс векторного хранилища для эмбеддингов кода.
 *
 * Хранит эмбеддинги фрагментов кода и предоставляет
 * поиск по косинусному сходству.
 */

import type { ICodeChunk } from "./ChunkTypes"

/**
 * Эмбеддинг фрагмента кода.
 */
export interface IChunkEmbedding {
  /** Уникальный идентификатор. */
  id: string

  /** Фрагмент кода. */
  chunk: ICodeChunk

  /** Вектор эмбеддинга. */
  embedding: number[]
}

/**
 * Результат поиска.
 */
export interface ISearchResult {
  /** Фрагмент кода. */
  chunk: ICodeChunk

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
  add(embeddings: IChunkEmbedding[]): Promise<void>

  /**
   * Поиск по вектору запроса.
   * @param queryEmbedding вектор запроса
   * @param topK число результатов
   * @returns результаты поиска, отсортированные по релевантности
   */
  search(queryEmbedding: number[], topK: number): Promise<ISearchResult[]>

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
