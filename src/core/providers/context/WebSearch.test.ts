import { describe, it, expect, vi } from "vitest"
import { makeWebSearchProvider } from "./WebSearch"

describe("makeWebSearchProvider", () => {
  it("returns empty for empty query", async () => {
    const provider = makeWebSearchProvider()
    const result = await provider.resolve("")
    expect(result).toEqual([])
  })

  it("returns error for fetch failure", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("network"))
    const provider = makeWebSearchProvider(mockFetch)
    const result = await provider.resolve("test query")
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain("Ошибка поиска")
  })

  it("returns search results", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        Abstract: "Some abstract",
        RelatedTopics: [{ Text: "Topic 1" }, { Text: "Topic 2" }],
      }),
    })
    const provider = makeWebSearchProvider(mockFetch)
    const result = await provider.resolve("test query")
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain("Some abstract")
    expect(result[0].content).toContain("Topic 1")
  })

  it("returns error for non-ok response", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500 })
    const provider = makeWebSearchProvider(mockFetch)
    const result = await provider.resolve("test query")
    expect(result[0].content).toContain("Поиск недоступен")
  })
})
