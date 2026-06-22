import type { ToolSchema } from "../ITool"
import type { ToolResult } from "../../agent/AgentTypes"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import * as fs from "fs/promises"
import * as path from "path"
import { walkDirectory } from "../../utils/FileSystem"
import { createDomainLogger } from "../../core/logger"
import { errorMessage } from "../../core/errors"
import { FilesystemTool } from "./FilesystemTool"
import { str, strOpt } from "../ToolArgs"

const log = createDomainLogger("Grep")

const execFileAsync = promisify(execFile)

const RG_TIMEOUT_MS = 15000
const RG_MAX_BUFFER = 512 * 1024
const RG_MAX_FILES = 5000
const GREP_LINE_TRUNCATE = 200
const GREP_OUTPUT_TRUNCATE = 10000

/**
 * Поиск содержимого файлов с помощью ripgrep (rg).
 * При отсутствии rg используется рекурсивный поиск по файлам.
 */
export class GrepTool extends FilesystemTool {
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

  protected async doExecute(args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
    const pattern = str(args, "pattern")
    const root = str(args, "path") || "."
    const include = strOpt(args, "include")

    if (!pattern) return { output: "Не указан шаблон поиска", success: false }

    const result = await this.resolvePath(root)
    if ("error" in result) return { output: result.error, success: false }

    try {
      return await this.executeRg(pattern, result.resolved, include)
    } catch (err: unknown) {
      const msg = errorMessage(err)
      log.error(`ripgrep недоступен: ${msg}`)
    }

    return await this.executeFallback(pattern, result.resolved, include, signal)
  }

  private async executeRg(
    pattern: string,
    root: string,
    include: string | undefined,
  ): Promise<ToolResult> {
    const fileArg = include ? ["-g", include, root] : [root]
    const { stdout, stderr } = await execFileAsync("rg", [
      "-n", "--no-heading", "--color=never", pattern, ...fileArg,
    ], { timeout: RG_TIMEOUT_MS, maxBuffer: RG_MAX_BUFFER })
    if (stderr && !stdout) {
      return { output: `Ошибка ripgrep: ${stderr}`, success: false }
    }
    return { output: stdout || "Совпадений не найдено", success: true }
  }

  private async executeFallback(
    pattern: string,
    root: string,
    include: string | undefined,
    signal?: AbortSignal,
  ): Promise<ToolResult> {
    let re: RegExp
    try {
      re = new RegExp(pattern, "i")
    } catch {
      return { output: `Неверное регулярное выражение: ${pattern}`, success: false }
    }

    const results: string[] = []

    const files = await walkDirectory(root, { maxFiles: RG_MAX_FILES, signal })

    for (const full of files) {
      if (signal?.aborted) break
      if (include && !this.matchesGlob(path.basename(full), include)) continue
      try {
        const content = await fs.readFile(full, "utf-8")
        const lines = content.split("\n")
        for (let i = 0; i < lines.length; i++) {
          if (re.test(lines[i])) {
            results.push(`${full}:${i + 1}: ${lines[i].slice(0, GREP_LINE_TRUNCATE)}`)
          }
        }
      } catch (err: unknown) {
        const msg = errorMessage(err)
        log.error(`Не удалось прочитать файл при поиске: ${full} — ${msg}`)
      }
    }

    return {
      output: results.length > 0 ? results.join("\n").slice(0, GREP_OUTPUT_TRUNCATE) : "Совпадений не найдено",
      success: true,
    }
  }

  private matchesGlob(filename: string, pattern: string): boolean {
    const parts = pattern.replace(/\*/g, "[^/]+").replace(/\?/g, ".")
    return new RegExp(`^${parts}$`, "i").test(filename)
  }
}
