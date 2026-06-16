import { describe, it, expect, vi } from "vitest"
import { makeWebSearchProvider } from "./web-search"

describe("makeWebSearchProvider", () => {
  const provider = makeWebSearchProvider()

  it("returns empty for empty query", async () => {
    const result = await provider.resolve("")
    expect(result).toEqual([])
  })

  it("returns error for fetch failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")))
    const result = await provider.resolve("test query")
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain("Ошибка поиска")
    vi.unstubAllGlobals()
  })

  it("returns search results", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        Abstract: "Some abstract",
        RelatedTopics: [{ Text: "Topic 1" }, { Text: "Topic 2" }],
      }),
    }))
    const result = await provider.resolve("test query")
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain("Some abstract")
    expect(result[0].content).toContain("Topic 1")
    vi.unstubAllGlobals()
  })

  it("returns error for non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    const result = await provider.resolve("test query")
    expect(result[0].content).toContain("Поиск недоступен")
    vi.unstubAllGlobals()
  })
})
