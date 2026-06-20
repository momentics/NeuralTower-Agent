import type { ContextProvider, ContextItem } from "./types"
import { fetchUrl, htmlToText } from "../../../network/UrlFetcher"

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

      const result = await fetchUrl(trimmed, { timeout: 15000, maxLength: 12000 })

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
      } catch {
        try {
          url = new URL(`https://${trimmed}`)
        } catch {
          return [{ content: `Некорректный URL: ${trimmed}`, name: "url", description: "error" }]
        }
      }

      const title = result.title ?? url.pathname

      return [{
        content: `Источник: ${url.toString()}\n\n${text.slice(0, 12000)}`,
        name: title,
        description: url.toString(),
      }]
    },
  }
}
