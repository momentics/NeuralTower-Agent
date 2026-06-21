import type { ToolSchema } from "../ITool"
import type { ToolResult } from "../../agent/AgentTypes"
import * as fs from "fs/promises"
import { FilesystemTool } from "./FilesystemTool"

/** Создание директории. Поддерживает рекурсивное создание родительских директорий. */
export class CreateDirTool extends FilesystemTool {
  name = "create_dir"
  description = "Создать директорию. При recursive=true создаёт все родительские директории."
  category = "filesystem"
  isSafe = true

  schema: ToolSchema = {
    name: "create_dir",
    description: "Создать директорию",
    parameters: {
      path: { type: "string", description: "Путь к создаваемой директории" },
      recursive: { type: "boolean", description: "Создать родительские директории", default: false },
    },
    required: ["path"],
  }

  protected async doExecute(args: Record<string, unknown>): Promise<ToolResult> {
    const p = String(args.path ?? "")
    const result = this.resolvePath(p)
    if ("error" in result) return { output: result.error, success: false }
    await fs.mkdir(result.resolved, { recursive: Boolean(args.recursive ?? false) })
    return { output: `Директория создана: ${p}`, success: true }
  }
}
