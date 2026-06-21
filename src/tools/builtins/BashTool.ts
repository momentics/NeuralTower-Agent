import type { ToolSchema } from "../ITool"
import type { ToolResult } from "../../agent/AgentTypes"
import { errorMessage } from "../../core/errors"
import { runProcess } from "../../utils/ProcessRunner"
import { BaseTool } from "./BaseTool"
import { str, strOpt, num, clamp } from "../ToolArgs"

const BASH_DEFAULT_TIMEOUT_MS = 30_000
const BASH_MAX_BUFFER = 1024 * 1024
const BASH_MIN_TIMEOUT_MS = 1000
const BASH_MAX_TIMEOUT_MS = 300_000

/**
 * Команды, запрещённые для выполнения из-за высокого риска повреждения системы.
 * Проверяются как базовая команда (первое слово) и через regex для сложных случаев.
 */
const DENIED_COMMANDS = new Set([
  "rm",
  "del",
  "rmdir",
  "format",
  "fdisk",
  "dd",
  "mkfs",
  "shutdown",
  "reboot",
  "halt",
  "poweroff",
  "sudo",
  "su",
  "passwd",
  "useradd",
  "userdel",
  "usermod",
  "groupadd",
  "groupdel",
  "chmod",
  "chown",
  "chgrp",
])

/**
 * Regex-паттерны, запрещённые в командах (например, pipe в curl, подстановочные удаления).
 */
const DENIED_PATTERNS = [
  /rm\s+(-r|-R|--recursive|--no-preserve-root)/i,
  /curl\s+.*\s*\|*\s*(bash|sh|zsh|powershell|cmd)/i,
  /wget\s+.*\s*\|*\s*(bash|sh|zsh|powershell|cmd)/i,
  /eval\s*\(/i,
  /exec\s*\(/i,
  /;\s*(rm|del|rmdir|format|shutdown|reboot)\b/i,
  /\|\s*(bash|sh|zsh|powershell)\s*$/i,
  /&&\s*(rm|del|rmdir|format|shutdown|reboot)\b/i,
  />>?\s*\/etc\//i,
  />>?\s*\/root\//i,
]

/**
 * Выполнить команду оболочки. Настраиваемый таймаут и рабочая директория.
 * Команда выполняется через spawn с оболочкой, что безопаснее exec.
 *
 * Безопасность:
 * - Denylist опасных команд (rm, sudo, format и др.)
 * - Regex-фильтрация опасных паттернов (curl|bash, rm -rf и др.)
 * - Максимальный таймаут ограничен для предотвращения DoS
 */
export class BashTool extends BaseTool {
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

  /**
   * Проверить команду на безопасность.
   * @returns null если команда разрешена, или строку с описанием причины блокировки
   */
  validateCommand(cmd: string): string | null {
    const trimmed = cmd.trim()
    const firstWord = trimmed.split(/\s+/)[0]?.toLowerCase().replace(/[\/\\].*$/, "")

    if (DENIED_COMMANDS.has(firstWord)) {
      return `Команда "${firstWord}" запрещена`
    }

    for (const pattern of DENIED_PATTERNS) {
      if (pattern.test(trimmed)) {
        return `Команда содержит запрещённый паттерн: ${pattern.source}`
      }
    }

    return null
  }

  protected async doExecute(args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
    const cmd = str(args, "command")
    if (!cmd) return { output: "Не указана команда", success: false }

    const denial = this.validateCommand(cmd)
    if (denial) return { output: `Команда заблокирована: ${denial}`, success: false }

    const rawTimeout = num(args, "timeout", BASH_DEFAULT_TIMEOUT_MS)
    const timeout = clamp(rawTimeout, BASH_MIN_TIMEOUT_MS, BASH_MAX_TIMEOUT_MS)
    const workdir = strOpt(args, "workdir")

    const isWindows = process.platform === "win32"
    const { stdout, stderr } = await runProcess(
      isWindows ? "cmd.exe" : "sh",
      isWindows ? ["/c", cmd] : ["-c", cmd],
      { cwd: workdir, timeout, maxBuffer: BASH_MAX_BUFFER, signal },
    )
    const outTrimmed = stdout.trim()
    const out = (outTrimmed ? stdout : "") + (stderr ? `\nВЫВОД ОШИБОК:\n${stderr}` : "")
    return { output: out || "(нет вывода)", success: true }
  }
}
