import { describe, it, expect, vi, beforeEach } from "vitest"
import { Replanner } from "./Replanner"
import { Plan } from "./Plan"
import { ToolRegistry } from "../tools/ToolRegistry"
import type { IBackend } from "../core/IBackend"
import { TEST_BACKEND_URL, makeTestBackendConfig } from "../__tests__/fixtures"

const createMockBackend = (): IBackend => ({
  chat: vi.fn(async () => ({ role: "assistant", content: "Test response", timestamp: Date.now() })),
  chatJson: vi.fn(async () => ({
    reasoning: "Updated plan after failure",
    steps: [
      { description: "Alternative approach", suggestedTools: ["read", "edit"] },
      { description: "Verify changes", suggestedTools: [] },
    ],
  })),
  getConfig: vi.fn(async () => makeTestBackendConfig()),
  currentUrl: vi.fn(() => TEST_BACKEND_URL),
  updateConfig: vi.fn(async () => {}),
  listModels: vi.fn(async () => ["test-model"]),
  healthCheck: vi.fn(async () => true),
})

const createMockToolRegistry = (): ToolRegistry => {
  const registry = new ToolRegistry()
  return registry
}

describe("Replanner", () => {
  let backend: IBackend
  let toolRegistry: ToolRegistry
  let replanner: Replanner

  beforeEach(() => {
    backend = createMockBackend()
    toolRegistry = createMockToolRegistry()
    replanner = new Replanner(backend, toolRegistry)
  })

  it("creates instance with all dependencies", () => {
    expect(replanner).toBeDefined()
  })

  it("replan returns new plan on success", async () => {
    const plan = new Plan({
      title: "Original Plan",
      reasoning: "Original reasoning",
      steps: [
        { description: "Step 1", suggestedTools: [] },
        { description: "Step 2", suggestedTools: [] },
      ],
    })
    plan.start()
    plan.markDone()
    plan.markRunning()
    plan.markFailed("file not found")

    const failedStep = plan.steps[1]
    const result = await replanner.replan(plan, failedStep, "file not found", 1)

    expect(result.plan).not.toBeNull()
    expect(result.plan!.title).toBe("Original Plan")
    expect(result.plan!.reasoning).toBe("Updated plan after failure")
    expect(result.plan!.steps.length).toBe(2)
    expect(result.reason).toContain("file not found")
    expect(result.attempt).toBe(1)
  })

  it("replan returns fallback plan when backend fails", async () => {
    vi.mocked(backend.chatJson).mockRejectedValueOnce(new Error("Backend unavailable"))

    const plan = new Plan({
      title: "Original Plan",
      reasoning: "Original reasoning",
      steps: [{ description: "Step 1", suggestedTools: [] }],
    })
    plan.start()
    plan.markRunning()
    plan.markFailed("error")

    const failedStep = plan.steps[0]
    const result = await replanner.replan(plan, failedStep, "error", 1)

    expect(result.plan).not.toBeNull()
    expect(result.plan!.steps.length).toBe(1)
    expect(result.plan!.steps[0].description).toContain("Завершить задачу с учётом ошибки")
    expect(result.plan!.reasoning).toContain("LLM недоступен для репланирования")
  })

  it("replan includes completed steps context in prompt", async () => {
    const plan = new Plan({
      title: "Original Plan",
      reasoning: "Original reasoning",
      steps: [
        { description: "Step 1", suggestedTools: [] },
        { description: "Step 2", suggestedTools: [] },
      ],
    })
    plan.start()
    plan.markDone("Step 1 result")
    plan.markRunning()
    plan.markFailed("error")

    const failedStep = plan.steps[1]
    await replanner.replan(plan, failedStep, "error", 1)

    const callArg = vi.mocked(backend.chatJson).mock.calls[0][0]
    const systemMsg = callArg.find((m: any) => m.role === "system")
    expect(systemMsg.content).toContain("Step 1")
  })

  it("replan includes failed steps context in prompt", async () => {
    const plan = new Plan({
      title: "Original Plan",
      reasoning: "Original reasoning",
      steps: [
        { description: "Step 1", suggestedTools: [] },
        { description: "Step 2", suggestedTools: [] },
      ],
      maxRetries: 0,
    })
    plan.start()
    plan.markRunning()
    plan.markFailed("error1")
    plan.markRunning()
    plan.markFailed("error2")

    const failedStep = plan.steps[0]
    await replanner.replan(plan, failedStep, "error2", 1)

    const callArg = vi.mocked(backend.chatJson).mock.calls[0][0]
    const systemMsg = callArg.find((m: any) => m.role === "system")
    expect(systemMsg.content).toContain("error1")
  })

  it("replan passes attempt number", async () => {
    const plan = new Plan({
      title: "Original Plan",
      reasoning: "Original reasoning",
      steps: [{ description: "Step 1", suggestedTools: [] }],
    })
    plan.start()
    plan.markRunning()
    plan.markFailed("error")

    const failedStep = plan.steps[0]
    await replanner.replan(plan, failedStep, "error", 3)

    const callArg = vi.mocked(backend.chatJson).mock.calls[0][0]
    const systemMsg = callArg.find((m: any) => m.role === "system")
    expect(systemMsg.content).toContain("Попыток репланирования: 3")
  })

  it("replan starts the new plan", async () => {
    const plan = new Plan({
      title: "Original Plan",
      reasoning: "Original reasoning",
      steps: [{ description: "Step 1", suggestedTools: [] }],
    })
    plan.start()
    plan.markRunning()
    plan.markFailed("error")

    const failedStep = plan.steps[0]
    const result = await replanner.replan(plan, failedStep, "error", 1)

    expect(result.plan!.status).toBe("running")
  })
})
