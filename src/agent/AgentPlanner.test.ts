import { describe, it, expect, vi, beforeEach } from "vitest"
import { AgentPlanner } from "./AgentPlanner"
import { Plan } from "./Plan"
import { ToolRegistry } from "../tools/ToolRegistry"
import type { IBackend } from "../core/IBackend"
import type { SessionContext } from "./SessionContext"

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

  beforeEach(() => {
    backend = createMockBackend()
    toolRegistry = new ToolRegistry()
    sessionContext = createMockSessionContext()
  })

  it("creates instance with all dependencies", () => {
    const planner = new AgentPlanner(backend, toolRegistry, sessionContext)
    expect(planner).toBeDefined()
  })

  it("getPlan returns null initially", () => {
    const planner = new AgentPlanner(backend, toolRegistry, sessionContext)
    expect(planner.getPlan()).toBeNull()
  })

  it("createPlan creates a plan with correct title", async () => {
    const planner = new AgentPlanner(backend, toolRegistry, sessionContext)
    const plan = await planner.createPlan("My test task")
    expect(plan).toBeDefined()
    expect(plan.title).toBe("My test task")
  })

  it("createPlan starts the plan (status is running)", async () => {
    const planner = new AgentPlanner(backend, toolRegistry, sessionContext)
    const plan = await planner.createPlan("My test task")
    expect(plan.status).toBe("running")
  })

  it("createPlan falls back to single-step plan on backend error", async () => {
    vi.mocked(backend.chatJson).mockRejectedValueOnce(new Error("Backend error"))
    const planner = new AgentPlanner(backend, toolRegistry, sessionContext)
    const plan = await planner.createPlan("My test task")
    expect(plan).toBeDefined()
    expect(plan.steps.length).toBe(1)
    expect(plan.steps[0].description).toBe("My test task")
  })

  it("createPlan sets plan on sessionContext when set", async () => {
    const planner = new AgentPlanner(backend, toolRegistry, sessionContext)
    await planner.createPlan("My test task")
    expect(sessionContext.setPlan).toHaveBeenCalled()
  })

  it("clearPlan resets plan to null", () => {
    const planner = new AgentPlanner(backend, toolRegistry, sessionContext)
    const plan = new Plan({ title: "Test", reasoning: "Test", steps: [] })
    planner.setCurrentPlan(plan)
    planner.clearPlan()
    expect(planner.getPlan()).toBeNull()
  })

  it("clearPlan clears plan on sessionContext when set", () => {
    const planner = new AgentPlanner(backend, toolRegistry, sessionContext)
    const plan = new Plan({ title: "Test", reasoning: "Test", steps: [] })
    planner.setCurrentPlan(plan)
    planner.clearPlan()
    expect(sessionContext.clearPlan).toHaveBeenCalled()
  })

  it("setCurrentPlan sets the plan externally", () => {
    const planner = new AgentPlanner(backend, toolRegistry, sessionContext)
    const plan = new Plan({ title: "External", reasoning: "External", steps: [] })
    planner.setCurrentPlan(plan)
    expect(planner.getPlan()).toBe(plan)
  })
})
