import type { ITool, ToolSchema } from "../ITool"
import type { ToolResult } from "../../agent/AgentTypes"
import { isInsideWorkspace } from "../../utils/WorkspaceGuard"
import * as fs from "fs/promises"
import * as path from "path"

/**
 * Точная замена текста в файле. Ищет старую строку,
 * заменяет новой. Работает на уровне всего файла или отдельных строк.
 */
export class EditFileTool implements ITool {
  name = "edit_file"
  description =
    "Заменить текст в файле. Находит старый текст и заменяет новым. Не выполняется, если старый текст не найден или встречается несколько раз."
  category = "filesystem"
  isSafe = false

  schema: ToolSchema = {
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

  constructor(private readonly workDir?: string) {}

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const fp = String(args.filepath ?? "")
    const oldStr = String(args.oldString ?? "")
    const newStr = String(args.newString ?? "")
    const all = Boolean(args.replaceAll ?? false)
    if (!fp || !oldStr) return { output: "Не указаны обязательные аргументы", success: false }

    const resolved = path.resolve(fp)
    if (!isInsideWorkspace(resolved, this.workDir)) {
      return { output: "Доступ запрещён: путь выходит за пределы рабочей директории", success: false }
    }
    try {
      const content = await fs.readFile(resolved, "utf-8")
      const count = content.split(oldStr).length - 1

      if (count === 0) {
        return { output: `"${oldStr.slice(0, 60)}..." не найдено в файле`, success: false }
      }
      if (count > 1 && !all) {
        return { output: `Найдено ${count} вхождений. Установите replaceAll=true или добавьте контекст.`, success: false }
      }

      const updated = all
        ? content.split(oldStr).join(newStr)
        : content.replace(oldStr, newStr)

      await fs.writeFile(resolved, updated, "utf-8")
      return {
        output: `Заменено ${count} вхождений в ${fp}`,
        success: true,
      }
    } catch (err) {
      return {
        output: `Редактирование не выполнено: ${err instanceof Error ? err.message : String(err)}`,
        success: false,
      }
    }
  }
}
