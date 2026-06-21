import type { ToolSchema } from "../ITool"
import type { ToolResult } from "../../agent/AgentTypes"
import * as fs from "fs/promises"
import { FilesystemTool } from "./FilesystemTool"
import { str, num, clamp } from "../ToolArgs"

const DEFAULT_READ_LIMIT = 2000
const MAX_READ_LIMIT = 10000

/** Чтение содержимого текстового файла. */
export class ReadFileTool extends FilesystemTool {
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

  protected async doExecute(args: Record<string, unknown>): Promise<ToolResult> {
    const fp = str(args, "filepath")
    const result = this.resolvePath(fp)
    if ("error" in result) return { output: result.error, success: false }

    const content = await fs.readFile(result.resolved, "utf-8")
    const rawOffset = num(args, "offset", 0)
    const offset = rawOffset >= 0 ? rawOffset : 0
    const rawLimit = num(args, "limit", DEFAULT_READ_LIMIT)
    const limit = clamp(rawLimit, 1, MAX_READ_LIMIT)
    const lines = content.split("\n")
    const slice = offset > 0 ? lines.slice(offset - 1, offset - 1 + limit) : lines.slice(0, limit)
    return { output: slice.join("\n"), success: true }
  }
}
