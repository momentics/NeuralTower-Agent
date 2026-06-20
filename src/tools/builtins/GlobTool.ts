import type { ITool, ToolSchema } from "../ITool"
import type { ToolResult } from "../../agent/AgentTypes"
import { glob as globFn } from "glob"
import * as path from "path"
import { isInsideWorkspace } from "../../utils/WorkspaceGuard"

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

  constructor(private readonly workDir?: string) {}

  async execute(args: Record<string, unknown>, _signal?: AbortSignal): Promise<ToolResult> {
    const pattern = String(args.pattern ?? "")
    const root = args.path ? String(args.path) : "."
    const resolved = path.resolve(root)
    if (!isInsideWorkspace(resolved, this.workDir)) {
      return { output: "Доступ запрещён: путь выходит за пределы рабочей директории", success: false }
    }
    try {
      const files = await globFn(pattern, { cwd: resolved, absolute: true })
      return {
        output: files.length > 0 ? files.join("\n") : "Совпадений не найдено",
        success: true,
      }
    } catch (err: unknown) {
      return {
        output: `Поиск не выполнен: ${err instanceof Error ? err.message : String(err)}`,
        success: false,
      }
    }
  }
}
