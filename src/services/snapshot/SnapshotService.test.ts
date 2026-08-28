import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { execFileSync } from "child_process"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { runProcess } from "../../utils/ProcessRunner"
import { GitRunner, GitUnavailableError, type IGitRunner } from "../git/GitRunner"
import { SnapshotService } from "./SnapshotService"
import { SnapshotError, type ISnapshotConfig, type ISnapshotRecord } from "./SnapshotTypes"

// Тесты требуют реальный git; без него — пропускаются.
let hasGit = false
try {
  execFileSync("git", ["--version"], { stdio: "ignore" })
  hasGit = true
} catch {
  hasGit = false
}

const describeGit = hasGit ? describe : describe.skip

/** Выполнить git-команду в указанной директории. */
async function git(
  args: string[],
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const res = await runProcess("git", args, { cwd, timeout: 15_000 })
  return { code: res.code ?? 1, stdout: res.stdout, stderr: res.stderr }
}

function toPosix(p: string): string {
  return p.replace(/\\/g, "/")
}

interface Fixture {
  root: string
  repo: string
  mirror: string
  service: SnapshotService
  config: ISnapshotConfig
  record: (hash: string, files: string[]) => ISnapshotRecord
}

/**
 * Создать временный git-репозиторий с исходными файлами
 * и сервис снапшотов с зеркалом в соседней директории.
 */
async function createFixture(configOverrides: Partial<ISnapshotConfig> = {}): Promise<Fixture> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "snapshot-svc-"))
  const repo = path.join(root, "repo")
  const mirror = path.join(root, "mirror")
  await fs.mkdir(repo, { recursive: true })

  await git(["init", "-q"], repo)
  await git(["config", "user.email", "test@test.local"], repo)
  await git(["config", "user.name", "Test"], repo)
  await git(["config", "commit.gpgsign", "false"], repo)

  await fs.writeFile(path.join(repo, "a.txt"), "alpha\n", "utf-8")
  await fs.mkdir(path.join(repo, "sub"), { recursive: true })
  await fs.writeFile(path.join(repo, "sub", "b.txt"), "beta\n", "utf-8")
  await fs.writeFile(path.join(repo, ".gitignore"), "ignored.txt\n", "utf-8")
  await git(["add", "-A"], repo)
  await git(["commit", "-q", "-m", "initial"], repo)

  const config: ISnapshotConfig = {
    enabled: true,
    retentionDays: 7,
    maxFileSizeBytes: 2 * 1024 * 1024,
    ...configOverrides,
  }

  const service = new SnapshotService(
    repo,
    mirror,
    new GitRunner(),
    config,
    async () => {
      const res = await git(["rev-parse", "--show-toplevel"], repo)
      return res.code === 0 ? res.stdout.trim() : null
    },
  )

  return {
    root,
    repo,
    mirror,
    service,
    config,
    record: (hash, files) => ({
      runId: "run-1",
      sessionId: "sess-1",
      hash,
      files,
      createdAt: Date.now(),
    }),
  }
}

async function cleanup(root: string): Promise<void> {
  await fs.rm(root, { recursive: true, force: true })
}

describeGit("SnapshotService (интеграция с git)", () => {
  let fx: Fixture

  beforeEach(async () => {
    fx = await createFixture()
  })

  afterEach(async () => {
    fx.service.dispose()
    await cleanup(fx.root)
  })

  it("first track creates mirror with required config", async () => {
    const hash = await fx.service.track()
    expect(hash).toBeTruthy()

    const autocrlf = await git(["--git-dir", fx.mirror, "config", "core.autocrlf"], fx.repo)
    expect(autocrlf.stdout.trim()).toBe("false")
    const longpaths = await git(["--git-dir", fx.mirror, "config", "core.longpaths"], fx.repo)
    expect(longpaths.stdout.trim()).toBe("true")
    const fsmonitor = await git(["--git-dir", fx.mirror, "config", "core.fsmonitor"], fx.repo)
    expect(fsmonitor.stdout.trim()).toBe("false")
    const quotepath = await git(["--git-dir", fx.mirror, "config", "core.quotepath"], fx.repo)
    expect(quotepath.stdout.trim()).toBe("false")

    const exclude = await fs.readFile(path.join(fx.mirror, "info", "exclude"), "utf-8")
    expect(exclude).toContain("/.git")
  })

  it("track returns hash; repeated track without changes returns same hash", async () => {
    const h1 = await fx.service.track()
    const h2 = await fx.service.track()
    expect(h1).toBeTruthy()
    expect(h2).toBe(h1)
  })

  it("patch includes modified tracked file", async () => {
    const hash = (await fx.service.track())!
    await fs.writeFile(path.join(fx.repo, "a.txt"), "changed\n", "utf-8")
    const patch = await fx.service.patch(hash)
    expect(patch.hash).toBe(hash)
    expect(patch.files).toContain(toPosix(path.join(fx.repo, "a.txt")))
  })

  it("patch includes new untracked file", async () => {
    const hash = (await fx.service.track())!
    await fs.writeFile(path.join(fx.repo, "new.txt"), "new\n", "utf-8")
    const patch = await fx.service.patch(hash)
    expect(patch.files).toContain(toPosix(path.join(fx.repo, "new.txt")))
  })

  it("patch includes deleted file", async () => {
    const hash = (await fx.service.track())!
    await fs.rm(path.join(fx.repo, "sub", "b.txt"))
    const patch = await fx.service.patch(hash)
    expect(patch.files).toContain(toPosix(path.join(fx.repo, "sub", "b.txt")))
  })

  it("patch excludes gitignored file", async () => {
    const hash = (await fx.service.track())!
    await fs.writeFile(path.join(fx.repo, "ignored.txt"), "secret\n", "utf-8")
    const patch = await fx.service.patch(hash)
    expect(patch.files).not.toContain(toPosix(path.join(fx.repo, "ignored.txt")))
  })

  it("patch excludes large file and adds it to mirror exclude", async () => {
    const small = await createFixture({ maxFileSizeBytes: 1024 })
    try {
      const hash = (await small.service.track())!
      await fs.writeFile(path.join(small.repo, "big.bin"), Buffer.alloc(2048, 1))
      const patch = await small.service.patch(hash)
      expect(patch.files).not.toContain(toPosix(path.join(small.repo, "big.bin")))
      const exclude = await fs.readFile(path.join(small.mirror, "info", "exclude"), "utf-8")
      expect(exclude).toContain("/big.bin")
    } finally {
      small.service.dispose()
      await cleanup(small.root)
    }
  })

  it("revert restores modified file content", async () => {
    const hash = (await fx.service.track())!
    await fs.writeFile(path.join(fx.repo, "a.txt"), "changed\n", "utf-8")
    const patch = await fx.service.patch(hash)
    const result = await fx.service.revert(fx.record(hash, patch.files))
    expect(result.ok).toBe(true)
    expect(result.failed).toHaveLength(0)
    expect(await fs.readFile(path.join(fx.repo, "a.txt"), "utf-8")).toBe("alpha\n")
  })

  it("revert deletes file created during the run", async () => {
    const hash = (await fx.service.track())!
    const newFile = path.join(fx.repo, "new.txt")
    await fs.writeFile(newFile, "new\n", "utf-8")
    const patch = await fx.service.patch(hash)
    const result = await fx.service.revert(fx.record(hash, patch.files))
    expect(result.ok).toBe(true)
    expect(result.deleted).toContain(toPosix(newFile))
    await expect(fs.stat(newFile)).rejects.toThrow()
  })

  it("revert returns deleted file", async () => {
    const hash = (await fx.service.track())!
    const file = path.join(fx.repo, "sub", "b.txt")
    await fs.rm(file)
    const patch = await fx.service.patch(hash)
    const result = await fx.service.revert(fx.record(hash, patch.files))
    expect(result.ok).toBe(true)
    expect(result.restored).toContain(toPosix(file))
    expect(await fs.readFile(file, "utf-8")).toBe("beta\n")
  })

  it("revert fails fast when snapshot hash is missing", async () => {
    const hash = (await fx.service.track())!
    await fs.writeFile(path.join(fx.repo, "a.txt"), "changed\n", "utf-8")
    const missing = "0".repeat(40)
    const result = await fx.service.revert(
      fx.record(missing, [toPosix(path.join(fx.repo, "a.txt"))]),
    )
    expect(result.ok).toBe(false)
    expect(result.failed).toHaveLength(1)
    // Файлы не тронуты
    expect(await fs.readFile(path.join(fx.repo, "a.txt"), "utf-8")).toBe("changed\n")
  })

  it("revert reports partial failure without hiding restored files", async () => {
    // Мок-раннер: checkout, затрагивающий a.txt, симулирует сбой;
    // остальное — реальный git. Проверяется честный отчёт при частичном откате.
    const realRunner = new GitRunner()
    const failingRunner: IGitRunner = {
      run: (args, opts) =>
        args[0] === "checkout" && args.includes("a.txt")
          ? Promise.resolve({ stdout: "", stderr: "сбой checkout (симуляция)", code: 1 })
          : realRunner.run(args, opts),
      isAvailable: () => Promise.resolve(true),
    }
    const service = new SnapshotService(
      fx.repo,
      fx.mirror,
      failingRunner,
      fx.config,
      async () => fx.repo,
    )
    try {
      const hash = (await service.track())!
      await fs.writeFile(path.join(fx.repo, "a.txt"), "changed\n", "utf-8")
      await fs.writeFile(path.join(fx.repo, "sub", "b.txt"), "changed\n", "utf-8")
      const patch = await service.patch(hash)
      expect(patch.files).toHaveLength(2)

      const result = await service.revert(fx.record(hash, patch.files))
      expect(result.ok).toBe(false)
      expect(result.restored).toContain(toPosix(path.join(fx.repo, "sub", "b.txt")))
      expect(result.failed.some((f) => f.file === toPosix(path.join(fx.repo, "a.txt")))).toBe(true)
      // a.txt остался в изменённом состоянии
      expect(await fs.readFile(path.join(fx.repo, "a.txt"), "utf-8")).toBe("changed\n")
    } finally {
      service.dispose()
    }
  })

  it("revert rejects paths outside the workspace", async () => {
    const hash = (await fx.service.track())!
    const outside = toPosix(path.join(fx.root, "outside.txt"))
    const result = await fx.service.revert(fx.record(hash, [outside]))
    expect(result.ok).toBe(false)
    expect(result.failed[0].error).toContain("вне рабочей области")
  })

  it("non-git workspace: isEnabled false, methods are no-op", async () => {
    const plain = await fs.mkdtemp(path.join(os.tmpdir(), "snapshot-plain-"))
    try {
      const service = new SnapshotService(
        plain,
        path.join(plain, "mirror"),
        new GitRunner(),
        fx.config,
        async () => null,
      )
      expect(await service.track()).toBeNull()
      expect(service.isEnabled()).toBe(false)
      expect(await service.patch("abc")).toEqual({ hash: "abc", files: [] })
      const result = await service.revert({
        runId: "r",
        sessionId: "s",
        hash: "abc",
        files: [],
        createdAt: 1,
      })
      expect(result.ok).toBe(false)
      service.dispose()
    } finally {
      await cleanup(plain)
    }
  })

  it("git missing: isEnabled false, service degrades gracefully", async () => {
    const failingRunner = {
      run: vi.fn(async () => {
        throw new GitUnavailableError()
      }),
      isAvailable: vi.fn(async () => false),
    }
    const service = new SnapshotService(
      fx.repo,
      fx.mirror,
      failingRunner,
      fx.config,
      async () => fx.repo,
    )
    expect(await service.track()).toBeNull()
    expect(service.isEnabled()).toBe(false)
    expect(failingRunner.run).not.toHaveBeenCalled()
    service.dispose()
  })

  it("disabled config: all methods are no-op", async () => {
    const service = new SnapshotService(
      fx.repo,
      fx.mirror,
      new GitRunner(),
      { ...fx.config, enabled: false },
      async () => fx.repo,
    )
    expect(await service.track()).toBeNull()
    expect(await service.patch("abc")).toEqual({ hash: "abc", files: [] })
    const result = await service.revert({
      runId: "r",
      sessionId: "s",
      hash: "abc",
      files: [],
      createdAt: 1,
    })
    expect(result.ok).toBe(false)
    service.dispose()
  })

  it("restore does not change line endings (autocrlf=false)", async () => {
    const eolFile = path.join(fx.repo, "eol.txt")
    const original = Buffer.from("line1\r\nline2\r\n")
    await fs.writeFile(eolFile, original)
    await git(["add", "-A"], fx.repo)
    await git(["commit", "-q", "-m", "eol"], fx.repo)

    const hash = (await fx.service.track())!
    await fs.writeFile(eolFile, "changed\n", "utf-8")
    await fx.service.restore(hash)
    expect(await fs.readFile(eolFile)).toEqual(original)
  })

  it("restore throws SnapshotError for missing hash", async () => {
    await fx.service.track()
    await expect(fx.service.restore("0".repeat(40))).rejects.toThrow(SnapshotError)
  })

  it("parallel track and revert are serialized by mutex", async () => {
    const hash = (await fx.service.track())!
    await fs.writeFile(path.join(fx.repo, "a.txt"), "changed\n", "utf-8")
    const patch = await fx.service.patch(hash)
    const [h2, result] = await Promise.all([
      fx.service.track(),
      fx.service.revert(fx.record(hash, patch.files)),
    ])
    expect(h2).toBeTruthy()
    expect(result.ok).toBe(true)
    expect(await fs.readFile(path.join(fx.repo, "a.txt"), "utf-8")).toBe("alpha\n")
  })

  it("cleanup runs without errors and marks session done", async () => {
    await fx.service.track()
    await expect(fx.service.cleanup()).resolves.toBeUndefined()
    await expect(fx.service.cleanup()).resolves.toBeUndefined()
    expect(fx.service.isEnabled()).toBe(true)
  })

  it("never touches the source repository .git", async () => {
    const gitDir = path.join(fx.repo, ".git")
    const before = await listDirWithHashes(gitDir)

    const hash = (await fx.service.track())!
    await fs.writeFile(path.join(fx.repo, "a.txt"), "changed\n", "utf-8")
    await fs.writeFile(path.join(fx.repo, "new.txt"), "new\n", "utf-8")
    const patch = await fx.service.patch(hash)
    expect(patch.files.length).toBeGreaterThanOrEqual(2)
    await fx.service.revert(fx.record(hash, patch.files))

    const after = await listDirWithHashes(gitDir)
    // Главный .git проекта не читается и не пишется сервисом
    expect(after).toEqual(before)
  })
})

/**
 * Рекурсивно перечислить файлы директории с хэшами содержимого
 * (для проверки, что .git источника не изменялся).
 */
async function listDirWithHashes(dir: string): Promise<string[]> {
  const crypto = await import("crypto")
  const results: string[] = []
  const walk = async (d: string): Promise<void> => {
    let entries: Awaited<ReturnType<typeof fs.readdir>>
    try {
      entries = await fs.readdir(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(d, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (entry.isFile()) {
        const content = await fs.readFile(full)
        results.push(`${toPosix(path.relative(dir, full))}:${crypto.createHash("sha256").update(content).digest("hex")}`)
      }
    }
  }
  await walk(dir)
  return results.sort()
}
