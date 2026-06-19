/**
 * Инструмент для семантического поиска по коду.
 *
 * Позволяет агенту искать релевантные фрагменты кода
 * по смыслу, а не только по ключевым словам.
 */

import type { ITool, ToolSchema } from "../../tools/ITool"
import type { ToolResult } from "../../agent/AgentTypes"
import type { CodebaseSearch } from "../../repo/CodebaseSearch"

/**
 * Инструмент поиска по репозиторию.
 */
export class CodebaseSearchTool implements ITool {
  name = "codebase_search"
  description =
    "Семантический поиск по коду. Ищет релевантные фрагменты кода по смыслу запроса. Например: 'функция для авторизации', 'класс для работы с базой данных'."
  category = "search"
  isSafe = true

  schema: ToolSchema = {
    name: "codebase_search",
    description: "Поиск по коду репозитория",
    parameters: {
      query: {
        type: "string",
        description: "Запрос для поиска (на естественном языке)",
      },
      maxResults: {
        type: "number",
        description: "Максимальное число результатов",
        default: 5,
      },
      mode: {
        type: "string",
        description: "Режим поиска: semantic, keyword, hybrid",
        enum: ["semantic", "keyword", "hybrid"],
        default: "hybrid",
      },
    },
    required: ["query"],
  }

  constructor(private readonly search: CodebaseSearch) {}

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const query = String(args.query ?? "").trim()
    if (!query) {
      return { output: "Не указан запрос для поиска", success: false }
    }

    const maxResults = Math.min(Number(args.maxResults ?? 5), 20)
    const mode = (args.mode as string) ?? "hybrid"

    try {
      const results = await this.search.search(query, {
        topK: maxResults,
        searchMode: mode as "semantic" | "keyword" | "hybrid",
      })

      if (results.length === 0) {
        return {
          output: "Ничего не найдено по запросу: \"" + query + "\"",
          success: false,
        }
      }

      let output = "Найдено " + results.length + " результатов по запросу: \"" + query + "\"\n\n"

      for (let i = 0; i < results.length; i++) {
        const r = results[i]
        output += "--- Результат " + (i + 1) + " (оценка: " + r.score.toFixed(3) + ", источник: " + r.source + ") ---\n"
        output += "Файл: " + r.chunk.filePath + "\n"
        output += "Строки: " + r.chunk.startLine + "-" + r.chunk.endLine + "\n"

        if (r.chunk.symbolName) {
          output += "Символ: " + r.chunk.symbolName
          if (r.chunk.parentName) {
            output += " (" + r.chunk.parentName + ")"
          }
          output += "\n"
        }

        if (r.chunk.signature) {
          output += "Подпись: " + r.chunk.signature + "\n"
        }

        output += "`" + r.chunk.language + "\n" + r.chunk.content + "\n`\n\n"
      }

      return { output, success: true }
    } catch (err) {
      return {
        output: "Ошибка поиска: " + (err instanceof Error ? err.message : String(err)),
        success: false,
      }
    }
  }
}
