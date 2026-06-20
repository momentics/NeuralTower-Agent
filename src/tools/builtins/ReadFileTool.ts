import type { ITool, ToolSchema } from "../ITool"
import type { ToolResult } from "../../agent/AgentTypes"
import { isInsideWorkspace } from "../../utils/WorkspaceGuard"
import * as fs from "fs/promises"
import * as path from "path"

const DEFAULT_READ_LIMIT = 2000

/** Чтение содержимого текстового файла. */
export class ReadFileTool implements ITool {
  name = "read_file"
  description = "Прочитать содержимое текстового файла."
  category = "filesystem"
  isSafe = true

  schema: ToolSchema = {
    name: "read_file",
    description: "Прочитать содержимое файла",
    parameters: {
      filepath: { type: "string", description: "Путь к файлу" },
      offset: { type: "number", description: "Номер начальной строки (с 1)", default: 0 },
      limit: { type: "number", description: "Максимальное число строк", default: DEFAULT_READ_LIMIT },
    },
    required: ["filepath"],
  }

  constructor(private readonly workDir?: string) {}

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const fp = String(args.filepath ?? "")
    if (!fp) return { output: "Не указан путь к файлу", success: false }
    const resolved = path.resolve(fp)
    if (!isInsideWorkspace(resolved, this.workDir)) {
      return { output: "Доступ запрещён: путь выходит за пределы рабочей директории", success: false }
    }
    try {
      const content = await fs.readFile(resolved, "utf-8")
      const offset = Number(args.offset ?? 0)
      const limit = Number(args.limit ?? DEFAULT_READ_LIMIT)
      const lines = content.split("\n")
      const slice = offset > 0 ? lines.slice(offset - 1, offset - 1 + limit) : lines.slice(0, limit)
      return { output: slice.join("\n"), success: true }
    } catch (err: unknown) {
      return {
        output: `Не удалось прочитать файл: ${err instanceof Error ? err.message : String(err)}`,
        success: false,
      }
    }
  }
}
