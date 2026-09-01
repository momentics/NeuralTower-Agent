import { describe, it, expect, vi, beforeEach } from "vitest"
import { AgentToolExecutor } from "./AgentToolExecutor"
import type { IBackend, IChatMessage } from "../core/IBackend"
import { ToolRegistry } from "../tools/ToolRegistry"
import type { ITool } from "../tools/ITool"
import type { IPermissionManager } from "../services/permission/PermissionManager"
import { AgentModeManager } from "./AgentMode"
import type { IAgentToolCall, IToolResult } from "./AgentTypes"
import { TEST_BACKEND_URL, makeTestBackendConfig } from "../__tests__/fixtures"
import { ToolOutputTruncator } from "../tools/Truncate"

const createMockBackend = (): IBackend => ({
  chat: vi.fn(async () => ({ role: "assistant", content: "Test response", timestamp: Date.now() })),
  chatJson: vi.fn(async () => ({})),
  getConfig: vi.fn(async () => makeTestBackendConfig()),
  currentUrl: vi.fn(() => TEST_BACKEND_URL),
  updateConfig: vi.fn(async () => {}),
  listModels: vi.fn(async () => ["test-model"]),
  resolvedModel: vi.fn(async () => "test-model"),
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
      new ToolOutputTruncator(() => null, () => 30_000),
    )
    expect(executor).toBeDefined()
  })

  it("callBackend returns text result when no tool calls in response", async () => {
    const executor = new AgentToolExecutor(
      backend,
      toolRegistry,
      null,
      modeManager,
      new ToolOutputTruncator(() => null, () => 30_000),
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
      new ToolOutputTruncator(() => null, () => 30_000),
    )
    const conversation: IChatMessage[] = [{ role: "user", content: "hello", timestamp: Date.now() }]
    const result = await executor.callBackend(conversation, () => {})
    expect(result.type).toBe("tool_calls")
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls![0].id).toBe("call_1")
    expect(result.toolCalls![0].toolName).toBe("read")
    expect(result.toolCalls![0].arguments).toEqual({ path: "/test" })
  })

  it("callBackend возвращает текст модели вместе с tool_calls", async () => {
    vi.mocked(backend.chat).mockResolvedValue({
      role: "assistant",
      content: "Сейчас прочитаю",
      toolCalls: [
        { id: "c1", toolName: "read", arguments: "{}" },
      ],
      timestamp: Date.now(),
    })
    const executor = new AgentToolExecutor(
      backend,
      toolRegistry,
      null,
      modeManager,
      new ToolOutputTruncator(() => null, () => 30_000),
    )
    const conversation: IChatMessage[] = [{ role: "user", content: "hello", timestamp: Date.now() }]
    const result = await executor.callBackend(conversation, () => {})
    expect(result.type).toBe("tool_calls")
    expect(result.content).toBe("Сейчас прочитаю")
    expect(result.toolCalls![0].id).toBe("c1")
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
      new ToolOutputTruncator(() => null, () => 30_000),
    )
    const conversation: IChatMessage[] = [{ role: "user", content: "hello", timestamp: Date.now() }]
    const result = await executor.callBackend(conversation, () => {})
    expect(result.type).toBe("tool_calls")
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls![0].toolName).toBe("read")
    expect(result.toolCalls![0].arguments).toEqual({ path: "/test" })
  })

  it("fallback-вызовы из JSON-блоков получают локальный id", async () => {
    vi.mocked(backend.chat).mockResolvedValue({
      role: "assistant",
      content: 'Сделаю\n{"tool": "glob", "args": {"pattern": "*.ts"}}',
      timestamp: Date.now(),
    })
    const executor = new AgentToolExecutor(
      backend,
      toolRegistry,
      null,
      modeManager,
      new ToolOutputTruncator(() => null, () => 30_000),
    )
    const conversation: IChatMessage[] = [{ role: "user", content: "hello", timestamp: Date.now() }]
    const result = await executor.callBackend(conversation, () => {})
    expect(result.type).toBe("tool_calls")
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls![0].id).toMatch(/^call_nt_/)
    expect(result.content).toContain("Сделаю")
  })

  it("callBackend throws on abort signal", async () => {
    const ac = new AbortController()
    ac.abort()
    const executor = new AgentToolExecutor(
      backend,
      toolRegistry,
      null,
      modeManager,
      new ToolOutputTruncator(() => null, () => 30_000),
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
      new ToolOutputTruncator(() => null, () => 30_000),
    )
    const conversation: IChatMessage[] = []
    const toolCalls: IAgentToolCall[] = [{ id: "c1", toolName: "read", arguments: { path: "/test" } }]
    const onToolUse = vi.fn()
    const onToolResult = vi.fn()
    const result = await executor.executeToolCalls(
      toolCalls, "build", conversation, undefined, undefined, onToolUse, onToolResult,
    )
    expect(result.anyFailed).toBe(false)
    expect(mockTool.execute).toHaveBeenCalledWith({ path: "/test" }, undefined)
    expect(conversation).toHaveLength(2)
    expect(conversation[0].role).toBe("assistant")
    expect(conversation[0].content).toBe("")
    expect(conversation[0].toolCalls).toEqual([
      { id: "c1", toolName: "read", arguments: '{"path":"/test"}' },
    ])
    expect(conversation[1].role).toBe("tool")
    expect(conversation[1].toolCallId).toBe("c1")
    expect(conversation[1].name).toBe("read")
    expect(conversation[1].content).toBe("ok")
    expect(onToolUse).toHaveBeenCalledWith("read", { path: "/test" }, "c1")
    expect(onToolResult).toHaveBeenCalledWith(
      "read",
      expect.objectContaining({ output: "ok", success: true }),
      "c1",
    )
  })

  it("executeToolCalls передаёт текст модели в assistant-сообщение", async () => {
    const mockTool = createMockTool("read")
    toolRegistry.register(mockTool)
    const executor = new AgentToolExecutor(
      backend,
      toolRegistry,
      null,
      modeManager,
      new ToolOutputTruncator(() => null, () => 30_000),
    )
    const conversation: IChatMessage[] = []
    const toolCalls: IAgentToolCall[] = [{ id: "c1", toolName: "read", arguments: { path: "/test" } }]
    await executor.executeToolCalls(toolCalls, "build", conversation, "Сейчас прочитаю")
    expect(conversation[0].role).toBe("assistant")
    expect(conversation[0].content).toBe("Сейчас прочитаю")
    expect(conversation[0].toolCalls![0].id).toBe("c1")
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
      new ToolOutputTruncator(() => null, () => 30_000),
    )
    const conversation: IChatMessage[] = []
    const toolCalls: IAgentToolCall[] = [{ id: "c1", toolName: "edit", arguments: { path: "/test" } }]
    const result = await executor.executeToolCalls(toolCalls, "plan", conversation)
    expect(result.anyFailed).toBe(true)
    expect(mockTool.execute).not.toHaveBeenCalled()
    expect(conversation).toHaveLength(2)
    expect(conversation[0].role).toBe("assistant")
    expect(conversation[1].role).toBe("tool")
    expect(conversation[1].toolCallId).toBe("c1")
    expect(conversation[1].name).toBe("edit")
    expect(conversation[1].content).toContain("ЗАБЛОКИРОВАНО режимом plan")
  })

  it("заблокированный режимом инструмент даёт tool-сообщение с причиной", async () => {
    modeManager.switchMode("explore")
    const mockTool = createMockTool("write_file")
    toolRegistry.register(mockTool)
    const executor = new AgentToolExecutor(
      backend,
      toolRegistry,
      null,
      modeManager,
      new ToolOutputTruncator(() => null, () => 30_000),
    )
    const conversation: IChatMessage[] = []
    const toolCalls: IAgentToolCall[] = [{ id: "c1", toolName: "write_file", arguments: { path: "/test" } }]
    const onToolUse = vi.fn()
    const result = await executor.executeToolCalls(
      toolCalls, "explore", conversation, undefined, undefined, onToolUse,
    )
    expect(result.anyFailed).toBe(true)
    expect(mockTool.execute).not.toHaveBeenCalled()
    expect(conversation).toHaveLength(2)
    expect(conversation[1].role).toBe("tool")
    expect(conversation[1].toolCallId).toBe("c1")
    expect(conversation[1].content).toContain("ЗАБЛОКИРОВАНО")
    expect(onToolUse).toHaveBeenCalledWith(
      "write_file",
      { path: "/test", _blocked: expect.stringContaining("ЗАБЛОКИРОВАНО") },
      "c1",
    )
  })

  it("несуществующий инструмент даёт tool-сообщение со списком доступных", async () => {
    const mockTool = createMockTool("read")
    toolRegistry.register(mockTool)
    const executor = new AgentToolExecutor(
      backend,
      toolRegistry,
      null,
      modeManager,
      new ToolOutputTruncator(() => null, () => 30_000),
    )
    const conversation: IChatMessage[] = []
    const toolCalls: IAgentToolCall[] = [{ id: "c1", toolName: "nope", arguments: {} }]
    const result = await executor.executeToolCalls(toolCalls, "build", conversation)
    expect(result.anyFailed).toBe(true)
    expect(mockTool.execute).not.toHaveBeenCalled()
    expect(conversation).toHaveLength(2)
    expect(conversation[1].role).toBe("tool")
    expect(conversation[1].toolCallId).toBe("c1")
    expect(conversation[1].content).toContain("не найден")
    expect(conversation[1].content).toContain("read")
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
      new ToolOutputTruncator(() => null, () => 30_000),
    )
    const conversation: IChatMessage[] = []
    const toolCalls: IAgentToolCall[] = [{ id: "c1", toolName: "bash", arguments: { command: "rm -rf /" } }]
    const result = await executor.executeToolCalls(toolCalls, "build", conversation)
    expect(result.anyFailed).toBe(true)
    expect(permissionManager.checkPermission).toHaveBeenCalled()
    expect(mockTool.execute).not.toHaveBeenCalled()
    expect(conversation).toHaveLength(2)
    expect(conversation[0].role).toBe("assistant")
    expect(conversation[1].role).toBe("tool")
    expect(conversation[1].toolCallId).toBe("c1")
    expect(conversation[1].content).toContain("отклонил")
  })

  it("executeToolCalls marks anyFailed when tool execution fails", async () => {
    const mockTool = createMockTool("read", true, { output: "error", success: false })
    toolRegistry.register(mockTool)
    const executor = new AgentToolExecutor(
      backend,
      toolRegistry,
      null,
      modeManager,
      new ToolOutputTruncator(() => null, () => 30_000),
    )
    const conversation: IChatMessage[] = []
    const toolCalls: IAgentToolCall[] = [{ id: "c1", toolName: "read", arguments: { path: "/test" } }]
    const result = await executor.executeToolCalls(toolCalls, "build", conversation)
    expect(result.anyFailed).toBe(true)
    expect(conversation).toHaveLength(2)
    expect(conversation[1].role).toBe("tool")
    expect(conversation[1].toolCallId).toBe("c1")
    expect(conversation[1].content).toBe("error")
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
      new ToolOutputTruncator(() => null, () => 30_000),
    )
    const conversation: IChatMessage[] = []
    const toolCalls: IAgentToolCall[] = [{ id: "c1", toolName: "read", arguments: { path: "/test" } }]
    const result = await executor.executeToolCalls(toolCalls, "build", conversation)

    expect(result.anyFailed).toBe(true)
    expect(result.failedTools).toHaveLength(1)
    expect(result.failedTools![0].name).toBe("read")
    expect(result.failedTools![0].error).toContain("не выполнен")
    expect(result.failedTools![0].error).toContain("Unexpected crash")
    expect(conversation).toHaveLength(2)
    expect(conversation[1].role).toBe("tool")
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
      new ToolOutputTruncator(() => null, () => 30_000),
    )
    const conversation: IChatMessage[] = []
    const toolCalls: IAgentToolCall[] = [
      { id: "c1", toolName: "read", arguments: { path: "/test" } },
      { id: "c2", toolName: "write", arguments: { path: "/out" } },
    ]
    const result = await executor.executeToolCalls(toolCalls, "build", conversation)

    expect(result.anyFailed).toBe(true)
    expect(throwingTool.execute).toHaveBeenCalledTimes(1)
    expect(okTool.execute).toHaveBeenCalledTimes(1)
    expect(conversation).toHaveLength(3)
    expect(conversation[1].role).toBe("tool")
    expect(conversation[1].toolCallId).toBe("c1")
    expect(conversation[2].role).toBe("tool")
    expect(conversation[2].toolCallId).toBe("c2")
    expect(conversation[2].content).toBe("ok")
  })

  it("сбой внутри итерации не оставляет tool_call без ответа", async () => {
    const unsafeTool = createMockTool("bash", false)
    const okTool = createMockTool("read")
    toolRegistry.register(unsafeTool)
    toolRegistry.register(okTool)
    vi.mocked(permissionManager.checkPermission).mockRejectedValueOnce(new Error("perm crash"))
    const executor = new AgentToolExecutor(
      backend,
      toolRegistry,
      permissionManager,
      modeManager,
      new ToolOutputTruncator(() => null, () => 30_000),
    )
    const conversation: IChatMessage[] = []
    const toolCalls: IAgentToolCall[] = [
      { id: "c1", toolName: "bash", arguments: { command: "ls" } },
      { id: "c2", toolName: "read", arguments: { path: "/test" } },
    ]
    const result = await executor.executeToolCalls(toolCalls, "build", conversation)

    expect(result.anyFailed).toBe(true)
    expect(unsafeTool.execute).not.toHaveBeenCalled()
    expect(okTool.execute).toHaveBeenCalledTimes(1)
    expect(conversation).toHaveLength(3)
    expect(conversation[1].role).toBe("tool")
    expect(conversation[1].toolCallId).toBe("c1")
    expect(conversation[1].content).toContain("Ошибка выполнения")
    expect(conversation[1].content).toContain("perm crash")
    expect(conversation[2].role).toBe("tool")
    expect(conversation[2].toolCallId).toBe("c2")
    expect(conversation[2].content).toBe("ok")
  })

  it("длинный вывод инструмента обрезается, в разговор попадают начало и конец", async () => {
    const long = "x".repeat(50_000)
    const mockTool = createMockTool("read", true, { output: long, success: true })
    toolRegistry.register(mockTool)
    const executor = new AgentToolExecutor(
      backend,
      toolRegistry,
      null,
      modeManager,
      new ToolOutputTruncator(() => null, () => 100),
    )
    const conversation: IChatMessage[] = []
    const toolCalls: IAgentToolCall[] = [{ id: "c1", toolName: "read", arguments: { path: "/test" } }]
    const onToolResult = vi.fn()
    const result = await executor.executeToolCalls(
      toolCalls, "build", conversation, undefined, undefined, undefined, onToolResult,
    )
    expect(result.anyFailed).toBe(false)
    expect(conversation).toHaveLength(2)
    expect(conversation[1].role).toBe("tool")
    // В разговор попадает обрезанный вывод: начало + маркер + конец.
    expect(conversation[1].content).toContain("вывод обрезан")
    expect(conversation[1].content).not.toBe(long)
    expect(conversation[1].content.length).toBeLessThan(long.length)
    // onToolResult получает тот же обрезанный вывод (персистентная сессия).
    expect(onToolResult).toHaveBeenCalledWith(
      "read",
      expect.objectContaining({ output: conversation[1].content, success: true }),
      "c1",
    )
  })

  it("doom loop: N одинаковых подряд вызовов принудительно подтверждается", async () => {
    const mockTool = createMockTool("bash", false)
    toolRegistry.register(mockTool)
    const seen: Array<{ forceReason?: string }> = []
    const perm = {
      checkPermission: async (_t: unknown, _a: unknown, _ms?: number, opts?: { forceReason?: string }) => {
        seen.push(opts ?? {})
        return true
      },
    } as unknown as IPermissionManager
    const executor = new AgentToolExecutor(
      backend,
      toolRegistry,
      perm,
      modeManager,
      new ToolOutputTruncator(() => null, () => 30_000),
      2, // лимит doom loop
    )

    const call = { id: "c1", toolName: "bash", arguments: { command: "npm test" } }
    await executor.executeToolCalls([call], "build", [])
    await executor.executeToolCalls([{ ...call, id: "c2" }], "build", [])

    // Первый вызов — обычное подтверждение, второй — с forceReason
    expect(seen[0].forceReason).toBeUndefined()
    expect(seen[1].forceReason).toContain("зацикливание")
  })
})
