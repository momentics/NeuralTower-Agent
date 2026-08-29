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
  record: (hash: string, endHash: string, files: string[]) => ISnapshotRecord
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
    seed: true,
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
    record: (hash, endHash, files) => ({
      runId: "run-1",
      sessionId: "sess-1",
      kind: "request",
      hash,
      endHash,
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
    const result = await fx.service.revert(fx.record(hash, patch.endHash, patch.files))
    expect(result.ok).toBe(true)
    expect(result.failed).toHaveLength(0)
    expect(await fs.readFile(path.join(fx.repo, "a.txt"), "utf-8")).toBe("alpha\n")
  })

  it("revert deletes file created during the run", async () => {
    const hash = (await fx.service.track())!
    const newFile = path.join(fx.repo, "new.txt")
    await fs.writeFile(newFile, "new\n", "utf-8")
    const patch = await fx.service.patch(hash)
    const result = await fx.service.revert(fx.record(hash, patch.endHash, patch.files))
    expect(result.ok).toBe(true)
    expect(result.deleted).toContain(toPosix(newFile))
    await expect(fs.stat(newFile)).rejects.toThrow()
  })

  it("revert returns deleted file", async () => {
    const hash = (await fx.service.track())!
    const file = path.join(fx.repo, "sub", "b.txt")
    await fs.rm(file)
    const patch = await fx.service.patch(hash)
    const result = await fx.service.revert(fx.record(hash, patch.endHash, patch.files))
    expect(result.ok).toBe(true)
    expect(result.restored).toContain(toPosix(file))
    expect(await fs.readFile(file, "utf-8")).toBe("beta\n")
  })

  it("revert fails fast when snapshot hash is missing", async () => {
    const hash = (await fx.service.track())!
    await fs.writeFile(path.join(fx.repo, "a.txt"), "changed\n", "utf-8")
    const missing = "0".repeat(40)
    const result = await fx.service.revert(
      fx.record(missing, missing, [toPosix(path.join(fx.repo, "a.txt"))]),
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

      const result = await service.revert(fx.record(hash, patch.endHash, patch.files))
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
    const result = await fx.service.revert(fx.record(hash, hash, [outside]))
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
      expect(await service.patch("abc")).toEqual({ hash: "abc", endHash: "abc", files: [] })
      const result = await service.revert({
        runId: "r",
        sessionId: "s",
        kind: "request",
        hash: "abc",
        endHash: "abc",
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
    expect(await service.patch("abc")).toEqual({ hash: "abc", endHash: "abc", files: [] })
    const result = await service.revert({
      runId: "r",
      sessionId: "s",
      kind: "request",
      hash: "abc",
      endHash: "abc",
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
      fx.service.revert(fx.record(hash, patch.endHash, patch.files)),
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


  it("track фиксирует коммит на refs/nt/snapshots", async () => {
    const hash = (await fx.service.track())!
    const res = await git(
      ["--git-dir", fx.mirror, "rev-parse", "--verify", "refs/nt/snapshots^{tree}"],
      fx.repo,
    )
    expect(res.code).toBe(0)
    expect(res.stdout.trim()).toBe(hash)
  })

  it("повторный track без изменений не создаёт новый коммит", async () => {
    await fx.service.track()
    await fx.service.track()
    const res = await git(
      ["--git-dir", fx.mirror, "rev-list", "--count", "refs/nt/snapshots"],
      fx.repo,
    )
    expect(res.stdout.trim()).toBe("1")
  })

  it("быстрый путь patch без изменений: endHash = hash, write-tree не нужен", async () => {
    const h = (await fx.service.track())!
    const p = await fx.service.patch(h)
    expect(p).toEqual({ hash: h, endHash: h, files: [] })
  })

  it("patch с изменениями возвращает endHash ≠ hash", async () => {
    const h = (await fx.service.track())!
    await fs.writeFile(path.join(fx.repo, "a.txt"), "changed\n", "utf-8")
    const p = await fx.service.patch(h)
    expect(p.hash).toBe(h)
    expect(p.endHash).not.toBe(p.hash)
    expect(p.files).toContain(toPosix(path.join(fx.repo, "a.txt")))
  })

  it("revert пропускает файл, изменённый пользователем после запроса", async () => {
    const h = (await fx.service.track())!
    const aFile = toPosix(path.join(fx.repo, "a.txt"))
    await fs.writeFile(path.join(fx.repo, "a.txt"), "agent\n", "utf-8")
    const p = await fx.service.patch(h)
    await fs.writeFile(path.join(fx.repo, "a.txt"), "user\n", "utf-8")
    const r = await fx.service.revert(fx.record(h, p.endHash, [aFile]))
    expect(r.skipped.some((s) => s.file === aFile)).toBe(true)
    expect(r.restored).toHaveLength(0)
    expect(r.ok).toBe(true)
    // Правка пользователя сохранена
    expect(await fs.readFile(path.join(fx.repo, "a.txt"), "utf-8")).toBe("user\n")
  })

  it("revert с forceFiles затирает правку пользователя", async () => {
    const h = (await fx.service.track())!
    const aFile = toPosix(path.join(fx.repo, "a.txt"))
    await fs.writeFile(path.join(fx.repo, "a.txt"), "agent\n", "utf-8")
    const p = await fx.service.patch(h)
    await fs.writeFile(path.join(fx.repo, "a.txt"), "user\n", "utf-8")
    const r = await fx.service.revert(fx.record(h, p.endHash, [aFile]), { forceFiles: [aFile] })
    expect(r.restored).toContain(aFile)
    expect(r.skipped).toHaveLength(0)
    // Содержимое возвращено к состоянию «до запроса»
    expect(await fs.readFile(path.join(fx.repo, "a.txt"), "utf-8")).toBe("alpha\n")
  })

  it("revert удаляет созданный запросом файл, если пользователь не трогал", async () => {
    const h = (await fx.service.track())!
    const newFile = toPosix(path.join(fx.repo, "new.txt"))
    await fs.writeFile(path.join(fx.repo, "new.txt"), "new\n", "utf-8")
    const p = await fx.service.patch(h)
    const r = await fx.service.revert(fx.record(h, p.endHash, [newFile]))
    expect(r.deleted).toContain(newFile)
    expect(r.ok).toBe(true)
    await expect(fs.stat(path.join(fx.repo, "new.txt"))).rejects.toThrow()
  })

  it("revert восстанавливает удалённый запросом файл", async () => {
    const h = (await fx.service.track())!
    const bFile = toPosix(path.join(fx.repo, "sub", "b.txt"))
    await fs.rm(path.join(fx.repo, "sub", "b.txt"))
    const p = await fx.service.patch(h)
    const r = await fx.service.revert(fx.record(h, p.endHash, [bFile]))
    expect(r.restored).toContain(bFile)
    expect(r.ok).toBe(true)
    expect(await fs.readFile(path.join(fx.repo, "sub", "b.txt"), "utf-8")).toBe("beta\n")
  })

  it("cleanup удаляет старые коммиты, свежие сохраняет", async () => {
    await fx.service.track()
    // Задатированный коммит текущего дерева зеркала на ref снимков
    const treeRes = await git(["--git-dir", fx.mirror, "write-tree"], fx.repo)
    const treeHash = treeRes.stdout.trim()
    expect(treeHash).toBeTruthy()
    const oldCommit = await runProcess(
      "git",
      ["--git-dir", fx.mirror, "commit-tree", "-m", "old snapshot", treeHash],
      {
        cwd: fx.repo,
        env: {
          ...process.env,
          GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
          GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
        },
        timeout: 15000,
      },
    )
    const oldHash = oldCommit.stdout.trim()
    expect(oldHash).toBeTruthy()
    await git(["--git-dir", fx.mirror, "update-ref", "refs/nt/snapshots", oldHash], fx.repo)
    // Свежий снимок: новое дерево → новый коммит в цепочке
    await fs.writeFile(path.join(fx.repo, "a.txt"), "changed\n", "utf-8")
    const fresh = await fx.service.track()
    expect(fresh).toBeTruthy()
    await fx.service.cleanup()
    const count = await git(
      ["--git-dir", fx.mirror, "rev-list", "--count", "refs/nt/snapshots"],
      fx.repo,
    )
    expect(count.stdout.trim()).toBe("1")
  })

  it("снимок переживает cleanup", async () => {
    const h = (await fx.service.track())!
    await fs.writeFile(path.join(fx.repo, "a.txt"), "changed\n", "utf-8")
    const p = await fx.service.patch(h)
    await fx.service.cleanup()
    const r = await fx.service.revert(fx.record(h, p.endHash, [toPosix(path.join(fx.repo, "a.txt"))]))
    expect(r.ok).toBe(true)
  })

  it("разогрев создаёт alternates и переиспользует объекты", async () => {
    const hash = (await fx.service.track())!
    expect(hash).toBeTruthy()
    // alternates указывает на objects исходного репозитория
    // (realpath: на Windows temp-путь может быть в 8.3-форме, а git возвращает полную)
    const alt = await fs.readFile(path.join(fx.mirror, "objects", "info", "alternates"), "utf-8")
    const expectedObjects = toPosix(await fs.realpath(path.join(fx.repo, ".git", "objects")))
    expect(toPosix(await fs.realpath(alt.trim()))).toBe(expectedObjects)
    // oid a.txt в индексе зеркала совпадает с oid в индексе исходного репозитория
    const mirrorIdx = await git(["--git-dir", fx.mirror, "ls-files", "-s", "--", "a.txt"], fx.repo)
    const sourceIdx = await git(["ls-files", "-s", "--", "a.txt"], fx.repo)
    expect(mirrorIdx.code).toBe(0)
    expect(sourceIdx.code).toBe(0)
    expect(mirrorIdx.stdout.trim()).toBe(sourceIdx.stdout.trim())
  })

  it("разогрев отключается настройкой", async () => {
    const noSeed = await createFixture({ seed: false })
    try {
      const hash = (await noSeed.service.track())!
      expect(hash).toBeTruthy()
      await expect(
        fs.access(path.join(noSeed.mirror, "objects", "info", "alternates")),
      ).rejects.toThrow()
    } finally {
      noSeed.service.dispose()
      await cleanup(noSeed.root)
    }
  })

  it("снимки переживают cleanup с alternates", async () => {
    const h = (await fx.service.track())!
    await fs.writeFile(path.join(fx.repo, "a.txt"), "changed\n", "utf-8")
    const p = await fx.service.patch(h)
    await fx.service.cleanup()
    const r = await fx.service.revert(fx.record(h, p.endHash, [toPosix(path.join(fx.repo, "a.txt"))]))
    expect(r.ok).toBe(true)
  })

  it("requestDiff определяет статусы modified/added/deleted", async () => {
    const h = (await fx.service.track())!
    await fs.writeFile(path.join(fx.repo, "a.txt"), "changed\n", "utf-8")
    await fs.writeFile(path.join(fx.repo, "new.txt"), "new\n", "utf-8")
    await fs.rm(path.join(fx.repo, "sub", "b.txt"))
    const p = await fx.service.patch(h)
    const d = await fx.service.requestDiff(fx.record(h, p.endHash, p.files))
    expect(d).not.toBeNull()
    const byName = new Map(d!.files.map((f) => [path.basename(f.path), f]))
    expect(byName.get("a.txt")?.status).toBe("modified")
    expect(byName.get("new.txt")?.status).toBe("added")
    expect(byName.get("b.txt")?.status).toBe("deleted")
    expect(d!.files.every((f) => f.userTouched === false)).toBe(true)
  })

  it("requestDiff показывает содержимое diff", async () => {
    const h = (await fx.service.track())!
    await fs.writeFile(path.join(fx.repo, "a.txt"), "changed\n", "utf-8")
    const p = await fx.service.patch(h)
    const d = await fx.service.requestDiff(fx.record(h, p.endHash, p.files))
    const a = d!.files.find((f) => f.path === toPosix(path.join(fx.repo, "a.txt")))
    expect(a).toBeTruthy()
    expect(a!.diff).toContain("+changed")
  })

  it("requestDiff помечает правку пользователя", async () => {
    const h = (await fx.service.track())!
    const aFile = toPosix(path.join(fx.repo, "a.txt"))
    await fs.writeFile(path.join(fx.repo, "a.txt"), "agent\n", "utf-8")
    const p = await fx.service.patch(h)
    // Пользователь изменил файл уже после запроса
    await fs.writeFile(path.join(fx.repo, "a.txt"), "user\n", "utf-8")
    const d = await fx.service.requestDiff(fx.record(h, p.endHash, [aFile]))
    const a = d!.files.find((f) => f.path === aFile)
    expect(a!.userTouched).toBe(true)
  })

  it("requestDiff возвращает null для несуществующего снимка", async () => {
    const d = await fx.service.requestDiff(fx.record("0".repeat(40), "0".repeat(40), []))
    expect(d).toBeNull()
  })

  it("never touches the source repository .git", async () => {
    const gitDir = path.join(fx.repo, ".git")
    const before = await listDirWithHashes(gitDir)

    const hash = (await fx.service.track())!
    await fs.writeFile(path.join(fx.repo, "a.txt"), "changed\n", "utf-8")
    await fs.writeFile(path.join(fx.repo, "new.txt"), "new\n", "utf-8")
    const patch = await fx.service.patch(hash)
    expect(patch.files.length).toBeGreaterThanOrEqual(2)
    await fx.service.revert(fx.record(hash, patch.endHash, patch.files))

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
