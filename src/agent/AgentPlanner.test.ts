import { describe, it, expect, vi, beforeEach } from "vitest"
import { AgentPlanner } from "./AgentPlanner"
import { Plan } from "./Plan"
import { Replanner } from "./Replanner"
import { ToolRegistry } from "../tools/ToolRegistry"
import type { IBackend } from "../core/IBackend"
import type { SessionContext } from "./SessionContext"
import type { PlanStep } from "./Plan"

const createMockBackend = (): IBackend => ({
  chat: vi.fn(async () => ({ role: "assistant", content: "Test response", timestamp: Date.now() })),
  chatJson: vi.fn(async () => ({
    reasoning: "Test reasoning",
    steps: [
      { description: "Step 1", suggestedTools: [] },
      { description: "Step 2", suggestedTools: ["tool1"] },
    ],
  })),
  getConfig: vi.fn(async () => ({ url: "http://localhost:30000", model: "test-model", maxRetries: 3, timeoutMs: 60000 })),
  updateConfig: vi.fn(async () => {}),
  listModels: vi.fn(async () => ["test-model"]),
  healthCheck: vi.fn(async () => true),
})

const createMockSessionContext = (): SessionContext => ({
  sessionID: "test-session",
  initialize: vi.fn(),
  prepare: vi.fn(),
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
} as unknown as SessionContext)

describe("AgentPlanner", () => {
  let backend: IBackend
  let toolRegistry: ToolRegistry
  let sessionContext: SessionContext
  let replanner: Replanner

  beforeEach(() => {
    backend = createMockBackend()
    toolRegistry = new ToolRegistry()
    sessionContext = createMockSessionContext()
    replanner = new Replanner(backend, toolRegistry)
  })

  it("creates instance with all dependencies", () => {
    const planner = new AgentPlanner(backend, toolRegistry, sessionContext, replanner)
    expect(planner).toBeDefined()
  })

  it("getPlan returns null initially", () => {
    const planner = new AgentPlanner(backend, toolRegistry, sessionContext, replanner)
    expect(planner.getPlan()).toBeNull()
  })

  it("createPlan creates a plan with correct title", async () => {
    const planner = new AgentPlanner(backend, toolRegistry, sessionContext, replanner)
    const plan = await planner.createPlan("My test task")
    expect(plan).toBeDefined()
    expect(plan.title).toBe("My test task")
  })

  it("createPlan starts the plan (status is running)", async () => {
    const planner = new AgentPlanner(backend, toolRegistry, sessionContext, replanner)
    const plan = await planner.createPlan("My test task")
    expect(plan.status).toBe("running")
  })

  it("createPlan falls back to single-step plan on backend error", async () => {
    vi.mocked(backend.chatJson).mockRejectedValueOnce(new Error("Backend error"))
    const planner = new AgentPlanner(backend, toolRegistry, sessionContext, replanner)
    const plan = await planner.createPlan("My test task")
    expect(plan).toBeDefined()
    expect(plan.steps.length).toBe(1)
    expect(plan.steps[0].description).toBe("My test task")
  })

  it("createPlan sets plan on sessionContext when set", async () => {
    const planner = new AgentPlanner(backend, toolRegistry, sessionContext, replanner)
    await planner.createPlan("My test task")
    expect(sessionContext.setPlan).toHaveBeenCalled()
  })

  it("clearPlan resets plan to null", () => {
    const planner = new AgentPlanner(backend, toolRegistry, sessionContext, replanner)
    const plan = new Plan({ title: "Test", reasoning: "Test", steps: [] })
    planner.setCurrentPlan(plan)
    planner.clearPlan()
    expect(planner.getPlan()).toBeNull()
  })

  it("clearPlan clears plan on sessionContext when set", () => {
    const planner = new AgentPlanner(backend, toolRegistry, sessionContext, replanner)
    const plan = new Plan({ title: "Test", reasoning: "Test", steps: [] })
    planner.setCurrentPlan(plan)
    planner.clearPlan()
    expect(sessionContext.clearPlan).toHaveBeenCalled()
  })

  it("setCurrentPlan sets the plan externally", () => {
    const planner = new AgentPlanner(backend, toolRegistry, sessionContext, replanner)
    const plan = new Plan({ title: "External", reasoning: "External", steps: [] })
    planner.setCurrentPlan(plan)
    expect(planner.getPlan()).toBe(plan)
  })

  it("attemptReplan returns null when no current plan", async () => {
    const planner = new AgentPlanner(backend, toolRegistry, sessionContext, replanner)
    const step: PlanStep = { description: "S1", suggestedTools: [], status: "failed", attempts: 1, error: "err" }
    const result = await planner.attemptReplan(step, "err", 2)
    expect(result).toBeNull()
  })

  it("attemptReplan returns new plan on success", async () => {
    vi.mocked(backend.chatJson).mockResolvedValueOnce({
      reasoning: "Replan reasoning",
      steps: [{ description: "New step", suggestedTools: [] }],
    })

    const planner = new AgentPlanner(backend, toolRegistry, sessionContext, replanner)
    const plan = new Plan({
      title: "Original",
      reasoning: "Original",
      steps: [
        { description: "Step 1", suggestedTools: [] },
        { description: "Step 2", suggestedTools: [] },
      ],
    })
    plan.start()
    plan.markDone()
    plan.markRunning()
    plan.markFailed("file not found")

    planner.setCurrentPlan(plan)
    const step: PlanStep = plan.steps[1]
    const result = await planner.attemptReplan(step, "file not found", 2)

    expect(result).not.toBeNull()
    expect(result!.title).toBe("Original")
    expect(result!.reasoning).toBe("Replan reasoning")
    expect(plan.replanHistory.length).toBe(1)
    expect(plan.replanHistory[0].reason).toContain("file not found")
  })

  it("attemptReplan sets new plan on sessionContext", async () => {
    vi.mocked(backend.chatJson).mockResolvedValueOnce({
      reasoning: "Replan reasoning",
      steps: [{ description: "New step", suggestedTools: [] }],
    })

    const planner = new AgentPlanner(backend, toolRegistry, sessionContext, replanner)
    const plan = new Plan({
      title: "Original",
      reasoning: "Original",
      steps: [{ description: "Step 1", suggestedTools: [] }],
    })
    plan.start()
    plan.markRunning()
    plan.markFailed("err")

    planner.setCurrentPlan(plan)
    const step: PlanStep = plan.steps[0]
    await planner.attemptReplan(step, "err", 2)

    expect(sessionContext.setPlan).toHaveBeenCalled()
  })

  it("attemptReplan returns fallback plan when backend fails", async () => {
    vi.mocked(backend.chatJson).mockRejectedValueOnce(new Error("Backend error"))

    const planner = new AgentPlanner(backend, toolRegistry, sessionContext, replanner)
    const plan = new Plan({
      title: "Original",
      reasoning: "Original",
      steps: [{ description: "Step 1", suggestedTools: [] }],
    })
    plan.start()
    plan.markRunning()
    plan.markFailed("err")

    planner.setCurrentPlan(plan)
    const step: PlanStep = plan.steps[0]
    const result = await planner.attemptReplan(step, "err", 2)

    expect(result).not.toBeNull()
    expect(result!.steps[0].description).toContain("Завершить задачу с учётом ошибки")
  })

  it("attemptReplan returns null after max attempts exceeded", async () => {
    const planner = new AgentPlanner(backend, toolRegistry, sessionContext, replanner)
    const plan = new Plan({
      title: "Original",
      reasoning: "Original",
      steps: [{ description: "Step 1", suggestedTools: [] }],
    })
    plan.start()
    plan.markRunning()
    plan.markFailed("err")

    planner.setCurrentPlan(plan)
    const step: PlanStep = plan.steps[0]

    planner.resetReplanAttempts()
    await planner.attemptReplan(step, "err", 1)
    await planner.attemptReplan(step, "err", 1)

    const result = await planner.attemptReplan(step, "err", 1)
    expect(result).toBeNull()
  })

  it("getReplanAttemptCount returns current count", () => {
    const planner = new AgentPlanner(backend, toolRegistry, sessionContext, replanner)
    expect(planner.getReplanAttemptCount()).toBe(0)
  })

  it("resetReplanAttempts resets the counter", () => {
    const planner = new AgentPlanner(backend, toolRegistry, sessionContext, replanner)
    const plan = new Plan({
      title: "T",
      reasoning: "R",
      steps: [{ description: "S1", suggestedTools: [] }],
    })
    plan.start()
    plan.markRunning()
    plan.markFailed("err")

    planner.setCurrentPlan(plan)
    const step: PlanStep = plan.steps[0]
    planner.attemptReplan(step, "err", 5)
    expect(planner.getReplanAttemptCount()).toBe(1)

    planner.resetReplanAttempts()
    expect(planner.getReplanAttemptCount()).toBe(0)
  })

  it("clearPlan resets replan attempts", () => {
    const planner = new AgentPlanner(backend, toolRegistry, sessionContext, replanner)
    const plan = new Plan({
      title: "T",
      reasoning: "R",
      steps: [{ description: "S1", suggestedTools: [] }],
    })
    plan.start()
    plan.markRunning()
    plan.markFailed("err")

    planner.setCurrentPlan(plan)
    const step: PlanStep = plan.steps[0]
    planner.attemptReplan(step, "err", 5)
    planner.clearPlan()
    expect(planner.getReplanAttemptCount()).toBe(0)
  })
})
