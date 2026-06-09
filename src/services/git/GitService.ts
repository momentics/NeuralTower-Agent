import type { Plugin } from "../../shared/types"
import { exec } from "child_process"
import { promisify } from "util"

const execAsync = promisify(exec)

export interface GitDiffResult {
  changed: string[]
  additions: number
  deletions: number
}

export interface GitStatusResult {
  staged: string[]
  unstaged: string[]
  untracked: string[]
}

export interface GitBranchInfo {
  name: string
  ahead: number
  behind: number
}

/**
 * Git-сервис. Предоставляет различия, статус, информацию о ветке
 * и внедрение контекста различий для агента.
 */
export class GitService implements Plugin {
  name = "git"
  version = "0.1.0"
  private root: string | null = null

  async init(): Promise<void> {}

  async findRoot(cwd: string): Promise<string | null> {
    if (this.root) return this.root
    try {
      const { stdout } = await execAsync(`git -C "${cwd}" rev-parse --show-toplevel`, {
        timeout: 5000,
      })
      this.root = stdout.trim()
      return this.root
    } catch {
      this.root = cwd
      return null
    }
  }

  async getDiff(dir: string): Promise<GitDiffResult> {
    try {
      const { stdout } = await execAsync(
        `git -C "${dir}" diff --stat --numstat`,
        { timeout: 10000 },
      )
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

      return { changed, additions, deletions }
    } catch {
      return { changed: [], additions: 0, deletions: 0 }
    }
  }

  async getStatus(dir: string): Promise<GitStatusResult> {
    try {
      const { stdout } = await execAsync(
        `git -C "${dir}" status --porcelain`,
        { timeout: 10000 },
      )
      const staged: string[] = []
      const unstaged: string[] = []
      const untracked: string[] = []

      for (const line of stdout.trim().split("\n").filter(Boolean)) {
        const x = line[0]
        const path = line.trim().slice(3)
        if (x === "A" || x === "M" || x === "D") staged.push(path)
        else if (line[1] === " ") untracked.push(path)
        else unstaged.push(path)
      }

      return { staged, unstaged, untracked }
    } catch {
      return { staged: [], unstaged: [], untracked: [] }
    }
  }

  async getBranchInfo(dir: string): Promise<GitBranchInfo | null> {
    try {
      const { stdout } = await execAsync(
        `git -C "${dir}" status --porcelain=2 --branch`,
        { timeout: 10000 },
      )
      const headBranch = stdout.match(/^# host .* head (.*?) branch.*/m)
      const behindAhead = stdout.match(/^# .* (\d+) .* (\d+)/m)
      return {
        name: headBranch?.[1] ?? "неизвестно",
        ahead: behindAhead?.[1] ? Number(behindAhead[1]) : 0,
        behind: behindAhead?.[2] ? Number(behindAhead[2]) : 0,
      }
    } catch {
      return null
    }
  }

  async getDiffContext(dir: string): Promise<string> {
    try {
      const { stdout } = await execAsync(
        `git -C "${dir}" diff --unified=0`,
        { timeout: 10000, maxBuffer: 512 * 1024 },
      )
      if (!stdout.trim()) return ""
      return `## Изменения Git (не добавленные)\n\`\`\`diff\n${stdout.slice(0, 10000)}\n\`\`\``
    } catch {
      return ""
    }
  }

  async generateCommitMessage(dir: string): Promise<string> {
    try {
      const { stdout } = await execAsync(
        `git -C "${dir}" diff --cached --stat`,
        { timeout: 10000 },
      )
      if (!stdout.trim()) return ""
      const lines = stdout.trim().split("\n")
      const summary = lines[lines.length - 1]
      const files = lines.slice(0, -1).map((l) => l.trim())
      return `Добавленные изменения:\n${files.join("\n")}\n${summary}`
    } catch {
      return ""
    }
  }

  async getCachedDiff(dir: string): Promise<string> {
    try {
      const { stdout } = await execAsync(
        `git -C "${dir}" diff --cached`,
        { timeout: 10000, maxBuffer: 512 * 1024 },
      )
      return stdout
    } catch {
      return ""
    }
  }

  dispose(): void {}
}
