import { describe, it, expect, vi, beforeEach } from "vitest"
import { AgentLoop } from "./AgentLoop"
import type { IBackend, ChatMessage } from "../core/IBackend"
import { AgentMemory } from "./AgentMemory"
import { Compactor } from "./Compactor"
import { AgentModeManager } from "./AgentMode"
import type { SessionContext } from "./SessionContext"
import type { AgentContextBuilder } from "./AgentContextBuilder"
import type { AgentToolExecutor } from "./AgentToolExecutor"
import type { AgentPlanner } from "./AgentPlanner"
import { Plan } from "./Plan"
import type { AgentTurnResult } from "./AgentTypes"

const createMockBackend = (): IBackend => ({
  chat: vi.fn(async () => ({ role: "assistant", content: "Test response", timestamp: Date.now() })),
  chatJson: vi.fn(async () => ({})),
  getConfig: vi.fn(async () => ({ url: "http://localhost:30000", model: "test-model", maxRetries: 3, timeoutMs: 60000 })),
  updateConfig: vi.fn(async () => {}),
  listModels: vi.fn(async () => ["test-model"]),
  healthCheck: vi.fn(async () => true),
})

const createMockSessionContext = (): SessionContext => ({
  prepare: vi.fn(async () => ({ baseline: "session baseline", baselineSeq: 1, revision: 1 })),
  pushMessage: vi.fn(),
  getMessages: vi.fn(() => []),
  replaceMessages: vi.fn(),
  getPlan: vi.fn(() => null),
  setPlan: vi.fn(),
  clearPlan: vi.fn(),
  getEpoch: vi.fn(() => null),
  getAgent: vi.fn(() => null),
  isCompacted: vi.fn(() => false),
  reset: vi.fn(),
  sessionID: "test-session",
} as unknown as SessionContext)

const createMockContextBuilder = (): AgentContextBuilder => ({
  buildSystemPrompt: vi.fn(async () => "context builder prompt"),
} as unknown as AgentContextBuilder)

const createMockToolExecutor = (): AgentToolExecutor => ({
  callBackend: vi.fn(async (): Promise<AgentTurnResult> => ({ type: "text", content: "Test response" })),
  executeToolCalls: vi.fn(async () => ({ anyFailed: false })),
} as unknown as AgentToolExecutor)

const createMockPlanner = (): AgentPlanner => ({
  createPlan: vi.fn(async () => new Plan({ title: "test", reasoning: "reason", steps: [] })),
  clearPlan: vi.fn(),
  getPlan: vi.fn(() => null),
  setCurrentPlan: vi.fn(),
} as unknown as AgentPlanner)

describe("AgentLoop", () => {
  let backend: IBackend
  let memory: AgentMemory
  let compactor: Compactor
  let modeManager: AgentModeManager
  let sessionContext: SessionContext
  let contextBuilder: AgentContextBuilder
  let toolExecutor: AgentToolExecutor
  let planner: AgentPlanner

  beforeEach(() => {
    backend = createMockBackend()
    memory = new AgentMemory()
    compactor = new Compactor(null)
    modeManager = new AgentModeManager()
    sessionContext = createMockSessionContext()
    contextBuilder = createMockContextBuilder()
    toolExecutor = createMockToolExecutor()
    planner = createMockPlanner()
  })

  it("creates instance with all dependencies", () => {
    const loop = new AgentLoop(
      backend, memory, compactor, modeManager, sessionContext,
      contextBuilder, toolExecutor, planner,
    )
    expect(loop).toBeDefined()
  })

  it("run returns assistant message on text response", async () => {
    const loop = new AgentLoop(
      backend, memory, compactor, modeManager, sessionContext,
      contextBuilder, toolExecutor, planner,
    )
    const chunks: string[] = []
    const result = await loop.run("test query", [], (c) => chunks.push(c))
    expect(result.role).toBe("assistant")
    expect(result.content).toBe("Test response")
  })

  it("run throws on abort signal", async () => {
    const loop = new AgentLoop(
      backend, memory, compactor, modeManager, sessionContext,
      contextBuilder, toolExecutor, planner,
    )
    const ac = new AbortController()
    ac.abort()
    await expect(loop.run("test", [], () => {}, undefined, undefined, ac.signal)).rejects.toThrow("Task aborted")
  })

  it("run handles tool_calls and loops back to backend", async () => {
    const mockToolExecutor = createMockToolExecutor()
    vi.mocked(mockToolExecutor.callBackend)
      .mockResolvedValueOnce({ type: "tool_calls", toolCalls: [{ toolName: "read", arguments: { path: "test.ts" } }] })
      .mockResolvedValueOnce({ type: "text", content: "After tool" })

    const loop = new AgentLoop(
      backend, memory, compactor, modeManager, sessionContext,
      contextBuilder, mockToolExecutor, planner,
    )
    const result = await loop.run("test query", [], () => {})
    expect(result.role).toBe("assistant")
    expect(result.content).toBe("After tool")
    expect(mockToolExecutor.callBackend).toHaveBeenCalledTimes(2)
    expect(mockToolExecutor.executeToolCalls).toHaveBeenCalledTimes(1)
  })

  it("run respects max iterations and returns timeout message", async () => {
    const mockToolExecutor = createMockToolExecutor()
    vi.mocked(mockToolExecutor.callBackend).mockResolvedValue({
      type: "tool_calls",
      toolCalls: [{ toolName: "read", arguments: {} }],
    })

    const loop = new AgentLoop(
      backend, memory, compactor, modeManager, sessionContext,
      contextBuilder, mockToolExecutor, planner,
    )
    const result = await loop.run("test query", [], () => {})
    expect(result.role).toBe("assistant")
    expect(result.content).toContain("максимальное число итераций")
  })

  it("run adds user message to memory", async () => {
    const loop = new AgentLoop(
      backend, memory, compactor, modeManager, sessionContext,
      contextBuilder, toolExecutor, planner,
    )
    await loop.run("test query", [], () => {})
    const recent = memory.getRecent()
    const userMsg = recent.find((m) => m.role === "user" && m.content === "test query")
    expect(userMsg).toBeDefined()
  })

  it("run adds assistant message to memory on text response", async () => {
    const loop = new AgentLoop(
      backend, memory, compactor, modeManager, sessionContext,
      contextBuilder, toolExecutor, planner,
    )
    await loop.run("test query", [], () => {})
    const recent = memory.getRecent()
    const assistantMsg = recent.find((m) => m.role === "assistant" && m.content === "Test response")
    expect(assistantMsg).toBeDefined()
  })

  it("run handles plan step injection when plan is running", async () => {
    const testPlan = new Plan({
      title: "test plan",
      reasoning: "reason",
      steps: [{ description: "Step 1", suggestedTools: ["read"] }],
    })
    testPlan.status = "running"
    testPlan.steps[0].status = "pending"

    const mockPlanner = createMockPlanner()
    vi.mocked(mockPlanner.getPlan).mockReturnValue(testPlan)

    const mockToolExecutor = createMockToolExecutor()
    vi.mocked(mockToolExecutor.callBackend)
      .mockResolvedValueOnce({ type: "text", content: "Done" })

    const loop = new AgentLoop(
      backend, memory, compactor, modeManager, sessionContext,
      contextBuilder, mockToolExecutor, mockPlanner,
    )
    await loop.run("test query", [], () => {})

    expect(mockToolExecutor.callBackend).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          content: expect.stringContaining("Выполнить шаг 1: Step 1"),
        }),
      ]),
      expect.any(Function),
      undefined,
    )
  })

  it("run marks plan step done on text response", async () => {
    const testPlan = new Plan({
      title: "test plan",
      reasoning: "reason",
      steps: [
        { description: "Step 1", suggestedTools: [] },
        { description: "Step 2", suggestedTools: [] },
      ],
    })
    testPlan.start()

    const mockPlanner = createMockPlanner()
    vi.mocked(mockPlanner.getPlan).mockReturnValue(testPlan)

    const mockToolExecutor = createMockToolExecutor()
    vi.mocked(mockToolExecutor.callBackend)
      .mockResolvedValueOnce({ type: "text", content: "Step 1 done" })

    const loop = new AgentLoop(
      backend, memory, compactor, modeManager, sessionContext,
      contextBuilder, mockToolExecutor, mockPlanner,
    )
    await loop.run("test query", [], () => {})

    expect(testPlan.steps[0].status).toBe("done")
    expect(testPlan.steps[0].result).toBe("Step 1 done")
  })

  it("run marks plan step failed when any tool fails", async () => {
    const testPlan = new Plan({
      title: "test plan",
      reasoning: "reason",
      steps: [{ description: "Step 1", suggestedTools: [] }],
    })
    testPlan.start()

    const mockPlanner = createMockPlanner()
    vi.mocked(mockPlanner.getPlan).mockReturnValue(testPlan)

    const mockToolExecutor = createMockToolExecutor()
    vi.mocked(mockToolExecutor.callBackend).mockResolvedValue({
      type: "tool_calls",
      toolCalls: [{ toolName: "read", arguments: {} }],
    })
    vi.mocked(mockToolExecutor.executeToolCalls).mockResolvedValue({ anyFailed: true })

    const loop = new AgentLoop(
      backend, memory, compactor, modeManager, sessionContext,
      contextBuilder, mockToolExecutor, mockPlanner,
    )
    await loop.run("test query", [], () => {})

    expect(testPlan.steps[0].error).toBe("Инструмент вернул ошибку")
  })
})
