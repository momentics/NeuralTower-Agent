export interface FetchUrlOptions {
  /** Тайм-аут в миллисекундах */
  timeout?: number
  /** Заголовки запроса */
  headers?: Record<string, string>
  /** Максимальная длина ответа */
  maxLength?: number
}

export interface FetchUrlResult {
  /** Содержимое ответа */
  text: string
  /** Заголовок страницы (если HTML) */
  title: string | null
  /** Статус HTTP */
  status: number
  /** Успешен ли запрос */
  ok: boolean
  /** Текст статуса */
  statusText?: string
}

const DEFAULT_TIMEOUT = 15000
const DEFAULT_MAX_LENGTH = 12000
const DEFAULT_USER_AGENT = "NeuralTower-Agent/0.1"

/** Разрешённые протоколы для загрузки. */
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"])

export async function fetchUrl(
  urlString: string,
  options: FetchUrlOptions = {},
): Promise<FetchUrlResult> {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT
  const maxLength = options.maxLength ?? DEFAULT_MAX_LENGTH
  const headers: Record<string, string> = {
    "User-Agent": DEFAULT_USER_AGENT,
    ...options.headers,
  }

  let url: URL
  try {
    url = new URL(urlString)
  } catch (_err: unknown) {
    try {
      url = new URL(`https://${urlString}`)
    } catch (_err2: unknown) {
      return {
        text: `Некорректный URL: ${urlString}`,
        title: null,
        status: 0,
        ok: false,
      }
    }
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return {
      text: `Протокол "${url.protocol}" не разрешён`,
      title: null,
      status: 0,
      ok: false,
    }
  }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers,
      redirect: "follow",
    }).finally(() => clearTimeout(timer))

    const text = await response.text()
    const title = extractTitle(text)

    return {
      text: text.slice(0, maxLength),
      title,
      status: response.status,
      ok: response.ok,
      statusText: response.statusText,
    }
  } catch (err: unknown) {
    return {
      text: `Ошибка загрузки: ${err instanceof Error ? err.message : String(err)}`,
      title: null,
      status: 0,
      ok: false,
    }
  }
}

function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  return m ? m[1].trim() : null
}

export function htmlToText(html: string): string {
  let t = html.replace(/<script[\s\S]*?<\/script>/gi, "")
  t = t.replace(/<style[\s\S]*?<\/style>/gi, "")
  t = t.replace(/<br\s*\/?>/gi, "\n")
  t = t.replace(/<\/?(p|div|li|tr|h[1-6])[^>]*>/gi, "\n")
  t = t.replace(/<[^>]+>/g, "")
  t = t.replace(/&nbsp;/g, " ")
  t = t.replace(/&amp;/g, "&")
  t = t.replace(/&lt;/g, "<")
  t = t.replace(/&gt;/g, ">")
  t = t.replace(/&quot;/g, '"')
  t = t.replace(/\u00a0/g, " ")
  t = t.replace(/\n{3,}/g, "\n\n")
  return t.trim()
}
