import type { ITool, ToolSchema } from "../ITool"
import type { ToolResult } from "../../agent/AgentTypes"
import { exec } from "child_process"
import { promisify } from "util"

const execAsync = promisify(exec)

/**
 * Выполнить команду оболочки. Настраиваемый таймаут и рабочая директория.
 */
export class BashTool implements ITool {
  name = "bash"
  description = "Выполнить команду оболочки и вернуть вывод stdout/stderr."
  category = "process"
  isSafe = false

  schema: ToolSchema = {
    name: "bash",
    description: "Выполнить команду оболочки",
    parameters: {
      command: { type: "string", description: "Команда оболочки для выполнения" },
      timeout: { type: "number", description: "Таймаут в миллисекундах (по умолчанию 30000)", default: 30000 },
      workdir: { type: "string", description: "Рабочая директория" },
    },
    required: ["command"],
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const cmd = String(args.command ?? "")
    if (!cmd) return { output: "Не указана команда", success: false }
    const timeout = Number(args.timeout ?? 30000)
    const workdir = args.workdir ? String(args.workdir) : undefined
    try {
      const { stdout, stderr } = await execAsync(cmd, {
        timeout,
        maxBuffer: 1024 * 1024,
        cwd: workdir,
      })
      const out = stdout + (stderr ? `\nВЫВОД ОШИБОК:\n${stderr}` : "")
      return { output: out || "(нет вывода)", success: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { output: `Команда не выполнена: ${msg}`, success: false }
    }
  }
}
