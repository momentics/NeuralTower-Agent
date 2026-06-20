import type { ITool, ToolSchema } from "../ITool"
import type { ToolResult } from "../../agent/AgentTypes"
import { isInsideWorkspace } from "../../utils/WorkspaceGuard"
import * as fs from "fs/promises"
import * as path from "path"

/** Перемещение или переименование файла или директории. */
export class MoveFileTool implements ITool {
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

  constructor(private readonly workDir?: string) {}

  async execute(args: Record<string, unknown>, _signal?: AbortSignal): Promise<ToolResult> {
    const src = String(args.source ?? "")
    const dst = String(args.destination ?? "")
    if (!src || !dst) return { output: "Не указаны обязательные аргументы", success: false }
    const resolvedSrc = path.resolve(src)
    const resolvedDst = path.resolve(dst)
    if (!isInsideWorkspace(resolvedSrc, this.workDir)) {
      return { output: "Доступ запрещён: исходный путь выходит за пределы рабочей директории", success: false }
    }
    if (!isInsideWorkspace(resolvedDst, this.workDir)) {
      return { output: "Доступ запрещён: путь назначения выходит за пределы рабочей директории", success: false }
    }
    try {
      await fs.stat(resolvedSrc)
      const dstDir = path.dirname(resolvedDst)
      await fs.mkdir(dstDir, { recursive: true })
      await fs.rename(resolvedSrc, resolvedDst)
      return { output: `Перемещено: ${src} -> ${dst}`, success: true }
    } catch (err: unknown) {
      return {
        output: `Не удалось переместить: ${err instanceof Error ? err.message : String(err)}`,
        success: false,
      }
    }
  }
}
