import type { ITool, ToolSchema } from "../ITool"
import type { ToolResult } from "../../agent/AgentTypes"
import { exec } from "child_process"
import { promisify } from "util"

const execAsync = promisify(exec)

/**
 * Поиск содержимого файлов с помощью ripgrep (rg).
 * При отсутствии rg используется стандартный grep.
 */
export class GrepTool implements ITool {
  name = "grep"
  description = "Поиск содержимого файлов по регулярному выражению. Использует ripgrep, если доступно."
  category = "filesystem"
  isSafe = true

  schema: ToolSchema = {
    name: "grep",
    description: "Поиск в файлах по регулярному выражению",
    parameters: {
      pattern: { type: "string", description: "Регулярное выражение для поиска" },
      path: { type: "string", description: "Директория для поиска", default: "." },
      include: { type: "string", description: "Шаблон файлов для включения, напр. *.ts" },
    },
    required: ["pattern"],
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const pattern = String(args.pattern ?? "")
    const root = String(args.path ?? ".")
    const include = args.include ? String(args.include) : undefined
    if (!pattern) return { output: "Не указан шаблон поиска", success: false }

    const cmd = include
      ? `rg -n --no-heading --color=never "${pattern}" -g "${include}" "${root}"`
      : `rg -n --no-heading --color=never "${pattern}" "${root}"`

    try {
      const { stdout, stderr } = await execAsync(cmd, { timeout: 15000, maxBuffer: 512 * 1024 })
      return { output: stdout || "Совпадений не найдено", success: true }
    } catch (err) {
      return {
        output: `Поиск не выполнен: ${err instanceof Error ? err.message : String(err)}`,
        success: false,
      }
    }
  }
}
