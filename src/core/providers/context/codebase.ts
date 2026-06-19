import type { ContextProvider, ContextItem } from "./types"
import type { CodebaseSearch } from "../../../repo/CodebaseSearch"

/**
 * Контекстный провайдер для семантического поиска по коду.
 *
 * Позволяет использовать @codebase для поиска релевантных
 * фрагментов кода по смыслу запроса.
 */
export function makeCodebaseProvider(
  search: CodebaseSearch,
): ContextProvider {
  return {
    description: {
      name: "codebase",
      displayTitle: "Codebase",
      description: "Семантический поиск по коду репозитория",
      type: "query",
    },
    async resolve(query: string): Promise<ContextItem[]> {
      const trimmed = query.trim()
      if (!trimmed) return []

      try {
        const results = await search.search(trimmed, {
          topK: 5,
          searchMode: "hybrid",
        })

        if (results.length === 0) {
          return [{
            content: "Результаты не найдены для \"" + trimmed + "\"",
            name: "codebase",
            description: "not found",
          }]
        }

        const lines: string[] = []

        for (const r of results) {
          lines.push("--- " + r.chunk.filePath + " (строки " + r.chunk.startLine + "-" + r.chunk.endLine + ", оценка: " + r.score.toFixed(3) + ") ---")

          if (r.chunk.symbolName) {
            lines.push("Символ: " + r.chunk.symbolName)
            if (r.chunk.parentName) {
              lines.push("Родитель: " + r.chunk.parentName)
            }
          }

          if (r.chunk.signature) {
            lines.push("Подпись: " + r.chunk.signature)
          }

          lines.push("")
          lines.push("`" + r.chunk.language)
          lines.push(r.chunk.content.slice(0, 2000))
          lines.push("`")
          lines.push("")
        }

        return [{
          content: "Семантический поиск по коду для \"" + trimmed + "\":\n\n" + lines.join("\n"),
          name: "Codebase: " + trimmed,
          description: String(results.length) + " результатов",
        }]
      } catch {
        return [{
          content: "Ошибка поиска по коду для \"" + trimmed + "\"",
          name: "codebase",
          description: "error",
        }]
      }
    },
  }
}
