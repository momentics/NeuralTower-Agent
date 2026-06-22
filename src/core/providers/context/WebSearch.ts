import type { IContextProvider } from "./Types"
import { createContextProvider } from "./WithErrorHandling"
import { errorMessage } from "../../Errors"

const CONTEXT_TIMEOUT_MS = 15000
const WEB_SEARCH_MAX_TOPICS = 8

export function makeWebSearchProvider(
  fetchFn: typeof fetch = fetch,
): IContextProvider {
  return createContextProvider(
    {
      name: "web",
      displayTitle: "Поиск в сети",
      description: "Поиск в интернете",
      type: "query",
    },
    async (trimmed) => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), CONTEXT_TIMEOUT_MS)
      let resp: Response
      try {
        resp = await fetchFn(
          `https://api.duckduckgo.com/?q=${encodeURIComponent(trimmed)}&format=json`,
          { signal: controller.signal },
        )
      } catch (err: unknown) {
        clearTimeout(timer)
        return [{ content: `Ошибка поиска: ${errorMessage(err)}`, name: "web", description: "error" }]
      }
      clearTimeout(timer)

      if (!resp.ok) {
        return [{ content: `Поиск недоступен: HTTP ${resp.status}`, name: "web", description: "error" }]
      }

      const data = await resp.json() as Record<string, unknown>
      const abstract = (data.Abstract as string) ?? "Результаты не найдены"
      const related = ((data.RelatedTopics as unknown[]) ?? [])
        .slice(0, WEB_SEARCH_MAX_TOPICS)
        .map((t: unknown) => {
          if (typeof t === "string") return t
          if (typeof t === "object" && t !== null) {
            const obj = t as Record<string, unknown>
            return (obj.Text as string) ?? (obj.FirstURL as string) ?? ""
          }
          return ""
        })
        .filter(Boolean) as string[]

      return [{
        content: `Запрос: ${trimmed}\n\n${abstract}\n\nСвязанные:\n${related.map((r: string, i: number) => `${i + 1}. ${r}`).join("\n")}`,
        name: `Поиск: ${trimmed.slice(0, 40)}`,
        description: `${related.length} результатов`,
      }]
    },
  )
}
