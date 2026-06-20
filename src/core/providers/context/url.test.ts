import { describe, it, expect, vi } from "vitest"
import { makeUrlProvider } from "./url"

describe("makeUrlProvider", () => {
  const provider = makeUrlProvider()

  it("returns empty for empty query", async () => {
    const result = await provider.resolve("")
    expect(result).toEqual([])
  })

  it("returns error for invalid URL", async () => {
    const result = await provider.resolve("not a url")
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain("Некорректный URL")
  })

  it("returns error for fetch failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")))
    const result = await provider.resolve("https://example.com")
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain("Ошибка загрузки")
    vi.unstubAllGlobals()
  })

  it("returns error for non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: vi.fn().mockResolvedValue(""),
    }))
    const result = await provider.resolve("https://example.com")
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain("HTTP 404")
    vi.unstubAllGlobals()
  })

  it("returns content for successful fetch", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue("<html><title>Test</title><body><p>Hello</p></body></html>"),
    }))
    const result = await provider.resolve("https://example.com")
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain("Источник: https://example.com")
    expect(result[0].name).toBe("Test")
    vi.unstubAllGlobals()
  })

  it("adds https for bare domain", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")))
    const result = await provider.resolve("example.com")
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain("Ошибка загрузки")
    vi.unstubAllGlobals()
  })
})
