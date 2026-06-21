import type { ToolSchema } from "../ITool"
import type { ToolResult } from "../../agent/AgentTypes"
import * as fs from "fs/promises"
import * as path from "path"
import { FilesystemTool } from "./FilesystemTool"
import { str } from "../ToolArgs"

/** Перемещение или переименование файла или директории. */
export class MoveFileTool extends FilesystemTool {
  name = "move_file"
  description = "Переместить или переименовать файл или директорию."
  category = "filesystem"
  isSafe = false

  schema: ToolSchema = {
    name: "move_file",
    description: "Переместить или переименовать файл или директорию",
    parameters: {
      source: { type: "string", description: "Исходный путь" },
      destination: { type: "string", description: "Путь назначения" },
    },
    required: ["source", "destination"],
  }

  protected async doExecute(args: Record<string, unknown>): Promise<ToolResult> {
    const src = str(args, "source")
    const dst = str(args, "destination")

    if (!src) return { output: "Не указан исходный путь", success: false }
    if (!dst) return { output: "Не указан путь назначения", success: false }

    const result = this.resolveTwoPaths(src, dst)
    if ("error" in result) return { output: result.error, success: false }

    await fs.stat(result.source)
    const dstDir = path.dirname(result.destination)
    await fs.mkdir(dstDir, { recursive: true })
    await fs.rename(result.source, result.destination)
    return { output: `Перемещено: ${src} -> ${dst}`, success: true }
  }
}
