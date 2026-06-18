import type { ITool, ToolSchema } from "../ITool"
import type { ToolResult } from "../../agent/AgentTypes"
import * as fs from "fs/promises"
import * as path from "path"

/** Запись содержимого в файл. Создаёт родительские директории при необходимости. */
export class WriteFileTool implements ITool {
  name = "write_file"
  description = "Записать содержимое в файл. Создаёт родительские директории, если они не существуют."
  category = "filesystem"
  isSafe = false

  schema: ToolSchema = {
    name: "write_file",
    description: "Записать содержимое файла",
    parameters: {
      filepath: { type: "string", description: "Путь к файлу" },
      content: { type: "string", description: "Содержимое для записи" },
    },
    required: ["filepath", "content"],
  }

  constructor(private readonly workDir?: string) {}

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const fp = String(args.filepath ?? "")
    const content = String(args.content ?? "")
    if (!fp) return { output: "Не указан путь к файлу", success: false }
    const resolved = path.resolve(fp)
    if (!this.isInsideWorkspace(resolved)) {
      return { output: "Доступ запрещён: путь выходит за пределы рабочей директории", success: false }
    }
    try {
      const dir = path.dirname(resolved)
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(resolved, content, "utf-8")
      return { output: `Записано ${content.length} байт в ${fp}`, success: true }
    } catch (err) {
      return {
        output: `Не удалось записать файл: ${err instanceof Error ? err.message : String(err)}`,
        success: false,
      }
    }
  }

  private isInsideWorkspace(resolved: string): boolean {
    if (!this.workDir) return true
    const normalized = resolved.replace(/\\/g, "/").replace(/\/+$/, "")
    const root = this.workDir.replace(/\\/g, "/").replace(/\/+$/, "")
    return normalized === root || normalized.startsWith(root + "/")
  }
}
