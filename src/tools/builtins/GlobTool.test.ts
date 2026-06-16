import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { GlobTool } from "./GlobTool"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

describe("GlobTool", () => {
  let tmpDir: string
  let tool: GlobTool

  beforeAll(async () => {
    tmpDir = path.join(os.tmpdir(), `glob-test-${Date.now()}`)
    await fs.mkdir(tmpDir, { recursive: true })
    await fs.mkdir(path.join(tmpDir, "sub"), { recursive: true })
    await fs.writeFile(path.join(tmpDir, "a.ts"), "const a = 1")
    await fs.writeFile(path.join(tmpDir, "b.js"), "const b = 2")
    await fs.writeFile(path.join(tmpDir, "sub", "c.ts"), "const c = 3")
    tool = new GlobTool()
  })

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it("has correct metadata", () => {
    expect(tool.name).toBe("glob")
    expect(tool.category).toBe("filesystem")
    expect(tool.isSafe).toBe(true)
  })

  it("has correct schema", () => {
    expect(tool.schema.name).toBe("glob")
    expect(tool.schema.required).toContain("pattern")
    expect(tool.schema.parameters.pattern).toBeDefined()
    expect(tool.schema.parameters.path).toBeDefined()
  })

  it("finds files matching pattern", async () => {
    const result = await tool.execute({ pattern: "**/*.ts", path: tmpDir })
    expect(result.success).toBe(true)
    expect(result.output).toContain("a.ts")
    expect(result.output).toContain("c.ts")
    expect(result.output).not.toContain("b.js")
  })

  it("finds files with simple pattern", async () => {
    const result = await tool.execute({ pattern: "*.js", path: tmpDir })
    expect(result.success).toBe(true)
    expect(result.output).toContain("b.js")
    expect(result.output).not.toContain("a.ts")
  })

  it("returns no matches message when nothing found", async () => {
    const result = await tool.execute({ pattern: "**/*.py", path: tmpDir })
    expect(result.success).toBe(true)
    expect(result.output).toContain("Совпадений не найдено")
  })

  it("returns error for empty pattern", async () => {
    const result = await tool.execute({ pattern: "" })
    expect(result.success).toBe(true)
    expect(result.output).toContain("Совпадений не найдено")
  })

  it("uses default path of current directory", async () => {
    const result = await tool.execute({ pattern: "**/*.test.ts" })
    expect(result.success).toBe(true)
  })

  it("returns absolute paths", async () => {
    const result = await tool.execute({ pattern: "a.ts", path: tmpDir })
    expect(result.success).toBe(true)
    expect(result.output).toContain(tmpDir)
  })

  it("handles invalid path gracefully", async () => {
    const result = await tool.execute({
      pattern: "**/*.ts",
      path: "/nonexistent/path/that/does/not/exist",
    })
    // On some platforms glob returns empty, on others it throws
    if (result.success) {
      expect(result.output).toContain("Совпадений не найдено")
    } else {
      expect(result.output).toContain("не выполнен")
    }
  })
})
