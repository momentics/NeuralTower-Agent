import type { ITool, ToolSchema } from "../ITool"
import type { ToolResult } from "../../agent/AgentTypes"
import { isInsideWorkspace } from "../../utils/WorkspaceGuard"
import * as fs from "fs/promises"
import * as path from "path"
import { errorMessage } from "../../core/errors"

/** Создание директории. Поддерживает рекурсивное создание родительских директорий. */
export class CreateDirTool implements ITool {
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

  constructor(private readonly workDir?: string) {}

  async execute(args: Record<string, unknown>, _signal?: AbortSignal): Promise<ToolResult> {
    const p = String(args.path ?? "")
    if (!p) return { output: "Не указан путь к директории", success: false }
    const resolved = path.resolve(p)
    if (!isInsideWorkspace(resolved, this.workDir)) {
      return { output: "Доступ запрещён: путь выходит за пределы рабочей директории", success: false }
    }
    try {
      await fs.mkdir(resolved, { recursive: Boolean(args.recursive ?? false) })
      return { output: `Директория создана: ${p}`, success: true }
    } catch (err: unknown) {
      return {
        output: `Не удалось создать директорию: ${errorMessage(err)}`,
        success: false,
      }
    }
  }
}
