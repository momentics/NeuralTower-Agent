import { describe, it, expect, vi, beforeEach } from "vitest"
import { ContextManager } from "./ContextManager"
import type { ContextSource } from "./ContextSource"

function makeSource(key: string, priority: number, loadValue: unknown, baselineText: string): ContextSource {
  return {
    key,
    priority,
    load: vi.fn().mockResolvedValue(loadValue),
    baseline: vi.fn().mockReturnValue(baselineText),
    update: vi.fn().mockReturnValue(`updated: ${key}`),
    removed: vi.fn().mockReturnValue(`removed: ${key}`),
  }
}

describe("ContextManager", () => {
  let cm: ContextManager

  beforeEach(() => {
    cm = new ContextManager()
  })

  it("registers and lists sources", () => {
    const src = makeSource("a", 50, "v1", "baseline a")
    cm.register(src)
    expect(cm.list()).toHaveLength(1)
    expect(cm.list()[0].key).toBe("a")
  })

  it("unregisters source by key", () => {
    cm.register(makeSource("a", 50, "v1", "baseline a"))
    cm.register(makeSource("b", 40, "v2", "baseline b"))
    cm.unregister("a")
    expect(cm.list()).toHaveLength(1)
    expect(cm.list()[0].key).toBe("b")
  })

  it("sets and gets token budget", () => {
    expect(cm.getTokenBudget()).toBe(16000)
    cm.setTokenBudget(8000)
    expect(cm.getTokenBudget()).toBe(8000)
  })

  it("initialize loads sources sorted by priority", async () => {
    const s1 = makeSource("low", 10, "v1", "low baseline")
    const s2 = makeSource("high", 90, "v2", "high baseline")
    cm.register(s1)
    cm.register(s2)

    const result = await cm.initialize()

    expect(result.systemPrompt).toBe("high baseline\n\nlow baseline")
    expect(result.revision).toBe(1)
    expect(result.snapshot).toHaveLength(2)
    expect(result.systemTokens).toBeGreaterThan(0)
  })

  it("initialize skips undefined load results", async () => {
    const src: ContextSource = {
      key: "skip",
      priority: 50,
      load: vi.fn().mockResolvedValue(undefined),
      baseline: vi.fn(),
      update: vi.fn(),
    }
    cm.register(src)
    const result = await cm.initialize()
    expect(result.snapshot).toHaveLength(0)
    expect(result.systemPrompt).toBe("")
  })

  it("initialize respects token budget", async () => {
    const s1 = makeSource("first", 90, "v1", "A".repeat(100000))
    const s2 = makeSource("second", 80, "v2", "B".repeat(100000))
    cm.register(s1)
    cm.register(s2)
    cm.setTokenBudget(5000)

    const result = await cm.initialize()

    expect(result.snapshot).toHaveLength(1)
    expect(result.snapshot[0].key).toBe("first")
  })

  it("initialize catches source load errors", async () => {
    const src: ContextSource = {
      key: "fail",
      priority: 50,
      load: vi.fn().mockRejectedValue(new Error("fail")),
      baseline: vi.fn(),
      update: vi.fn(),
    }
    cm.register(src)
    const result = await cm.initialize()
    expect(result.snapshot).toHaveLength(0)
  })

  it("prepare detects unchanged sources", async () => {
    const src = makeSource("a", 50, "v1", "baseline a")
    cm.register(src)
    await cm.initialize()

    const result = await cm.prepare()

    expect(result.revision).toBe(2)
    expect(result.systemPrompt).toBe("baseline a")
  })

  it("prepare detects updated sources", async () => {
    const src = makeSource("a", 50, "v1", "baseline a")
    cm.register(src)
    await cm.initialize()

    ;(src.load as ReturnType<typeof vi.fn>).mockResolvedValue("v2")

    const result = await cm.prepare()

    expect(result.systemPrompt).toContain("Изменения контекста")
    expect(result.systemPrompt).toContain("updated: a")
  })

  it("prepare detects removed sources", async () => {
    const src: ContextSource = {
      key: "a",
      priority: 50,
      load: vi.fn().mockResolvedValue("v1").mockResolvedValueOnce("v1").mockResolvedValue(undefined),
      baseline: vi.fn().mockReturnValue("baseline a"),
      update: vi.fn(),
      removed: vi.fn().mockReturnValue("removed: a"),
    }
    cm.register(src)
    await cm.initialize()

    const result = await cm.prepare()

    expect(result.systemPrompt).toContain("removed: a")
  })

  it("getSnapshot returns copy", () => {
    const snapshot = cm.getSnapshot()
    expect(snapshot).toEqual([])
  })

  it("getRevision starts at 0", () => {
    expect(cm.getRevision()).toBe(0)
  })

  it("estimateSystemTokens returns sum", async () => {
    cm.register(makeSource("a", 50, "v1", "hello"))
    cm.register(makeSource("b", 40, "v2", "world"))
    await cm.initialize()
    const tokens = cm.estimateSystemTokens()
    expect(tokens).toBeGreaterThan(0)
  })

  it("reset clears state", async () => {
    cm.register(makeSource("a", 50, "v1", "baseline a"))
    await cm.initialize()
    cm.reset()
    expect(cm.list()).toHaveLength(0)
    expect(cm.getSnapshot()).toHaveLength(0)
    expect(cm.getRevision()).toBe(0)
  })

  it("uses custom removed text", async () => {
    const src: ContextSource = {
      key: "a",
      priority: 50,
      load: vi.fn().mockResolvedValue("v1").mockResolvedValueOnce("v1").mockResolvedValue(undefined),
      baseline: vi.fn().mockReturnValue("baseline a"),
      update: vi.fn(),
      removed: vi.fn().mockReturnValue("custom removed"),
    }
    cm.register(src)
    await cm.initialize()
    const result = await cm.prepare()
    expect(result.systemPrompt).toContain("custom removed")
  })

  it("uses default removed text when no custom removed", async () => {
    const src: ContextSource = {
      key: "a",
      priority: 50,
      load: vi.fn().mockResolvedValue("v1").mockResolvedValueOnce("v1").mockResolvedValue(undefined),
      baseline: vi.fn().mockReturnValue("baseline a"),
      update: vi.fn(),
    }
    cm.register(src)
    await cm.initialize()
    const result = await cm.prepare()
    expect(result.systemPrompt).toContain('Источник "a" удалён')
  })
})
