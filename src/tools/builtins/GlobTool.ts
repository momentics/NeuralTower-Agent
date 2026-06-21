import type { ToolSchema } from "../ITool"
import type { ToolResult } from "../../agent/AgentTypes"
import { glob as globFn } from "glob"
import { FilesystemTool } from "./FilesystemTool"

/**
 * Найти файлы по шаблону glob.
 */
export class GlobTool extends FilesystemTool {
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

  protected async doExecute(args: Record<string, unknown>): Promise<ToolResult> {
    const pattern = String(args.pattern ?? "")
    const root = args.path ? String(args.path) : "."
    const result = this.resolvePath(root)
    if ("error" in result) return { output: result.error, success: false }
    const files = await globFn(pattern, { cwd: result.resolved, absolute: true })
    return {
      output: files.length > 0 ? files.join("\n") : "Совпадений не найдено",
      success: true,
    }
  }
}
