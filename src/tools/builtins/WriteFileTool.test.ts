import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { WriteFileTool } from "./WriteFileTool"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

describe("WriteFileTool", () => {
  let tmpDir: string
  let tool: WriteFileTool

  beforeAll(async () => {
    tmpDir = path.join(os.tmpdir(), `writefile-test-${Date.now()}`)
    await fs.mkdir(tmpDir, { recursive: true })
    tool = new WriteFileTool(tmpDir)
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

  it("blocks write outside workspace when workDir is set", async () => {
    const outsideDir = path.join(os.tmpdir(), `outside-write-${Date.now()}`)
    await fs.mkdir(outsideDir, { recursive: true })
    const outsideFile = path.join(outsideDir, "secret.txt")
    const restrictedTool = new WriteFileTool(tmpDir)
    const result = await restrictedTool.execute({ filepath: outsideFile, content: "hacked" })
    expect(result.success).toBe(false)
    expect(result.output).toContain("Доступ запрещён")
    await fs.rm(outsideDir, { recursive: true, force: true })
  })

  it("allows write inside workspace when workDir is set", async () => {
    const restrictedTool = new WriteFileTool(tmpDir)
    const filePath = path.join(tmpDir, "inside.txt")
    const result = await restrictedTool.execute({ filepath: filePath, content: "ok" })
    expect(result.success).toBe(true)
    const content = await fs.readFile(filePath, "utf-8")
    expect(content).toBe("ok")
  })
})
