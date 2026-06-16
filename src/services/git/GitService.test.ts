import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const mockExec = vi.fn()

vi.mock("child_process", () => ({
  exec: mockExec,
}))

describe("GitService", () => {
  let service: any

  beforeEach(async () => {
    mockExec.mockReset()
    const mod = await import("./GitService")
    service = new mod.GitService()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("findRoot returns root", async () => {
    mockExec.mockImplementation((cmd: string, opts: any, cb: any) => {
      setImmediate(() => cb(null, { stdout: "/repo\n", stderr: "" }))
    })
    const root = await service.findRoot("/work")
    expect(root).toBe("/repo")
  })

  it("findRoot returns null on error", async () => {
    mockExec.mockImplementation((cmd: string, opts: any, cb: any) => {
      setImmediate(() => cb(new Error("not a repo"), null))
    })
    const root = await service.findRoot("/work")
    expect(root).toBeNull()
  })

  it("getDiff returns changed files", async () => {
    mockExec.mockImplementation((cmd: string, opts: any, cb: any) => {
      setImmediate(() => cb(null, { stdout: "1\t2\tfile1.ts\n3\t4\tfile2.ts\n", stderr: "" }))
    })
    const result = await service.getDiff("/work")
    expect(result.changed).toEqual(["file1.ts", "file2.ts"])
    expect(result.additions).toBe(4)
    expect(result.deletions).toBe(6)
  })

  it("getDiff returns empty on error", async () => {
    mockExec.mockImplementation((cmd: string, opts: any, cb: any) => {
      setImmediate(() => cb(new Error("fail"), null))
    })
    const result = await service.getDiff("/work")
    expect(result.changed).toEqual([])
    expect(result.additions).toBe(0)
  })

  it("getStatus returns categorized files", async () => {
    mockExec.mockImplementation((cmd: string, opts: any, cb: any) => {
      setImmediate(() => cb(null, { stdout: "M file1.ts\n?? file2.ts\n M file3.ts\n", stderr: "" }))
    })
    const result = await service.getStatus("/work")
    expect(result.staged).toContain("ile1.ts")
    expect(result.unstaged).toContain("file2.ts")
    expect(result.unstaged).toContain("ile3.ts")
  })

  it("getStatus returns empty on error", async () => {
    mockExec.mockImplementation((cmd: string, opts: any, cb: any) => {
      setImmediate(() => cb(new Error("fail"), null))
    })
    const result = await service.getStatus("/work")
    expect(result.staged).toEqual([])
  })

  it("getBranchInfo returns branch info", async () => {
    mockExec.mockImplementation((cmd: string, opts: any, cb: any) => {
      setImmediate(() => cb(null, { stdout: "# host origin head main branch \"origin/main\"\n# upstream 1 0\n", stderr: "" }))
    })
    const result = await service.getBranchInfo("/work")
    expect(result).not.toBeNull()
    expect(result!.name).toBe("main")
  })

  it("getBranchInfo returns null on error", async () => {
    mockExec.mockImplementation((cmd: string, opts: any, cb: any) => {
      setImmediate(() => cb(new Error("fail"), null))
    })
    const result = await service.getBranchInfo("/work")
    expect(result).toBeNull()
  })

  it("getDiffContext returns diff", async () => {
    mockExec.mockImplementation((cmd: string, opts: any, cb: any) => {
      setImmediate(() => cb(null, { stdout: "--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old\n+new\n", stderr: "" }))
    })
    const result = await service.getDiffContext("/work")
    expect(result).toContain("Изменения Git")
    expect(result).toContain("```diff")
  })

  it("getDiffContext returns empty on no changes", async () => {
    mockExec.mockImplementation((cmd: string, opts: any, cb: any) => {
      setImmediate(() => cb(null, { stdout: "", stderr: "" }))
    })
    const result = await service.getDiffContext("/work")
    expect(result).toBe("")
  })

  it("generateCommitMessage returns message", async () => {
    mockExec.mockImplementation((cmd: string, opts: any, cb: any) => {
      setImmediate(() => cb(null, { stdout: " file1.ts | 1 +\n file2.ts | 2 ++\n 2 files changed, 3 insertions(+)\n", stderr: "" }))
    })
    const result = await service.generateCommitMessage("/work")
    expect(result).toContain("Добавленные изменения")
    expect(result).toContain("file1.ts")
  })

  it("generateCommitMessage returns empty on error", async () => {
    mockExec.mockImplementation((cmd: string, opts: any, cb: any) => {
      setImmediate(() => cb(new Error("fail"), null))
    })
    const result = await service.generateCommitMessage("/work")
    expect(result).toBe("")
  })

  it("getCachedDiff returns diff", async () => {
    mockExec.mockImplementation((cmd: string, opts: any, cb: any) => {
      setImmediate(() => cb(null, { stdout: "cached diff", stderr: "" }))
    })
    const result = await service.getCachedDiff("/work")
    expect(result).toBe("cached diff")
  })

  it("getCachedDiff returns empty on error", async () => {
    mockExec.mockImplementation((cmd: string, opts: any, cb: any) => {
      setImmediate(() => cb(new Error("fail"), null))
    })
    const result = await service.getCachedDiff("/work")
    expect(result).toBe("")
  })

  it("init and dispose are no-ops", async () => {
    await service.init()
    service.dispose()
  })
})
