import type { ITool, ToolSchema } from "../ITool"
import type { ToolResult } from "../../agent/AgentTypes"
import { errorMessage } from "../../core/errors"
import { runProcess } from "../../utils/ProcessRunner"

const BASH_DEFAULT_TIMEOUT_MS = 30000
const BASH_MAX_BUFFER = 1024 * 1024

/**
 * Выполнить команду оболочки. Настраиваемый таймаут и рабочая директория.
 * Команда выполняется через spawn с оболочкой, что безопаснее exec.
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
      timeout: { type: "number", description: "Таймаут в миллисекундах (по умолчанию 30000)", default: BASH_DEFAULT_TIMEOUT_MS },
      workdir: { type: "string", description: "Рабочая директория" },
    },
    required: ["command"],
  }

  async execute(args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
    if (signal?.aborted) return { output: "Операция отменена", success: false }
    const cmd = String(args.command ?? "")
    if (!cmd) return { output: "Не указана команда", success: false }
    const timeout = Number(args.timeout ?? BASH_DEFAULT_TIMEOUT_MS)
    const workdir = args.workdir ? String(args.workdir) : undefined
    try {
      const isWindows = process.platform === "win32"
      const { stdout, stderr } = await runProcess(
        isWindows ? "cmd.exe" : "sh",
        isWindows ? ["/c", cmd] : ["-c", cmd],
        { cwd: workdir, timeout, maxBuffer: BASH_MAX_BUFFER, signal },
      )
      const outTrimmed = stdout.trim()
      const out = (outTrimmed ? stdout : "") + (stderr ? `\nВЫВОД ОШИБОК:\n${stderr}` : "")
      return { output: out || "(нет вывода)", success: true }
    } catch (err: unknown) {
      const msg = errorMessage(err)
      return { output: `Команда не выполнена: ${msg}`, success: false }
    }
  }
}
