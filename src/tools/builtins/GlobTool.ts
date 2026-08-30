import type { IToolSchema } from "../ITool"
import type { IToolResult } from "../../agent/AgentTypes"
import { glob as globFn } from "glob"
import { FilesystemTool } from "./FilesystemTool"
import { str, strOpt } from "../ToolArgs"
import { GLOB_MAX_RESULTS } from "../../core/Config"

/**
 * Найти файлы по шаблону glob.
 */
export class GlobTool extends FilesystemTool {
  /** Максимальное число результатов (тестовая точка доступа). */
  static maxResults: number = GLOB_MAX_RESULTS

  name = "glob"
  description = "Найти файлы, соответствующие шаблону glob."
  category = "filesystem"
  isSafe = true

  schema: IToolSchema = {
    name: "glob",
    description: "Поиск файлов по шаблону",
    parameters: {
      pattern: { type: "string", description: "Шаблон glob, напр. **/*.ts" },
      path: { type: "string", description: "Корневая директория для поиска" },
    },
    required: ["pattern"],
  }

  protected async doExecute(args: Record<string, unknown>, signal?: AbortSignal): Promise<IToolResult> {
    const pattern = str(args, "pattern")
    if (!pattern) return { output: "Не указан шаблон glob", success: false }

    const root = strOpt(args, "path") ?? "."
    const result = await this.resolvePath(root)
    if ("error" in result) return { output: result.error, success: false }

    // node_modules исключаем явно: glob не уважает .gitignore, и на большом
    // репозитории широкий шаблон вернёт десятки тысяч путей из зависимостей.
    const files = await globFn(pattern, {
      cwd: result.resolved,
      absolute: true,
      ignore: ["**/node_modules/**"],
    })

    // Лимит числа результатов: на репозитории 10k+ файлов вывод может
    // достигать нескольких МБ и раздувать контекст модели.
    if (files.length > GlobTool.maxResults) {
      return {
        output:
          files.slice(0, GlobTool.maxResults).join("\n") +
          `\n… (обрезано: показано ${GlobTool.maxResults} из ${files.length}; сузьте шаблон)`,
        success: true,
      }
    }

    return {
      output: files.length > 0 ? files.join("\n") : "Совпадений не найдено",
      success: true,
    }
  }
}
