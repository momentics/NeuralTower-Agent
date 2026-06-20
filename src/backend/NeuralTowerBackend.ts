import * as vscode from "vscode"
import type { IBackend, BackendConfig, ChatMessage, ToolCall, ToolDefinition } from "../core/IBackend"
import { BackendError, ConnectionError, TimeoutError } from "../core/errors"
import { loadDefaultBackendConfig } from "../core/config"

const RETRY_BASE_DELAY_MS = 1000
const RETRY_MAX_DELAY_MS = 10000

/**
 * Бэкенд Neural Tower. Подключается к локальному серверу
 * SGLang/vLLM на аппаратном узле Neural Tower (4× V100, 128 ГБ HBM2).
 *
 * Использует API-эндпоинты, совместимые с OpenAI,
 * предоставляемые SGLang. Можно заменить на llama.cpp или
 * любой другой HTTP-сервер вывода, изменив API-эндпоинты и формат запросов.
 */
export class NeuralTowerBackend implements IBackend {
  private config: BackendConfig

  constructor(config?: BackendConfig) {
    this.config = config ?? loadDefaultBackendConfig()
  }

  async getConfig(): Promise<BackendConfig> {
    return { ...this.config }
  }

  async updateConfig(partial: Partial<BackendConfig>): Promise<void> {
    if (partial.url !== undefined) this.config.url = partial.url
    if (partial.model !== undefined) this.config.model = partial.model
    if (partial.maxRetries !== undefined) this.config.maxRetries = partial.maxRetries
    if (partial.timeoutMs !== undefined) this.config.timeoutMs = partial.timeoutMs

    const cfg = vscode.workspace.getConfiguration("neuralTowerAgent")
    if (partial.url !== undefined) await cfg.update("neuralTowerUrl", partial.url, true)
    if (partial.model !== undefined) await cfg.update("model", partial.model, true)
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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`Проверка здоровья бэкенда не выполнена: ${msg}`)
      return false
    }
  }

  async chat(
    messages: ChatMessage[],
    onChunk: (text: string) => void,
    tools?: ToolDefinition[],
  ): Promise<ChatMessage> {
    const cfg = await this.getConfig()

    const body: Record<string, unknown> = {
      model: cfg.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
    }

    if (tools && tools.length > 0) {
      body.tools = tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: toOpenAIParameters(t.parameters),
        },
      }))
    }

    const res = await this.request(`${cfg.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })

    if (!res.body) throw new BackendError("Пустой ответ от Neural Tower")

    let full = ""
    const toolCalls = new Map<number, ToolCall>()
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
              const msg = err instanceof Error ? err.message : String(err)
              console.error(`Некорректные данные SSE: ${msg}`)
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    const result: ChatMessage = { role: "assistant", content: full, timestamp: Date.now() }
    if (toolCalls.size > 0) {
      result.toolCalls = Array.from(toolCalls.values())
    }
    return result
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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new BackendError(`Бэкенд вернул не-JSON: ${content.slice(0, 200)} (${msg})`)
    }
  }

  // ── HTTP-помощник с повторными попытками ─────────────────

  private async request(url: string, init?: RequestInit): Promise<Response> {
    const cfg = await this.getConfig()
    let lastError: Error | null = null

    for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = Math.min(RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1), RETRY_MAX_DELAY_MS)
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
      } catch (err: unknown) {
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

/**
 * Преобразовать параметры ToolDefinition в формат OpenAI JSON Schema.
 */
function toOpenAIParameters(parameters: object): object {
  const schema = parameters as { parameters?: Record<string, unknown>; required?: string[]; type?: string }
  const result: Record<string, unknown> = {}
  if (schema.parameters) {
    result.properties = schema.parameters
  }
  if (schema.required) {
    result.required = schema.required
  }
  result.type = schema.type ?? "object"
  return result
}
