/**
 * Инструмент для семантического поиска по коду.
 *
 * Позволяет агенту искать релевантные фрагменты кода
 * по смыслу, а не только по ключевым словам.
 */

import type { ToolSchema } from "../ITool"
import type { ToolResult } from "../../agent/AgentTypes"
import type { ICodebaseSearch } from "../../repo/CodebaseSearch"
import { errorMessage } from "../../core/errors"
import { BaseTool } from "./BaseTool"
import { str, strOpt, num, clamp } from "../ToolArgs"

const SEARCH_DEFAULT_MAX_RESULTS = 5
const SEARCH_MAX_RESULTS = 20
const SEARCH_MIN_RESULTS = 1

const VALID_MODES = new Set(["semantic", "keyword", "hybrid"])

/**
 * Инструмент поиска по репозиторию.
 */
export class CodebaseSearchTool extends BaseTool {
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
        default: SEARCH_DEFAULT_MAX_RESULTS,
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

  constructor(private readonly search: ICodebaseSearch) {
    super()
  }

  protected async doExecute(args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
    const query = str(args, "query").trim()
    if (!query) {
      return { output: "Не указан запрос для поиска", success: false }
    }

    const rawMax = num(args, "maxResults", SEARCH_DEFAULT_MAX_RESULTS)
    const maxResults = clamp(rawMax, SEARCH_MIN_RESULTS, SEARCH_MAX_RESULTS)
    const modeRaw = strOpt(args, "mode") ?? "hybrid"
    const mode = VALID_MODES.has(modeRaw) ? modeRaw : "hybrid"

    const results = await this.search.search(query, {
        topK: maxResults,
        searchMode: mode as "semantic" | "keyword" | "hybrid",
      }, signal)

      if (results.length === 0) {
        return {
          output: `Совпадений не найдено по запросу: "${query}"`,
          success: true,
        }
      }

      let output = `Найдено ${results.length} результатов по запросу: "${query}"\n\n`

      for (let i = 0; i < results.length; i++) {
        const r = results[i]
        output += `--- Результат ${i + 1} (оценка: ${r.score.toFixed(3)}, источник: ${r.source}) ---\n`
        output += `Файл: ${r.chunk.filePath}\n`
        output += `Строки: ${r.chunk.startLine}-${r.chunk.endLine}\n`

        if (r.chunk.symbolName) {
          if (r.chunk.parentName) {
            output += `Символ: ${r.chunk.symbolName} (${r.chunk.parentName})\n`
          } else {
            output += `Символ: ${r.chunk.symbolName}\n`
          }
        }

        if (r.chunk.signature) {
          output += `Подпись: ${r.chunk.signature}\n`
        }

        output += `\`\`${r.chunk.language}\n${r.chunk.content}\n\`\`\n\n`
      }

      return { output, success: true }
  }
}
