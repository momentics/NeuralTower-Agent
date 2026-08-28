import { describe, it, expect } from "vitest"
import * as os from "os"
import * as path from "path"
import type { IGitRunner, IGitRunOptions, IGitRunResult } from "./GitRunner"
import { GitUnavailableError } from "./GitRunner"
import { GitOperations } from "./GitOperations"
import {
  GIT_READ_TIMEOUT_MS,
  GIT_WRITE_TIMEOUT_MS,
  GIT_NETWORK_TIMEOUT_MS,
  GIT_DIFF_MAX_OUTPUT_CHARS,
  GIT_MESSAGE_MAX_LENGTH,
} from "./GitTypes"

// Платформо-независимый абсолютный корень (path.resolve валиден только для реальных путей)
const REPO = path.resolve(os.tmpdir(), "repo")

interface Call {
  args: string[]
  options: IGitRunOptions
}

/**
 * Фейковый git-раннер: фиксирует вызовы, возвращает результаты из очереди.
 * Шов для тестов — GitOperations не знает о процессах.
 */
class FakeRunner implements IGitRunner {
  calls: Call[] = []
  private results: IGitRunResult[]
  private pendingError: Error | null = null

  constructor(results: IGitRunResult[] = []) {
    this.results = results
  }

  failNext(err: Error): void {
    this.pendingError = err
  }

  async run(args: string[], options: IGitRunOptions): Promise<IGitRunResult> {
    this.calls.push({ args, options })
    if (this.pendingError) {
      const err = this.pendingError
      this.pendingError = null
      throw err
    }
    if (this.results.length > 1) return this.results.shift()!
    return this.results[0] ?? { stdout: "", stderr: "", code: 0 }
  }

  async isAvailable(): Promise<boolean> {
    return true
  }
}

function ok(stdout: string): IGitRunResult {
  return { stdout, stderr: "", code: 0 }
}

function fail(stderr: string, code = 1): IGitRunResult {
  return { stdout: "", stderr, code }
}

function makeOps(runner: FakeRunner, root: string | null = REPO): GitOperations {
  return new GitOperations(runner, async () => root)
}

describe("GitOperations.classify", () => {
  it("returns safe for read-only operations", () => {
    const ops = makeOps(new FakeRunner())
    for (const name of ["status", "diff", "log", "show", "branch_list", "remote_list", "stash_list"]) {
      expect(ops.classify(name)).toBe("safe")
    }
  })

  it("returns dangerous for network and irreversible operations", () => {
    const ops = makeOps(new FakeRunner())
    for (const name of ["push", "pull", "reset", "clean"]) {
      expect(ops.classify(name)).toBe("dangerous")
    }
  })

  it("returns ask for local mutating operations", () => {
    const ops = makeOps(new FakeRunner())
    for (const name of ["add", "commit", "checkout", "branch_create", "switch", "stash_push", "stash_pop", "fetch"]) {
      expect(ops.classify(name)).toBe("ask")
    }
  })

  it("returns ask for unknown operations", () => {
    const ops = makeOps(new FakeRunner())
    expect(ops.classify("unknown")).toBe("ask")
  })
})

describe("GitOperations.execute — dispatch and errors", () => {
  it("rejects unknown operation without running git", async () => {
    const runner = new FakeRunner()
    const ops = makeOps(runner)
    const r = await ops.execute("nope", {})
    expect(r.success).toBe(false)
    expect(r.output).toContain("Неизвестная операция")
    expect(runner.calls).toHaveLength(0)
  })

  it("returns not-a-repo when root is null", async () => {
    const ops = makeOps(new FakeRunner(), null)
    const r = await ops.execute("status", {})
    expect(r).toEqual({ success: false, output: "Не git-репозиторий" })
  })

  it("returns git-not-found when runner throws GitUnavailableError", async () => {
    const runner = new FakeRunner()
    runner.failNext(new GitUnavailableError())
    const ops = makeOps(runner)
    const r = await ops.execute("status", {})
    expect(r.success).toBe(false)
    expect(r.output).toBe("git не найден в PATH")
  })

  it("returns timeout message with remote hint for network operations", async () => {
    const runner = new FakeRunner()
    runner.failNext(new Error("Превышен таймаут процесса (120000 мс)"))
    const ops = makeOps(runner)
    const r = await ops.execute("fetch", {})
    expect(r.success).toBe(false)
    expect(r.output).toContain("не завершилась за 120000 мс")
    expect(r.output).toContain("remote")
  })

  it("returns timeout message without remote hint for local operations", async () => {
    const runner = new FakeRunner()
    runner.failNext(new Error("Превышен таймаут процесса (30000 мс)"))
    const ops = makeOps(runner)
    const r = await ops.execute("commit", { message: "x" })
    expect(r.success).toBe(false)
    expect(r.output).toContain("не завершилась за 30000 мс")
    expect(r.output).not.toContain("Проверьте доступность remote")
  })

  it("passes read timeout for safe operations", async () => {
    const runner = new FakeRunner([ok("## main\n")])
    const ops = makeOps(runner)
    await ops.execute("status", {})
    expect(runner.calls[0].options.timeout).toBe(GIT_READ_TIMEOUT_MS)
  })

  it("passes write timeout for ask operations", async () => {
    const runner = new FakeRunner([ok("## stash\n")])
    const ops = makeOps(runner)
    await ops.execute("stash_push", {})
    expect(runner.calls[0].options.timeout).toBe(GIT_WRITE_TIMEOUT_MS)
  })

  it("passes network timeout for fetch/push/pull", async () => {
    const runner = new FakeRunner([ok("")])
    const ops = makeOps(runner)
    await ops.execute("push", {})
    expect(runner.calls[0].options.timeout).toBe(GIT_NETWORK_TIMEOUT_MS)
  })

  it("runs git in the repo root", async () => {
    const runner = new FakeRunner([ok("## main\n")])
    const ops = makeOps(runner)
    await ops.execute("status", {})
    expect(runner.calls[0].options.workTree).toBe(REPO)
  })
})

describe("GitOperations.status", () => {
  it("formats branch with tracking and changes", async () => {
    const runner = new FakeRunner([
      ok("## main...origin/main [ahead 1, behind 0]\n M src/foo.ts\n?? src/bar.ts\nA  src/baz.ts\n"),
    ])
    const ops = makeOps(runner)
    const r = await ops.execute("status", {})
    expect(r.success).toBe(true)
    expect(r.output).toBe(
      "Ветка: main (ahead 1, behind 0)\nИзменения:\n   M src/foo.ts\n  ?? src/bar.ts\n  A  src/baz.ts",
    )
  })

  it("reports clean repo", async () => {
    const runner = new FakeRunner([ok("## main\n")])
    const ops = makeOps(runner)
    const r = await ops.execute("status", {})
    expect(r.output).toBe("Ветка: main\nНет изменений")
  })

  it("reports branch without upstream", async () => {
    const runner = new FakeRunner([ok("## feature\n M a.ts\n")])
    const ops = makeOps(runner)
    const r = await ops.execute("status", {})
    expect(r.output).toBe("Ветка: feature\nИзменения:\n   M a.ts")
  })

  it("reports detached HEAD", async () => {
    const runner = new FakeRunner([ok("## HEAD (no branch)\n")])
    const ops = makeOps(runner)
    const r = await ops.execute("status", {})
    expect(r.output).toBe("Ветка: (отключённый HEAD)\nНет изменений")
  })

  it("returns failure on git error", async () => {
    const runner = new FakeRunner([fail("fatal: boom")])
    const ops = makeOps(runner)
    const r = await ops.execute("status", {})
    expect(r.success).toBe(false)
    expect(r.output).toContain("fatal: boom")
  })
})

describe("GitOperations.diff", () => {
  it("includes stat block and unified patch by default", async () => {
    const runner = new FakeRunner([
      ok(" src/a.ts | 2 +-\n 1 file changed, 1 insertion(+), 1 deletion(-)\n"),
      ok("--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n"),
    ])
    const ops = makeOps(runner)
    const r = await ops.execute("diff", {})
    expect(r.success).toBe(true)
    expect(r.output).toContain("1 file changed")
    expect(r.output).toContain("+new")
    expect(runner.calls[0].args).toEqual(["diff", "--no-color", "--stat"])
    expect(runner.calls[1].args).toEqual(["diff", "--no-color"])
  })

  it("uses --cached for staged diff", async () => {
    const runner = new FakeRunner([ok(""), ok("patch")])
    const ops = makeOps(runner)
    await ops.execute("diff", { staged: true })
    expect(runner.calls[0].args).toEqual(["diff", "--no-color", "--cached", "--stat"])
  })

  it("filters by file", async () => {
    const runner = new FakeRunner([ok(""), ok("patch")])
    const ops = makeOps(runner)
    const r = await ops.execute("diff", { file: "src/a.ts" })
    expect(r.success).toBe(true)
    expect(runner.calls[0].args).toEqual(["diff", "--no-color", "--", "src/a.ts", "--stat"])
  })

  it("skips stat call when stat=false", async () => {
    const runner = new FakeRunner([ok("patch")])
    const ops = makeOps(runner)
    await ops.execute("diff", { stat: false })
    expect(runner.calls).toHaveLength(1)
    expect(runner.calls[0].args).toEqual(["diff", "--no-color"])
  })

  it("reports no changes", async () => {
    const runner = new FakeRunner([ok(""), ok("")])
    const ops = makeOps(runner)
    const r = await ops.execute("diff", {})
    expect(r.output).toBe("Нет изменений")
  })

  it("truncates long diff with marker", async () => {
    const runner = new FakeRunner([ok(""), ok("x".repeat(GIT_DIFF_MAX_OUTPUT_CHARS + 5000))])
    const ops = makeOps(runner)
    const r = await ops.execute("diff", {})
    expect(r.output.endsWith("…обрезано")).toBe(true)
    expect(r.output.length).toBeLessThanOrEqual(GIT_DIFF_MAX_OUTPUT_CHARS + 20)
  })

  it("rejects path traversal in file", async () => {
    const runner = new FakeRunner()
    const ops = makeOps(runner)
    const r = await ops.execute("diff", { file: "../../etc/passwd" })
    expect(r.success).toBe(false)
    expect(r.output).toContain("Некорректный аргумент file")
    expect(runner.calls).toHaveLength(0)
  })

  it("rejects absolute path in file", async () => {
    const runner = new FakeRunner()
    const ops = makeOps(runner)
    const r = await ops.execute("diff", { file: "/etc/passwd" })
    expect(r.success).toBe(false)
    expect(r.output).toContain("относительным")
  })
})

describe("GitOperations.log", () => {
  it("uses default limit 10", async () => {
    const runner = new FakeRunner([ok("abc1234 subject\n")])
    const ops = makeOps(runner)
    await ops.execute("log", {})
    expect(runner.calls[0].args).toEqual(["log", "--oneline", "--decorate", "--no-color", "-n", "10"])
  })

  it("clamps limit to max 100", async () => {
    const runner = new FakeRunner([ok("")])
    const ops = makeOps(runner)
    await ops.execute("log", { limit: 10000 })
    expect(runner.calls[0].args).toContain("100")
  })

  it("clamps limit to min 1", async () => {
    const runner = new FakeRunner([ok("")])
    const ops = makeOps(runner)
    await ops.execute("log", { limit: 0 })
    expect(runner.calls[0].args).toContain("1")
  })

  it("reports empty history", async () => {
    const runner = new FakeRunner([ok("")])
    const ops = makeOps(runner)
    const r = await ops.execute("log", {})
    expect(r.output).toBe("Нет коммитов")
  })

  it("maps no-commits-yet error", async () => {
    const runner = new FakeRunner([fail("fatal: your current branch 'main' does not have any commits yet")])
    const ops = makeOps(runner)
    const r = await ops.execute("log", {})
    expect(r.success).toBe(false)
    expect(r.output).toContain("В репозитории нет коммитов")
  })
})

describe("GitOperations.show", () => {
  it("shows HEAD by default", async () => {
    const runner = new FakeRunner([ok(""), ok("commit abc\nstat\npatch")])
    const ops = makeOps(runner)
    const r = await ops.execute("show", {})
    expect(r.success).toBe(true)
    expect(runner.calls[0].args).toEqual(["rev-parse", "--verify", "--quiet", "HEAD^{commit}"])
    expect(runner.calls[1].args).toEqual(["show", "--no-color", "--stat", "HEAD"])
  })

  it("rejects unknown ref (not found in repo)", async () => {
    const runner = new FakeRunner([fail("", 1)])
    const ops = makeOps(runner)
    const r = await ops.execute("show", { ref: "no-such-branch" })
    expect(r.success).toBe(false)
    expect(r.output).toContain("не найден в репозитории")
  })

  it("shows a custom ref", async () => {
    const runner = new FakeRunner([ok("v1.0"), ok("commit def")])
    const ops = makeOps(runner)
    await ops.execute("show", { ref: "v1.0" })
    expect(runner.calls[1].args).toEqual(["show", "--no-color", "--stat", "v1.0"])
  })

  it("rejects invalid ref format", async () => {
    const runner = new FakeRunner([fail("fatal: 'a..b' is not a valid refname")])
    const ops = makeOps(runner)
    const r = await ops.execute("show", { ref: "a..b" })
    expect(r.success).toBe(false)
    expect(r.output).toContain("Некорректный аргумент ref")
  })
})

describe("GitOperations.branch_list / remote_list / stash_list", () => {
  it("lists local branches", async () => {
    const runner = new FakeRunner([ok("* main abc1234 subject\n  dev def5678 subject\n")])
    const ops = makeOps(runner)
    const r = await ops.execute("branch_list", {})
    expect(r.success).toBe(true)
    expect(runner.calls[0].args).toEqual(["branch", "-v", "--no-color"])
    expect(r.output).toContain("* main")
  })

  it("lists remote branches", async () => {
    const runner = new FakeRunner([ok("  origin/main abc1234 subject\n")])
    const ops = makeOps(runner)
    await ops.execute("branch_list", { remote: true })
    expect(runner.calls[0].args).toEqual(["branch", "-v", "--no-color", "--remotes"])
  })

  it("reports no branches", async () => {
    const runner = new FakeRunner([ok("")])
    const ops = makeOps(runner)
    const r = await ops.execute("branch_list", {})
    expect(r.output).toBe("Нет веток")
  })

  it("lists remotes", async () => {
    const runner = new FakeRunner([ok("origin\thttps://host/repo (fetch)\n")])
    const ops = makeOps(runner)
    const r = await ops.execute("remote_list", {})
    expect(r.success).toBe(true)
    expect(r.output).toContain("origin")
  })

  it("reports no remotes", async () => {
    const runner = new FakeRunner([ok("")])
    const ops = makeOps(runner)
    const r = await ops.execute("remote_list", {})
    expect(r.output).toBe("Remote не настроены")
  })

  it("lists stash entries", async () => {
    const runner = new FakeRunner([ok("stash@{0}: WIP on main: abc1234 subject\n")])
    const ops = makeOps(runner)
    const r = await ops.execute("stash_list", {})
    expect(r.output).toContain("stash@{0}")
  })

  it("reports empty stash", async () => {
    const runner = new FakeRunner([ok("")])
    const ops = makeOps(runner)
    const r = await ops.execute("stash_list", {})
    expect(r.output).toBe("Stash пуст")
  })
})

describe("GitOperations.add", () => {
  it("stages everything when files is empty", async () => {
    const runner = new FakeRunner([ok("")])
    const ops = makeOps(runner)
    const r = await ops.execute("add", {})
    expect(r.success).toBe(true)
    expect(runner.calls[0].args).toEqual(["add", "-A"])
    expect(r.output).toBe("Все изменения добавлены в index")
  })

  it("stages specific files", async () => {
    const runner = new FakeRunner([ok("")])
    const ops = makeOps(runner)
    const r = await ops.execute("add", { files: ["src/a.ts", "src/b.ts"] })
    expect(r.success).toBe(true)
    expect(runner.calls[0].args).toEqual(["add", "--", "src/a.ts", "src/b.ts"])
    expect(r.output).toBe("Добавлено в index: src/a.ts, src/b.ts")
  })

  it("rejects path traversal in files", async () => {
    const runner = new FakeRunner()
    const ops = makeOps(runner)
    const r = await ops.execute("add", { files: ["../outside.ts"] })
    expect(r.success).toBe(false)
    expect(r.output).toContain("Некорректный аргумент files")
    expect(runner.calls).toHaveLength(0)
  })
})

describe("GitOperations.commit", () => {
  it("creates commit and reports hash", async () => {
    const runner = new FakeRunner([ok("[main 1a2b3c4] test commit\n 1 file changed\n")])
    const ops = makeOps(runner)
    const r = await ops.execute("commit", { message: "test commit" })
    expect(r.success).toBe(true)
    expect(r.output).toBe("Коммит создан: 1a2b3c4")
    expect(runner.calls[0].args).toEqual(["commit", "-m", "test commit"])
  })

  it("rejects empty message before running git", async () => {
    const runner = new FakeRunner()
    const ops = makeOps(runner)
    const r = await ops.execute("commit", { message: "   " })
    expect(r.success).toBe(false)
    expect(r.output).toContain("Некорректный аргумент message")
    expect(runner.calls).toHaveLength(0)
  })

  it("rejects overlong message", async () => {
    const runner = new FakeRunner()
    const ops = makeOps(runner)
    const r = await ops.execute("commit", { message: "x".repeat(GIT_MESSAGE_MAX_LENGTH + 1) })
    expect(r.success).toBe(false)
    expect(r.output).toContain("длиннее")
  })

  it("reports nothing to commit", async () => {
    const runner = new FakeRunner([fail("On branch main\nnothing to commit, working tree clean")])
    const ops = makeOps(runner)
    const r = await ops.execute("commit", { message: "x" })
    expect(r.success).toBe(false)
    expect(r.output).toBe("Нет изменений для коммита")
  })

  it("stages all changes first when all=true", async () => {
    const runner = new FakeRunner([ok(""), ok("[main 5d6e7f8] x")])
    const ops = makeOps(runner)
    const r = await ops.execute("commit", { message: "x", all: true })
    expect(r.success).toBe(true)
    expect(runner.calls[0].args).toEqual(["add", "-A"])
    expect(runner.calls[1].args).toEqual(["commit", "-m", "x"])
  })
})

describe("GitOperations.checkout", () => {
  it("switches branch", async () => {
    const runner = new FakeRunner([ok("dev"), ok("Switched to branch 'dev'")])
    const ops = makeOps(runner)
    const r = await ops.execute("checkout", { branch: "dev" })
    expect(r.success).toBe(true)
    expect(r.output).toBe("Переключено на ветку: dev")
    expect(runner.calls[1].args).toEqual(["checkout", "dev"])
  })

  it("restores files from HEAD by default", async () => {
    const runner = new FakeRunner([ok("HEAD"), ok("")])
    const ops = makeOps(runner)
    const r = await ops.execute("checkout", { files: ["src/a.ts"] })
    expect(r.success).toBe(true)
    expect(r.output).toBe("Файлы восстановлены из HEAD: src/a.ts")
    expect(runner.calls[1].args).toEqual(["checkout", "HEAD", "--", "src/a.ts"])
  })

  it("restores files from a custom ref", async () => {
    const runner = new FakeRunner([ok("v1.0"), ok("")])
    const ops = makeOps(runner)
    await ops.execute("checkout", { files: ["src/a.ts"], from: "v1.0" })
    expect(runner.calls[1].args).toEqual(["checkout", "v1.0", "--", "src/a.ts"])
  })

  it("rejects both branch and files", async () => {
    const runner = new FakeRunner()
    const ops = makeOps(runner)
    const r = await ops.execute("checkout", { branch: "dev", files: ["src/a.ts"] })
    expect(r.success).toBe(false)
    expect(r.output).toContain("ровно одно из branch или files")
    expect(runner.calls).toHaveLength(0)
  })

  it("rejects neither branch nor files", async () => {
    const runner = new FakeRunner()
    const ops = makeOps(runner)
    const r = await ops.execute("checkout", {})
    expect(r.success).toBe(false)
    expect(r.output).toContain("ровно одно из branch или files")
  })

  it("reports git error for missing branch", async () => {
    const runner = new FakeRunner([ok("dev"), fail("error: pathspec 'dev' did not match any file(s) known to git")])
    const ops = makeOps(runner)
    const r = await ops.execute("checkout", { branch: "dev" })
    expect(r.success).toBe(false)
    expect(r.output).toContain("pathspec 'dev'")
  })
})

describe("GitOperations.branch_create", () => {
  it("creates branch without checkout", async () => {
    const runner = new FakeRunner([ok("feature"), ok("")])
    const ops = makeOps(runner)
    const r = await ops.execute("branch_create", { name: "feature" })
    expect(r.success).toBe(true)
    expect(r.output).toBe("Ветка создана: feature")
    expect(runner.calls).toHaveLength(2)
    expect(runner.calls[1].args).toEqual(["branch", "feature"])
  })

  it("creates and checks out branch", async () => {
    const runner = new FakeRunner([ok("feature"), ok(""), ok("Switched to a new branch 'feature'")])
    const ops = makeOps(runner)
    const r = await ops.execute("branch_create", { name: "feature", checkout: true })
    expect(r.success).toBe(true)
    expect(r.output).toBe("Ветка создана и активна: feature")
    expect(runner.calls[2].args).toEqual(["checkout", "feature"])
  })

  it("rejects invalid branch name via check-ref-format", async () => {
    const runner = new FakeRunner([fail("fatal: 'bad ref' is not a valid refname")])
    const ops = makeOps(runner)
    const r = await ops.execute("branch_create", { name: "bad ref" })
    expect(r.success).toBe(false)
    expect(r.output).toContain("Некорректный аргумент name")
  })

  it("rejects empty name", async () => {
    const runner = new FakeRunner()
    const ops = makeOps(runner)
    const r = await ops.execute("branch_create", { name: "" })
    expect(r.success).toBe(false)
    expect(r.output).toContain("Некорректный аргумент name")
    expect(runner.calls).toHaveLength(0)
  })
})

describe("GitOperations.switch", () => {
  it("switches to existing branch", async () => {
    const runner = new FakeRunner([ok("dev"), ok("Switched to branch 'dev'")])
    const ops = makeOps(runner)
    const r = await ops.execute("switch", { branch: "dev" })
    expect(r.success).toBe(true)
    expect(runner.calls[1].args).toEqual(["switch", "dev"])
  })

  it("reports error for missing branch", async () => {
    const runner = new FakeRunner([ok("nope"), fail("error: pathspec 'nope' did not match any file(s) known to git")])
    const ops = makeOps(runner)
    const r = await ops.execute("switch", { branch: "nope" })
    expect(r.success).toBe(false)
    expect(r.output).toContain("pathspec 'nope'")
  })
})

describe("GitOperations.stash", () => {
  it("pushes stash without message", async () => {
    const runner = new FakeRunner([ok("Saved working directory and index state On main: wip\n")])
    const ops = makeOps(runner)
    const r = await ops.execute("stash_push", {})
    expect(r.success).toBe(true)
    expect(runner.calls[0].args).toEqual(["stash", "push"])
  })

  it("pushes stash with message", async () => {
    const runner = new FakeRunner([ok("Saved working directory and index state On main: wip\n")])
    const ops = makeOps(runner)
    const r = await ops.execute("stash_push", { message: "wip" })
    expect(r.success).toBe(true)
    expect(runner.calls[0].args).toEqual(["stash", "push", "-m", "wip"])
    expect(r.output).toContain("wip")
  })

  it("reports no local changes", async () => {
    const runner = new FakeRunner([fail("No local changes to save")])
    const ops = makeOps(runner)
    const r = await ops.execute("stash_push", {})
    expect(r.success).toBe(false)
    expect(r.output).toBe("Нет изменений для сохранения в stash")
  })

  it("pops default stash entry", async () => {
    const runner = new FakeRunner([ok("Dropped refs/stash@{0} (abc)\n")])
    const ops = makeOps(runner)
    const r = await ops.execute("stash_pop", {})
    expect(r.success).toBe(true)
    expect(runner.calls[0].args).toEqual(["stash", "pop"])
  })

  it("pops stash entry by index", async () => {
    const runner = new FakeRunner([ok("Dropped refs/stash@{2} (abc)\n")])
    const ops = makeOps(runner)
    await ops.execute("stash_pop", { index: 2 })
    expect(runner.calls[0].args).toEqual(["stash", "pop", "stash@{2}"])
  })

  it("rejects negative index", async () => {
    const runner = new FakeRunner()
    const ops = makeOps(runner)
    const r = await ops.execute("stash_pop", { index: -1 })
    expect(r.success).toBe(false)
    expect(r.output).toContain("Некорректный аргумент index")
    expect(runner.calls).toHaveLength(0)
  })

  it("reports empty stash on pop", async () => {
    const runner = new FakeRunner([fail("No stash entries found.")])
    const ops = makeOps(runner)
    const r = await ops.execute("stash_pop", {})
    expect(r.success).toBe(false)
    expect(r.output).toBe("Stash пуст")
  })
})

describe("GitOperations.fetch", () => {
  it("uses non-interactive env", async () => {
    const runner = new FakeRunner([ok("")])
    const ops = makeOps(runner)
    await ops.execute("fetch", {})
    const env = runner.calls[0].options.env
    expect(env?.GIT_TERMINAL_PROMPT).toBe("0")
    expect(env?.GIT_SSH_COMMAND).toBe("ssh -o BatchMode=yes")
    expect(env?.EDITOR).toBeUndefined()
  })

  it("fetches a specific remote", async () => {
    const runner = new FakeRunner([ok("")])
    const ops = makeOps(runner)
    await ops.execute("fetch", { remote: "origin" })
    expect(runner.calls[0].args).toEqual(["fetch", "origin"])
  })

  it("reports offline error", async () => {
    const runner = new FakeRunner([fail("fatal: unable to access 'https://host/repo.git/': Could not resolve host: host")])
    const ops = makeOps(runner)
    const r = await ops.execute("fetch", {})
    expect(r.success).toBe(false)
    expect(r.output).toContain("Could not resolve host")
  })
})

describe("GitOperations.push", () => {
  it("pushes without force by default", async () => {
    const runner = new FakeRunner([ok("")])
    const ops = makeOps(runner)
    await ops.execute("push", {})
    expect(runner.calls[0].args).toEqual(["push"])
  })

  it("passes --force when force=true", async () => {
    const runner = new FakeRunner([ok("")])
    const ops = makeOps(runner)
    await ops.execute("push", { force: true })
    expect(runner.calls[0].args).toEqual(["push", "--force"])
  })

  it("pushes to remote and branch", async () => {
    const runner = new FakeRunner([ok("dev"), ok("")])
    const ops = makeOps(runner)
    await ops.execute("push", { remote: "origin", branch: "dev" })
    expect(runner.calls[1].args).toEqual(["push", "origin", "dev"])
  })

  it("maps non-fast-forward rejection", async () => {
    const runner = new FakeRunner([
      fail(
        "To https://host/repo.git\n ! [rejected]        main -> main (non-fast-forward)\nerror: failed to push some refs",
      ),
    ])
    const ops = makeOps(runner)
    const r = await ops.execute("push", {})
    expect(r.success).toBe(false)
    expect(r.output).toContain("Push отклонён: remote содержит новые коммиты. Сначала выполните pull.")
  })

  it("maps authentication failure", async () => {
    const runner = new FakeRunner([fail("fatal: Authentication failed for 'https://host/repo.git/'")])
    const ops = makeOps(runner)
    const r = await ops.execute("push", {})
    expect(r.success).toBe(false)
    expect(r.output).toContain("Ошибка аутентификации remote.")
  })

  it("uses non-interactive env", async () => {
    const runner = new FakeRunner([ok("")])
    const ops = makeOps(runner)
    await ops.execute("push", {})
    expect(runner.calls[0].options.env?.GIT_TERMINAL_PROMPT).toBe("0")
  })
})

describe("GitOperations.pull", () => {
  it("pulls with merge by default", async () => {
    const runner = new FakeRunner([ok("Merge made by the 'ort' strategy.\n")])
    const ops = makeOps(runner)
    const r = await ops.execute("pull", {})
    expect(r.success).toBe(true)
    expect(runner.calls[0].args).toEqual(["pull"])
  })

  it("pulls with rebase", async () => {
    const runner = new FakeRunner([ok("")])
    const ops = makeOps(runner)
    await ops.execute("pull", { rebase: true })
    expect(runner.calls[0].args).toEqual(["pull", "--rebase"])
  })

  it("maps merge conflicts with file list", async () => {
    const runner = new FakeRunner([
      fail(
        "Auto-merging src/a.ts\n" +
          "CONFLICT (content): Merge conflict in src/a.ts\n" +
          "Auto-merging src/b.ts\n" +
          "CONFLICT (content): Merge conflict in src/b.ts\n" +
          "Automatic merge failed; fix conflicts and then commit the result.",
      ),
    ])
    const ops = makeOps(runner)
    const r = await ops.execute("pull", {})
    expect(r.success).toBe(false)
    expect(r.output).toContain("Конфликты слияния.")
    expect(r.output).toContain("src/a.ts")
    expect(r.output).toContain("src/b.ts")
    expect(r.output).toContain("Разрешите конфликты и выполните commit.")
  })
})

describe("GitOperations.reset", () => {
  it("resets soft by default", async () => {
    const runner = new FakeRunner([ok("")])
    const ops = makeOps(runner)
    const r = await ops.execute("reset", {})
    expect(r.success).toBe(true)
    expect(runner.calls[0].args).toEqual(["reset", "--soft"])
  })

  it("resets hard to a ref", async () => {
    const runner = new FakeRunner([ok("HEAD"), ok("")])
    const ops = makeOps(runner)
    await ops.execute("reset", { mode: "hard", ref: "HEAD" })
    expect(runner.calls[1].args).toEqual(["reset", "--hard", "HEAD"])
  })

  it("resets mixed", async () => {
    const runner = new FakeRunner([ok("")])
    const ops = makeOps(runner)
    await ops.execute("reset", { mode: "mixed" })
    expect(runner.calls[0].args).toEqual(["reset", "--mixed"])
  })

  it("rejects invalid mode", async () => {
    const runner = new FakeRunner()
    const ops = makeOps(runner)
    const r = await ops.execute("reset", { mode: "nuclear" })
    expect(r.success).toBe(false)
    expect(r.output).toContain("Некорректный аргумент mode")
    expect(runner.calls).toHaveLength(0)
  })
})

describe("GitOperations.clean", () => {
  it("dry-run by default", async () => {
    const runner = new FakeRunner([ok("Would remove tmp.txt\n")])
    const ops = makeOps(runner)
    const r = await ops.execute("clean", {})
    expect(r.success).toBe(true)
    expect(runner.calls[0].args).toEqual(["clean", "-n"])
    expect(r.output).toContain("Будут удалены")
    expect(r.output).toContain("tmp.txt")
  })

  it("deletes when dryRun=false", async () => {
    const runner = new FakeRunner([ok("Removed tmp.txt\n")])
    const ops = makeOps(runner)
    const r = await ops.execute("clean", { dryRun: false })
    expect(r.success).toBe(true)
    expect(runner.calls[0].args).toEqual(["clean", "-f"])
    expect(r.output).toContain("Удалено")
  })

  it("includes directories when dirs=true", async () => {
    const runner = new FakeRunner([ok("")])
    const ops = makeOps(runner)
    await ops.execute("clean", { dirs: true })
    expect(runner.calls[0].args).toEqual(["clean", "-n", "-d"])
  })

  it("reports nothing to clean", async () => {
    const runner = new FakeRunner([ok("")])
    const ops = makeOps(runner)
    const r = await ops.execute("clean", {})
    expect(r.output).toBe("Неотслеживаемых файлов нет")
  })
})

describe("GitOperations — name injection protection", () => {
  const injections = ["a; rm -rf x", "a|b", "a$b", "a`b", "a&b", "a..b", "-rf", "a\nb"]

  for (const name of injections) {
    it(`rejects branch name "${name}"`, async () => {
      const runner = new FakeRunner()
      const ops = makeOps(runner)
      const r = await ops.execute("branch_create", { name })
      expect(r.success).toBe(false)
      expect(r.output).toContain("Некорректный аргумент name")
      expect(runner.calls).toHaveLength(0)
    })
  }

  it("rejects ref with newline in show", async () => {
    const runner = new FakeRunner()
    const ops = makeOps(runner)
    const r = await ops.execute("show", { ref: "a\nb" })
    expect(r.success).toBe(false)
    expect(r.output).toContain("Некорректный аргумент ref")
    expect(runner.calls).toHaveLength(0)
  })

  it("rejects remote with shell metacharacters in fetch", async () => {
    const runner = new FakeRunner()
    const ops = makeOps(runner)
    const r = await ops.execute("fetch", { remote: "origin; rm -rf x" })
    expect(r.success).toBe(false)
    expect(r.output).toContain("Некорректный аргумент remote")
    expect(runner.calls).toHaveLength(0)
  })
})

describe("GitOperations.describeOperation", () => {
  const ops = makeOps(new FakeRunner())

  it("describes safe operations", () => {
    expect(ops.describeOperation("status", {})).toBe("Статус репозитория")
    expect(ops.describeOperation("diff", { staged: true, file: "a.ts" })).toBe("Различия (staged: a.ts)")
    expect(ops.describeOperation("log", {})).toContain("История коммитов")
  })

  it("labels force push risk", () => {
    const d = ops.describeOperation("push", { force: true, remote: "origin", branch: "main" })
    expect(d).toBe("Force push в origin/main (перезапишет историю remote)")
  })

  it("labels hard reset risk", () => {
    const d = ops.describeOperation("reset", { mode: "hard" })
    expect(d).toContain("Hard reset")
    expect(d).toContain("безвозвратно")
  })

  it("labels clean deletion risk", () => {
    expect(ops.describeOperation("clean", { dryRun: false })).toContain("Удаление неотслеживаемых файлов")
    expect(ops.describeOperation("clean", {})).toContain("без удаления")
  })

  it("labels pull merge risk", () => {
    expect(ops.describeOperation("pull", {})).toContain("возможны конфликты")
    expect(ops.describeOperation("pull", { rebase: true })).toContain("rebase")
  })

  it("describes commit with message", () => {
    expect(ops.describeOperation("commit", { message: "fix: bug\n\nbody" })).toBe("Коммит: fix: bug")
  })
})
