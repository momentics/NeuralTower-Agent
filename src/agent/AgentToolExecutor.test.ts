import { describe, it, expect, vi, beforeEach } from "vitest"
import { AgentToolExecutor } from "./AgentToolExecutor"
import type { IBackend, IChatMessage } from "../core/IBackend"
import { ToolRegistry } from "../tools/ToolRegistry"
import type { ITool } from "../tools/ITool"
import type { IPermissionManager } from "../services/permission/PermissionManager"
import { AgentModeManager } from "./AgentMode"
import type { IToolResult } from "./AgentTypes"
import { TEST_BACKEND_URL, makeTestBackendConfig } from "../__tests__/fixtures"

const createMockBackend = (): IBackend => ({
  chat: vi.fn(async () => ({ role: "assistant", content: "Test response", timestamp: Date.now() })),
  chatJson: vi.fn(async () => ({})),
  getConfig: vi.fn(async () => makeTestBackendConfig()),
  currentUrl: vi.fn(() => TEST_BACKEND_URL),
  updateConfig: vi.fn(async () => {}),
  listModels: vi.fn(async () => ["test-model"]),
  healthCheck: vi.fn(async () => true),
})

const createMockTool = (name: string, isSafe = true, result: IToolResult = { output: "ok", success: true }): ITool => ({
  name,
  description: `Mock ${name}`,
  category: "test",
  schema: { name, description: `Mock ${name}`, parameters: {} },
  execute: vi.fn(async () => result),
  isSafe,
})

const createMockPermissionManager = (): IPermissionManager =>
  ({
    checkPermission: vi.fn(async () => true),
  })

describe("AgentToolExecutor", () => {
  let backend: IBackend
  let toolRegistry: ToolRegistry
  let permissionManager: IPermissionManager
  let modeManager: AgentModeManager
  beforeEach(() => {
    backend = createMockBackend()
    toolRegistry = new ToolRegistry()
    permissionManager = createMockPermissionManager()
    modeManager = new AgentModeManager()
  })

  it("creates instance with all dependencies", () => {
    const executor = new AgentToolExecutor(
      backend,
      toolRegistry,
      permissionManager,
      modeManager,
    )
    expect(executor).toBeDefined()
  })

    it("callBackend returns text result when no tool calls in response", async () => {
    const executor = new AgentToolExecutor(
      backend,
      toolRegistry,
      null,
      modeManager,
    )
    const conversation: IChatMessage[] = [{ role: "user", content: "hello", timestamp: Date.now() }]
    const result = await executor.callBackend(conversation, () => {})
    expect(result.type).toBe("text")
    expect(result.content).toBe("Test response")
  })

  it("callBackend returns native tool_calls from backend response", async () => {
    vi.mocked(backend.chat).mockResolvedValue({
      role: "assistant",
      content: "",
      toolCalls: [
        { id: "call_1", toolName: "read", arguments: '{"path":"/test"}' },
      ],
      timestamp: Date.now(),
    })
    const executor = new AgentToolExecutor(
      backend,
      toolRegistry,
      null,
      modeManager,
    )
    const conversation: IChatMessage[] = [{ role: "user", content: "hello", timestamp: Date.now() }]
    const result = await executor.callBackend(conversation, () => {})
    expect(result.type).toBe("tool_calls")
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls![0].toolName).toBe("read")
    expect(result.toolCalls![0].arguments).toEqual({ path: "/test" })
  })

  it("callBackend falls back to text parsing when no native tool_calls", async () => {
    vi.mocked(backend.chat).mockResolvedValue({
      role: "assistant",
      content: 'Some text\n```json\n{"tool": "read", "args": {"path": "/test"}}\n```',
      timestamp: Date.now(),
    })
    const executor = new AgentToolExecutor(
      backend,
      toolRegistry,
      null,
      modeManager,
    )
    const conversation: IChatMessage[] = [{ role: "user", content: "hello", timestamp: Date.now() }]
    const result = await executor.callBackend(conversation, () => {})
    expect(result.type).toBe("tool_calls")
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls![0].toolName).toBe("read")
    expect(result.toolCalls![0].arguments).toEqual({ path: "/test" })
  })

  it("callBackend throws on abort signal", async () => {
    const ac = new AbortController()
    ac.abort()
    const executor = new AgentToolExecutor(
      backend,
      toolRegistry,
      null,
      modeManager,
    )
    const conversation: IChatMessage[] = [{ role: "user", content: "hello", timestamp: Date.now() }]
    await expect(executor.callBackend(conversation, () => {}, ac.signal)).rejects.toThrow("Задача прервана")
  })

  it("executeToolCalls executes allowed tools and appends to conversation", async () => {
    const mockTool = createMockTool("read")
    toolRegistry.register(mockTool)
    const executor = new AgentToolExecutor(
      backend,
      toolRegistry,
      null,
      modeManager,
    )
    const conversation: IChatMessage[] = []
    const toolCalls = [{ toolName: "read", arguments: { path: "/test" } }]
    const result = await executor.executeToolCalls(toolCalls, "build", conversation)
    expect(result.anyFailed).toBe(false)
    expect(mockTool.execute).toHaveBeenCalledWith({ path: "/test" }, undefined)
    expect(conversation).toHaveLength(2)
    expect(conversation[0].role).toBe("assistant")
    expect(conversation[1].role).toBe("user")
  })

  it("executeToolCalls blocks denied tools by mode", async () => {
    modeManager.switchMode("plan")
    const mockTool = createMockTool("edit")
    toolRegistry.register(mockTool)
    const executor = new AgentToolExecutor(
      backend,
      toolRegistry,
      null,
      modeManager,
    )
    const conversation: IChatMessage[] = []
    const toolCalls = [{ toolName: "edit", arguments: { path: "/test" } }]
    const result = await executor.executeToolCalls(toolCalls, "plan", conversation)
    expect(result.anyFailed).toBe(true)
    expect(mockTool.execute).not.toHaveBeenCalled()
    expect(conversation).toHaveLength(1)
    expect(conversation[0].content).toContain("ЗАБЛОКИРОВАНО режимом plan")
  })

  it("executeToolCalls asks permission for unsafe tools when permissionManager is set", async () => {
    const mockTool = createMockTool("bash", false)
    toolRegistry.register(mockTool)
    vi.mocked(permissionManager.checkPermission).mockResolvedValue(false)
    const executor = new AgentToolExecutor(
      backend,
      toolRegistry,
      permissionManager,
      modeManager,
    )
    const conversation: IChatMessage[] = []
    const toolCalls = [{ toolName: "bash", arguments: { command: "rm -rf /" } }]
    const result = await executor.executeToolCalls(toolCalls, "build", conversation)
    expect(result.anyFailed).toBe(true)
    expect(permissionManager.checkPermission).toHaveBeenCalled()
    expect(mockTool.execute).not.toHaveBeenCalled()
    expect(conversation).toHaveLength(1)
    expect(conversation[0].content).toContain("ЗАБЛОКИРОВАНО политикой разрешений")
  })

  it("executeToolCalls marks anyFailed when tool execution fails", async () => {
    const mockTool = createMockTool("read", true, { output: "error", success: false })
    toolRegistry.register(mockTool)
    const executor = new AgentToolExecutor(
      backend,
      toolRegistry,
      null,
      modeManager,
    )
    const conversation: IChatMessage[] = []
    const toolCalls = [{ toolName: "read", arguments: { path: "/test" } }]
    const result = await executor.executeToolCalls(toolCalls, "build", conversation)
    expect(result.anyFailed).toBe(true)
  })

  it("executeToolCalls handles tool that throws exception", async () => {
    const mockTool = createMockTool("read")
    vi.mocked(mockTool.execute).mockRejectedValue(new Error("Unexpected crash"))
    toolRegistry.register(mockTool)
    const executor = new AgentToolExecutor(
      backend,
      toolRegistry,
      null,
      modeManager,
    )
    const conversation: IChatMessage[] = []
    const toolCalls = [{ toolName: "read", arguments: { path: "/test" } }]
    const result = await executor.executeToolCalls(toolCalls, "build", conversation)

    expect(result.anyFailed).toBe(true)
    expect(result.failedTools).toHaveLength(1)
    expect(result.failedTools![0].name).toBe("read")
    expect(result.failedTools![0].error).toContain("не выполнен")
    expect(result.failedTools![0].error).toContain("Unexpected crash")
    expect(conversation).toHaveLength(2)
    expect(conversation[1].content).toContain("не выполнен")
  })

  it("executeToolCalls continues processing remaining tools when one throws", async () => {
    const throwingTool = createMockTool("read")
    vi.mocked(throwingTool.execute).mockRejectedValue(new Error("Crash"))
    const okTool = createMockTool("write")
    toolRegistry.register(throwingTool)
    toolRegistry.register(okTool)
    const executor = new AgentToolExecutor(
      backend,
      toolRegistry,
      null,
      modeManager,
    )
    const conversation: IChatMessage[] = []
    const toolCalls = [
      { toolName: "read", arguments: { path: "/test" } },
      { toolName: "write", arguments: { path: "/out" } },
    ]
    const result = await executor.executeToolCalls(toolCalls, "build", conversation)

    expect(result.anyFailed).toBe(true)
    expect(throwingTool.execute).toHaveBeenCalledTimes(1)
    expect(okTool.execute).toHaveBeenCalledTimes(1)
  })
})
