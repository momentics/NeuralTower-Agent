import type { IToolSchema } from "../ITool"
import type { IToolResult } from "../../agent/AgentTypes"
import * as fs from "fs/promises"
import { FilesystemTool } from "./FilesystemTool"
import { str, num, clamp } from "../ToolArgs"
import { FS_DEFAULT_READ_LIMIT, FS_MAX_READ_LIMIT, FS_MAX_READ_OUTPUT_BYTES } from "../../core/Config"
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

    // Байтовый лимит вывода: одно чтение не должно раздувать контекст
    // модели (в репозиториях 10k+ файлов много крупных сгенерированных
    // файлов). Для дальнейшего чтения агент использует offset — он
    // указан в заметке.
    let output = ""
    let bytes = 0
    let returned = 0
    let truncated = false
    for (const line of slice) {
      const lineBytes = Buffer.byteLength(line, "utf-8") + 1
      if (bytes + lineBytes > FS_MAX_READ_OUTPUT_BYTES) {
        truncated = true
        break
      }
      if (returned > 0) output += "\n"
      output += line
      bytes += lineBytes
      returned++
    }
    if (truncated) {
      const nextOffset = offset > 0 ? offset + returned : returned + 1
      output += `\n… (вывод обрезан: ${FS_MAX_READ_OUTPUT_BYTES} байт; для продолжения чтения используйте offset=${nextOffset})`
    }

    return { output, success: true }
  }
}
