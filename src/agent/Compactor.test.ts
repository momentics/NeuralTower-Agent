import { describe, it, expect, vi, beforeEach } from "vitest"
import { Compactor } from "./Compactor"
import type { IBackend, IChatMessage } from "../core/IBackend"
import { FULL_OUTPUT_MARKER } from "../tools/Truncate"

const makeMessages = (count: number, contentLen: number): IChatMessage[] => {
  const msgs: IChatMessage[] = []
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
      resolvedModel: vi.fn().mockResolvedValue(""),
      healthCheck: vi.fn().mockResolvedValue(true),
      chat: vi.fn(),
      chatJson: vi.fn(),
      getConfig: vi.fn().mockResolvedValue({ url: "", model: "", maxRetries: 0, timeoutMs: 0 }),
      currentUrl: vi.fn(() => ""),
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
    const userMsg = callArgs.find((m: IChatMessage) => m.content.includes("Сожми"))
    expect(userMsg).toBeDefined()
  })

  it("fallback summary includes last user message", async () => {
    const c = new Compactor(null, {
      contextLimit: 100,
      bufferTokens: 0,
      keepTokens: 1,
    })

    // Разрез по ходам: хвост начинается с последнего user-сообщения,
    // в head остаётся первый запрос пользователя.
    const msgs: IChatMessage[] = [
      { role: "user", content: "My goal is to test" },
      { role: "assistant", content: "ok" },
      { role: "user", content: "second query" },
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

    // Head без user-сообщений (разрез на границе «u2»),
    // чтобы последнее сообщение пользователя было undefined.
    const msgs: IChatMessage[] = [
      { role: "assistant", content: "some response" },
      { role: "assistant", content: "another response" },
      { role: "user", content: "u2" },
      { role: "assistant", content: "a2" },
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

  describe("pruneOldToolOutputs", () => {
    it("старые tool-сообщения очищаются, последние — нет", () => {
      const c = new Compactor(null, { contextLimit: 100_000, bufferTokens: 10_000, keepTokens: 5_000, maxToolOutputChars: 2_000, summaryMaxTokens: 4_096 })
      const messages: IChatMessage[] = []
      for (let i = 0; i < 10; i++) {
        messages.push({ role: "user", content: `u${i}`, timestamp: i })
        messages.push({ role: "tool", toolCallId: `t${i}`, name: "bash", content: `вывод ${i}`, timestamp: i })
      }
      const pruned = c.pruneOldToolOutputs(messages)
      expect(pruned[1].content).toBe("[Старый вывод инструмента очищен]")
      expect(pruned[pruned.length - 1].content).toBe("вывод 9")
    })

    it("указатель на файл с полным выводом сохраняется", () => {
      const c = new Compactor(null, { contextLimit: 100_000, bufferTokens: 10_000, keepTokens: 5_000, maxToolOutputChars: 2_000, summaryMaxTokens: 4_096 })
      const messages: IChatMessage[] = [
        { role: "user", content: "u0", timestamp: 0 },
        { role: "tool", toolCallId: "t0", name: "read_file", content: `начало\n${FULL_OUTPUT_MARKER} C:/data/out.txt\nконец`, timestamp: 0 },
        { role: "user", content: "u1", timestamp: 1 },
        { role: "tool", toolCallId: "t1", name: "read_file", content: "x", timestamp: 1 },
        { role: "user", content: "u2", timestamp: 2 },
        { role: "tool", toolCallId: "t2", name: "read_file", content: "y", timestamp: 2 },
        { role: "user", content: "u3", timestamp: 3 },
        { role: "tool", toolCallId: "t3", name: "read_file", content: "z", timestamp: 3 },
      ]
      const pruned = c.pruneOldToolOutputs(messages)
      expect(pruned[1].content).toBe(`[Старый вывод инструмента очищен]\n${FULL_OUTPUT_MARKER} C:/data/out.txt`)
    })

    it("короткая история не изменяется", () => {
      const c = new Compactor(null, { contextLimit: 100_000, bufferTokens: 10_000, keepTokens: 5_000, maxToolOutputChars: 2_000, summaryMaxTokens: 4_096 })
      const messages: IChatMessage[] = [
        { role: "user", content: "u", timestamp: 0 },
        { role: "tool", toolCallId: "t", name: "bash", content: "вывод", timestamp: 0 },
      ]
      expect(c.pruneOldToolOutputs(messages)).toBe(messages)
    })
  })

  describe("splitMessages (через compact)", () => {
    it("разрез только на границе user-сообщения", async () => {
      const backend: IBackend = {
        listModels: async () => [],
        healthCheck: async () => true,
        chat: async () => { throw new Error("не должно вызываться") },
        chatJson: async <T>(): Promise<T> => ({ summary: "СВОДКА" } as T),
        resolvedModel: async () => "m",
        getConfig: async () => ({ url: "http://x", model: "m", maxRetries: 0, timeoutMs: 1000 }),
        updateConfig: async () => {},
      }
      // keepTokens = 200 (≈ 800 символов): хвост должен начаться с u2
      const c = new Compactor(backend, { contextLimit: 100_000, bufferTokens: 10_000, keepTokens: 200, maxToolOutputChars: 2_000, summaryMaxTokens: 4_096 })
      const messages: IChatMessage[] = [
        { role: "user", content: "u1 " + "а".repeat(1000), timestamp: 0 },
        { role: "assistant", content: "a1 " + "б".repeat(1000), timestamp: 0 },
        { role: "tool", toolCallId: "t1", name: "bash", content: "т".repeat(1000), timestamp: 0 },
        { role: "user", content: "u2 " + "а".repeat(100), timestamp: 1 },
        { role: "assistant", content: "a2 " + "б".repeat(100), timestamp: 1 },
      ]
      const result = await c.compact(messages, "system")
      expect(result.needsCompaction).toBe(true)
      expect(result.compactedHistory?.[0].content).toBe("СВОДКА")
      // Хвост начинается с user-сообщения u2
      expect(result.compactedHistory?.[1].content).toContain("u2")
    })
  })
})
