import { describe, it, expect, vi, beforeEach } from "vitest"
import { SessionContext } from "./SessionContext"
import { ContextManager } from "../core/ContextManager"
import { AgentMismatchError } from "../core/ContextSource"
import type { ContextProvider } from "../core/providers/context/types"

describe("SessionContext", () => {
  let cm: ContextManager
  let sc: SessionContext
  let provider: ContextProvider

  beforeEach(() => {
    cm = new ContextManager()
    provider = {
      description: {
        name: "test",
        displayTitle: "Test",
        description: "Test provider",
        type: "normal",
        priority: 50,
      },
      resolve: vi.fn().mockResolvedValue([{ content: "baseline test", name: "test" }]),
    }
    cm.register(provider)
    sc = new SessionContext("sess-1", cm)
  })

  it("initializes and returns epoch prepared", async () => {
    const result = await sc.initialize("build")
    expect(result.baseline).toBe("baseline test")
    expect(result.revision).toBeGreaterThan(0)
  })

  it("throws AgentMismatchError on re-init with different agent", async () => {
    await sc.initialize("build")
    await expect(sc.initialize("plan")).rejects.toThrow(AgentMismatchError)
  })

  it("returns same epoch on re-init with same agent", async () => {
    const r1 = await sc.initialize("build")
    const r2 = await sc.initialize("build")
    expect(r2.baseline).toBe("baseline test")
  })

  it("prepare initializes if not initialized", async () => {
    const result = await sc.prepare("build")
    expect(result.baseline).toBe("baseline test")
  })

  it("prepare throws on agent mismatch", async () => {
    await sc.initialize("build")
    await expect(sc.prepare("plan")).rejects.toThrow(AgentMismatchError)
  })

  it("prepare updates epoch", async () => {
    await sc.initialize("build")
    const result = await sc.prepare("build")
    expect(result.revision).toBeGreaterThan(1)
  })

  it("pushMessage adds to history", () => {
    sc.pushMessage({ role: "user", content: "hello" })
    expect(sc.getMessages()).toHaveLength(1)
    expect(sc.getMessages()[0].content).toBe("hello")
  })

  it("getMessages returns copy", () => {
    sc.pushMessage({ role: "user", content: "hello" })
    const msgs = sc.getMessages()
    msgs.push({ role: "assistant", content: "hi" })
    expect(sc.getMessages()).toHaveLength(1)
  })

  it("replaceMessages replaces and sets compacted", () => {
    sc.pushMessage({ role: "user", content: "hello" })
    sc.replaceMessages([{ role: "user", content: "summary" }])
    expect(sc.getMessages()).toHaveLength(1)
    expect(sc.getMessages()[0].content).toBe("summary")
    expect(sc.isCompacted()).toBe(true)
  })

  it("setPlan and getPlan", () => {
    const plan = {} as any
    sc.setPlan(plan)
    expect(sc.getPlan()).toBe(plan)
  })

  it("clearPlan removes plan", () => {
    sc.setPlan({} as any)
    sc.clearPlan()
    expect(sc.getPlan()).toBeNull()
  })

  it("getEpoch returns copy", async () => {
    await sc.initialize("build")
    const epoch = sc.getEpoch()
    expect(epoch).not.toBeNull()
    expect(epoch!.agent).toBe("build")
  })

  it("getAgent returns null before init", () => {
    expect(sc.getAgent()).toBeNull()
  })

  it("getAgent returns agent after init", async () => {
    await sc.initialize("build")
    expect(sc.getAgent()).toBe("build")
  })

  it("isCompacted starts false", () => {
    expect(sc.isCompacted()).toBe(false)
  })

  it("reset clears all state", async () => {
    await sc.initialize("build")
    sc.pushMessage({ role: "user", content: "hello" })
    sc.reset()
    expect(sc.getEpoch()).toBeNull()
    expect(sc.getMessages()).toHaveLength(0)
    expect(sc.getPlan()).toBeNull()
    expect(sc.isCompacted()).toBe(false)
    expect(sc.getAgent()).toBeNull()
  })

  it("toPrepared throws when not initialized", () => {
    expect(() => (sc as any).toPrepared()).toThrow("Этап не инициализирован")
  })
})
