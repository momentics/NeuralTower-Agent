import type { ITool, ToolSchema } from "../ITool"
import type { ToolResult } from "../../agent/AgentTypes"
import { isInsideWorkspace } from "../../utils/WorkspaceGuard"
import * as fs from "fs/promises"
import * as path from "path"

/** Удаление файла или директории. Поддерживает рекурсивное удаление директорий. */
export class DeleteFileTool implements ITool {
  name = "delete_file"
  description = "Удалить файл или директорию. При recursive=true удаляет директорию со всем содержимым."
  category = "filesystem"
  isSafe = false

  schema: ToolSchema = {
    name: "delete_file",
    description: "Удалить файл или директорию",
    parameters: {
      filepath: { type: "string", description: "Путь к файлу или директории" },
      recursive: { type: "boolean", description: "Рекурсивно удалить директорию", default: false },
    },
    required: ["filepath"],
  }

  constructor(private readonly workDir?: string) {}

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const fp = String(args.filepath ?? "")
    if (!fp) return { output: "Не указан путь к файлу или директории", success: false }
    const resolved = path.resolve(fp)
    if (!isInsideWorkspace(resolved, this.workDir)) {
      return { output: "Доступ запрещён: путь выходит за пределы рабочей директории", success: false }
    }
    try {
      const stat = await fs.stat(resolved)
      await fs.rm(resolved, {
        recursive: stat.isDirectory() || Boolean(args.recursive),
        force: true,
      })
      return {
        output: `Удалено: ${fp}${stat.isDirectory() ? " (директория)" : ""}`,
        success: true,
      }
    } catch (err) {
      return {
        output: `Не удалось удалить: ${err instanceof Error ? err.message : String(err)}`,
        success: false,
      }
    }
  }
}
