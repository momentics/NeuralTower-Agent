import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { CreateDirTool } from "./CreateDirTool"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

describe("CreateDirTool", () => {
  let tmpDir: string
  let tool: CreateDirTool

  beforeAll(async () => {
    tmpDir = path.join(os.tmpdir(), `createdir-test-${Date.now()}`)
    await fs.mkdir(tmpDir, { recursive: true })
    tool = new CreateDirTool(tmpDir)
  })

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it("has correct metadata", () => {
    expect(tool.name).toBe("create_dir")
    expect(tool.category).toBe("filesystem")
    expect(tool.isSafe).toBe(true)
  })

  it("has correct schema", () => {
    expect(tool.schema.name).toBe("create_dir")
    expect(tool.schema.required).toContain("path")
    expect(tool.schema.parameters.path).toBeDefined()
    expect(tool.schema.parameters.recursive).toBeDefined()
  })

  it("creates a directory", async () => {
    const dirPath = path.join(tmpDir, "new-dir")
    const result = await tool.execute({ path: dirPath })
    expect(result.success).toBe(true)
    expect(result.output).toContain("Директория создана")
    const stat = await fs.stat(dirPath)
    expect(stat.isDirectory()).toBe(true)
  })

  it("creates nested directories with recursive", async () => {
    const dirPath = path.join(tmpDir, "a", "b", "c")
    const result = await tool.execute({ path: dirPath, recursive: true })
    expect(result.success).toBe(true)
    const stat = await fs.stat(dirPath)
    expect(stat.isDirectory()).toBe(true)
  })

  it("returns error for empty path", async () => {
    const result = await tool.execute({ path: "" })
    expect(result.success).toBe(false)
    expect(result.output).toContain("Не указан")
  })

  it("succeeds when directory already exists with recursive", async () => {
    const dirPath = path.join(tmpDir, "existing")
    await fs.mkdir(dirPath, { recursive: true })
    const result = await tool.execute({ path: dirPath, recursive: true })
    expect(result.success).toBe(true)
  })

  it("blocks create outside workspace when workDir is set", async () => {
    const outsideDir = path.join(os.tmpdir(), `outside-cd-${Date.now()}`)
    const restrictedTool = new CreateDirTool(tmpDir)
    const result = await restrictedTool.execute({ path: outsideDir })
    expect(result.success).toBe(false)
    expect(result.output).toContain("Доступ запрещён")
  })

  it("allows create inside workspace when workDir is set", async () => {
    const restrictedTool = new CreateDirTool(tmpDir)
    const dirPath = path.join(tmpDir, "inside-cd")
    const result = await restrictedTool.execute({ path: dirPath })
    expect(result.success).toBe(true)
    const stat = await fs.stat(dirPath)
    expect(stat.isDirectory()).toBe(true)
  })
})
