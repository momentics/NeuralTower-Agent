import { describe, it, expect, vi, beforeEach } from "vitest"
import { AgentLoop } from "./AgentLoop"
import type { IBackend, IChatMessage } from "../core/IBackend"
import { AgentMemory } from "./AgentMemory"
import { Compactor, type ICompactionResult } from "./Compactor"
import { AgentModeManager } from "./AgentMode"
import type { SessionContext } from "./SessionContext"
import type { AgentContextBuilder } from "./AgentContextBuilder"
import type { AgentToolExecutor } from "./AgentToolExecutor"
import type { AgentPlanner } from "./AgentPlanner"
import { Plan } from "./Plan"
import type { IAgentTurnResult } from "./AgentTypes"
import { AbortError, BackendError } from "../core/Errors"
import { TEST_BACKEND_URL, makeTestBackendConfig } from "../__tests__/fixtures"

class MockCompactor extends Compactor {
  private _shouldCompact = false
  private _compactionResult: ICompactionResult | null = null

  enableCompaction(): void {
    this._shouldCompact = true
  }

  setCompactionResult(result: ICompactionResult): void {
    this._compactionResult = result
  }

  async compactIfNeeded(
    messages: IChatMessage[],
    systemPrompt: string,
  ): Promise<ICompactionResult> {
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
  getConfig: vi.fn(async () => makeTestBackendConfig()),
  currentUrl: vi.fn(() => TEST_BACKEND_URL),
  updateConfig: vi.fn(async () => {}),
  listModels: vi.fn(async () => ["test-model"]),
  resolvedModel: vi.fn(async () => "test-model"),
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
  callBackend: vi.fn(async (): Promise<IAgentTurnResult> => ({ type: "text", content: "Test response" })),
  executeToolCalls: vi.fn(async () => ({ anyFailed: false })),
} as unknown as AgentToolExecutor)

const createMockPlanner = (): AgentPlanner => ({
  createPlan: vi.fn(async () => new Plan({ title: "test", reasoning: "reason", steps: [] })),
  clearPlan: vi.fn(),
  getPlan: vi.fn(() => null),
  setCurrentPlan: vi.fn(),
  persistPlan: vi.fn(async () => {}),
} as unknown as AgentPlanner)

const createMockSnapshotService = () => ({
  isEnabled: vi.fn(() => true),
  track: vi.fn(async () => "snapshot-hash"),
  patch: vi.fn(async (hash: string) => ({ hash, endHash: hash, files: ["/work/a.ts"] })),
  revert: vi.fn(async () => ({ ok: true, restored: [], deleted: [], skipped: [], failed: [] })),
  restore: vi.fn(async () => {}),
  cleanup: vi.fn(async () => {}),
  dispose: vi.fn(),
})

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

  it("план персистится после хода", async () => {
    const testPlan = new Plan({
      title: "test plan",
      reasoning: "reason",
      steps: [{ description: "Step 1", suggestedTools: [] }],
    })
    testPlan.start()

    const mockPlanner = createMockPlanner()
    vi.mocked(mockPlanner.getPlan).mockReturnValue(testPlan)

    const mockToolExecutor = createMockToolExecutor()
    vi.mocked(mockToolExecutor.callBackend).mockResolvedValueOnce({ type: "text", content: "Done" })

    const loop = new AgentLoop(
      backend, memory, compactor, modeManager, sessionContext,
      contextBuilder, mockToolExecutor, mockPlanner,
    )
    await loop.run("test query", [], () => {})

    expect(mockPlanner.persistPlan).toHaveBeenCalled()
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
    const conversation = secondCall[0] as IChatMessage[]
    const recoveryMsg = conversation.find(
      (m) => m.role === "user" && m.content.includes("Внимание: "),
    )
    expect(recoveryMsg).toBeDefined()
    // Новый формат деталей: «имя: текст ошибки» (шаг 4.3).
    expect(recoveryMsg?.content).toContain("read: file not found")
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
      { maxRecoveryAttempts: 2 },
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
      { replanOnFailure: true, maxReplanAttempts: 2 },
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
      { maxCompactions: 2 },
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
    const conversation = secondCall[0] as IChatMessage[]
    const planStepMsg = conversation.find(
      (m) => m.role === "user" && m.content.includes("Выполнить шаг"),
    )
    expect(planStepMsg).toBeDefined()
  })

  it("run throws immediately when callBackend rejects with a backend error", async () => {
    const mockToolExecutor = createMockToolExecutor()
    vi.mocked(mockToolExecutor.callBackend).mockRejectedValueOnce(
      new BackendError("HTTP 400: model not found"),
    )

    const loop = new AgentLoop(
      backend, memory, compactor, modeManager, sessionContext,
      contextBuilder, mockToolExecutor, planner,
    )
    await expect(loop.run("test query", [], () => {})).rejects.toThrow("HTTP 400: model not found")

    // Ошибка бэкенда не идёт в цикл восстановления: бэкенд вызван один раз,
    // сообщение о сбое в разговор не добавлено.
    expect(mockToolExecutor.callBackend).toHaveBeenCalledTimes(1)
    const recent = memory.getRecent()
    expect(
      recent.some((m) => m.role === "user" && m.content.includes("Внимание: ")),
    ).toBe(false)
  })

  it("run throws on the first iteration when callBackend always rejects", async () => {
    const mockToolExecutor = createMockToolExecutor()
    vi.mocked(mockToolExecutor.callBackend).mockRejectedValue(new BackendError("HTTP 500: err"))

    const loop = new AgentLoop(
      backend, memory, compactor, modeManager, sessionContext,
      contextBuilder, mockToolExecutor, planner,
    )
    await expect(loop.run("test query", [], () => {})).rejects.toThrow("HTTP 500: err")

    // Ретраи на уровне цикла отсутствуют: бэкенд вызван ровно один раз.
    expect(mockToolExecutor.callBackend).toHaveBeenCalledTimes(1)
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

  it("отмена в ходе вызова бэкенда пробрасывается как AbortError", async () => {
    const mockToolExecutor = createMockToolExecutor()
    vi.mocked(mockToolExecutor.callBackend).mockRejectedValueOnce(
      new DOMException("aborted", "AbortError"),
    )

    const loop = new AgentLoop(
      backend, memory, compactor, modeManager, sessionContext,
      contextBuilder, mockToolExecutor, planner,
    )
    await expect(loop.run("test query", [], () => {})).rejects.toBeInstanceOf(AbortError)
    expect(mockToolExecutor.callBackend).toHaveBeenCalledTimes(1)
  })

  it("фолбэк по итерациям стримится в onChunk", async () => {
    const mockToolExecutor = createMockToolExecutor()
    vi.mocked(mockToolExecutor.callBackend).mockResolvedValue({ type: "text" })

    const loop = new AgentLoop(
      backend, memory, compactor, modeManager, sessionContext,
      contextBuilder, mockToolExecutor, planner,
    )
    const onChunk = vi.fn()
    const result = await loop.run("test query", [], onChunk)

    expect(result.content).toContain("максимальное число итераций")
    expect(onChunk).toHaveBeenCalledWith(
      "Достигнуто максимальное число итераций. Операция может быть незавершённой.",
    )
  })

  it("recovery-сообщение содержит текст ошибки инструмента", async () => {
    const mockToolExecutor = createMockToolExecutor()
    vi.mocked(mockToolExecutor.callBackend)
      .mockResolvedValueOnce({
        type: "tool_calls",
        toolCalls: [{ id: "c1", toolName: "bash", arguments: { command: "ls" } }],
      })
      .mockResolvedValueOnce({ type: "text", content: "Done" })

    vi.mocked(mockToolExecutor.executeToolCalls).mockResolvedValueOnce({
      anyFailed: true,
      failedTools: [{ name: "bash", error: "exit code 1" }],
    })

    const loop = new AgentLoop(
      backend, memory, compactor, modeManager, sessionContext,
      contextBuilder, mockToolExecutor, planner,
    )
    await loop.run("test query", [], () => {})

    const secondCall = vi.mocked(mockToolExecutor.callBackend).mock.calls[1]
    const conversation = secondCall[0] as IChatMessage[]
    const recoveryMsg = conversation.find(
      (m) => m.role === "user" && m.content.includes("bash: exit code 1"),
    )
    expect(recoveryMsg).toBeDefined()
  })

  it("сбой выполнения инструментов не прерывает run", async () => {
    const mockToolExecutor = createMockToolExecutor()
    vi.mocked(mockToolExecutor.callBackend)
      .mockResolvedValueOnce({
        type: "tool_calls",
        toolCalls: [{ id: "c1", toolName: "bash", arguments: { command: "ls" } }],
      })
      .mockResolvedValueOnce({ type: "text", content: "Recovered" })

    vi.mocked(mockToolExecutor.executeToolCalls).mockRejectedValueOnce(
      new Error("Tool execution crashed"),
    )

    const loop = new AgentLoop(
      backend, memory, compactor, modeManager, sessionContext,
      contextBuilder, mockToolExecutor, planner,
    )
    const result = await loop.run("test query", [], () => {})

    expect(result.content).toBe("Recovered")
    const secondCall = vi.mocked(mockToolExecutor.callBackend).mock.calls[1]
    const conversation = secondCall[0] as IChatMessage[]
    const recoveryMsg = conversation.find(
      (m) => m.role === "user" && m.content.includes("tool_executor: Tool execution crashed"),
    )
    expect(recoveryMsg).toBeDefined()
  })

  // ── Интеграция со снапшотами ────────────────────────────

  it("run calls track once and notifies onSnapshot with patch on text exit", async () => {
    const snapshot = createMockSnapshotService()
    const loop = new AgentLoop(
      backend, memory, compactor, modeManager, sessionContext,
      contextBuilder, toolExecutor, planner, {}, snapshot,
    )
    const patches: unknown[] = []
    const result = await loop.run(
      "test query", [], () => {}, undefined, undefined, undefined, undefined,
      (p) => patches.push(p),
    )
    expect(result.content).toBe("Test response")
    expect(snapshot.track).toHaveBeenCalledTimes(1)
    expect(snapshot.patch).toHaveBeenCalledTimes(1)
    expect(patches).toEqual([
      expect.objectContaining({ hash: "snapshot-hash", endHash: "snapshot-hash", files: ["/work/a.ts"] }),
    ])
  })

  it("run calls patch on maxIterations exit", async () => {
    const mockToolExecutor = createMockToolExecutor()
    vi.mocked(mockToolExecutor.callBackend).mockResolvedValue({
      type: "tool_calls",
      toolCalls: [{ toolName: "read", arguments: {} }],
    })
    const snapshot = createMockSnapshotService()
    const loop = new AgentLoop(
      backend, memory, compactor, modeManager, sessionContext,
      contextBuilder, mockToolExecutor, planner, { maxIterations: 1 }, snapshot,
    )
    const patches: unknown[] = []
    const result = await loop.run(
      "test query", [], () => {}, undefined, undefined, undefined, undefined,
      (p) => patches.push(p),
    )
    expect(result.content).toContain("максимальное число итераций")
    expect(snapshot.track).toHaveBeenCalledTimes(1)
    expect(snapshot.patch).toHaveBeenCalledTimes(1)
    expect(patches).toHaveLength(1)
    expect(patches[0]).toEqual(expect.objectContaining({ hash: "snapshot-hash", endHash: "snapshot-hash" }))
  })

  it("run calls patch on recovery-break exit", async () => {
    const mockToolExecutor = createMockToolExecutor()
    vi.mocked(mockToolExecutor.callBackend).mockResolvedValue({
      type: "tool_calls",
      toolCalls: [{ toolName: "read", arguments: {} }],
    })
    vi.mocked(mockToolExecutor.executeToolCalls).mockResolvedValue({
      anyFailed: true,
      failedTools: [{ name: "read", error: "error" }],
    })
    const snapshot = createMockSnapshotService()
    const loop = new AgentLoop(
      backend, memory, compactor, modeManager, sessionContext,
      contextBuilder, mockToolExecutor, planner, { maxRecoveryAttempts: 1 }, snapshot,
    )
    const patches: unknown[] = []
    await loop.run(
      "test query", [], () => {}, undefined, undefined, undefined, undefined,
      (p) => patches.push(p),
    )
    expect(snapshot.patch).toHaveBeenCalledTimes(1)
    expect(patches).toHaveLength(1)
  })

  it("run skips track and patch when signal is already aborted", async () => {
    const snapshot = createMockSnapshotService()
    const loop = new AgentLoop(
      backend, memory, compactor, modeManager, sessionContext,
      contextBuilder, toolExecutor, planner, {}, snapshot,
    )
    const ac = new AbortController()
    ac.abort()
    const patches: unknown[] = []
    await expect(
      loop.run(
        "test", [], () => {}, undefined, undefined, ac.signal, undefined,
        (p) => patches.push(p),
      ),
    ).rejects.toThrow("Задача отменена")
    expect(snapshot.track).not.toHaveBeenCalled()
    expect(snapshot.patch).not.toHaveBeenCalled()
    expect(patches).toHaveLength(0)
  })

  it("track failure does not break run", async () => {
    const snapshot = createMockSnapshotService()
    vi.mocked(snapshot.track).mockRejectedValueOnce(new Error("git down"))
    const loop = new AgentLoop(
      backend, memory, compactor, modeManager, sessionContext,
      contextBuilder, toolExecutor, planner, {}, snapshot,
    )
    const patches: unknown[] = []
    const result = await loop.run(
      "test query", [], () => {}, undefined, undefined, undefined, undefined,
      (p) => patches.push(p),
    )
    expect(result.content).toBe("Test response")
    expect(patches).toEqual([null])
  })

  it("patch failure does not break run", async () => {
    const snapshot = createMockSnapshotService()
    vi.mocked(snapshot.patch).mockRejectedValueOnce(new Error("diff down"))
    const loop = new AgentLoop(
      backend, memory, compactor, modeManager, sessionContext,
      contextBuilder, toolExecutor, planner, {}, snapshot,
    )
    const patches: unknown[] = []
    const result = await loop.run(
      "test query", [], () => {}, undefined, undefined, undefined, undefined,
      (p) => patches.push(p),
    )
    expect(result.content).toBe("Test response")
    expect(patches).toEqual([null])
  })

  it("without snapshot service onSnapshot is called with null", async () => {
    const loop = new AgentLoop(
      backend, memory, compactor, modeManager, sessionContext,
      contextBuilder, toolExecutor, planner, {},
    )
    const patches: unknown[] = []
    await loop.run(
      "test query", [], () => {}, undefined, undefined, undefined, undefined,
      (p) => patches.push(p),
    )
    expect(patches).toEqual([null])
  })

  // ── revertNote ───────────────────────────────────────────

  it("revertNote добавляется к системному промпту", async () => {
    const mockToolExecutor = createMockToolExecutor()
    const loop = new AgentLoop(
      backend, memory, compactor, modeManager, sessionContext,
      contextBuilder, mockToolExecutor, planner,
    )
    await loop.run(
      "test query", [], () => {}, undefined, undefined, undefined, undefined, undefined,
      "TEST_REVERT_NOTE",
    )
    const conversation = vi.mocked(mockToolExecutor.callBackend).mock.calls[0][0] as IChatMessage[]
    expect(conversation[0].role).toBe("system")
    expect(conversation[0].content).toContain("TEST_REVERT_NOTE")
  })

  it("без revertNote системный промпт не меняется", async () => {
    const mockToolExecutor = createMockToolExecutor()
    const loop = new AgentLoop(
      backend, memory, compactor, modeManager, sessionContext,
      contextBuilder, mockToolExecutor, planner,
    )
    await loop.run("test query", [], () => {})
    const conversation = vi.mocked(mockToolExecutor.callBackend).mock.calls[0][0] as IChatMessage[]
    expect(conversation[0].role).toBe("system")
    expect(conversation[0].content).not.toContain("TEST_REVERT_NOTE")
  })
})
