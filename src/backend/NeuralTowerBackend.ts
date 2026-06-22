import type { IBackend, IBackendConfig, IChatMessage, IToolCall, IToolDefinition } from "../core/IBackend"
import { BackendError, ConnectionError, TimeoutError, errorMessage } from "../core/Errors"
import { loadDefaultBackendConfig } from "../core/Config"
import { createDomainLogger } from "../core/Logger"

const log = createDomainLogger("Backend")

const RETRY_BASE_DELAY_MS = 1000
const RETRY_MAX_DELAY_MS = 10000
const SSE_MAX_RESPONSE_CHARS = 5_000_000

/**
 * Бэкенд Neural Tower. Подключается к локальному серверу
 * SGLang/vLLM на аппаратном узле Neural Tower (4× V100, 128 ГБ HBM2).
 *
 * Использует API-эндпоинты, совместимые с OpenAI,
 * предоставляемые SGLang. Можно заменить на llama.cpp или
 * любой другой HTTP-сервер вывода, изменив API-эндпоинты и формат запросов.
 */
export class NeuralTowerBackend implements IBackend {
  private config: IBackendConfig

  constructor(
    config?: IBackendConfig,
    private readonly onConfigChange?: (partial: Partial<IBackendConfig>) => void,
  ) {
    this.config = config ?? loadDefaultBackendConfig()
  }

  async getConfig(): Promise<IBackendConfig> {
    return { ...this.config }
  }

  async updateConfig(partial: Partial<IBackendConfig>): Promise<void> {
    if (partial.url !== undefined) {
      if (!validateUrl(partial.url)) {
        throw new BackendError(`Неверный URL: ${partial.url}`)
      }
      this.config.url = partial.url
    }
    if (partial.model !== undefined) this.config.model = partial.model
    if (partial.maxRetries !== undefined) this.config.maxRetries = partial.maxRetries
    if (partial.timeoutMs !== undefined) this.config.timeoutMs = partial.timeoutMs

    this.onConfigChange?.(partial)
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
    } catch (err: unknown) {
      const msg = errorMessage(err)
      log.error(`Проверка здоровья бэкенда не выполнена: ${msg}`)
      return false
    }
  }

  async chat(
    messages: IChatMessage[],
    onChunk: (text: string) => void,
    tools?: IToolDefinition[],
    signal?: AbortSignal,
  ): Promise<IChatMessage> {
    const cfg = await this.getConfig()

    const body: Record<string, unknown> = {
      model: cfg.model,
      messages: mapMessages(messages),
      stream: true,
    }

    if (tools && tools.length > 0) {
      body.tools = tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }))
    }

    const res = await this.request(`${cfg.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }, signal)

    if (!res.body) throw new BackendError("Пустой ответ от Neural Tower")

    let full = ""
    const toolCalls = new Map<number, IToolCall>()
    const reader = res.body.getReader()
    const dec = new TextDecoder()

    try {
      while (true) {
        if (signal?.aborted) throw new DOMException("Запрос прерван", "AbortError")
        const { done, value } = await reader.read()
        if (done) break
        const chunk = dec.decode(value, { stream: true })
        for (const line of chunk.split("\n").filter(Boolean)) {
          if (line.startsWith("data: ")) {
            const payload = line.slice(6)
            if (payload === "[DONE]") continue
            try {
              const p = JSON.parse(payload) as {
                choices?: Array<{
                  delta?: {
                    content?: string
                    tool_calls?: Array<{
                      index: number
                      id?: string
                      type?: string
                      function?: {
                        name?: string
                        arguments?: string
                      }
                    }>
                  }
                }>
              }
              const delta = p.choices?.[0]?.delta
              if (!delta) continue

             const content = delta.content
               if (content) {
                 if (full.length + content.length > SSE_MAX_RESPONSE_CHARS) {
                   throw new BackendError("Ответ бэкенда превышает лимит размера")
                 }
                 full += content
                 onChunk(content)
               }

              if (delta.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const idx = tc.index
                  let existing = toolCalls.get(idx)
                  if (!existing) {
                    existing = {
                      id: tc.id ?? "",
                      toolName: tc.function?.name ?? "",
                      arguments: "",
                    }
                    toolCalls.set(idx, existing)
                  }
                  if (tc.id) existing.id = tc.id
                  if (tc.function?.name) existing.toolName = tc.function.name
                  if (tc.function?.arguments) existing.arguments += tc.function.arguments
                }
              }
            } catch (err: unknown) {
              const msg = errorMessage(err)
              log.error(`Некорректные данные SSE: ${msg}`)
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
      if (typeof res.body.cancel === "function") {
        res.body.cancel().catch(() => {})
      }
    }

    const result: IChatMessage = { role: "assistant", content: full, timestamp: Date.now() }
    if (toolCalls.size > 0) {
      result.toolCalls = Array.from(toolCalls.values())
    }
    return result
  }

  /**
   * Одиночный JSON-вызов для структурированных ответов.
   */
  async chatJson<T>(messages: IChatMessage[]): Promise<T> {
    const cfg = await this.getConfig()
    const res = await this.request(`${cfg.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: cfg.model,
        messages: mapMessages(messages),
        response_format: { type: "json_object" },
      }),
    })

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = data.choices?.[0]?.message?.content ?? ""

    try {
      return JSON.parse(content) as T
    } catch (err: unknown) {
      const msg = errorMessage(err)
      throw new BackendError(`Бэкенд вернул не-JSON: ${content.slice(0, 200)} (${msg})`)
    }
  }

  // ── HTTP-помощник с повторными попытками ─────────────────

  private async request(url: string, init?: RequestInit, externalSignal?: AbortSignal): Promise<Response> {
    const cfg = await this.getConfig()
    let lastError: Error | null = null

    for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
      if (attempt > 0) {
        const baseDelay = Math.min(RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1), RETRY_MAX_DELAY_MS)
        const jitter = baseDelay * (0.5 + Math.random() * 0.5)
        await new Promise((r) => setTimeout(r, jitter))
      }

      try {
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs)

        const signals: AbortSignal[] = [ctrl.signal]
        if (externalSignal) signals.push(externalSignal)
        const combined = AbortSignal.any(signals)

        const res = await fetch(url, { ...init, signal: combined }).finally(() => clearTimeout(timer))
        if (!res.ok) {
          const body = await res.text()
          if (res.status === 408) {
            throw new TimeoutError(`HTTP ${res.status}: ${body}`)
          }
          throw new BackendError(`HTTP ${res.status}: ${body}`)
        }
        return res
      } catch (err: unknown) {
        if (err instanceof BackendError) {
          lastError = err
        } else if (err instanceof DOMException && err.name === "AbortError") {
          if (externalSignal?.aborted) {
            throw err
          }
          lastError = new TimeoutError("Запрос прерван по таймауту")
        } else {
          const e = err instanceof Error ? err : new Error(String(err))
          lastError = new ConnectionError(e.message)
        }
      }
    }

    throw lastError ?? new BackendError("Неизвестная ошибка")
  }
}

/** Преобразовать IChatMessage[] в формат API (без timestamp и toolCalls). */
function mapMessages(messages: IChatMessage[]): Array<{ role: string; content: string }> {
  return messages.map((m) => ({ role: m.role, content: m.content }))
}

/** Проверить, что URL валидный и использует HTTP/HTTPS протокол. */
function validateUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === "http:" || parsed.protocol === "https:"
  } catch {
    return false
  }
}
