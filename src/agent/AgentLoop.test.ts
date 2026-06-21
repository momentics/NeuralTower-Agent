import { describe, it, expect, vi, beforeEach } from "vitest"
import { AgentLoop } from "./AgentLoop"
import type { IBackend, ChatMessage } from "../core/IBackend"
import { AgentMemory } from "./AgentMemory"
import { Compactor, type CompactionResult } from "./Compactor"
import { AgentModeManager } from "./AgentMode"
import type { SessionContext } from "./SessionContext"
import type { AgentContextBuilder } from "./AgentContextBuilder"
import type { AgentToolExecutor } from "./AgentToolExecutor"
import type { AgentPlanner } from "./AgentPlanner"
import { Plan } from "./Plan"
import type { AgentTurnResult } from "./AgentTypes"

class MockCompactor extends Compactor {
  private _shouldCompact = false
  private _compactionResult: CompactionResult | null = null

  enableCompaction(): void {
    this._shouldCompact = true
  }

  setCompactionResult(result: CompactionResult): void {
    this._compactionResult = result
  }

  async compactIfNeeded(
    messages: ChatMessage[],
    systemPrompt: string,
  ): Promise<CompactionResult> {
    if (!this._shouldCompact) {
      return { needsCompaction: false, tokensBefore: 0, tokensAfter: 0 }
    }
    if (this._compactionResult) {
      return this._compactionResult
    }
    return super.compactIfNeeded(messages, systemPrompt)
  }
}

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
    await expect(loop.run("test", [], () => {}, undefined, undefined, ac.signal)).rejects.toThrow("Задача отменена")
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
    vi.mocked(mockToolExecutor.executeToolCalls).mockResolvedValue({
      anyFailed: true,
      failedTools: [{ name: "read", error: "file not found" }],
    })

const loop = new AgentLoop(
      backend, memory, compactor, modeManager, sessionContext,
      contextBuilder, mockToolExecutor, mockPlanner,
      { maxRecoveryAttempts: 2 },
    )
    await loop.run("test query", [], () => {})

    expect(testPlan.steps[0].error).toBe("Инструмент вернул ошибку")
  })

  it("run recovers from tool failure and continues loop", async () => {
    const testPlan = new Plan({
      title: "test plan",
      reasoning: "reason",
      steps: [{ description: "Step 1", suggestedTools: [] }],
    })
    testPlan.start()

    const mockPlanner = createMockPlanner()
    vi.mocked(mockPlanner.getPlan).mockReturnValue(testPlan)

    const mockToolExecutor = createMockToolExecutor()
    vi.mocked(mockToolExecutor.callBackend)
      .mockResolvedValueOnce({
        type: "tool_calls",
        toolCalls: [{ toolName: "read", arguments: { path: "test.ts" } }],
      })
      .mockResolvedValueOnce({ type: "text", content: "Recovered" })

    vi.mocked(mockToolExecutor.executeToolCalls).mockResolvedValueOnce({
      anyFailed: true,
      failedTools: [{ name: "read", error: "file not found" }],
    })

    const loop = new AgentLoop(
      backend, memory, compactor, modeManager, sessionContext,
      contextBuilder, mockToolExecutor, mockPlanner,
    )
    const result = await loop.run("test query", [], () => {})

    expect(result.role).toBe("assistant")
    expect(result.content).toBe("Recovered")
    expect(mockToolExecutor.callBackend).toHaveBeenCalledTimes(2)
  })

  it("run injects recovery hint after tool failure", async () => {
    const mockToolExecutor = createMockToolExecutor()
    vi.mocked(mockToolExecutor.callBackend)
      .mockResolvedValueOnce({
        type: "tool_calls",
        toolCalls: [{ toolName: "read", arguments: { path: "test.ts" } }],
      })
      .mockResolvedValueOnce({ type: "text", content: "After recovery" })

    vi.mocked(mockToolExecutor.executeToolCalls).mockResolvedValueOnce({
      anyFailed: true,
      failedTools: [{ name: "read", error: "file not found" }],
    })

    const loop = new AgentLoop(
      backend, memory, compactor, modeManager, sessionContext,
      contextBuilder, mockToolExecutor, planner,
    )
    await loop.run("test query", [], () => {})

    expect(mockToolExecutor.callBackend).toHaveBeenCalledTimes(2)
    const secondCall = vi.mocked(mockToolExecutor.callBackend).mock.calls[1]
    const conversation = secondCall[0] as ChatMessage[]
    const recoveryMsg = conversation.find(
      (m) => m.role === "user" && m.content.includes("Внимание: инструменты"),
    )
    expect(recoveryMsg).toBeDefined()
    expect(recoveryMsg?.content).toContain("read")
  })

  it("run breaks after max recovery attempts exceeded", async () => {
    const mockToolExecutor = createMockToolExecutor()
    vi.mocked(mockToolExecutor.callBackend).mockResolvedValue({
      type: "tool_calls",
      toolCalls: [{ toolName: "read", arguments: {} }],
    })
    vi.mocked(mockToolExecutor.executeToolCalls).mockResolvedValue({
      anyFailed: true,
      failedTools: [{ name: "read", error: "error" }],
    })

    const loop = new AgentLoop(
      backend, memory, compactor, modeManager, sessionContext,
      contextBuilder, mockToolExecutor, planner,
      undefined,
      2,
    )
    const result = await loop.run("test query", [], () => {})

    expect(result.role).toBe("assistant")
    expect(result.content).toContain("максимальное число итераций")
  })

  it("run triggers replan when step fails and replanOnFailure is true", async () => {
    const testPlan = new Plan({
      title: "test plan",
      reasoning: "reason",
      steps: [{ description: "Step 1", suggestedTools: [] }],
      maxRetries: 0,
    })
    testPlan.start()

    const mockPlanner = createMockPlanner()
    vi.mocked(mockPlanner.getPlan).mockReturnValue(testPlan)

    const newPlan = new Plan({
      title: "test plan",
      reasoning: "Replan reasoning",
      steps: [{ description: "New step", suggestedTools: [] }],
    })
    newPlan.start()
    vi.mocked(mockPlanner as any).attemptReplan = vi.fn(async () => newPlan)

    const mockToolExecutor = createMockToolExecutor()
    vi.mocked(mockToolExecutor.callBackend)
      .mockResolvedValueOnce({
        type: "tool_calls",
        toolCalls: [{ toolName: "read", arguments: {} }],
      })
      .mockResolvedValueOnce({ type: "text", content: "After replan" })

    vi.mocked(mockToolExecutor.executeToolCalls).mockResolvedValueOnce({
      anyFailed: true,
      failedTools: [{ name: "read", error: "file not found" }],
    })

    const loop = new AgentLoop(
      backend, memory, compactor, modeManager, sessionContext,
      contextBuilder, mockToolExecutor, mockPlanner,
      undefined,
      undefined,
      true,
      2,
    )
    const result = await loop.run("test query", [], () => {})

    expect(result.role).toBe("assistant")
    expect(result.content).toBe("After replan")
    expect((mockPlanner as any).attemptReplan).toHaveBeenCalled()
  })

  it("run skips replan when replanOnFailure is false", async () => {
    const testPlan = new Plan({
      title: "test plan",
      reasoning: "reason",
      steps: [{ description: "Step 1", suggestedTools: [] }],
      maxRetries: 0,
    })
    testPlan.start()

    const mockPlanner = createMockPlanner()
    vi.mocked(mockPlanner.getPlan).mockReturnValue(testPlan)
    ;(mockPlanner as any).attemptReplan = vi.fn(async () => null)

    const mockToolExecutor = createMockToolExecutor()
    vi.mocked(mockToolExecutor.callBackend)
      .mockResolvedValueOnce({
        type: "tool_calls",
        toolCalls: [{ toolName: "read", arguments: {} }],
      })
      .mockResolvedValueOnce({ type: "text", content: "After recovery" })

    vi.mocked(mockToolExecutor.executeToolCalls).mockResolvedValueOnce({
      anyFailed: true,
      failedTools: [{ name: "read", error: "file not found" }],
    })

const loop = new AgentLoop(
      backend, memory, compactor, modeManager, sessionContext,
      contextBuilder, mockToolExecutor, mockPlanner,
      { replanOnFailure: false, maxReplanAttempts: 2 },
    )
    await loop.run("test query", [], () => {})

    expect((mockPlanner as any).attemptReplan).not.toHaveBeenCalled()
  })

  it("run falls back to recovery when replan returns null", async () => {
    const testPlan = new Plan({
      title: "test plan",
      reasoning: "reason",
      steps: [{ description: "Step 1", suggestedTools: [] }],
      maxRetries: 0,
    })
    testPlan.start()

    const mockPlanner = createMockPlanner()
    vi.mocked(mockPlanner.getPlan).mockReturnValue(testPlan)
    ;(mockPlanner as any).attemptReplan = vi.fn(async () => null)

    const mockToolExecutor = createMockToolExecutor()
    vi.mocked(mockToolExecutor.callBackend)
      .mockResolvedValueOnce({
        type: "tool_calls",
        toolCalls: [{ toolName: "read", arguments: {} }],
      })
      .mockResolvedValueOnce({ type: "text", content: "After fallback" })

    vi.mocked(mockToolExecutor.executeToolCalls).mockResolvedValueOnce({
      anyFailed: true,
      failedTools: [{ name: "read", error: "file not found" }],
    })

    const loop = new AgentLoop(
      backend, memory, compactor, modeManager, sessionContext,
      contextBuilder, mockToolExecutor, mockPlanner,
      { replanOnFailure: true, maxReplanAttempts: 2 },
    )
    const result = await loop.run("test query", [], () => {})

    expect(result.role).toBe("assistant")
    expect(result.content).toBe("After fallback")
    expect((mockPlanner as any).attemptReplan).toHaveBeenCalled()
  })

  it("run compacts mid-loop when context grows large", async () => {
    const mockCompactor = new Compactor(null, {
      contextLimit: 100,
      bufferTokens: 0,
      keepTokens: 10,
    })

    const mockToolExecutor = createMockToolExecutor()
    vi.mocked(mockToolExecutor.callBackend)
      .mockResolvedValueOnce({
        type: "tool_calls",
        toolCalls: [{ toolName: "read", arguments: { path: "test.ts" } }],
      })
      .mockResolvedValueOnce({ type: "text", content: "After compaction" })

    vi.mocked(mockToolExecutor.executeToolCalls).mockResolvedValue({
      anyFailed: false,
    })

    const loop = new AgentLoop(
      backend, memory, mockCompactor, modeManager, sessionContext,
      contextBuilder, mockToolExecutor, planner,
    )
    const result = await loop.run("test query", [], () => {})

    expect(result.role).toBe("assistant")
    expect(result.content).toBe("After compaction")
  })

  it("run calls onCompaction callback when compaction occurs", async () => {
    const mockCompactor = new MockCompactor(null)
    mockCompactor.enableCompaction()
    mockCompactor.setCompactionResult({
      needsCompaction: true,
      compactedHistory: [{ role: "user", content: "Summary", timestamp: Date.now() }],
      summary: "Summary",
      tokensBefore: 500,
      tokensAfter: 100,
    })

    const mockToolExecutor = createMockToolExecutor()
    vi.mocked(mockToolExecutor.callBackend)
      .mockResolvedValueOnce({
        type: "tool_calls",
        toolCalls: [{ toolName: "read", arguments: { path: "test.ts" } }],
      })
      .mockResolvedValueOnce({ type: "text", content: "Done" })

    vi.mocked(mockToolExecutor.executeToolCalls).mockResolvedValue({
      anyFailed: false,
    })

    const compactionEvents: Array<{ before: number; after: number }> = []

    const loop = new AgentLoop(
      backend, memory, mockCompactor, modeManager, sessionContext,
      contextBuilder, mockToolExecutor, planner,
    )
    await loop.run("test query", [], () => {}, undefined, undefined, undefined, (before, after) => {
      compactionEvents.push({ before, after })
    })

    expect(compactionEvents.length).toBeGreaterThan(0)
    expect(compactionEvents[0].before).toBe(500)
    expect(compactionEvents[0].after).toBe(100)
  })

  it("run synchronizes memory after compaction", async () => {
    const mockCompactor = new Compactor(null, {
      contextLimit: 100,
      bufferTokens: 0,
      keepTokens: 10,
    })

    const mockToolExecutor = createMockToolExecutor()
    vi.mocked(mockToolExecutor.callBackend)
      .mockResolvedValueOnce({
        type: "tool_calls",
        toolCalls: [{ toolName: "read", arguments: { path: "test.ts" } }],
      })
      .mockResolvedValueOnce({ type: "text", content: "After sync" })

    vi.mocked(mockToolExecutor.executeToolCalls).mockResolvedValue({
      anyFailed: false,
    })

    const loop = new AgentLoop(
      backend, memory, mockCompactor, modeManager, sessionContext,
      contextBuilder, mockToolExecutor, planner,
    )
    await loop.run("test query", [], () => {})

    const recent = memory.getRecent()
    expect(recent.length).toBeGreaterThan(0)
  })

  it("run synchronizes sessionContext after compaction", async () => {
    const mockSessionContext = createMockSessionContext()
    const replaceSpy = vi.spyOn(mockSessionContext, "replaceMessages")

    const mockCompactor = new MockCompactor(null)
    mockCompactor.enableCompaction()
    mockCompactor.setCompactionResult({
      needsCompaction: true,
      compactedHistory: [{ role: "user", content: "Summary", timestamp: Date.now() }],
      summary: "Summary",
      tokensBefore: 500,
      tokensAfter: 100,
    })

    const mockToolExecutor = createMockToolExecutor()
    vi.mocked(mockToolExecutor.callBackend)
      .mockResolvedValueOnce({
        type: "tool_calls",
        toolCalls: [{ toolName: "read", arguments: { path: "test.ts" } }],
      })
      .mockResolvedValueOnce({ type: "text", content: "After sync" })

    vi.mocked(mockToolExecutor.executeToolCalls).mockResolvedValue({
      anyFailed: false,
    })

    const loop = new AgentLoop(
      backend, memory, mockCompactor, modeManager, mockSessionContext,
      contextBuilder, mockToolExecutor, planner,
    )
    await loop.run("test query", [], () => {})

    expect(replaceSpy).toHaveBeenCalled()
  })

  it("run returns error when max compactions exceeded", async () => {
    const mockCompactor = new MockCompactor(null)
    mockCompactor.enableCompaction()
    mockCompactor.setCompactionResult({
      needsCompaction: true,
      compactedHistory: [{ role: "user", content: "Summary", timestamp: Date.now() }],
      summary: "Summary",
      tokensBefore: 500,
      tokensAfter: 100,
    })

    const mockToolExecutor = createMockToolExecutor()
    vi.mocked(mockToolExecutor.callBackend).mockResolvedValue({
      type: "tool_calls",
      toolCalls: [{ toolName: "read", arguments: { path: "test.ts" } }],
    })
    vi.mocked(mockToolExecutor.executeToolCalls).mockResolvedValue({
      anyFailed: false,
    })

    const loop = new AgentLoop(
      backend, memory, mockCompactor, modeManager, sessionContext,
      contextBuilder, mockToolExecutor, planner,
      undefined,
      undefined,
      undefined,
      undefined,
      2,
    )
    const result = await loop.run("test query", [], () => {})

    expect(result.role).toBe("assistant")
    expect(result.content).toContain("Контекст превышает допустимые пределы")
  })

  it("run re-injects plan step after compaction", async () => {
    const testPlan = new Plan({
      title: "test plan",
      reasoning: "reason",
      steps: [
        { description: "Step 1", suggestedTools: ["read"] },
        { description: "Step 2", suggestedTools: [] },
      ],
    })
    testPlan.start()

    const mockPlanner = createMockPlanner()
    vi.mocked(mockPlanner.getPlan).mockReturnValue(testPlan)

    const mockCompactor = new Compactor(null, {
      contextLimit: 100,
      bufferTokens: 0,
      keepTokens: 10,
    })

    const mockToolExecutor = createMockToolExecutor()
    vi.mocked(mockToolExecutor.callBackend)
      .mockResolvedValueOnce({
        type: "tool_calls",
        toolCalls: [{ toolName: "read", arguments: { path: "test.ts" } }],
      })
      .mockResolvedValueOnce({ type: "text", content: "After compaction" })

    vi.mocked(mockToolExecutor.executeToolCalls).mockResolvedValue({
      anyFailed: false,
    })

    const loop = new AgentLoop(
      backend, memory, mockCompactor, modeManager, sessionContext,
      contextBuilder, mockToolExecutor, mockPlanner,
    )
    await loop.run("test query", [], () => {})

    const secondCall = vi.mocked(mockToolExecutor.callBackend).mock.calls[1]
    const conversation = secondCall[0] as ChatMessage[]
    const planStepMsg = conversation.find(
      (m) => m.role === "user" && m.content.includes("Выполнить шаг"),
    )
    expect(planStepMsg).toBeDefined()
  })

  it("run recovers when callBackend throws and continues loop", async () => {
    const mockToolExecutor = createMockToolExecutor()
    vi.mocked(mockToolExecutor.callBackend)
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce({ type: "text", content: "Recovered" })

    const loop = new AgentLoop(
      backend, memory, compactor, modeManager, sessionContext,
      contextBuilder, mockToolExecutor, planner,
    )
    const result = await loop.run("test query", [], () => {})

    expect(result.role).toBe("assistant")
    expect(result.content).toBe("Recovered")
    expect(mockToolExecutor.callBackend).toHaveBeenCalledTimes(2)
  })

  it("run breaks after max recovery attempts when callBackend throws", async () => {
    const mockToolExecutor = createMockToolExecutor()
    vi.mocked(mockToolExecutor.callBackend).mockRejectedValue(new Error("Network error"))

    const loop = new AgentLoop(
      backend, memory, compactor, modeManager, sessionContext,
      contextBuilder, mockToolExecutor, planner,
      undefined,
      2,
    )
    const result = await loop.run("test query", [], () => {})

    expect(result.role).toBe("assistant")
    expect(result.content).toContain("максимальное число итераций")
  })

  it("run continues when initial compaction throws", async () => {
    const mockCompactor = new MockCompactor(null)
    mockCompactor.setCompactionResult({
      needsCompaction: false,
      tokensBefore: 0,
      tokensAfter: 0,
    })
    vi.spyOn(mockCompactor, "compactIfNeeded").mockRejectedValueOnce(new Error("Compaction error"))

    const loop = new AgentLoop(
      backend, memory, mockCompactor, modeManager, sessionContext,
      contextBuilder, toolExecutor, planner,
    )
    const result = await loop.run("test query", [], () => {})

    expect(result.role).toBe("assistant")
    expect(result.content).toBe("Test response")
  })

  it("run continues when loop compaction throws", async () => {
    const mockCompactor = new MockCompactor(null)
    mockCompactor.enableCompaction()
    mockCompactor.setCompactionResult({
      needsCompaction: false,
      tokensBefore: 0,
      tokensAfter: 0,
    })
    vi.spyOn(mockCompactor, "compactIfNeeded").mockRejectedValue(new Error("Compaction error"))

    const mockToolExecutor = createMockToolExecutor()
    vi.mocked(mockToolExecutor.callBackend)
      .mockResolvedValueOnce({
        type: "tool_calls",
        toolCalls: [{ toolName: "read", arguments: { path: "test.ts" } }],
      })
      .mockResolvedValueOnce({ type: "text", content: "After compaction error" })

    vi.mocked(mockToolExecutor.executeToolCalls).mockResolvedValue({
      anyFailed: false,
    })

    const loop = new AgentLoop(
      backend, memory, mockCompactor, modeManager, sessionContext,
      contextBuilder, mockToolExecutor, planner,
    )
    const result = await loop.run("test query", [], () => {})

    expect(result.role).toBe("assistant")
    expect(result.content).toBe("After compaction error")
  })

  it("run recovers when executeToolCalls throws and continues loop", async () => {
    const mockToolExecutor = createMockToolExecutor()
    vi.mocked(mockToolExecutor.callBackend)
      .mockResolvedValueOnce({
        type: "tool_calls",
        toolCalls: [{ toolName: "read", arguments: { path: "test.ts" } }],
      })
      .mockResolvedValueOnce({ type: "text", content: "Recovered from tool crash" })

    vi.mocked(mockToolExecutor.executeToolCalls)
      .mockRejectedValueOnce(new Error("Tool execution crashed"))

    const loop = new AgentLoop(
      backend, memory, compactor, modeManager, sessionContext,
      contextBuilder, mockToolExecutor, planner,
    )
    const result = await loop.run("test query", [], () => {})

    expect(result.role).toBe("assistant")
    expect(result.content).toBe("Recovered from tool crash")
    expect(mockToolExecutor.callBackend).toHaveBeenCalledTimes(2)
  })

  it("run injects error message into conversation when callBackend throws", async () => {
    const mockToolExecutor = createMockToolExecutor()
    vi.mocked(mockToolExecutor.callBackend)
      .mockRejectedValueOnce(new Error("Connection refused"))
      .mockResolvedValueOnce({ type: "text", content: "After error" })

    const loop = new AgentLoop(
      backend, memory, compactor, modeManager, sessionContext,
      contextBuilder, mockToolExecutor, planner,
    )
    await loop.run("test query", [], () => {})

    expect(mockToolExecutor.callBackend).toHaveBeenCalledTimes(2)
    const secondCall = vi.mocked(mockToolExecutor.callBackend).mock.calls[1]
    const conversation = secondCall[0] as ChatMessage[]
    const errorMsg = conversation.find(
      (m) => m.role === "user" && m.content.includes("Внимание: инструменты"),
    )
    expect(errorMsg).toBeDefined()
    expect(errorMsg?.content).toContain("backend")
  })
})
