/**
 * Провайдер эмбеддингов для Neural Tower.
 *
 * Использует эндпоинт /v1/embeddings сервера Neural Tower
 * (SGLang/vLLM), совместимый с OpenAI API.
 *
 * Если эндпоинт недоступен, возвращается пустой массив —
 * в этом случае семантический поиск будет отключён.
 */

import type { IEmbeddingProvider, EmbeddingProviderConfig } from "./IEmbeddingProvider"
import { BackendError, ConnectionError } from "../core/errors"

/**
 * Провайдер эмбеддингов Neural Tower.
 */
export class NeuralTowerEmbeddingProvider implements IEmbeddingProvider {
  private config: EmbeddingProviderConfig
  private _available = false
  private _dimension = 1536
  private _modelName = "nomic-embed-text"

  constructor(config?: Partial<EmbeddingProviderConfig>) {
    this.config = {
      baseUrl: config?.baseUrl ?? "http://localhost:30000",
      model: config?.model ?? "nomic-embed-text",
      batchSize: config?.batchSize ?? 256,
      timeoutMs: config?.timeoutMs ?? 30000,
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
        throw new BackendError("HTTP " + res.status + ": " + body)
      }

      const data = (await res.json()) as {
        data?: Array<{ embedding?: number[] }>
      }

      return (
        data.data?.map((d) => d.embedding ?? new Array(this._dimension).fill(0)) ??
        texts.map(() => new Array(this._dimension).fill(0))
      )
    } catch (err) {
      if (err instanceof BackendError) throw err
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new ConnectionError("Запрос эмбеддинга прерван по таймауту")
      }
      throw new ConnectionError("Ошибка эмбеддинга: " + String(err))
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
    } catch {
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
