import * as vscode from "vscode"
import type { IBackend, BackendConfig, ChatMessage } from "../core/IBackend"
import { BackendError, ConnectionError, TimeoutError } from "../core/errors"

/**
 * Бэкенд Neural Tower. Подключается к локальному серверу
 * SGLang/vLLM на аппаратном узле Neural Tower (4× V100, 128 ГБ HBM2).
 *
 * Использует API-эндпоинты, совместимые с OpenAI,
 * предоставляемые SGLang. Можно заменить на llama.cpp или
 * любой другой HTTP-сервер вывода, изменив API-эндпоинты и формат запросов.
 */
export class NeuralTowerBackend implements IBackend {
  private static readonly DEFAULT_URL = "http://localhost:30000"
  private static readonly DEFAULT_MODEL = "qwen3.6-27b"

  async getConfig(): Promise<BackendConfig> {
    const cfg = vscode.workspace.getConfiguration("neuralTowerAgent")
    return {
      url: cfg.get<string>("neuralTowerUrl", NeuralTowerBackend.DEFAULT_URL)!,
      model: cfg.get<string>("model", NeuralTowerBackend.DEFAULT_MODEL)!,
      maxRetries: cfg.get<number>("maxRetries", 3)!,
      timeoutMs: cfg.get<number>("timeoutMs", 60000)!,
    }
  }

  async updateConfig(partial: Partial<BackendConfig>): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("neuralTowerAgent")
    if (partial.url) await cfg.update("neuralTowerUrl", partial.url, true)
    if (partial.model) await cfg.update("model", partial.model, true)
    if (partial.maxRetries !== undefined) await cfg.update("maxRetries", partial.maxRetries, true)
    if (partial.timeoutMs !== undefined) await cfg.update("timeoutMs", partial.timeoutMs, true)
  }

  async listModels(): Promise<string[]> {
    const cfg = await this.getConfig()
    const res = await this.request(`${cfg.url}/v1/models`)
    const data = (await res.json()) as { data?: Array<{ id: string }> }
    return data.data?.map((m) => m.id) ?? []
  }

  async healthCheck(): Promise<boolean> {
    try {
      const cfg = await this.getConfig()
      await this.request(`${cfg.url}/v1/models`)
      return true
    } catch {
      return false
    }
  }

  async chat(
    messages: ChatMessage[],
    onChunk: (text: string) => void,
  ): Promise<ChatMessage> {
    const cfg = await this.getConfig()
    const res = await this.request(`${cfg.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: cfg.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        stream: true,
      }),
    })

    if (!res.body) throw new BackendError("Пустой ответ от Neural Tower")

    let full = ""
    const reader = res.body.getReader()
    const dec = new TextDecoder()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = dec.decode(value, { stream: true })
        for (const line of chunk.split("\n").filter(Boolean)) {
          if (line.startsWith("data: ")) {
            const payload = line.slice(6)
            if (payload === "[DONE]") continue
            try {
              const p = JSON.parse(payload) as {
                choices?: Array<{ delta?: { content?: string } }>
              }
              const content = p.choices?.[0]?.delta?.content
              if (content) {
                full += content
                onChunk(content)
              }
            } catch { /* пропустить некорректные данные SSE */ }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    return { role: "assistant", content: full, timestamp: Date.now() }
  }

  /**
   * Одиночный JSON-вызов для структурированных ответов.
   */
  async chatJson<T>(messages: ChatMessage[]): Promise<T> {
    const cfg = await this.getConfig()
    const res = await this.request(`${cfg.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: cfg.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        response_format: { type: "json_object" },
      }),
    })

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = data.choices?.[0]?.message?.content ?? ""

    try {
      return JSON.parse(content) as T
    } catch {
      throw new BackendError(`Бэкенд вернул не-JSON: ${content.slice(0, 200)}`)
    }
  }

  // ── HTTP-помощник с повторными попытками ─────────────────

  private async request(url: string, init?: RequestInit): Promise<Response> {
    const cfg = await this.getConfig()
    let lastError: Error | null = null

    for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000)
        await new Promise((r) => setTimeout(r, delay))
      }

      try {
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs)
        const res = await fetch(url, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer))
        if (!res.ok) {
          const body = await res.text()
          if (res.status === 408) {
            throw new TimeoutError(`HTTP ${res.status}: ${body}`)
          }
          throw new BackendError(`HTTP ${res.status}: ${body}`)
        }
        return res
      } catch (err) {
        if (err instanceof BackendError) {
          lastError = err
        } else if (err instanceof DOMException && err.name === "AbortError") {
          lastError = new TimeoutError("Запрос прерван по таймауту")
        } else {
          const e = err instanceof Error ? err : new Error(String(err))
          lastError = e.cause instanceof Error
            ? new ConnectionError(`${e.message}`)
            : new ConnectionError(`${e.message}`)
        }
      }
    }

    throw lastError ?? new BackendError("Неизвестная ошибка")
  }
}
