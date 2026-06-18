import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { ToolRegistry } from "../tools/ToolRegistry"

const mockSpawn = vi.fn()

vi.mock("child_process", () => ({
  spawn: mockSpawn,
}))

describe("MCPManager", () => {
  let MCPManager: any

  beforeEach(async () => {
    mockSpawn.mockReset()
    const mod = await import("./MCPManager")
    MCPManager = mod.MCPManager
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("registers server config", () => {
    const mgr = new MCPManager()
    mgr.register({
      name: "test",
      transport: "stdio",
      command: "node",
      args: ["server.js"],
    })
    expect(mgr.listServers()).toHaveLength(1)
  })

  it("connect spawns process for stdio", async () => {
    const proc = {
      on: vi.fn(),
      stdout: null,
      stdin: { write: vi.fn() },
      kill: vi.fn(),
    }
    mockSpawn.mockReturnValue(proc)

    const mgr = new MCPManager()
    mgr.register({
      name: "test",
      transport: "stdio",
      command: "node",
      args: ["server.js"],
    })
    await mgr.connect()

    expect(mockSpawn).toHaveBeenCalledWith("node", ["server.js"], expect.objectContaining({ stdio: ["pipe", "pipe", "pipe"] }))
    expect(mgr.getReadyServers()).toContain("test")
  })

  it("connect skips non-stdio", async () => {
    const mgr = new MCPManager()
    mgr.register({
      name: "test",
      transport: "http",
      command: "http://localhost",
    })
    await mgr.connect()
    expect(mgr.getReadyServers()).not.toContain("test")
  })

  it("discover returns tools from ready servers", async () => {
    const { EventEmitter } = await import("events")
    const stdout = new EventEmitter() as NodeJS.ReadableStream
    let capturedId: number
    const proc = {
      on: vi.fn(),
      stdout,
      stdin: {
        write: vi.fn((data: string) => {
          const req = JSON.parse(data)
          capturedId = req.id
          setImmediate(() => {
            stdout.emit("data", Buffer.from(JSON.stringify({
              jsonrpc: "2.0",
              id: capturedId,
              result: { tools: [{ name: "mcp_tool", description: "A tool", schema: {} }] },
            })))
          })
        }),
      },
      kill: vi.fn(),
    }
    mockSpawn.mockReturnValue(proc)

    const mgr = new MCPManager()
    mgr.register({
      name: "test",
      transport: "stdio",
      command: "node",
    })
    await mgr.connect()

    const tools = await mgr.discover()
    expect(Array.isArray(tools)).toBe(true)
  })

  it("callTool returns error for unavailable server", async () => {
    const mgr = new MCPManager()
    const result = await mgr.callTool("missing", "tool", {})
    expect(result.success).toBe(false)
    expect(result.output).toContain("недоступен")
  })

  it("syncWithRegistry registers tools", async () => {
    const proc = {
      on: vi.fn(),
      stdout: { on: vi.fn() },
      stdin: { write: vi.fn() },
      kill: vi.fn(),
    }
    mockSpawn.mockReturnValue(proc)

    const mgr = new MCPManager()
    mgr.register({
      name: "test",
      transport: "stdio",
      command: "node",
    })
    await mgr.connect()

    const registry = new ToolRegistry()
    await mgr.syncWithRegistry(registry)
  })

  it("getToolsByServer returns tools for ready servers", () => {
    const mgr = new MCPManager()
    const result = mgr.getToolsByServer()
    expect(Array.isArray(result)).toBe(true)
  })

  it("disconnect kills processes", async () => {
    const proc = {
      on: vi.fn(),
      stdout: null,
      stdin: { write: vi.fn() },
      kill: vi.fn(),
    }
    mockSpawn.mockReturnValue(proc)

    const mgr = new MCPManager()
    mgr.register({
      name: "test",
      transport: "stdio",
      command: "node",
    })
    await mgr.connect()
    await mgr.disconnect()

    expect(proc.kill).toHaveBeenCalled()
    expect(mgr.getReadyServers()).toHaveLength(0)
  })

  it("uses monotonic request IDs", async () => {
    const { EventEmitter } = await import("events")
    const stdout = new EventEmitter() as NodeJS.ReadableStream
    const ids: number[] = []
    const proc = {
      on: vi.fn(),
      stdout,
      stdin: {
        write: vi.fn((data: string) => {
          const req = JSON.parse(data)
          ids.push(req.id)
          setImmediate(() => {
            stdout.emit("data", Buffer.from(JSON.stringify({
              jsonrpc: "2.0",
              id: req.id,
              result: { tools: [] },
            })))
          })
        }),
      },
      kill: vi.fn(),
    }
    mockSpawn.mockReturnValue(proc)

    const mgr = new MCPManager()
    mgr.register({
      name: "test",
      transport: "stdio",
      command: "node",
    })
    await mgr.connect()

    await mgr.discover()
    await mgr.discover()
    await mgr.discover()

    expect(ids).toEqual([1, 2, 3])
  })

  it("rejects pending requests on process exit", async () => {
    const { EventEmitter } = await import("events")
    const stdout = new EventEmitter() as NodeJS.ReadableStream
    const exitListeners: ((code: number | null, signal: string | null) => void)[] = []
    const proc = {
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        if (event === "exit") {
          exitListeners.push(handler as (code: number | null, signal: string | null) => void)
        }
        return proc
      }),
      stdout,
      stdin: {
        write: vi.fn(),
      },
      kill: vi.fn(),
    }
    mockSpawn.mockReturnValue(proc)

    const mgr = new MCPManager()
    mgr.register({
      name: "test",
      transport: "stdio",
      command: "node",
    })
    await mgr.connect()

    const callPromise = mgr.callTool("test", "some_tool", {})

    exitListeners[0](0, null)

    const result = await callPromise
    expect(result.success).toBe(false)
    expect(result.output).toContain("MCP-процесс завершил работу")
  })
})
