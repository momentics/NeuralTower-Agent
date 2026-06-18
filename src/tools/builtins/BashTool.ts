import type { ITool, ToolSchema } from "../ITool"
import type { ToolResult } from "../../agent/AgentTypes"
import { spawn } from "child_process"

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
      const { stdout, stderr } = await this.runCommand(cmd, timeout, workdir)
      const outTrimmed = stdout.trim()
      const out = (outTrimmed ? stdout : "") + (stderr ? `\nВЫВОД ОШИБОК:\n${stderr}` : "")
      return { output: out || "(нет вывода)", success: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { output: `Команда не выполнена: ${msg}`, success: false }
    }
  }

  private runCommand(
    cmd: string,
    timeout: number,
    cwd: string | undefined,
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const isWindows = process.platform === "win32"
      const proc = spawn(
        isWindows ? "cmd.exe" : "sh",
        isWindows ? ["/c", cmd] : ["-c", cmd],
        {
          cwd,
          timeout,
          shell: false,
          env: process.env,
        },
      )

      const stdoutChunks: Buffer[] = []
      const stderrChunks: Buffer[] = []
      const maxBuffer = 1024 * 1024
      let stdoutSize = 0
      let stderrSize = 0

      proc.stdout.on("data", (chunk: Buffer) => {
        stdoutSize += chunk.length
        if (stdoutSize > maxBuffer) {
          proc.kill()
          reject(new Error("Превышен лимит вывода (1 МБ)"))
          return
        }
        stdoutChunks.push(chunk)
      })

      proc.stderr.on("data", (chunk: Buffer) => {
        stderrSize += chunk.length
        if (stderrSize > maxBuffer) {
          proc.kill()
          reject(new Error("Превышен лимит вывода ошибок (1 МБ)"))
          return
        }
        stderrChunks.push(chunk)
      })

      proc.on("error", (err) => {
        reject(err)
      })

      proc.on("close", (code) => {
        const stdout = Buffer.concat(stdoutChunks).toString("utf-8")
        const stderr = Buffer.concat(stderrChunks).toString("utf-8")
        if (code === 0) {
          resolve({ stdout, stderr })
        } else {
          reject(new Error(`Выходной код: ${code ?? -1}` + (stderr ? `\n${stderr}` : "")))
        }
      })
    })
  }
}
