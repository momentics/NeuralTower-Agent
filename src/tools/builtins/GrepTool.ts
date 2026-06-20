import type { ITool, ToolSchema } from "../ITool"
import type { ToolResult } from "../../agent/AgentTypes"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import * as fs from "fs/promises"
import * as path from "path"
import { ExecutionError } from "../../core/errors"
import { isInsideWorkspace } from "../../utils/WorkspaceGuard"

const execFileAsync = promisify(execFile)

/**
 * Поиск содержимого файлов с помощью ripgrep (rg).
 * При отсутствии rg используется рекурсивный поиск по файлам.
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

  private static _rgChecked = false
  private static _rgAvailable = true

  constructor(private readonly workDir?: string) {}

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const pattern = String(args.pattern ?? "")
    const root = String(args.path ?? ".")
    const include = args.include ? String(args.include) : undefined
    if (!pattern) return { output: "Не указан шаблон поиска", success: false }

    const resolved = path.resolve(root)
    if (!isInsideWorkspace(resolved, this.workDir)) {
      return { output: "Доступ запрещён: путь выходит за пределы рабочей директории", success: false }
    }

    try {
      if (GrepTool._rgAvailable) {
        try {
          const rgResult = await this.executeRg(pattern, resolved, include)
          return rgResult
        } catch {
          GrepTool._rgChecked = true
          GrepTool._rgAvailable = false
        }
      }

      return await this.executeFallback(pattern, resolved, include)
    } catch (err) {
      return {
        output: `Поиск не выполнен: ${err instanceof Error ? err.message : String(err)}`,
        success: false,
      }
    }
  }

  private async executeRg(
    pattern: string,
    root: string,
    include: string | undefined,
  ): Promise<ToolResult> {
    const fileArg = include ? ["-g", include, root] : [root]
    const { stdout, stderr } = await execFileAsync("rg", [
      "-n", "--no-heading", "--color=never", pattern, ...fileArg,
    ], { timeout: 15000, maxBuffer: 512 * 1024 })
    if (stderr && !stdout) {
      return { output: `Ошибка ripgrep: ${stderr}`, success: false }
    }
    return { output: stdout || "Совпадений не найдено", success: true }
  }

  private async executeFallback(
    pattern: string,
    root: string,
    include: string | undefined,
  ): Promise<ToolResult> {
    const re = new RegExp(pattern, "i")
    const results: string[] = []
    const maxFiles = 5000
    let counted = 0

    const walk = async (dir: string): Promise<void> => {
      if (counted >= maxFiles) return
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        if (counted >= maxFiles) return
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          await walk(full)
        } else {
          counted++
          if (include && !this.matchesGlob(entry.name, include)) continue
          try {
            const content = await fs.readFile(full, "utf-8")
            const lines = content.split("\n")
            for (let i = 0; i < lines.length; i++) {
              if (re.test(lines[i])) {
                results.push(`${full}:${i + 1}: ${lines[i].slice(0, 200)}`)
              }
            }
          } catch {
            // пропустить нечитаемые файлы
          }
        }
      }
    }

    await walk(root)
    return {
      output: results.length > 0 ? results.join("\n").slice(0, 10000) : "Совпадений не найдено",
      success: true,
    }
  }

  private matchesGlob(filename: string, pattern: string): boolean {
    const parts = pattern.replace(/\*/g, "[^/]+").replace(/\?/g, ".")
    return new RegExp(`^${parts}$`, "i").test(filename)
  }
}
