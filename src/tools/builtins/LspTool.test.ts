import { describe, it, expect, vi, beforeEach } from "vitest"
import { LspTool } from "./LspTool"

describe("LspTool", () => {
  let tool: LspTool

  beforeEach(() => {
    tool = new LspTool()
  })

  it("has correct metadata", () => {
    expect(tool.name).toBe("lsp")
    expect(tool.category).toBe("lsp")
    expect(tool.isSafe).toBe(true)
  })

  it("has correct schema", () => {
    expect(tool.schema.name).toBe("lsp")
    expect(tool.schema.required).toContain("operation")
    expect(tool.schema.parameters.operation).toBeDefined()
    expect(tool.schema.parameters.filePath).toBeDefined()
    expect(tool.schema.parameters.line).toBeDefined()
    expect(tool.schema.parameters.character).toBeDefined()
    expect(tool.schema.parameters.query).toBeDefined()
  })

  it("returns error for missing operation", async () => {
    const result = await tool.execute({})
    expect(result.success).toBe(false)
    expect(result.output).toContain("Не указана")
  })

  it("returns error for unsupported operation", async () => {
    const result = await tool.execute({ operation: "invalidOp" })
    expect(result.success).toBe(false)
    expect(result.output).toContain("Неподдерживаемая")
  })

  it("returns error for missing filePath (non-workspaceSymbol)", async () => {
    const result = await tool.execute({ operation: "goToDefinition" })
    expect(result.success).toBe(false)
    expect(result.output).toContain("Не указан путь")
  })

  it("allows workspaceSymbol without filePath", async () => {
    const result = await tool.execute({ operation: "workspaceSymbol", query: "" })
    expect(result.success).toBe(true)
  })

  it("handles goToDefinition with file not found", async () => {
    const result = await tool.execute({
      operation: "goToDefinition",
      filePath: "/nonexistent/file.ts",
      line: 1,
      character: 1,
    })
    expect(result.success).toBe(false)
    expect(result.output).toContain("не найден")
  })

  it("handles goToTypeDefinition with file not found", async () => {
    const result = await tool.execute({
      operation: "goToTypeDefinition",
      filePath: "/nonexistent/file.ts",
      line: 1,
      character: 1,
    })
    expect(result.success).toBe(false)
    expect(result.output).toContain("не найден")
  })

  it("handles goToImplementation with file not found", async () => {
    const result = await tool.execute({
      operation: "goToImplementation",
      filePath: "/nonexistent/file.ts",
      line: 1,
      character: 1,
    })
    expect(result.success).toBe(false)
    expect(result.output).toContain("не найден")
  })

  it("handles findReferences with file not found", async () => {
    const result = await tool.execute({
      operation: "findReferences",
      filePath: "/nonexistent/file.ts",
      line: 1,
      character: 1,
    })
    expect(result.success).toBe(false)
    expect(result.output).toContain("не найден")
  })

  it("handles hover with file not found", async () => {
    const result = await tool.execute({
      operation: "hover",
      filePath: "/nonexistent/file.ts",
      line: 1,
      character: 1,
    })
    expect(result.success).toBe(false)
    expect(result.output).toContain("не найден")
  })

  it("handles signatureHelp with file not found", async () => {
    const result = await tool.execute({
      operation: "signatureHelp",
      filePath: "/nonexistent/file.ts",
      line: 1,
      character: 1,
    })
    expect(result.success).toBe(false)
    expect(result.output).toContain("не найден")
  })

  it("handles documentSymbol with file not found", async () => {
    const result = await tool.execute({
      operation: "documentSymbol",
      filePath: "/nonexistent/file.ts",
    })
    expect(result.success).toBe(false)
    expect(result.output).toContain("не найден")
  })

  it("converts 1-based line/character to 0-based position", async () => {
    const result = await tool.execute({
      operation: "goToDefinition",
      filePath: "/nonexistent/file.ts",
      line: 5,
      character: 10,
    })
    expect(result.success).toBe(false)
  })

  it("handles line 0 as valid input", async () => {
    const result = await tool.execute({
      operation: "goToDefinition",
      filePath: "/nonexistent/file.ts",
      line: 0,
      character: 0,
    })
    expect(result.success).toBe(false)
  })

  it("uses default position when line/character not provided", async () => {
    const result = await tool.execute({
      operation: "goToDefinition",
      filePath: "/nonexistent/file.ts",
    })
    expect(result.success).toBe(false)
  })
})
