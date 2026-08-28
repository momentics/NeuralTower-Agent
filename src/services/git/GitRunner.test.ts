import { describe, it, expect, vi, beforeEach } from "vitest"
import { EventEmitter } from "events"
import { GitRunner, GitUnavailableError, makeNonInteractiveEnv } from "./GitRunner"

// vi.mock поднимается выше импортов — мок создаём через vi.hoisted
const { mockSpawn } = vi.hoisted(() => ({ mockSpawn: vi.fn() }))

vi.mock("child_process", () => ({
  spawn: mockSpawn,
}))

interface MockProcess {
  proc: EventEmitter
  stdinWritten: string[]
  kill: () => void
}

/**
 * Создать мок процесса: по setImmediate эмитит data/close
 * (или error для spawn-сбоев). noClose — процесс «висит» (таймаут).
 */
function createMockProcess(options: {
  stdout?: string
  stderr?: string
  exitCode?: number
  spawnError?: NodeJS.ErrnoException
  noClose?: boolean
}): MockProcess {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
    stdin: { write: (s: string) => boolean; end: () => void; on: (ev: string, fn: () => void) => void }
    kill: () => void
  }
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  const stdinWritten: string[] = []
  proc.stdin = {
    write: (s: string) => {
      stdinWritten.push(s)
      return true
    },
    end: () => {},
    on: () => {},
  }
  proc.kill = vi.fn()

  setImmediate(() => {
    if (options.spawnError) {
      proc.emit("error", options.spawnError)
      return
    }
    if (options.noClose) return
    if (options.stdout) proc.stdout.emit("data", Buffer.from(options.stdout))
    if (options.stderr) proc.stderr.emit("data", Buffer.from(options.stderr))
    proc.emit("close", options.exitCode ?? 0)
  })

  return { proc, stdinWritten, kill: proc.kill }
}

function createEnoentError(): NodeJS.ErrnoException {
  const err = new Error("spawn git ENOENT") as NodeJS.ErrnoException
  err.code = "ENOENT"
  return err
}

describe("GitRunner", () => {
  let runner: GitRunner

  beforeEach(() => {
    mockSpawn.mockReset()
    runner = new GitRunner()
  })

  const baseOpts = { workTree: "/work", timeout: 1000 }

  it("run returns code, stdout and stderr", async () => {
    mockSpawn.mockReturnValue(createMockProcess({ stdout: "hello", stderr: "warn", exitCode: 0 }).proc)
    const result = await runner.run(["status"], baseOpts)
    expect(result).toEqual({ stdout: "hello", stderr: "warn", code: 0 })
  })

  it("run does not throw on non-zero exit code", async () => {
    mockSpawn.mockReturnValue(createMockProcess({ stdout: "", stderr: "ignored", exitCode: 1 }).proc)
    const result = await runner.run(["check-ignore", "--stdin"], baseOpts)
    expect(result.code).toBe(1)
    expect(result.stderr).toBe("ignored")
  })

  it("run passes --git-dir and --work-tree when gitDir is set", async () => {
    mockSpawn.mockReturnValue(createMockProcess({ exitCode: 0 }).proc)
    await runner.run(["write-tree"], { ...baseOpts, gitDir: "/mirror" })
    const [command, args] = vi.mocked(mockSpawn).mock.calls[0] as [string, string[]]
    expect(command).toBe("git")
    expect(args).toEqual(["--git-dir", "/mirror", "--work-tree", "/work", "write-tree"])
  })

  it("run omits --git-dir when gitDir is not set", async () => {
    mockSpawn.mockReturnValue(createMockProcess({ exitCode: 0 }).proc)
    await runner.run(["status"], baseOpts)
    const [, args] = vi.mocked(mockSpawn).mock.calls[0] as [string, string[]]
    expect(args).toEqual(["status"])
  })

  it("run writes stdin data to the process", async () => {
    const mock = createMockProcess({ exitCode: 0 })
    mockSpawn.mockReturnValue(mock.proc)
    await runner.run(["add", "--pathspec-from-file=-"], { ...baseOpts, stdin: "a\0b\0" })
    expect(mock.stdinWritten).toEqual(["a\0b\0"])
  })

  it("run passes extra env merged with process env", async () => {
    mockSpawn.mockReturnValue(createMockProcess({ exitCode: 0 }).proc)
    await runner.run(["init"], { ...baseOpts, env: { GIT_DIR: "/mirror" } })
    const [, , options] = vi.mocked(mockSpawn).mock.calls[0] as [string, string[], { env?: Record<string, string> }]
    expect(options.env?.GIT_DIR).toBe("/mirror")
    // process.env должен быть передан целиком (spawn требует полный набор)
    expect(Object.keys(options.env ?? {}).length).toBeGreaterThan(1)
  })

  it("run throws GitUnavailableError when git is missing", async () => {
    mockSpawn.mockReturnValue(createMockProcess({ spawnError: createEnoentError() }).proc)
    await expect(runner.run(["status"], baseOpts)).rejects.toThrow(GitUnavailableError)
  })

  it("run propagates timeout error", async () => {
    mockSpawn.mockReturnValue(createMockProcess({ noClose: true }).proc)
    await expect(runner.run(["status"], { workTree: "/work", timeout: 50 })).rejects.toThrow("таймаут")
  })

  it("isAvailable returns true and caches the result", async () => {
    mockSpawn.mockReturnValue(createMockProcess({ stdout: "git version 2.54.0\n", exitCode: 0 }).proc)
    expect(await runner.isAvailable()).toBe(true)
    expect(await runner.isAvailable()).toBe(true)
    expect(mockSpawn).toHaveBeenCalledTimes(1)
  })

  it("isAvailable returns false when git is missing", async () => {
    mockSpawn.mockReturnValue(createMockProcess({ spawnError: createEnoentError() }).proc)
    expect(await runner.isAvailable()).toBe(false)
  })
})

describe("makeNonInteractiveEnv", () => {
  it("removes editor and pager variables", () => {
    const env = makeNonInteractiveEnv({
      EDITOR: "vim",
      GIT_EDITOR: "vim",
      PAGER: "less",
      GIT_PAGER: "less",
      PATH: "x",
    })
    expect(env.EDITOR).toBeUndefined()
    expect(env.GIT_EDITOR).toBeUndefined()
    expect(env.PAGER).toBeUndefined()
    expect(env.GIT_PAGER).toBeUndefined()
    expect(env.PATH).toBe("x")
  })

  it("sets GIT_TERMINAL_PROMPT and GIT_SSH_COMMAND", () => {
    const env = makeNonInteractiveEnv({})
    expect(env.GIT_TERMINAL_PROMPT).toBe("0")
    expect(env.GIT_SSH_COMMAND).toBe("ssh -o BatchMode=yes")
  })

  it("keeps user-defined GIT_SSH_COMMAND", () => {
    const env = makeNonInteractiveEnv({ GIT_SSH_COMMAND: "ssh -o custom" })
    expect(env.GIT_SSH_COMMAND).toBe("ssh -o custom")
  })
})
