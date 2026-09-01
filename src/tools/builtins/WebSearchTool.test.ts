import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { WebSearchTool, parseSearchResults } from "./WebSearchTool"

const FIXTURE_HTML = `
<html><body>
<div class="result">
  <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs&amp;rut=1">Example &amp; Docs</a>
  <a class="result__snippet" href="#">Сниппет <b>первого</b> результата</a>
</div>
<div class="result">
  <a class="result__a" href="https://example.org/page">Second Page</a>
</div>
</body></html>
`

describe("parseSearchResults", () => {
  it("разбирает заголовок, URL и сниппет", () => {
    const results = parseSearchResults(FIXTURE_HTML, 5)
    expect(results).toHaveLength(2)
    expect(results[0].title).toBe("Example & Docs")
    expect(results[0].url).toBe("https://example.com/docs")
    expect(results[0].snippet).toContain("первого")
    expect(results[1].title).toBe("Second Page")
    expect(results[1].url).toBe("https://example.org/page")
    expect(results[1].snippet).toBe("")
  })

  it("лимит max", () => {
    expect(parseSearchResults(FIXTURE_HTML, 1)).toHaveLength(1)
  })

  it("пустой HTML — пусто", () => {
    expect(parseSearchResults("<html></html>", 5)).toEqual([])
  })
})

describe("WebSearchTool", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("успешный поиск — список результатов", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Map(),
      text: async () => FIXTURE_HTML,
    }))
    // fetchUrl использует response.text() и response.ok
    const tool = new WebSearchTool()
    const r = await tool.execute({ query: "example docs" }, undefined)
    expect(r.success).toBe(true)
    expect(r.output).toContain("Example & Docs")
    expect(r.output).toContain("https://example.com/docs")
  })

  it("пустой запрос — ошибка", async () => {
    const tool = new WebSearchTool()
    const r = await tool.execute({ query: "   " }, undefined)
    expect(r.success).toBe(false)
  })

  it("сбой загрузки — ошибка", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("нет сети")))
    const tool = new WebSearchTool()
    const r = await tool.execute({ query: "x" }, undefined)
    expect(r.success).toBe(false)
    expect(r.output).toContain("Поиск не выполнен")
  })
})
