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
    const isDir = stat.isDirectory()
    const isRecursive = isDir || Boolean(args.recursive)

    if (isRecursive) {
      const fileCount = await this.countFiles(result.resolved)
      if (fileCount > 100) {
        return {
          output: `Рекурсивное удаление заблокировано: директория содержит ${fileCount} файлов. Это слишком много для автоматического удаления.`,
          success: false,
        }
      }
    }

    await fs.rm(result.resolved, {
      recursive: isRecursive,
      force: true,
    })
    return {
      output: `Удалено: ${fp}${isDir ? " (директория)" : ""}`,
      success: true,
    }
  }

  private async countFiles(dir: string): Promise<number> {
    let count = 0
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) {
        count += await this.countFiles(`${dir}/${entry.name}`)
      } else {
        count++
      }
    }
    return count
  }
}
