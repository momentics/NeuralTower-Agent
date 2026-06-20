import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Plan } from "./Plan"
import { PlanRepository } from "./PlanRepository"

vi.mock("fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue("{}"),
  readdir: vi.fn().mockResolvedValue([]),
}))

import * as fs from "fs/promises"

describe("Plan", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("creates plan with defaults", () => {
    const plan = new Plan({
      title: "Test",
      reasoning: "Because",
      steps: [{ description: "Step 1", suggestedTools: ["read"] }],
    })
    expect(plan.id).toMatch(/^plan-/)
    expect(plan.title).toBe("Test")
    expect(plan.status).toBe("draft")
    expect(plan.currentStepIndex).toBe(0)
    expect(plan.maxRetries).toBe(3)
    expect(plan.steps[0].status).toBe("pending")
    expect(plan.steps[0].attempts).toBe(0)
  })

  it("creates plan with custom id and maxRetries", () => {
    const plan = new Plan({
      id: "custom-id",
      title: "Test",
      reasoning: "Because",
      steps: [],
      maxRetries: 5,
    })
    expect(plan.id).toBe("custom-id")
    expect(plan.maxRetries).toBe(5)
  })

  it("returns completed count", () => {
    const plan = new Plan({
      title: "T",
      reasoning: "R",
      steps: [
        { description: "S1", suggestedTools: [] },
        { description: "S2", suggestedTools: [] },
      ],
    })
    plan.start()
    plan.markDone()
    expect(plan.completedCount).toBe(1)
  })

  it("returns failed count", () => {
    const plan = new Plan({
      title: "T",
      reasoning: "R",
      steps: [{ description: "S1", suggestedTools: [] }],
      maxRetries: 0,
    })
    plan.start()
    plan.markFailed("err")
    expect(plan.failedCount).toBe(1)
  })

  it("returns remaining count", () => {
    const plan = new Plan({
      title: "T",
      reasoning: "R",
      steps: [
        { description: "S1", suggestedTools: [] },
        { description: "S2", suggestedTools: [] },
        { description: "S3", suggestedTools: [] },
      ],
    })
    plan.start()
    plan.markDone()
    expect(plan.remainingCount).toBe(2)
  })

  it("returns progress percentage", () => {
    const plan = new Plan({
      title: "T",
      reasoning: "R",
      steps: [
        { description: "S1", suggestedTools: [] },
        { description: "S2", suggestedTools: [] },
      ],
    })
    plan.start()
    plan.markDone()
    expect(plan.progress).toBe(50)
  })

  it("returns 0 progress for empty steps", () => {
    const plan = new Plan({
      title: "T",
      reasoning: "R",
      steps: [],
    })
    expect(plan.progress).toBe(0)
  })

  it("returns current step", () => {
    const plan = new Plan({
      title: "T",
      reasoning: "R",
      steps: [{ description: "S1", suggestedTools: [] }],
    })
    plan.start()
    expect(plan.currentStep).not.toBeNull()
    expect(plan.currentStep!.description).toBe("S1")
  })

  it("returns null current step when out of bounds", () => {
    const plan = new Plan({
      title: "T",
      reasoning: "R",
      steps: [],
    })
    expect(plan.currentStep).toBeNull()
  })

  it("checks dependencies met", () => {
    const plan = new Plan({
      title: "T",
      reasoning: "R",
      steps: [
        { description: "S1", suggestedTools: [] },
        { description: "S2", suggestedTools: [], dependsOn: [0] },
      ],
    })
    expect(plan.dependenciesMet(1)).toBe(false)
    plan.start()
    plan.markDone()
    expect(plan.dependenciesMet(1)).toBe(true)
  })

  it("dependencies met returns true when no deps", () => {
    const plan = new Plan({
      title: "T",
      reasoning: "R",
      steps: [{ description: "S1", suggestedTools: [] }],
    })
    expect(plan.dependenciesMet(0)).toBe(true)
  })

  it("start sets running and advances to next pending", () => {
    const plan = new Plan({
      title: "T",
      reasoning: "R",
      steps: [
        { description: "S1", suggestedTools: [] },
        { description: "S2", suggestedTools: [] },
      ],
    })
    plan.start()
    expect(plan.status).toBe("running")
    expect(plan.currentStepIndex).toBe(0)
  })

  it("markRunning increments attempts", () => {
    const plan = new Plan({
      title: "T",
      reasoning: "R",
      steps: [{ description: "S1", suggestedTools: [] }],
    })
    plan.start()
    plan.markRunning()
    expect(plan.currentStep!.attempts).toBe(1)
    expect(plan.currentStep!.status).toBe("running")
  })

  it("markDone advances and sets result", () => {
    const plan = new Plan({
      title: "T",
      reasoning: "R",
      steps: [
        { description: "S1", suggestedTools: [] },
        { description: "S2", suggestedTools: [] },
      ],
    })
    plan.start()
    plan.markDone("result")
    expect(plan.steps[0].status).toBe("done")
    expect(plan.steps[0].result).toBe("result")
    expect(plan.currentStepIndex).toBe(1)
  })

  it("markFailed retries within maxRetries", () => {
    const plan = new Plan({
      title: "T",
      reasoning: "R",
      steps: [{ description: "S1", suggestedTools: [] }],
      maxRetries: 3,
    })
    plan.start()
    plan.markRunning()
    plan.markFailed("err")
    expect(plan.steps[0].status).toBe("pending")
    expect(plan.steps[0].error).toBe("err")
  })

  it("markFailed marks as failed after max retries", () => {
    const plan = new Plan({
      title: "T",
      reasoning: "R",
      steps: [{ description: "S1", suggestedTools: [] }],
      maxRetries: 1,
    })
    plan.start()
    plan.markRunning()
    plan.markFailed("err")
    expect(plan.steps[0].status).toBe("failed")
  })

  it("completes when all steps done", () => {
    const plan = new Plan({
      title: "T",
      reasoning: "R",
      steps: [
        { description: "S1", suggestedTools: [] },
        { description: "S2", suggestedTools: [] },
      ],
    })
    plan.start()
    plan.markDone()
    plan.markDone()
    expect(plan.status).toBe("completed")
  })

  it("marks as failed when any step failed", () => {
    const plan = new Plan({
      title: "T",
      reasoning: "R",
      steps: [
        { description: "S1", suggestedTools: [] },
        { description: "S2", suggestedTools: [] },
      ],
      maxRetries: 0,
    })
    plan.start()
    plan.markRunning()
    plan.markFailed("err")
    plan.markRunning()
    plan.markFailed("err")
    expect(plan.status).toBe("failed")
  })

  it("reset clears state", () => {
    const plan = new Plan({
      title: "T",
      reasoning: "R",
      steps: [{ description: "S1", suggestedTools: [] }],
    })
    plan.start()
    plan.markDone()
    plan.reset()
    expect(plan.status).toBe("draft")
    expect(plan.currentStepIndex).toBe(0)
    expect(plan.steps[0].status).toBe("pending")
    expect(plan.steps[0].attempts).toBe(0)
  })

  it("toText returns formatted plan", () => {
    const plan = new Plan({
      title: "Test Plan",
      reasoning: "Reason",
      steps: [{ description: "Step 1", suggestedTools: ["read"] }],
    })
    plan.start()
    const text = plan.toText()
    expect(text).toContain("Test Plan")
    expect(text).toContain("[→]")
    expect(text).toContain("инструменты: read")
  })

  it("toJSON and fromJSON roundtrip", () => {
    const plan = new Plan({
      id: "test-1",
      title: "T",
      reasoning: "R",
      steps: [
        { description: "S1", suggestedTools: ["read"], dependsOn: [] },
      ],
      maxRetries: 5,
    })
    plan.start()
    plan.markDone("result")
    const json = plan.toJSON()
    const restored = Plan.fromJSON(json)
    expect(restored.id).toBe("test-1")
    expect(restored.title).toBe("T")
    expect(restored.steps[0].status).toBe("done")
    expect(restored.steps[0].result).toBe("result")
    expect(restored.maxRetries).toBe(5)
  })

it("save writes to file", async () => {
    const plan = new Plan({
      title: "T",
      reasoning: "R",
      steps: [{ description: "S1", suggestedTools: [] }],
    })
    const repo = new PlanRepository("/work")
    const p = await repo.save(plan)
    expect(p).toMatch(/\.neuraltower[\\/]+plans/)
  })

  it("load reads from file", async () => {
    const data = {
      id: "test-1",
      title: "T",
      reasoning: "R",
      steps: [{ description: "S1", suggestedTools: [], status: "done", attempts: 1 }],
      status: "completed",
      currentStepIndex: 0,
      maxRetries: 3,
      createdAt: 1000,
      updatedAt: 2000,
    }
    vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify(data))
    const repo = new PlanRepository("/work")
    const plan = await repo.load("/work/test.json")
    expect(plan.id).toBe("test-1")
  })

  it("load throws for invalid file", async () => {
    vi.mocked(fs.readFile).mockResolvedValueOnce("not json")
    const repo = new PlanRepository("/work")
    await expect(repo.load("/work/test.json")).rejects.toThrow(/Невалидный файл плана/)
  })

  it("load throws for missing steps", async () => {
    vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify({ id: "1" }))
    const repo = new PlanRepository("/work")
    await expect(repo.load("/work/test.json")).rejects.toThrow(/Невалидный файл плана/)
  })

  it("replanHistory is empty by default", () => {
    const plan = new Plan({
      title: "T",
      reasoning: "R",
      steps: [{ description: "S1", suggestedTools: [] }],
    })
    expect(plan.replanHistory).toEqual([])
  })

  it("recordReplan adds entry to history", () => {
    const plan = new Plan({
      title: "T",
      reasoning: "R",
      steps: [{ description: "S1", suggestedTools: [] }],
    })
    plan.recordReplan("Step failed", 1)
    expect(plan.replanHistory.length).toBe(1)
    expect(plan.replanHistory[0].reason).toBe("Step failed")
    expect(plan.replanHistory[0].attempt).toBe(1)
    expect(plan.replanHistory[0].timestamp).toBeGreaterThan(0)
  })

  it("recordReplan accumulates entries", () => {
    const plan = new Plan({
      title: "T",
      reasoning: "R",
      steps: [{ description: "S1", suggestedTools: [] }],
    })
    plan.recordReplan("First failure", 1)
    plan.recordReplan("Second failure", 2)
    expect(plan.replanHistory.length).toBe(2)
    expect(plan.replanHistory[0].attempt).toBe(1)
    expect(plan.replanHistory[1].attempt).toBe(2)
  })

  it("toText includes replan history when present", () => {
    const plan = new Plan({
      title: "T",
      reasoning: "R",
      steps: [{ description: "S1", suggestedTools: [] }],
    })
    plan.start()
    plan.recordReplan("Step failed", 1)
    const text = plan.toText()
    expect(text).toContain("История репланирования")
    expect(text).toContain("Step failed")
  })

  it("toText does not include replan history when empty", () => {
    const plan = new Plan({
      title: "T",
      reasoning: "R",
      steps: [{ description: "S1", suggestedTools: [] }],
    })
    plan.start()
    const text = plan.toText()
    expect(text).not.toContain("История репланирования")
  })

  it("toJSON includes replanHistory", () => {
    const plan = new Plan({
      title: "T",
      reasoning: "R",
      steps: [{ description: "S1", suggestedTools: [] }],
    })
    plan.recordReplan("Step failed", 1)
    const json = plan.toJSON()
    expect(json.replanHistory).toBeDefined()
    expect(json.replanHistory!.length).toBe(1)
    expect(json.replanHistory![0].reason).toBe("Step failed")
  })

  it("fromJSON restores replanHistory", () => {
    const plan = new Plan({
      title: "T",
      reasoning: "R",
      steps: [{ description: "S1", suggestedTools: [] }],
    })
    plan.recordReplan("Step failed", 1)
    const json = plan.toJSON()
    const restored = Plan.fromJSON(json)
    expect(restored.replanHistory.length).toBe(1)
    expect(restored.replanHistory[0].reason).toBe("Step failed")
  })

  it("fromJSON defaults replanHistory to empty array when missing", () => {
    const json = {
      id: "test-1",
      title: "T",
      reasoning: "R",
      steps: [{ description: "S1", suggestedTools: [], status: "pending", attempts: 0 }],
      status: "draft",
      currentStepIndex: 0,
      maxRetries: 3,
      createdAt: 1000,
      updatedAt: 1000,
    }
    const restored = Plan.fromJSON(json)
    expect(restored.replanHistory).toEqual([])
  })

  it("reset clears replanHistory", () => {
    const plan = new Plan({
      title: "T",
      reasoning: "R",
      steps: [{ description: "S1", suggestedTools: [] }],
    })
    plan.recordReplan("Step failed", 1)
    plan.reset()
    expect(plan.replanHistory).toEqual([])
  })
})
