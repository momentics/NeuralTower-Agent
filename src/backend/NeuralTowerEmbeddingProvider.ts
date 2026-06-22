/**
 * Провайдер эмбеддингов для Neural Tower.
 *
 * Использует эндпоинт /v1/embeddings сервера Neural Tower
 * (SGLang/vLLM), совместимый с OpenAI API.
 *
 * Если эндпоинт недоступен, возвращается пустой массив —
 * в этом случае семантический поиск будет отключён.
 */

import type { IEmbeddingProvider, IEmbeddingProviderConfig } from "./IEmbeddingProvider"
import { BackendError, ConnectionError, errorMessage } from "../core/Errors"
import { createDomainLogger } from "../core/Logger"

const log = createDomainLogger("Embedding")

const DEFAULT_EMBEDDING_DIMENSION = 1536
const DEFAULT_EMBEDDING_MODEL = "nomic-embed-text"
const DEFAULT_BACKEND_URL = "http://localhost:30000"
const EMBEDDING_TIMEOUT_MS = 10000
const DEFAULT_EMBEDDING_BATCH_SIZE = 256

/**
 * Провайдер эмбеддингов Neural Tower.
 */
export class NeuralTowerEmbeddingProvider implements IEmbeddingProvider {
  private config: IEmbeddingProviderConfig
  private _available = false
  private _dimension = DEFAULT_EMBEDDING_DIMENSION
  private _modelName = DEFAULT_EMBEDDING_MODEL

  constructor(config?: Partial<IEmbeddingProviderConfig>) {
    this.config = {
      baseUrl: config?.baseUrl ?? DEFAULT_BACKEND_URL,
      model: config?.model ?? DEFAULT_EMBEDDING_MODEL,
      batchSize: config?.batchSize ?? DEFAULT_EMBEDDING_BATCH_SIZE,
      timeoutMs: config?.timeoutMs ?? EMBEDDING_TIMEOUT_MS,
    }
    this._modelName = this.config.model
  }

  /**
   * Создать эмбеддинги для списка текстов.
   * Разбивает тексты на батчи для обработки.
   */
  async embed(texts: string[]): Promise<number[][]> {
    if (!this._available) {
      await this.checkAvailability()
    }

    if (!this._available) {
      // Эмбеддинги недоступны — вернуть заглушку
      return texts.map(() => new Array(this._dimension).fill(0))
    }

    const results: number[][] = []
    const batchSize = this.config.batchSize

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize)
      const batchResult = await this.embedBatch(batch)
      results.push(...batchResult)
    }

    return results
  }

  /**
   * Создать эмбеддинги для одного батча.
   */
  private async embedBatch(texts: string[]): Promise<number[][]> {
    const url = this.config.baseUrl + "/v1/embeddings"

    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), this.config.timeoutMs)

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.config.model,
          input: texts,
        }),
        signal: ctrl.signal,
      })

      if (!res.ok) {
        const body = await res.text()
        throw new BackendError(`HTTP ${res.status}: ${body}`)
      }

      const data = (await res.json()) as {
        data?: Array<{ embedding?: number[] }>
      }

      return (
        data.data?.map((d) => d.embedding ?? new Array(this._dimension).fill(0)) ??
        texts.map(() => new Array(this._dimension).fill(0))
      )
   } catch (err: unknown) {
      if (err instanceof BackendError) throw err
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new ConnectionError("Запрос эмбеддинга прерван по таймауту")
      }
      throw new ConnectionError(`Ошибка эмбеддинга: ${String(err)}`)
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Проверить доступность провайдера эмбеддингов.
   */
  private async checkAvailability(): Promise<void> {
    try {
      // Попытаться получить эмбеддинг для тестовой строки
      const testEmbedding = await this.embedBatch(["test"])
      if (testEmbedding.length > 0 && testEmbedding[0].length > 0) {
        this._available = true
        this._dimension = testEmbedding[0].length
      }
   } catch (err: unknown) {
      const msg = errorMessage(err)
      log.error(`Проверка доступности эмбеддингов не выполнена: ${msg}`)
      this._available = false
    }
  }

  isAvailable(): boolean {
    return this._available
  }

  dimension(): number {
    return this._dimension
  }

  modelName(): string {
    return this._modelName
  }
}
