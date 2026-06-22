import type { ContextProvider, ContextItem } from "./Types"
import { fetchUrl, htmlToText } from "../../../network/UrlFetcher"

const CONTEXT_TIMEOUT_MS = 15000
const CONTEXT_MAX_TEXT_LENGTH = 12000

export function makeUrlProvider(): ContextProvider {
  return {
    description: {
      name: "url",
      displayTitle: "URL",
      description: "Содержимое веб-страницы по URL",
      type: "query",
    },
    async resolve(query: string): Promise<ContextItem[]> {
      const trimmed = query.trim()
      if (!trimmed) return []

      const result = await fetchUrl(trimmed, { timeout: CONTEXT_TIMEOUT_MS, maxLength: CONTEXT_MAX_TEXT_LENGTH })

      if (!result.ok && result.status === 0) {
        return [{ content: result.text, name: "url", description: "error" }]
      }

      if (!result.ok) {
        return [{ content: `HTTP ${result.status}: ${result.statusText}`, name: "url", description: "error" }]
      }

      const text = htmlToText(result.text)
      let url: URL
      try {
        url = new URL(trimmed)
      } catch (_err: unknown) {
        try {
          url = new URL(`https://${trimmed}`)
        } catch (_err2: unknown) {
          return [{ content: `Некорректный URL: ${trimmed}`, name: "url", description: "error" }]
        }
      }

      const title = result.title ?? url.pathname

      return [{
        content: `Источник: ${url.toString()}\n\n${text.slice(0, CONTEXT_MAX_TEXT_LENGTH)}`,
        name: title,
        description: url.toString(),
      }]
    },
  }
}
