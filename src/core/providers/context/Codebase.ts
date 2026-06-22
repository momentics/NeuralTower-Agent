import type { IContextProvider } from "./Types"
import type { ICodebaseSearch } from "../../../repo/CodebaseSearch"
import { createContextProvider } from "./WithErrorHandling"

const CODEBASE_TOPK = 5
const CODEBASE_MAX_CONTENT = 2000

/**
 * Контекстный провайдер для семантического поиска по коду.
 *
 * Позволяет использовать @codebase для поиска релевантных
 * фрагментов кода по смыслу запроса.
 */
export function makeCodebaseProvider(
  search: ICodebaseSearch,
): IContextProvider {
  return createContextProvider(
    {
      name: "codebase",
      displayTitle: "Кодовая база",
      description: "Семантический поиск по коду репозитория",
      type: "query",
    },
    async (trimmed) => {
      const results = await search.search(trimmed, {
        topK: CODEBASE_TOPK,
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
        lines.push(r.chunk.content.slice(0, CODEBASE_MAX_CONTENT))
        lines.push("`")
        lines.push("")
      }

      return [{
        content: "Семантический поиск по коду для \"" + trimmed + "\":\n\n" + lines.join("\n"),
        name: "Codebase: " + trimmed,
        description: String(results.length) + " результатов",
      }]
    },
  )
}
