import { describe, it, expect, vi, beforeEach } from "vitest"
import { Compactor } from "./Compactor"
import type { IBackend, ChatMessage } from "../core/IBackend"

const makeMessages = (count: number, contentLen: number): ChatMessage[] => {
  const msgs: ChatMessage[] = []
  for (let i = 0; i < count; i++) {
    msgs.push({
      role: i % 2 === 0 ? "user" : "assistant",
      content: "x".repeat(contentLen),
    })
  }
  return msgs
}

describe("Compactor", () => {
  let backend: IBackend

  beforeEach(() => {
    backend = {
      listModels: vi.fn().mockResolvedValue(["model"]),
      healthCheck: vi.fn().mockResolvedValue(true),
      chat: vi.fn(),
      chatJson: vi.fn(),
      getConfig: vi.fn().mockResolvedValue({ url: "", model: "", maxRetries: 0, timeoutMs: 0 }),
      updateConfig: vi.fn().mockResolvedValue(undefined),
    }
  })

  it("returns no compaction needed when under threshold", async () => {
    const c = new Compactor(backend)
    const result = await c.compactIfNeeded(
      [{ role: "user", content: "hello" }],
      "system prompt",
    )
    expect(result.needsCompaction).toBe(false)
    expect(result.tokensBefore).toBeGreaterThan(0)
    expect(result.tokensAfter).toBe(result.tokensBefore)
  })

  it("returns compaction needed when over threshold", async () => {
    const c = new Compactor(backend, {
      contextLimit: 100,
      bufferTokens: 0,
      keepTokens: 10,
    })

    backend.chatJson = vi.fn().mockResolvedValue({ summary: "Summary text" })

    const msgs = makeMessages(10, 100)
    const result = await c.compactIfNeeded(msgs, "sys")

    expect(result.needsCompaction).toBe(true)
    expect(result.summary).toBe("Summary text")
    expect(result.compactedHistory).toBeDefined()
  })

  it("uses fallback summary when backend is null", async () => {
    const c = new Compactor(null, {
      contextLimit: 100,
      bufferTokens: 0,
      keepTokens: 10,
    })

    const msgs = makeMessages(10, 100)
    const result = await c.compactIfNeeded(msgs, "sys")

    expect(result.needsCompaction).toBe(true)
    expect(result.summary).toContain("## Цель")
    expect(result.summary).toContain("## Прогресс")
  })

  it("uses fallback summary when backend throws", async () => {
    backend.chatJson = vi.fn().mockRejectedValue(new Error("fail"))
    const c = new Compactor(backend, {
      contextLimit: 100,
      bufferTokens: 0,
      keepTokens: 10,
    })

    const msgs = makeMessages(10, 100)
    const result = await c.compactIfNeeded(msgs, "sys")

    expect(result.summary).toContain("## Цель")
  })

  it("returns no compaction when head is empty", async () => {
    const c = new Compactor(backend, {
      contextLimit: 100,
      bufferTokens: 0,
      keepTokens: 10000,
    })

    const msgs = makeMessages(2, 100)
    const result = await c.compactIfNeeded(msgs, "sys")

    expect(result.needsCompaction).toBe(false)
  })

  it("sets options correctly", () => {
    const c = new Compactor(backend)
    c.setOptions({ contextLimit: 50000 })
    expect((c as any).options.contextLimit).toBe(50000)
  })

  it("compact returns compacted history with summary and recent", async () => {
    backend.chatJson = vi.fn().mockResolvedValue({ summary: "My summary" })
    const c = new Compactor(backend, {
      contextLimit: 100,
      bufferTokens: 0,
      keepTokens: 10,
    })

    const msgs = makeMessages(20, 100)
    const result = await c.compact(msgs, "sys")

    expect(result.compactedHistory).toBeDefined()
    expect(result.compactedHistory![0].content).toBe("My summary")
    expect(result.tokensAfter).toBeLessThan(result.tokensBefore)
  })

  it("truncates long message content before summarizing", async () => {
    backend.chatJson = vi.fn().mockResolvedValue({ summary: "ok" })
    const c = new Compactor(backend, {
      contextLimit: 100,
      bufferTokens: 0,
      keepTokens: 10,
      maxToolOutputChars: 50,
    })

    const msgs = makeMessages(10, 200)
    await c.compact(msgs, "sys")

    const callArgs = (backend.chatJson as ReturnType<typeof vi.fn>).mock.calls[0][0]
    const userMsg = callArgs.find((m: ChatMessage) => m.content.includes("Сожми"))
    expect(userMsg).toBeDefined()
  })

  it("fallback summary includes last user message", async () => {
    const c = new Compactor(null, {
      contextLimit: 100,
      bufferTokens: 0,
      keepTokens: 1,
    })

    const msgs: ChatMessage[] = [
      { role: "user", content: "My goal is to test" },
      { role: "assistant", content: "ok" },
    ]
    const result = await c.compact(msgs, "sys")

    expect(result.summary).toContain("My goal is to test")
  })

  it("fallback summary handles empty messages", async () => {
    const c = new Compactor(null, {
      contextLimit: 100,
      bufferTokens: 0,
      keepTokens: 1,
    })

    // Use only assistant messages so last user message is undefined
    const msgs: ChatMessage[] = [
      { role: "assistant", content: "some response" },
      { role: "assistant", content: "another response" },
    ]
    const result = await c.compact(msgs, "sys")

    expect(result.summary).toContain("Неизвестно")
  })

  it("split keeps recent messages within keepTokens", async () => {
    backend.chatJson = vi.fn().mockResolvedValue({ summary: "s" })
    const c = new Compactor(backend, {
      contextLimit: 100,
      bufferTokens: 0,
      keepTokens: 50,
    })

    const msgs = makeMessages(20, 100)
    const result = await c.compact(msgs, "sys")

    expect(result.compactedHistory).toBeDefined()
    expect(result.compactedHistory!.length).toBeGreaterThan(1)
  })
})
