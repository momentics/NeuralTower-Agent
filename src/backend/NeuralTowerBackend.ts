import * as vscode from "vscode"
import type { IBackend, BackendConfig, ChatMessage } from "../core/IBackend"

/**
 * Бэкенд Neural Tower. Подключается к локальному серверу
 * SGLang/vLLM на аппаратном узле Neural Tower (4× V100, 128 ГБ HBM2).
 *
 * Использует API-конечные точки, совместимые с OpenAI,
 * предоставляемые SGLang. Можно заменить на llama.cpp или
 * любой другой HTTP-сервер вывода, изменив пути конечных точек
 * и формат запросов.
 */
export class NeuralTowerBackend implements IBackend {
  private static readonly DEFAULT_URL = "http://localhost:30000"
  private static readonly DEFAULT_MODEL = "qwen3.6-27b"

  async getConfig(): Promise<BackendConfig> {
    const cfg = vscode.workspace.getConfiguration("nt-agent")
    return {
      url: cfg.get<string>("neuralTowerUrl", NeuralTowerBackend.DEFAULT_URL)!,
      model: cfg.get<string>("model", NeuralTowerBackend.DEFAULT_MODEL)!,
      maxRetries: cfg.get<number>("maxRetries", 3)!,
      timeoutMs: cfg.get<number>("timeoutMs", 60000)!,
    }
  }

  async updateConfig(partial: Partial<BackendConfig>): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("nt-agent")
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

    if (!res.body) throw new Error("Пустой ответ от Neural Tower")

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
   * Нестримерный JSON-вызов для структурированных ответов.
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
      throw new Error(`Бэкенд вернул не-JSON: ${content.slice(0, 200)}`)
    }
  }

  // ── HTTP-помощник ────────────────────────────────────────

  private async request(url: string, init?: RequestInit): Promise<Response> {
    const ctrl = new AbortController()
    const cfg = await this.getConfig()
    const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs)
    const res = await fetch(url, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer))
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`HTTP ${res.status}: ${body}`)
    }
    return res
  }
}
