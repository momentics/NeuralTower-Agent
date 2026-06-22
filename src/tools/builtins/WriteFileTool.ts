import type { IToolSchema } from "../ITool"
import type { IToolResult } from "../../agent/AgentTypes"
import * as fs from "fs/promises"
import * as path from "path"
import { FilesystemTool } from "./FilesystemTool"
import { str } from "../ToolArgs"
import { FS_MAX_WRITE_CONTENT_LENGTH } from "../../core/Config"
import { errorMessage } from "../../core/Errors"

/** Запись содержимого в файл. Создаёт родительские директории при необходимости. */
export class WriteFileTool extends FilesystemTool {
  name = "write_file"
  description = "Записать содержимое в файл. Создаёт родительские директории, если они не существуют."
  category = "filesystem"
  isSafe = false

  schema: IToolSchema = {
    name: "write_file",
    description: "Записать содержимое файла",
    parameters: {
      filepath: { type: "string", description: "Путь к файлу" },
      content: { type: "string", description: "Содержимое для записи" },
    },
    required: ["filepath", "content"],
  }

  protected async doExecute(args: Record<string, unknown>, signal?: AbortSignal): Promise<IToolResult> {
    const fp = str(args, "filepath")
    const content = str(args, "content")

    if (!fp) return { output: "Не указан путь к файлу", success: false }
    if (content.length > FS_MAX_WRITE_CONTENT_LENGTH) {
      return { output: `Содержимое слишком велико (макс. ${FS_MAX_WRITE_CONTENT_LENGTH} символов)`, success: false }
    }

    const result = await this.resolvePath(fp)
    if ("error" in result) return { output: result.error, success: false }

    const dir = path.dirname(result.resolved)
    try {
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(result.resolved, content, "utf-8")
    } catch (err: unknown) {
      return { output: `Не удалось записать файл: ${errorMessage(err)}`, success: false }
    }
    return { output: `Записано ${content.length} байт в ${fp}`, success: true }
  }
}
