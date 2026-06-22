import { describe, it, expect, vi, beforeEach } from "vitest"
import { ContextManager } from "./ContextManager"
import type { IContextProvider, IContextItem } from "./providers/context/types"

function makeProvider(
  name: string,
  priority: number,
  resolveFn: () => Promise<IContextItem[]>,
): IContextProvider {
  return {
    description: {
      name,
      displayTitle: name,
      description: name,
      type: "normal",
      priority,
    },
    resolve: vi.fn(async (_query: string) => resolveFn()),
  }
}

describe("ContextManager", () => {
  let cm: ContextManager

  beforeEach(() => {
    cm = new ContextManager()
  })

  it("registers and lists providers", () => {
    const p = makeProvider("a", 50, async () => [{ content: "v1", name: "A" }])
    cm.register(p)
    expect(cm.list()).toHaveLength(1)
    expect(cm.list()[0].description.name).toBe("a")
  })

  it("unregisters provider by name", () => {
    cm.register(makeProvider("a", 50, async () => [{ content: "v1", name: "A" }]))
    cm.register(makeProvider("b", 40, async () => [{ content: "v2", name: "B" }]))
    cm.unregister("a")
    expect(cm.list()).toHaveLength(1)
    expect(cm.list()[0].description.name).toBe("b")
  })

  it("sets and gets token budget", () => {
    expect(cm.getTokenBudget()).toBe(16000)
    cm.setTokenBudget(8000)
    expect(cm.getTokenBudget()).toBe(8000)
  })

  it("initialize loads providers sorted by priority", async () => {
    const s1 = makeProvider("low", 10, async () => [{ content: "low content", name: "L" }])
    const s2 = makeProvider("high", 90, async () => [{ content: "high content", name: "H" }])
    cm.register(s1)
    cm.register(s2)

    const result = await cm.initialize()

    expect(result.systemPrompt).toBe("high content\n\nlow content")
    expect(result.revision).toBe(1)
    expect(result.snapshot).toHaveLength(2)
    expect(result.systemTokens).toBeGreaterThan(0)
  })

  it("initialize skips providers returning empty items", async () => {
    const p = makeProvider("empty", 50, async () => [])
    cm.register(p)
    const result = await cm.initialize()
    expect(result.snapshot).toHaveLength(0)
    expect(result.systemPrompt).toBe("")
  })

  it("initialize respects token budget", async () => {
    const s1 = makeProvider("first", 90, async () => [{ content: "A".repeat(100000), name: "A" }])
    const s2 = makeProvider("second", 80, async () => [{ content: "B".repeat(100000), name: "B" }])
    cm.register(s1)
    cm.register(s2)
    cm.setTokenBudget(5000)

    const result = await cm.initialize()

    expect(result.snapshot).toHaveLength(1)
    expect(result.snapshot[0].name).toBe("first")
  })

  it("initialize catches provider resolve errors", async () => {
    const p: IContextProvider = {
      description: { name: "fail", displayTitle: "fail", description: "fail", type: "normal" },
      resolve: vi.fn(async () => { throw new Error("fail") }),
    }
    cm.register(p)
    const result = await cm.initialize()
    expect(result.snapshot).toHaveLength(0)
  })

  it("prepare detects unchanged providers", async () => {
    const p = makeProvider("a", 50, async () => [{ content: "v1", name: "A" }])
    cm.register(p)
    await cm.initialize()

    const result = await cm.prepare()

    expect(result.revision).toBe(2)
    expect(result.systemPrompt).toBe("v1")
  })

  it("prepare detects content changes", async () => {
    const p = makeProvider("a", 50, async () => [{ content: "v1", name: "A" }])
    cm.register(p)
    await cm.initialize()

    ;(p.resolve as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => [{ content: "v2", name: "A" }])

    const result = await cm.prepare()

    expect(result.systemPrompt).toContain("Изменения контекста")
    expect(result.systemPrompt).toContain('Источник "a" изменён')
  })

  it("prepare detects removed content", async () => {
    const p = makeProvider("a", 50, async () => [{ content: "v1", name: "A" }])
    cm.register(p)
    await cm.initialize()

    ;(p.resolve as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => [])

    const result = await cm.prepare()

    expect(result.systemPrompt).toContain('Источник "a" изменён')
  })

  it("getSnapshot returns copy", () => {
    const snapshot = cm.getSnapshot()
    expect(snapshot).toEqual([])
  })

  it("getRevision starts at 0", () => {
    expect(cm.getRevision()).toBe(0)
  })

  it("estimateSystemTokens returns sum", async () => {
    cm.register(makeProvider("a", 50, async () => [{ content: "hello", name: "A" }]))
    cm.register(makeProvider("b", 40, async () => [{ content: "world", name: "B" }]))
    await cm.initialize()
    const tokens = cm.estimateSystemTokens()
    expect(tokens).toBeGreaterThan(0)
  })

  it("reset clears state but keeps providers", async () => {
    cm.register(makeProvider("a", 50, async () => [{ content: "v1", name: "A" }]))
    await cm.initialize()
    cm.reset()
    expect(cm.list()).toHaveLength(1)
    expect(cm.getSnapshot()).toHaveLength(0)
    expect(cm.getRevision()).toBe(0)
  })

  it("uses custom changed text", async () => {
    const p: IContextProvider = {
      description: { name: "a", displayTitle: "a", description: "a", type: "normal" },
      resolve: vi.fn(async () => [{ content: "v1", name: "A" }]),
      changed: vi.fn(() => "custom changed"),
    }
    cm.register(p)
    await cm.initialize()
    ;(p.resolve as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => [{ content: "v2", name: "A" }])
    const result = await cm.prepare()
    expect(result.systemPrompt).toContain("custom changed")
  })

  it("uses default changed text when no custom changed", async () => {
    const p = makeProvider("a", 50, async () => [{ content: "v1", name: "A" }])
    cm.register(p)
    await cm.initialize()
    ;(p.resolve as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => [{ content: "v2", name: "A" }])
    const result = await cm.prepare()
    expect(result.systemPrompt).toContain('Источник "a" изменён')
  })
})
