import type { IToolSchema } from "../ITool"
import type { IToolResult } from "../../agent/AgentTypes"
import * as fs from "fs/promises"
import { FilesystemTool } from "./FilesystemTool"
import { str, bool } from "../ToolArgs"
import { FS_EDIT_PREVIEW_TRUNCATE, FS_MAX_EDIT_CONTENT_LENGTH } from "../../core/Config"

/**
 * Расширения бинарных файлов, которые нельзя редактировать как текст.
 */
const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp", ".svg",
  ".woff", ".woff2", ".ttf", ".eot",
  ".zip", ".tar", ".gz", ".rar", ".7z",
  ".exe", ".dll", ".so", ".dylib",
  ".class", ".pyc", ".o", ".a", ".lib",
  ".db", ".sqlite", ".sqlite3",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx",
  ".mp3", ".mp4", ".avi", ".mov", ".wav",
  ".psd", ".ai", ".sketch",
])

/**
 * Точная замена текста в файле. Ищет старую строку,
 * заменяет новой. Работает на уровне всего файла или отдельных строк.
 */
export class EditFileTool extends FilesystemTool {
  name = "edit_file"
  description =
    "Заменить текст в файле. Находит старый текст и заменяет новым. Не выполняется, если старый текст не найден или встречается несколько раз."
  category = "filesystem"
  isSafe = false

  schema: IToolSchema = {
    name: "edit_file",
    description: "Редактировать файл заменой текста",
    parameters: {
      filepath: { type: "string", description: "Путь к файлу" },
      oldString: { type: "string", description: "Точный текст для поиска и замены" },
      newString: { type: "string", description: "Текст замены" },
      replaceAll: { type: "boolean", description: "Заменить все вхождения", default: false },
    },
    required: ["filepath", "oldString", "newString"],
  }

  protected async doExecute(args: Record<string, unknown>, signal?: AbortSignal): Promise<IToolResult> {
    const fp = str(args, "filepath")
    const oldStr = str(args, "oldString")
    const newStr = str(args, "newString")
    const all = bool(args, "replaceAll", false)

    if (!fp) return { output: "Не указан путь к файлу", success: false }
    if (!oldStr) return { output: "Не указан текст для поиска", success: false }
    if (newStr.length > FS_MAX_EDIT_CONTENT_LENGTH) {
      return { output: `Текст замены слишком велик (макс. ${FS_MAX_EDIT_CONTENT_LENGTH} символов)`, success: false }
    }

    const result = await this.resolvePath(fp)
    if ("error" in result) return { output: result.error, success: false }

    const ext = fp.split(".").pop()?.toLowerCase() ?? ""
    if (ext && BINARY_EXTENSIONS.has(`.${ext}`)) {
      return { output: `Редактирование бинарных файлов запрещено: .${ext}`, success: false }
    }

    const content = await fs.readFile(result.resolved, "utf-8")
    const count = content.split(oldStr).length - 1

    if (count === 0) {
      const preview = oldStr.length > FS_EDIT_PREVIEW_TRUNCATE ? `${oldStr.slice(0, FS_EDIT_PREVIEW_TRUNCATE)}...` : oldStr
      return { output: `"${preview}" не найдено в файле`, success: false }
    }
    if (count > 1 && !all) {
      return { output: `Найдено ${count} вхождений. Установите replaceAll=true или добавьте контекст.`, success: false }
    }

    const updated = all
      ? content.split(oldStr).join(newStr)
      : content.replace(oldStr, newStr)

    await fs.writeFile(result.resolved, updated, "utf-8")
    return {
      output: `Заменено ${count} вхождений в ${fp}`,
      success: true,
    }
  }
}
