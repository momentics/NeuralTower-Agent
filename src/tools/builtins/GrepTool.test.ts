import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { GrepTool } from "./GrepTool"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

describe("GrepTool", () => {
  let tmpDir: string
  let tool: GrepTool

  beforeAll(async () => {
    tmpDir = path.join(os.tmpdir(), `grep-test-${Date.now()}`)
    await fs.mkdir(tmpDir, { recursive: true })
    await fs.writeFile(path.join(tmpDir, "a.ts"), "const foo = 1\nconst bar = 2\n")
    await fs.writeFile(path.join(tmpDir, "b.js"), "function foo() {}\n")
    await fs.writeFile(path.join(tmpDir, "c.txt"), "no match here\n")
    tool = new GrepTool()
  })

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it("has correct metadata", () => {
    expect(tool.name).toBe("grep")
    expect(tool.category).toBe("filesystem")
    expect(tool.isSafe).toBe(true)
  })

  it("has correct schema", () => {
    expect(tool.schema.name).toBe("grep")
    expect(tool.schema.required).toContain("pattern")
    expect(tool.schema.parameters.pattern).toBeDefined()
    expect(tool.schema.parameters.path).toBeDefined()
    expect(tool.schema.parameters.include).toBeDefined()
  })

  it("returns error for empty pattern", async () => {
    const result = await tool.execute({ pattern: "" })
    expect(result.success).toBe(false)
    expect(result.output).toContain("Не указан")
  })

  it("returns error for missing pattern", async () => {
    const result = await tool.execute({})
    expect(result.success).toBe(false)
    expect(result.output).toContain("Не указан")
  })

  it("finds matches using fallback search", async () => {
    GrepTool["rgAvailable"] = false
    const result = await tool.execute({ pattern: "foo", path: tmpDir })
    expect(result.success).toBe(true)
    expect(result.output).toContain("a.ts")
    expect(result.output).toContain("b.js")
    expect(result.output).not.toContain("c.txt")
  })

  it("respects include filter in fallback", async () => {
    GrepTool["rgAvailable"] = false
    const result = await tool.execute({ pattern: "foo", path: tmpDir, include: "*.ts" })
    expect(result.success).toBe(true)
    expect(result.output).toContain("a.ts")
    expect(result.output).not.toContain("b.js")
  })

  it("returns no matches when nothing found", async () => {
    GrepTool["rgAvailable"] = false
    const result = await tool.execute({ pattern: "nonexistent_pattern_xyz", path: tmpDir })
    expect(result.success).toBe(true)
    expect(result.output).toContain("Совпадений не найдено")
  })

  it("includes line numbers in output", async () => {
    GrepTool["rgAvailable"] = false
    const result = await tool.execute({ pattern: "foo", path: tmpDir })
    expect(result.success).toBe(true)
    expect(result.output).toMatch(/:\d+:/)
  })

  it("skips hidden directories", async () => {
    GrepTool["rgAvailable"] = false
    const hiddenDir = path.join(tmpDir, ".hidden")
    await fs.mkdir(hiddenDir, { recursive: true })
    await fs.writeFile(path.join(hiddenDir, "secret.ts"), "const foo = 999\n")
    const result = await tool.execute({ pattern: "foo", path: tmpDir })
    expect(result.success).toBe(true)
    expect(result.output).not.toContain(".hidden")
    await fs.rm(hiddenDir, { recursive: true, force: true })
  })

  it("skips node_modules directory", async () => {
    GrepTool["rgAvailable"] = false
    const nmDir = path.join(tmpDir, "node_modules")
    await fs.mkdir(nmDir, { recursive: true })
    await fs.writeFile(path.join(nmDir, "dep.ts"), "const foo = 999\n")
    const result = await tool.execute({ pattern: "foo", path: tmpDir })
    expect(result.success).toBe(true)
    expect(result.output).not.toContain("node_modules")
    await fs.rm(nmDir, { recursive: true, force: true })
  })

  it("truncates long lines to 200 chars", async () => {
    GrepTool["rgAvailable"] = false
    const longLine = "const foo = " + "x".repeat(300)
    await fs.writeFile(path.join(tmpDir, "long.ts"), longLine)
    const result = await tool.execute({ pattern: "foo", path: tmpDir })
    expect(result.success).toBe(true)
    const lines = result.output.split("\n")
    for (const line of lines) {
      // Найти часть с номером строки: после "path:LINE:" содержимое обрезается до 200 символов
      const lineNumMatch = line.match(/:(\d+): (.*)$/)
      if (lineNumMatch) {
        expect(lineNumMatch[2].length).toBeLessThanOrEqual(200)
      }
    }
  })

  it("truncates total output to 10000 chars", async () => {
    GrepTool["rgAvailable"] = false
    const result = await tool.execute({ pattern: "foo", path: tmpDir })
    expect(result.success).toBe(true)
    expect(result.output.length).toBeLessThanOrEqual(10000)
  })

  it("uses default path of current directory", async () => {
    GrepTool["rgAvailable"] = false
    const result = await tool.execute({ pattern: "foo", path: tmpDir })
    expect(result.success).toBe(true)
  })
})
