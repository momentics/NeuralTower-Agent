import type { IToolSchema } from "../ITool"
import type { IToolResult } from "../../agent/AgentTypes"
import * as fs from "fs/promises"
import { FilesystemTool } from "./FilesystemTool"
import { str, bool } from "../ToolArgs"
import { FS_MAX_DELETE_FILE_COUNT } from "../../core/Config"

/** Удаление файла или директории. Поддерживает рекурсивное удаление директорий. */
export class DeleteFileTool extends FilesystemTool {
  name = "delete_file"
  description = "Удалить файл или директорию. При recursive=true удаляет директорию со всем содержимым."
  category = "filesystem"
  isSafe = false

  schema: IToolSchema = {
    name: "delete_file",
    description: "Удалить файл или директорию",
    parameters: {
      filepath: { type: "string", description: "Путь к файлу или директории" },
      recursive: { type: "boolean", description: "Рекурсивно удалить директорию", default: false },
    },
    required: ["filepath"],
  }

  protected async doExecute(args: Record<string, unknown>, signal?: AbortSignal): Promise<IToolResult> {
    const fp = str(args, "filepath")
    const result = await this.resolvePath(fp)
    if ("error" in result) return { output: result.error, success: false }

    const stat = await fs.stat(result.resolved)
    const isDir = stat.isDirectory()
    const isRecursive = isDir || bool(args, "recursive", false)

    if (isRecursive) {
      const fileCount = await this.countFiles(result.resolved, signal)
      if (fileCount > FS_MAX_DELETE_FILE_COUNT) {
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

  private async countFiles(dir: string, signal?: AbortSignal): Promise<number> {
    if (signal?.aborted) return 0
    let count = 0
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (signal?.aborted) return count
      if (entry.isDirectory()) {
        count += await this.countFiles(`${dir}/${entry.name}`, signal)
      } else {
        count++
      }
    }
    return count
  }
}
