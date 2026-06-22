import type { IToolSchema } from "../ITool"
import type { IToolResult } from "../../agent/AgentTypes"
import * as fs from "fs/promises"
import { FilesystemTool } from "./FilesystemTool"
import { str, bool } from "../ToolArgs"

/** Создание директории. Поддерживает рекурсивное создание родительских директорий. */
export class CreateDirTool extends FilesystemTool {
  name = "create_dir"
  description = "Создать директорию. При recursive=true создаёт все родительские директории."
  category = "filesystem"
  isSafe = true

  schema: IToolSchema = {
    name: "create_dir",
    description: "Создать директорию",
    parameters: {
      path: { type: "string", description: "Путь к создаваемой директории" },
      recursive: { type: "boolean", description: "Создать родительские директории", default: false },
    },
    required: ["path"],
  }

  protected async doExecute(args: Record<string, unknown>, signal?: AbortSignal): Promise<IToolResult> {
    const p = str(args, "path")
    const result = await this.resolvePath(p)
    if ("error" in result) return { output: result.error, success: false }

    const recursive = bool(args, "recursive", false)
    await fs.mkdir(result.resolved, { recursive })
    return { output: `Директория создана: ${p}`, success: true }
  }
}
