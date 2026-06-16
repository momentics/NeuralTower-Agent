import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { WriteFileTool } from "./WriteFileTool"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

describe("WriteFileTool", () => {
  let tmpDir: string
  let tool: WriteFileTool

  beforeAll(() => {
    tmpDir = path.join(os.tmpdir(), `writefile-test-${Date.now()}`)
    tool = new WriteFileTool()
  })

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it("writes file content", async () => {
    const filePath = path.join(tmpDir, "hello.txt")
    const result = await tool.execute({ filepath: filePath, content: "Hello World" })
    expect(result.success).toBe(true)
    expect(result.output).toContain("11 байт")
    const content = await fs.readFile(filePath, "utf-8")
    expect(content).toBe("Hello World")
  })

  it("creates parent directories", async () => {
    const filePath = path.join(tmpDir, "a", "b", "c", "deep.txt")
    const result = await tool.execute({ filepath: filePath, content: "deep" })
    expect(result.success).toBe(true)
    const content = await fs.readFile(filePath, "utf-8")
    expect(content).toBe("deep")
  })

  it("returns error for empty filepath", async () => {
    const result = await tool.execute({ filepath: "", content: "test" })
    expect(result.success).toBe(false)
    expect(result.output).toContain("Не указан")
  })

  it("overwrites existing file", async () => {
    const filePath = path.join(tmpDir, "overwrite.txt")
    await fs.writeFile(filePath, "old")
    const result = await tool.execute({ filepath: filePath, content: "new" })
    expect(result.success).toBe(true)
    const content = await fs.readFile(filePath, "utf-8")
    expect(content).toBe("new")
  })
})
