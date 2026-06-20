import { describe, it, expect, vi, beforeEach } from "vitest"
import { WebFetchTool } from "./WebFetchTool"

describe("WebFetchTool", () => {
  let tool: WebFetchTool

  beforeEach(() => {
    tool = new WebFetchTool()
    vi.clearAllMocks()
  })

  it("has correct metadata", () => {
    expect(tool.name).toBe("web_fetch")
    expect(tool.category).toBe("network")
    expect(tool.isSafe).toBe(true)
  })

  it("has correct schema", () => {
    expect(tool.schema.name).toBe("web_fetch")
    expect(tool.schema.required).toContain("url")
    expect(tool.schema.parameters.url).toBeDefined()
    expect(tool.schema.parameters.format).toBeDefined()
    expect(tool.schema.parameters.timeout).toBeDefined()
  })

  it("returns error for empty URL", async () => {
    const result = await tool.execute({ url: "" })
    expect(result.success).toBe(false)
    expect(result.output).toContain("Не указан")
  })

  it("returns error for missing URL", async () => {
    const result = await tool.execute({})
    expect(result.success).toBe(false)
    expect(result.output).toContain("Не указан")
  })

  it("fetches content successfully", async () => {
    const mockText = "Hello from the web"
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => mockText,
    } as Response)

    const result = await tool.execute({ url: "https://example.com" })
    expect(result.success).toBe(true)
    expect(result.output).toBe(mockText)
    expect(fetch).toHaveBeenCalled()
  })

  it("truncates response to 8000 chars", async () => {
    const longText = "x".repeat(10000)
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => longText,
    } as Response)

    const result = await tool.execute({ url: "https://example.com" })
    expect(result.success).toBe(true)
    expect(result.output.length).toBe(8000)
  })

  it("returns HTTP error for non-200 response", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: async () => "",
    } as Response)

    const result = await tool.execute({ url: "https://example.com/notfound" })
    expect(result.success).toBe(false)
    expect(result.output).toBe("HTTP 404")
  })

  it("returns HTTP error for 500 response", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => "",
    } as Response)

    const result = await tool.execute({ url: "https://example.com/error" })
    expect(result.success).toBe(false)
    expect(result.output).toBe("HTTP 500")
  })

  it("handles fetch error", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("Network error"))

    const result = await tool.execute({ url: "https://example.com" })
    expect(result.success).toBe(false)
    expect(result.output).toContain("Ошибка загрузки")
    expect(result.output).toContain("Network error")
  })

  it("handles abort error", async () => {
    vi.mocked(fetch).mockRejectedValue(new DOMException("Aborted", "AbortError"))

    const result = await tool.execute({ url: "https://example.com" })
    expect(result.success).toBe(false)
    expect(result.output).toContain("Ошибка загрузки")
  })

  it("uses custom timeout", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "ok",
    } as Response)

    await tool.execute({ url: "https://example.com", timeout: 5 })
    expect(fetch).toHaveBeenCalled()
  })

  it("uses default timeout of 30 seconds", () => {
    expect(tool.schema.parameters.timeout.default).toBe(30)
  })

  it("uses default format of markdown", () => {
    expect(tool.schema.parameters.format.default).toBe("markdown")
  })

  it("format enum contains expected values", () => {
    expect(tool.schema.parameters.format.enum).toEqual(["markdown", "text", "html"])
  })
})
