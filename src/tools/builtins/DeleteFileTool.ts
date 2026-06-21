import type { ToolSchema } from "../ITool"
import type { ToolResult } from "../../agent/AgentTypes"
import * as fs from "fs/promises"
import { FilesystemTool } from "./FilesystemTool"

/** Удаление файла или директории. Поддерживает рекурсивное удаление директорий. */
export class DeleteFileTool extends FilesystemTool {
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

  protected async doExecute(args: Record<string, unknown>): Promise<ToolResult> {
    const fp = String(args.filepath ?? "")
    const result = this.resolvePath(fp)
    if ("error" in result) return { output: result.error, success: false }
    const stat = await fs.stat(result.resolved)
    await fs.rm(result.resolved, {
      recursive: stat.isDirectory() || Boolean(args.recursive),
      force: true,
    })
    return {
      output: `Удалено: ${fp}${stat.isDirectory() ? " (директория)" : ""}`,
      success: true,
    }
  }
}
