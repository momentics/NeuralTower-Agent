import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { spawnSync } from "child_process"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { runProcess } from "../../utils/ProcessRunner"
import { GitRunner } from "./GitRunner"
import { GitOperations } from "./GitOperations"
import { GitTool } from "../../tools/builtins/GitTool"

// Если git не установлен — интеграционный тест пропускается
const hasGit = (() => {
  try {
    return spawnSync("git", ["--version"], { timeout: 5000 }).status === 0
  } catch {
    return false
  }
})()

/**
 * Интеграционный тест: реальный GitRunner против реального временного
 * git-репозитория — полный цикл status → add → commit → branch → reset → clean.
 * Покрывает платформенные нюансы (CRLF на Windows, пути, флаги git).
 */
describe.skipIf(!hasGit)("GitOperations — real git integration", () => {
  let dir: string
  const runner = new GitRunner()
  const savedEnv: Record<string, string | undefined> = {}

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "nt-git-e2e-"))
    // Изолированное git-identity: тест не зависит от глобальной конфигурации машины
    for (const key of ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"]) {
      savedEnv[key] = process.env[key]
      process.env[key] = key.includes("EMAIL") ? "nt-e2e@test.local" : "NT E2E"
    }
    const sh = (args: string[]) => runProcess("git", args, { cwd: dir, timeout: 30000 })
    return sh(["init", "-b", "main"]).then(() => {
      fs.writeFileSync(path.join(dir, "a.txt"), "one\n")
      return sh(["add", "a.txt"])
    }).then(() => sh(["commit", "-m", "init"]))
  })

  afterAll(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
  })

  const ops = new GitOperations(runner, async () => dir)

  // Windows: core.autocrlf конвертирует LF→CRLF в working tree — сравниваем с нормализацией
  const readNorm = (p: string) => fs.readFileSync(p, "utf-8").replace(/\r\n/g, "\n")

  it("status: clean repo", async () => {
    const r = await ops.execute("status", {})
    expect(r.success).toBe(true)
    expect(r.output).toContain("Ветка: main")
    expect(r.output).toContain("Нет изменений")
  })

  it("full cycle: modify → add → commit", async () => {
    fs.writeFileSync(path.join(dir, "b.txt"), "two\n")
    let r = await ops.execute("status", {})
    expect(r.output).toContain("?? b.txt")

    r = await ops.execute("add", { files: ["b.txt"] })
    expect(r.success).toBe(true)

    r = await ops.execute("diff", { staged: true })
    expect(r.output).toContain("b.txt")

    r = await ops.execute("commit", { message: "add b" })
    expect(r.success).toBe(true)
    expect(r.output).toMatch(/^Коммит создан: [0-9a-f]+$/)

    r = await ops.execute("log", {})
    expect(r.output).toContain("add b")
    expect(r.output).toContain("init")
  })

  it("branch cycle: create → switch → back", async () => {
    let r = await ops.execute("branch_create", { name: "feature/e2e" })
    expect(r.success).toBe(true)

    r = await ops.execute("switch", { branch: "feature/e2e" })
    expect(r.success).toBe(true)

    r = await ops.execute("branch_list", {})
    expect(r.output).toContain("feature/e2e")
    expect(r.output).toContain("main")

    r = await ops.execute("switch", { branch: "main" })
    expect(r.success).toBe(true)
  })

  it("reset: hard discards uncommitted changes", async () => {
    fs.writeFileSync(path.join(dir, "a.txt"), "changed\n")
    const r = await ops.execute("reset", { mode: "hard" })
    expect(r.success).toBe(true)
    expect(readNorm(path.join(dir, "a.txt"))).toBe("one\n")
    const s = await ops.execute("status", {})
    expect(s.output).toContain("Нет изменений")
  })

  it("clean: dry-run lists, then removes untracked", async () => {
    fs.writeFileSync(path.join(dir, "tmp.txt"), "x\n")
    let r = await ops.execute("clean", {})
    expect(r.success).toBe(true)
    expect(r.output).toContain("tmp.txt")
    expect(fs.existsSync(path.join(dir, "tmp.txt"))).toBe(true)

    r = await ops.execute("clean", { dryRun: false })
    expect(r.success).toBe(true)
    expect(fs.existsSync(path.join(dir, "tmp.txt"))).toBe(false)
  })

  it("checkout: restore file from HEAD", async () => {
    fs.writeFileSync(path.join(dir, "a.txt"), "modified\n")
    const r = await ops.execute("checkout", { files: ["a.txt"] })
    expect(r.success).toBe(true)
    expect(readNorm(path.join(dir, "a.txt"))).toBe("one\n")
  })

  it("GitTool: status end to end through the tool", async () => {
    const tool = new GitTool(dir, runner)
    const r = await tool.execute({ operation: "status" })
    expect(r.success).toBe(true)
    expect(r.output).toContain("Ветка: main")
    expect(tool.isSafeForArgs?.({ operation: "status" })).toBe(true)
    expect(tool.isSafeForArgs?.({ operation: "push" })).toBe(false)
  })

  it("GitTool: plain folder without git reports not-a-repo", async () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), "nt-git-plain-"))
    try {
      const tool = new GitTool(plain, runner)
      const r = await tool.execute({ operation: "status" })
      expect(r.success).toBe(false)
      expect(r.output).toBe("Не git-репозиторий")
    } finally {
      fs.rmSync(plain, { recursive: true, force: true })
    }
  })
})
