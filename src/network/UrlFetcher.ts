export interface IFetchUrlOptions {
  /** Тайм-аут в миллисекундах */
  timeout?: number
  /** Заголовки запроса */
  headers?: Record<string, string>
  /** Максимальная длина ответа */
  maxLength?: number
  /** Сигнал отмены */
  signal?: AbortSignal
}

import { errorMessage } from "../core/Errors"

export interface IFetchUrlResult {
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

import { NET_DEFAULT_TIMEOUT_MS, NET_DEFAULT_MAX_LENGTH, NET_DEFAULT_USER_AGENT, NET_MAX_REDIRECTS } from "../core/Config"

const DEFAULT_TIMEOUT_MS = NET_DEFAULT_TIMEOUT_MS
const DEFAULT_MAX_LENGTH = NET_DEFAULT_MAX_LENGTH
const DEFAULT_USER_AGENT = NET_DEFAULT_USER_AGENT
const MAX_REDIRECTS = NET_MAX_REDIRECTS

/** Разрешённые протоколы для загрузки. */
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"])

/**
 * Проверить, является ли IP-адрес приватным или зарезервированным.
 * Защищает от SSRF-атак через redirect на внутренние ресурсы.
 */
function isPrivateOrReservedIp(host: string): boolean {
  if (!host) return false

  const ipMatch = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipMatch) {
    const octets = ipMatch.slice(1).map(Number)

    // Проверить каждый октет на вхождение в [0, 255]
    for (const octet of octets) {
      if (octet > 255) return false
    }

    const [a, b] = octets

    if (a === 10) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 127) return true
    if (a === 0) return true
    if (a === 169 && b === 254) return true
    if (a === 100 && b >= 64 && b <= 127) return true
    if (a >= 224) return true
    return false
  }

  const hostname = host.toLowerCase()
  if (hostname === "localhost") return true
  if (hostname.endsWith(".local")) return true
  if (hostname.endsWith(".internal")) return true
  if (hostname.endsWith(".arpa")) return true

  return false
}

export async function fetchUrl(
  urlString: string,
  options: IFetchUrlOptions = {},
): Promise<IFetchUrlResult> {
  if (options.signal?.aborted) {
    return {
      text: "Операция отменена",
      title: null,
      status: 0,
      ok: false,
    }
  }

  const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS
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

  if (isPrivateOrReservedIp(url.hostname)) {
    return {
      text: `Доступ к внутренним адресам запрещён: ${url.hostname}`,
      title: null,
      status: 0,
      ok: false,
    }
  }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)

    const signals: AbortSignal[] = [controller.signal]
    if (options.signal) signals.push(options.signal)
    const combinedSignal = AbortSignal.any(signals)

    let redirectCount = 0
    let response = await fetch(url.toString(), {
      signal: combinedSignal,
      headers,
      redirect: "manual",
    }).finally(() => clearTimeout(timer))

    while (response.status === 301 || response.status === 302 || response.status === 307 || response.status === 308) {
      redirectCount++
      if (redirectCount > MAX_REDIRECTS) {
        return {
          text: `Превышено число редиректов (${MAX_REDIRECTS})`,
          title: null,
          status: 0,
          ok: false,
        }
      }

      const location = response.headers.get("location")
      if (!location) break

      let redirectUrl: URL
      try {
        redirectUrl = new URL(location, url.toString())
      } catch {
        break
      }

      if (!ALLOWED_PROTOCOLS.has(redirectUrl.protocol)) break
      if (isPrivateOrReservedIp(redirectUrl.hostname)) {
        return {
          text: `Редирект на внутренний адрес запрещён: ${redirectUrl.hostname}`,
          title: null,
          status: 0,
          ok: false,
        }
      }

      const nextSignals: AbortSignal[] = [controller.signal]
      if (options.signal) nextSignals.push(options.signal)
      const nextSignal = AbortSignal.any(nextSignals)

      response = await fetch(redirectUrl.toString(), {
        signal: nextSignal,
        headers,
        redirect: "manual",
      })
    }

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
      text: `Ошибка загрузки: ${errorMessage(err)}`,
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
