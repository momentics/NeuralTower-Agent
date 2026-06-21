import { spawn, type SpawnOptions, type ChildProcess } from "child_process"
import type { Plugin } from "../../shared/types"
import { createDomainLogger } from "../../core/logger"
import { errorMessage } from "../../core/errors"

const log = createDomainLogger("Git")

const GIT_ROOT_TIMEOUT_MS = 5000
const GIT_DIFF_TIMEOUT_MS = 10000
const GIT_MAX_BUFFER = 512 * 1024

export interface GitDiffResult {
  ok: true
  changed: string[]
  additions: number
  deletions: number
}

export interface GitDiffError {
  ok: false
  error: string
}

export type GitDiffOutcome = GitDiffResult | GitDiffError

export interface GitBranchInfo {
  name: string
  ahead: number
  behind: number
}

/**
 * Интерфейс Git-сервиса — только методы, используемые через AgentDependencies.
 */
export interface IGitService {
  getDiffContext(dir: string): Promise<string>
  getBranchInfo(dir: string): Promise<GitBranchInfo | null>
  getDiff(dir: string): Promise<GitDiffOutcome>
  getCachedDiff(dir: string): Promise<string>
  findRoot(cwd: string): Promise<string | null>
  dispose(): void
}

/**
 * Выполнить команду git через spawn (без оболочки) для защиты от инъекций.
 */
function gitSpawn(
  dir: string,
  args: string[],
  timeout: number,
  maxBuffer = GIT_MAX_BUFFER,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let settled = false
    const settle = (
      value: { stdout: string; stderr: string } | undefined,
      error: Error | undefined,
    ) => {
      if (settled) return
      settled = true
      if (error) reject(error)
      else if (value) resolve(value)
    }

    const opts: SpawnOptions = {
      cwd: process.cwd(),
      timeout,
      shell: false,
    }

    const proc: ChildProcess = spawn("git", ["-C", dir, ...args], opts)

    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let stdoutSize = 0
    let stderrSize = 0

    proc.stdout?.on("data", (chunk: Buffer) => {
      stdoutSize += chunk.length
      if (stdoutSize > maxBuffer) {
        proc.kill()
        return settle(undefined, new Error("Превышен лимит вывода"))
      }
      stdoutChunks.push(chunk)
    })

    proc.stderr?.on("data", (chunk: Buffer) => {
      stderrSize += chunk.length
      if (stderrSize > maxBuffer) {
        proc.kill()
        return settle(undefined, new Error("Превышен лимит вывода ошибок"))
      }
      stderrChunks.push(chunk)
    })

    proc.on("error", (err: Error) => settle(undefined, err))

    proc.on("close", (code: number | null) => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf-8")
      const stderr = Buffer.concat(stderrChunks).toString("utf-8")
      if (code === 0) {
        settle({ stdout, stderr }, undefined)
      } else {
        settle(undefined, new Error(`Выходной код: ${code ?? -1}` + (stderr ? `\n${stderr}` : "")))
      }
    })
  })
}

/**
 * Git-сервис. Предоставляет различия, статус, информацию о ветке
 * и внедрение контекста различий для агента.
 */
export class GitService implements Plugin, IGitService {
  name = "git"
  private root: string | null = null

  async init(): Promise<void> {}

  async findRoot(cwd: string): Promise<string | null> {
    if (this.root) return this.root
    try {
      const { stdout } = await gitSpawn(cwd, ["rev-parse", "--show-toplevel"], GIT_ROOT_TIMEOUT_MS)
      this.root = stdout.trim()
      return this.root
    } catch (err: unknown) {
      const msg = errorMessage(err)
      log.error(`Не удалось определить корень репозитория: ${msg}`)
      this.root = cwd
      return null
    }
  }

  async getDiff(dir: string): Promise<GitDiffOutcome> {
    try {
      const { stdout } = await gitSpawn(dir, ["diff", "--stat", "--numstat"], GIT_DIFF_TIMEOUT_MS)
      const lines = stdout.trim().split("\n")
      const changed: string[] = []
      let additions = 0
      let deletions = 0

      for (const line of lines) {
        const match = line.match(/^(\d+)\t(\d+)\t(.+)$/)
        if (match) {
          additions += Number(match[1])
          deletions += Number(match[2])
          changed.push(match[3])
        }
      }

      return { ok: true, changed, additions, deletions }
    } catch (err: unknown) {
      const msg = errorMessage(err)
      log.error(`Не удалось получить изменения Git: ${msg}`)
      return { ok: false, error: msg }
    }
  }

  async getBranchInfo(dir: string): Promise<GitBranchInfo | null> {
    try {
      const { stdout } = await gitSpawn(dir, ["status", "--porcelain=2", "--branch"], GIT_DIFF_TIMEOUT_MS)
      const headBranch = stdout.match(/^# host .* head (.*?) branch.*/m)
      const behindAhead = stdout.match(/^# .* (\d+) .* (\d+)/m)
      return {
        name: headBranch?.[1] ?? "неизвестно",
        ahead: behindAhead?.[1] ? Number(behindAhead[1]) : 0,
        behind: behindAhead?.[2] ? Number(behindAhead[2]) : 0,
      }
    } catch (err: unknown) {
      const msg = errorMessage(err)
      log.error(`Не удалось получить информацию о ветке: ${msg}`)
      return null
    }
  }

  async getDiffContext(dir: string): Promise<string> {
    try {
      const { stdout } = await gitSpawn(
        dir,
        ["diff", "--unified=0"],
        GIT_DIFF_TIMEOUT_MS,
        GIT_MAX_BUFFER,
      )
      if (!stdout.trim()) return ""
      return `## Изменения Git (не добавленные)\n\`\`\`diff\n${stdout.slice(0, 10000)}\n\`\`\``
    } catch (err: unknown) {
      const msg = errorMessage(err)
      log.error(`Не удалось получить diff: ${msg}`)
      return ""
    }
  }

  async getCachedDiff(dir: string): Promise<string> {
    try {
      const { stdout } = await gitSpawn(
        dir,
        ["diff", "--cached"],
        GIT_DIFF_TIMEOUT_MS,
        GIT_MAX_BUFFER,
      )
      return stdout
    } catch (err: unknown) {
      const msg = errorMessage(err)
      log.error(`Не удалось получить staged diff: ${msg}`)
      return ""
    }
  }

  dispose(): void {}
}
