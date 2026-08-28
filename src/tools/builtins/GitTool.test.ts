import { describe, it, expect } from "vitest"
import type { IGitRunner, IGitRunOptions, IGitRunResult } from "../../services/git/GitRunner"
import { GitTool } from "./GitTool"
import { GIT_OPERATIONS } from "../../services/git/GitTypes"

class FakeRunner implements IGitRunner {
  calls: { args: string[]; options: IGitRunOptions }[] = []
  private results: IGitRunResult[]

  constructor(results: IGitRunResult[] = []) {
    this.results = results
  }

  async run(args: string[], options: IGitRunOptions): Promise<IGitRunResult> {
    this.calls.push({ args, options })
    if (this.results.length > 1) return this.results.shift()!
    return this.results[0] ?? { stdout: "", stderr: "", code: 0 }
  }

  async isAvailable(): Promise<boolean> {
    return true
  }
}

const ok = (stdout: string): IGitRunResult => ({ stdout, stderr: "", code: 0 })
const fail = (stderr: string): IGitRunResult => ({ stdout: "", stderr, code: 1 })

describe("GitTool — schema", () => {
  const tool = new GitTool("/ws", new FakeRunner())

  it("is named git with git category", () => {
    expect(tool.name).toBe("git")
    expect(tool.category).toBe("git")
    expect(tool.isSafe).toBe(false)
  })

  it("exposes all 19 operations in the enum", () => {
    const enum_ = tool.schema.parameters.operation?.enum ?? []
    expect(enum_).toHaveLength(19)
    expect(enum_).toEqual([...GIT_OPERATIONS])
  })

  it("requires only the operation argument", () => {
    expect(tool.schema.required).toEqual(["operation"])
  })

  it("describes itself as the preferred path over bash", () => {
    expect(tool.description).toContain("а не bash")
  })
})

describe("GitTool — isSafeForArgs", () => {
  const tool = new GitTool("/ws", new FakeRunner())

  it("marks read-only operations as safe", () => {
    for (const op of ["status", "diff", "log", "show", "branch_list", "remote_list", "stash_list"]) {
      expect(tool.isSafeForArgs?.({ operation: op })).toBe(true)
    }
  })

  it("marks mutating operations as unsafe", () => {
    for (const op of ["add", "commit", "checkout", "push", "pull", "reset", "clean", "fetch"]) {
      expect(tool.isSafeForArgs?.({ operation: op })).toBe(false)
    }
  })

  it("marks unknown operations as unsafe", () => {
    expect(tool.isSafeForArgs?.({ operation: "nope" })).toBe(false)
    expect(tool.isSafeForArgs?.({})).toBe(false)
  })
})

describe("GitTool — describeCall", () => {
  const tool = new GitTool("/ws", new FakeRunner())

  it("describes a force push with risk label", () => {
    expect(tool.describeCall?.({ operation: "push", force: true, remote: "origin", branch: "main" })).toBe(
      "Force push в origin/main (перезапишет историю remote)",
    )
  })

  it("describes a hard reset with risk label", () => {
    expect(tool.describeCall?.({ operation: "reset", mode: "hard" })).toContain("безвозвратно")
  })

  it("describes a commit with its message", () => {
    expect(tool.describeCall?.({ operation: "commit", message: "fix: bug" })).toBe("Коммит: fix: bug")
  })
})

describe("GitTool — execute", () => {
  it("returns error when operation is missing", async () => {
    const tool = new GitTool("/ws", new FakeRunner())
    const r = await tool.execute({})
    expect(r.success).toBe(false)
    expect(r.output).toBe("Не указана операция")
  })

  it("resolves repo root once and runs status", async () => {
    const runner = new FakeRunner([ok("/repo\n"), ok("## main\n")])
    const tool = new GitTool("/ws", runner)
    const r = await tool.execute({ operation: "status" })
    expect(r.success).toBe(true)
    expect(r.output).toBe("Ветка: main\nНет изменений")
    expect(runner.calls[0].args).toEqual(["rev-parse", "--show-toplevel"])
    expect(runner.calls[0].options.workTree).toBe("/ws")
    expect(runner.calls[1].args).toEqual(["status", "--porcelain", "--branch"])
    expect(runner.calls[1].options.workTree).toBe("/repo")
  })

  it("caches the repo root across calls", async () => {
    const runner = new FakeRunner([ok("/repo\n"), ok("## main\n")])
    const tool = new GitTool("/ws", runner)
    await tool.execute({ operation: "status" })
    await tool.execute({ operation: "status" })
    const rootCalls = runner.calls.filter((c) => c.args[0] === "rev-parse")
    expect(rootCalls).toHaveLength(1)
  })

  it("reports non-git workspace", async () => {
    const runner = new FakeRunner([fail("fatal: not a git repository")])
    const tool = new GitTool("/ws", runner)
    const r = await tool.execute({ operation: "status" })
    expect(r.success).toBe(false)
    expect(r.output).toBe("Не git-репозиторий")
  })

  it("runs a safe read-only operation end to end", async () => {
    const runner = new FakeRunner([ok("/repo\n"), ok("abc1234 subject (HEAD -> main)\n")])
    const tool = new GitTool("/ws", runner)
    const r = await tool.execute({ operation: "log" })
    expect(r.success).toBe(true)
    expect(r.output).toContain("abc1234 subject")
  })

  it("returns error result for a failed mutating operation", async () => {
    const runner = new FakeRunner([ok("/repo\n"), fail("On branch main\nnothing to commit, working tree clean")])
    const tool = new GitTool("/ws", runner)
    const r = await tool.execute({ operation: "commit", message: "x" })
    expect(r.success).toBe(false)
    expect(r.output).toBe("Нет изменений для коммита")
  })

  it("aborts when the signal is already aborted", async () => {
    const tool = new GitTool("/ws", new FakeRunner())
    const controller = new AbortController()
    controller.abort()
    const r = await tool.execute({ operation: "status" }, controller.signal)
    expect(r.success).toBe(false)
    expect(r.output).toBe("Операция отменена")
  })
})
