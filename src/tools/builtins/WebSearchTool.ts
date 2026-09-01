import type { IToolSchema } from "../ITool"
import type { IToolResult } from "../../agent/AgentTypes"
import { BaseTool } from "./BaseTool"
import { str, num, clamp } from "../ToolArgs"
import { fetchUrl, htmlToText } from "../../network/UrlFetcher"
import {
  WEB_SEARCH_TIMEOUT_MS,
  WEB_SEARCH_MAX_HTML_CHARS,
  WEB_SEARCH_MAX_RESULTS,
} from "../../core/Config"

/** Результат веб-поиска. */
interface ISearchResult {
  title: string
  url: string
  snippet: string
}

/**
 * Веб-поиск через HTML-эндпоинт DuckDuckGo (API-ключ не требуется).
 *
 * Возвращает список результатов: заголовок, URL, сниппет.
 * Загрузка — через fetchUrl (SSRF-защита, таймауты, редиректы).
 */
export class WebSearchTool extends BaseTool {
  name = "web_search"
  description =
    "Поиск в вебе: возвращает список результатов (заголовок, URL, сниппет). " +
    "Для чтения конкретного URL используйте web_fetch."
  category = "network"
  isSafe = true

  schema: IToolSchema = {
    name: "web_search",
    description: "Поиск в вебе",
    parameters: {
      query: { type: "string", description: "Поисковый запрос" },
      maxResults: { type: "number", description: "Максимальное число результатов (по умолчанию 5)", default: 5 },
    },
    required: ["query"],
  }

  protected async doExecute(args: Record<string, unknown>, signal?: AbortSignal): Promise<IToolResult> {
    const query = str(args, "query").trim()
    if (!query) return { output: "Не указан поисковый запрос", success: false }
    const max = clamp(num(args, "maxResults", 5), 1, WEB_SEARCH_MAX_RESULTS)

    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
    const res = await fetchUrl(url, {
      timeout: WEB_SEARCH_TIMEOUT_MS,
      maxLength: WEB_SEARCH_MAX_HTML_CHARS,
      signal,
    })
    if (!res.ok) {
      return { output: `Поиск не выполнен: ${res.text.slice(0, 200)}`, success: false }
    }

    const results = parseSearchResults(res.text, max)
    if (results.length === 0) {
      return { output: `Результатов нет по запросу: ${query}`, success: true }
    }

    const lines = results.map((r, i) => {
      const snippet = r.snippet ? ` — ${r.snippet}` : ""
      return `${i + 1}. ${r.title}\n   ${r.url}${snippet}`
    })
    return {
      output: `Результаты поиска по «${query}»:\n\n${lines.join("\n")}`,
      success: true,
    }
  }
}

/**
 * Разобрать HTML-результаты DuckDuckGo:
 * ссылки `class="result__a"` (href + заголовок) и следующие за ними
 * сниппеты `class="result__snippet"`.
 */
export function parseSearchResults(html: string, max: number): ISearchResult[] {
  const results: ISearchResult[] = []
  const re = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) && results.length < max) {
    const url = unwrapRedirect(decodeEntities(m[1]))
    const title = htmlToText(m[2]).trim()
    const tail = html.slice(m.index + m[0].length)
    const sm = tail.match(/<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/)
    const snippet = sm ? htmlToText(sm[1]).trim() : ""
    if (title && url) {
      results.push({ title, url, snippet })
    }
  }
  return results
}

/**
 * DuckDuckGo оборачивает URL результата в редирект
 * (//duckduckgo.com/l/?uddg=<url-encoded>) — развернуть в прямой URL.
 */
function unwrapRedirect(href: string): string {
  const m = href.match(/uddg=([^&]+)/)
  if (m) {
    try {
      return decodeURIComponent(m[1])
    } catch {
      return href
    }
  }
  return href
}

/** Разобрать HTML-сущности в URL. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
}
