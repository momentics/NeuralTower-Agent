import type { ITool, ToolSchema } from "../ITool"
import type { ToolResult } from "../../agent/AgentTypes"
import { glob as globFn } from "glob"

/**
 * Найти файлы по шаблону glob.
 */
export class GlobTool implements ITool {
  name = "glob"
  description = "Найти файлы, соответствующие шаблону glob."
  category = "filesystem"
  isSafe = true

  schema: ToolSchema = {
    name: "glob",
    description: "Поиск файлов по шаблону",
    parameters: {
      pattern: { type: "string", description: "Шаблон glob, напр. **/*.ts" },
      path: { type: "string", description: "Корневая директория для поиска" },
    },
    required: ["pattern"],
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const pattern = String(args.pattern ?? "")
    const root = args.path ? String(args.path) : "."
    try {
      const files = await globFn(pattern, { cwd: root, absolute: true })
      return {
        output: files.length > 0 ? files.join("\n") : "Совпадений не найдено",
        success: true,
      }
    } catch (err) {
      return {
        output: `Поиск не выполнен: ${err instanceof Error ? err.message : String(err)}`,
        success: false,
      }
    }
  }
}
