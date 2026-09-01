import type { IToolSchema } from "../ITool"
import type { IToolResult } from "../../agent/AgentTypes"
import * as fs from "fs/promises"
import { FilesystemTool } from "./FilesystemTool"
import { str, arr } from "../ToolArgs"
import { FS_MAX_EDIT_CONTENT_LENGTH } from "../../core/Config"
import { errorMessage } from "../../core/Errors"

/** Одна замена внутри multi_edit. */
interface IMultiEdit {
  oldString: string
  newString: string
  replaceAll: boolean
}

/** Максимальное число замен в одном вызове. */
const MAX_EDITS = 50

/** Русское склонение существительного: число и три формы (1, 2–4, 5+). */
function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

/**
 * Пакетная замена нескольких фрагментов текста в одном файле.
 *
 * All-or-nothing: сначала проверяются все замены (текст найден,
 * однозначен или replaceAll), затем применяются к копии содержимого
 * и файл записывается один раз. При любом сбое файл не изменяется.
 */
export class MultiEditTool extends FilesystemTool {
  name = "multi_edit"
  description =
    "Применить несколько точечных замен к одному файлу одной операцией. " +
    "All-or-nothing: если любая замена не найдена или неоднозначна — файл не изменяется."
  category = "filesystem"
  isSafe = false

  schema: IToolSchema = {
    name: "multi_edit",
    description: "Пакетная замена текста в файле",
    parameters: {
      filepath: { type: "string", description: "Путь к файлу" },
      edits: {
        type: "array",
        description: "Список замен, применяются в порядке следования",
        items: {
          type: "object",
          properties: {
            oldString: { type: "string", description: "Точный текст для поиска" },
            newString: { type: "string", description: "Текст замены" },
            replaceAll: { type: "boolean", description: "Заменить все вхождения", default: false },
          },
          required: ["oldString", "newString"],
        },
      },
    },
    required: ["filepath", "edits"],
  }

  protected async doExecute(args: Record<string, unknown>, signal?: AbortSignal): Promise<IToolResult> {
    const fp = str(args, "filepath")
    if (!fp) return { output: "Не указан путь к файлу", success: false }

    const rawEdits = arr<Record<string, unknown>>(args, "edits")
    if (rawEdits.length === 0) return { output: "Не указаны замены", success: false }
    if (rawEdits.length > MAX_EDITS) {
      return { output: `Слишком много замен (макс. ${MAX_EDITS})`, success: false }
    }

    const edits: IMultiEdit[] = []
    for (let i = 0; i < rawEdits.length; i++) {
      const e = rawEdits[i]
      const oldStr = typeof e.oldString === "string" ? e.oldString : ""
      const newStr = typeof e.newString === "string" ? e.newString : ""
      if (oldStr.length === 0) {
        return { output: `Замена #${i + 1}: текст для поиска не может быть пустым`, success: false }
      }
      if (newStr.length > FS_MAX_EDIT_CONTENT_LENGTH) {
        return { output: `Замена #${i + 1}: текст замены слишком велик (макс. ${FS_MAX_EDIT_CONTENT_LENGTH} символов)`, success: false }
      }
      edits.push({ oldString: oldStr, newString: newStr, replaceAll: e.replaceAll === true })
    }

    const result = await this.resolvePath(fp)
    if ("error" in result) return { output: result.error, success: false }

    let content: string
    try {
      content = await fs.readFile(result.resolved, "utf-8")
    } catch (err: unknown) {
      return { output: `Не удалось прочитать файл: ${errorMessage(err)}`, success: false }
    }

    // Проход 1: валидация всех замен (all-or-nothing)
    for (let i = 0; i < edits.length; i++) {
      const count = content.split(edits[i].oldString).length - 1
      if (count === 0) {
        return { output: `Замена #${i + 1}: текст не найден в файле`, success: false }
      }
      if (count > 1 && !edits[i].replaceAll) {
        return {
          output: `Замена #${i + 1}: найдено ${count} ${plural(count, "вхождение", "вхождения", "вхождений")} — укажите replaceAll=true или добавьте контекст`,
          success: false,
        }
      }
    }

    // Проход 2: применение к копии содержимого
    let updated = content
    let total = 0
    for (const e of edits) {
      const count = updated.split(e.oldString).length - 1
      if (count === 0) {
        return {
          output: "Пересечение замен: текст одной замены уничтожен предыдущей",
          success: false,
        }
      }
      total += count
      updated = e.replaceAll
        ? updated.split(e.oldString).join(e.newString)
        : updated.replace(e.oldString, e.newString)
    }

    try {
      await fs.writeFile(result.resolved, updated, "utf-8")
    } catch (err: unknown) {
      return { output: `Не удалось записать файл: ${errorMessage(err)}`, success: false }
    }

    return {
      output: `Заменено ${total} ${plural(total, "вхождение", "вхождения", "вхождений")} в ${fp} (${edits.length} ${plural(edits.length, "замена", "замены", "замен")})`,
      success: true,
    }
  }
}
