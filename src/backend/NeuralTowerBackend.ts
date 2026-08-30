import type { IBackend, IBackendConfig, IChatMessage, IToolCall, IToolDefinition } from "../core/IBackend"
import { AbortError, BackendError, ConnectionError, TimeoutError, errorMessage } from "../core/Errors"
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
  private _resumeCallback: (() => void) | null = null

  constructor(
    config?: IBackendConfig,
    private readonly onConfigChange?: (partial: Partial<IBackendConfig>) => void,
  ) {
    this.config = { ...(config ?? loadDefaultBackendConfig()) }
    this.config.url = normalizeUrl(this.config.url)
  }

  setResumeCallback(cb: () => void): void {
    this._resumeCallback = cb
  }

  async getConfig(): Promise<IBackendConfig> {
    return { ...this.config }
  }

  currentUrl(): string {
    return this.config.url
  }

  async updateConfig(partial: Partial<IBackendConfig>): Promise<void> {
    const normalized: Partial<IBackendConfig> = { ...partial }
    if (normalized.url !== undefined) {
      if (!validateUrl(normalized.url)) {
        throw new BackendError(`Неверный URL: ${normalized.url}`)
      }
      normalized.url = normalizeUrl(normalized.url)
    }
    if (normalized.url !== undefined) this.config.url = normalized.url
    if (normalized.model !== undefined) this.config.model = normalized.model
    if (normalized.maxRetries !== undefined) this.config.maxRetries = normalized.maxRetries
    if (normalized.timeoutMs !== undefined) this.config.timeoutMs = normalized.timeoutMs

    this.onConfigChange?.(normalized)
    this._resumeCallback?.()
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

    const ctrl = new AbortController()
    const onAbort = () => ctrl.abort()
    if (signal) signal.addEventListener("abort", onAbort)

    // Idle-таймаут: прерываем запрос, если данные не поступают timeoutMs.
    // Таймер сбрасывается при каждом сетевом чанке — длинные генерации
    // не убиваются общим таймером.
    let idleTimer: ReturnType<typeof setTimeout> | null = null
    let idleAborted = false
    const resetIdleTimer = (): void => {
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        idleAborted = true
        ctrl.abort()
      }, cfg.timeoutMs)
    }

    // Различаем две причины прерывания: отмена пользователем (исходный
    // `signal`) и idle-таймаут (таймер). Без этого зависший сервер
    // сообщался бы как «задача остановлена пользователем».
    const toDomainError = (err: unknown): Error => {
      if (signal?.aborted) {
        if (err instanceof AbortError) return err
        if (err instanceof DOMException && err.name === "AbortError") return new AbortError()
        return err instanceof Error ? err : new Error(String(err))
      }
      if (idleAborted) {
        return new TimeoutError("Ответ бэкенда прерван по таймауту: данные не поступали в течение заданного времени")
      }
      return err instanceof Error ? err : new Error(String(err))
    }

    // Таймер запускаем ДО запроса: он покрывает и ожидание заголовков
    // ответа (сервер, принявший соединение, но не начавший отвечать),
    // и паузы между чанками. Без этого зависший сервер вешает запрос
    // без какого-либо таймаута.
    let res: Response
    try {
      resetIdleTimer()
      res = await this.request(
        `${cfg.url}/v1/chat/completions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        ctrl.signal,
        { streaming: true },
      )
    } catch (err: unknown) {
      signal?.removeEventListener("abort", onAbort)
      if (idleTimer) clearTimeout(idleTimer)
      throw toDomainError(err)
    }

    if (!res.body) {
      signal?.removeEventListener("abort", onAbort)
      if (idleTimer) clearTimeout(idleTimer)
      throw new BackendError("Пустой ответ от Neural Tower")
    }

    let full = ""
    const toolCalls = new Map<number, IToolCall>()
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buffer = ""
    let sawDone = false

    // Строка SSE может быть разорвана между сетевыми чанками — накапливаем
    // остаток в buffer и разбираем только полные строки.
    const processLine = (rawLine: string): void => {
      const line = rawLine.replace(/\r$/, "")
      if (!line.startsWith("data:")) return
      const payload = line.slice(5).trim()
      if (payload === "[DONE]") {
        sawDone = true
        return
      }
      let p: {
        error?: { message?: string }
        choices?: Array<{
          delta?: {
            content?: string
            tool_calls?: Array<{
              index?: number
              id?: string
              function?: { name?: string; arguments?: string }
            }>
          }
        }>
      }
      try {
        p = JSON.parse(payload)
      } catch {
        log.error(`Некорректные данные SSE: ${payload.slice(0, 200)}`)
        return
      }
      if (p.error) {
        throw new BackendError(`Ошибка бэкенда в потоке: ${p.error.message ?? JSON.stringify(p.error)}`)
      }
      const delta = p.choices?.[0]?.delta
      if (!delta) return
      const content = delta.content
      if (typeof content === "string" && content.length > 0) {
        if (full.length + content.length > SSE_MAX_RESPONSE_CHARS) {
          throw new BackendError("Ответ бэкенда превышает лимит размера")
        }
        full += content
        onChunk(content)
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const idx = typeof tc.index === "number" ? tc.index : 0
          let existing = toolCalls.get(idx)
          if (!existing) {
            // Имя и аргументы накапливаются через += — фрагментированная
            // передача имени не теряется, а первый фрагмент не дублируется.
            existing = { id: tc.id ?? "", toolName: "", arguments: "" }
            toolCalls.set(idx, existing)
          }
          if (tc.id) existing.id = tc.id
          if (tc.function?.name) existing.toolName += tc.function.name
          if (tc.function?.arguments) existing.arguments += tc.function.arguments
        }
      }
    }

    try {
      resetIdleTimer()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        resetIdleTimer()
        buffer += dec.decode(value, { stream: true })
        let nl: number
        while ((nl = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nl)
          buffer = buffer.slice(nl + 1)
          processLine(line)
        }
      }
      if (buffer.trim().length > 0) processLine(buffer)
      if (!sawDone) log.warn("Поток SSE завершён без [DONE]")
    } catch (err: unknown) {
      // Ошибки потока (AbortError от таймера или отмены, сетевой сбой)
      // переводим в доменные: idle-таймаут — TimeoutError, отмена — AbortError.
      // Остальные (BackendError из processLine) проходят без изменений.
      throw toDomainError(err)
    } finally {
      if (idleTimer) clearTimeout(idleTimer)
      reader.releaseLock()
      if (typeof res.body.cancel === "function") {
        res.body.cancel().catch(() => {})
      }
      signal?.removeEventListener("abort", onAbort)
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
  async chatJson<T>(messages: IChatMessage[], signal?: AbortSignal): Promise<T> {
    const cfg = await this.getConfig()
    const res = await this.request(
      `${cfg.url}/v1/chat/completions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: cfg.model,
          messages: mapMessages(messages),
          response_format: { type: "json_object" },
        }),
      },
      signal,
    )

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

  private async request(
    url: string,
    init?: RequestInit,
    externalSignal?: AbortSignal,
    opts?: { streaming?: boolean },
  ): Promise<Response> {
    const cfg = await this.getConfig()
    let lastError: Error | null = null

    for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
      if (attempt > 0) {
        const baseDelay = Math.min(RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1), RETRY_MAX_DELAY_MS)
        const jitter = baseDelay * (0.5 + Math.random() * 0.5)
        await new Promise((r) => setTimeout(r, jitter))
      }

      try {
        // Для стриминга таймаут управляется вызывающим (chat() — idle-таймаут).
        const ctrl = new AbortController()
        const timer = opts?.streaming ? null : setTimeout(() => ctrl.abort(), cfg.timeoutMs)

        const signals: AbortSignal[] = [ctrl.signal]
        if (externalSignal) signals.push(externalSignal)
        const combined = AbortSignal.any(signals)

        const res = await fetch(url, { ...init, signal: combined }).finally(() => {
          if (timer) clearTimeout(timer)
        })
        if (!res.ok) {
          const body = await res.text()
          const detail = body.slice(0, 500)
          if (res.status === 408) {
            throw new TimeoutError(`HTTP ${res.status}: ${detail}`)
          }
          // 5xx и 429 — повторяемые; остальные 4xx — немедленный отказ
          // (повтор не изменит результата: невалидная модель, имена инструментов и т. п.).
          if (res.status >= 500 || res.status === 429) {
            throw new BackendError(`HTTP ${res.status}: ${detail}`, true)
          }
          // Префикс «Ошибка бэкенда: » добавляет handleBackendError — не дублируем его здесь,
          // иначе в UI получится «Ошибка бэкенда: Ошибка бэкенда (HTTP 400): …».
          throw new BackendError(`HTTP ${res.status}: ${detail}`)
        }
        return res
      } catch (err: unknown) {
        // Неповторяемые ошибки пробрасываются сразу.
        if (err instanceof BackendError && !err.retryable) throw err
        if (err instanceof DOMException && err.name === "AbortError") {
          if (externalSignal?.aborted) {
            throw err
          }
          lastError = new TimeoutError("Запрос прерван по таймауту")
        } else if (err instanceof BackendError) {
          // Повторяемые HTTP-ошибки (5xx, 429, 408) сохраняем как есть:
          // класс BackendError доходит до UI без пересборки в ConnectionError.
          lastError = err
        } else {
          const e = err instanceof Error ? err : new Error(String(err))
          lastError = new ConnectionError(e.message)
        }
      }
    }

    throw lastError ?? new BackendError("Неизвестная ошибка")
  }
}

/** Преобразовать IChatMessage[] в формат API (без timestamp). */
function mapMessages(messages: IChatMessage[]): Array<Record<string, unknown>> {
  return messages.map((m) => {
    if (m.role === "tool") {
      return {
        role: "tool",
        tool_call_id: m.toolCallId ?? "",
        name: m.name ?? "",
        content: m.content,
      }
    }
    if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
      return {
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.toolName, arguments: tc.arguments },
        })),
      }
    }
    return { role: m.role, content: m.content }
  })
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

/**
 * Привести URL к каноническому виду: убрать хвостовые слэши.
 * Иначе `${url}/v1/...` даёт двойной слэш (`//v1/...`), который
 * серверы вывода (LM Studio, llama.cpp) отвечают на 404.
 */
function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "")
}
