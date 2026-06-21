import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { EventEmitter } from "events"

const mockSpawn = vi.fn()

vi.mock("child_process", () => ({
  spawn: mockSpawn,
}))

function createMockSpawn(stdoutData: string, stderrData = "", exitCode = 0): EventEmitter {
  const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => void }
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.kill = vi.fn()

  setImmediate(() => {
    if (stdoutData) {
      proc.stdout.emit("data", Buffer.from(stdoutData))
    }
    if (stderrData) {
      proc.stderr.emit("data", Buffer.from(stderrData))
    }
    proc.emit("close", exitCode)
  })

  return proc
}

function createMockSpawnError(errorMessage: string): EventEmitter {
  const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => void }
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.kill = vi.fn()

  setImmediate(() => {
    proc.stderr.emit("data", Buffer.from(errorMessage))
    proc.emit("close", 1)
  })

  return proc
}

describe("GitService", () => {
  let service: any

  beforeEach(async () => {
    mockSpawn.mockReset()
    const mod = await import("./GitService")
    service = new mod.GitService()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("findRoot returns root", async () => {
    mockSpawn.mockReturnValue(createMockSpawn("/repo\n"))
    const root = await service.findRoot("/work")
    expect(root).toBe("/repo")
  })

  it("findRoot returns null on error", async () => {
    mockSpawn.mockReturnValue(createMockSpawnError("not a repo"))
    const root = await service.findRoot("/work")
    expect(root).toBeNull()
  })

  it("getDiff returns changed files", async () => {
    mockSpawn.mockReturnValue(createMockSpawn("1\t2\tfile1.ts\n3\t4\tfile2.ts\n"))
    const result = await service.getDiff("/work")
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.changed).toEqual(["file1.ts", "file2.ts"])
      expect(result.additions).toBe(4)
      expect(result.deletions).toBe(6)
    }
  })

  it("getDiff returns error on failure", async () => {
    mockSpawn.mockReturnValue(createMockSpawnError("fail"))
    const result = await service.getDiff("/work")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBeDefined()
    }
  })

  it("getBranchInfo returns branch info", async () => {
    mockSpawn.mockReturnValue(createMockSpawn("# host origin head main branch \"origin/main\"\n# upstream 1 0\n"))
    const result = await service.getBranchInfo("/work")
    expect(result).not.toBeNull()
    expect(result!.name).toBe("main")
  })

  it("getBranchInfo returns null on error", async () => {
    mockSpawn.mockReturnValue(createMockSpawnError("fail"))
    const result = await service.getBranchInfo("/work")
    expect(result).toBeNull()
  })

  it("getDiffContext returns diff", async () => {
    mockSpawn.mockReturnValue(createMockSpawn("--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old\n+new\n"))
    const result = await service.getDiffContext("/work")
    expect(result).toContain("Изменения Git")
    expect(result).toContain("```diff")
  })

  it("getDiffContext returns empty on no changes", async () => {
    mockSpawn.mockReturnValue(createMockSpawn(""))
    const result = await service.getDiffContext("/work")
    expect(result).toBe("")
  })

  it("getCachedDiff returns diff", async () => {
    mockSpawn.mockReturnValue(createMockSpawn("cached diff"))
    const result = await service.getCachedDiff("/work")
    expect(result).toBe("cached diff")
  })

  it("getCachedDiff returns empty on error", async () => {
    mockSpawn.mockReturnValue(createMockSpawnError("fail"))
    const result = await service.getCachedDiff("/work")
    expect(result).toBe("")
  })

 
})
