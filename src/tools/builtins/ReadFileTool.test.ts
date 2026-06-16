import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ReadFileTool } from "./ReadFileTool"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

describe("ReadFileTool", () => {
  let tmpDir: string
  let tool: ReadFileTool

  beforeAll(async () => {
    tmpDir = path.join(os.tmpdir(), `readfile-test-${Date.now()}`)
    await fs.mkdir(tmpDir, { recursive: true })
    const testFile = path.join(tmpDir, "test.txt")
    await fs.writeFile(testFile, "line1\nline2\nline3\nline4\nline5")
    tool = new ReadFileTool()
  })

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it("reads file content", async () => {
    const result = await tool.execute({ filepath: path.join(tmpDir, "test.txt") })
    expect(result.success).toBe(true)
    expect(result.output).toContain("line1")
    expect(result.output).toContain("line5")
  })

  it("returns error for missing file", async () => {
    const result = await tool.execute({ filepath: path.join(tmpDir, "nonexistent.txt") })
    expect(result.success).toBe(false)
    expect(result.output).toContain("Не удалось")
  })

  it("returns error for empty filepath", async () => {
    const result = await tool.execute({ filepath: "" })
    expect(result.success).toBe(false)
    expect(result.output).toContain("Не указан")
  })

  it("reads with offset", async () => {
    const result = await tool.execute({
      filepath: path.join(tmpDir, "test.txt"),
      offset: 3,
    })
    expect(result.success).toBe(true)
    expect(result.output).not.toContain("line1")
    expect(result.output).toContain("line3")
  })

  it("reads with limit", async () => {
    const result = await tool.execute({
      filepath: path.join(tmpDir, "test.txt"),
      limit: 2,
    })
    expect(result.success).toBe(true)
    const lines = result.output.split("\n")
    expect(lines.length).toBe(2)
  })

  it("reads with offset and limit", async () => {
    const result = await tool.execute({
      filepath: path.join(tmpDir, "test.txt"),
      offset: 2,
      limit: 2,
    })
    expect(result.success).toBe(true)
    const lines = result.output.split("\n")
    expect(lines.length).toBe(2)
    expect(lines[0]).toContain("line2")
    expect(lines[1]).toContain("line3")
  })
})
