import type { IToolSchema } from "../ITool"
import type { IToolResult } from "../../agent/AgentTypes"
import * as fs from "fs/promises"
import { FilesystemTool } from "./FilesystemTool"
import { str, num, clamp } from "../ToolArgs"
import { FS_DEFAULT_READ_LIMIT, FS_MAX_READ_LIMIT } from "../../core/Config"
import { errorMessage } from "../../core/Errors"

/** Чтение содержимого текстового файла. */
export class ReadFileTool extends FilesystemTool {
  name = "read_file"
  description = "Прочитать содержимое текстового файла."
  category = "filesystem"
  isSafe = true

  schema: IToolSchema = {
    name: "read_file",
    description: "Прочитать содержимое файла",
    parameters: {
      filepath: { type: "string", description: "Путь к файлу" },
      offset: { type: "number", description: "Номер начальной строки (с 1)", default: 0 },
      limit: { type: "number", description: "Максимальное число строк", default: FS_DEFAULT_READ_LIMIT },
    },
    required: ["filepath"],
  }

  protected async doExecute(args: Record<string, unknown>, signal?: AbortSignal): Promise<IToolResult> {
    const fp = str(args, "filepath")
    const result = await this.resolvePath(fp)
    if ("error" in result) return { output: result.error, success: false }

    let content: string
    try {
      content = await fs.readFile(result.resolved, "utf-8")
    } catch (err: unknown) {
      return { output: `Не удалось прочитать файл: ${errorMessage(err)}`, success: false }
    }
    const rawOffset = num(args, "offset", 0)
    const offset = rawOffset >= 0 ? rawOffset : 0
    const rawLimit = num(args, "limit", FS_DEFAULT_READ_LIMIT)
    const limit = clamp(rawLimit, 1, FS_MAX_READ_LIMIT)
    const lines = content.split("\n")
    const slice = offset > 0 ? lines.slice(offset - 1, offset - 1 + limit) : lines.slice(0, limit)
    return { output: slice.join("\n"), success: true }
  }
}
