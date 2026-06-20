import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { MoveFileTool } from "./MoveFileTool"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

describe("MoveFileTool", () => {
  let tmpDir: string
  let tool: MoveFileTool

  beforeAll(async () => {
    tmpDir = path.join(os.tmpdir(), `movefile-test-${Date.now()}`)
    await fs.mkdir(tmpDir, { recursive: true })
    tool = new MoveFileTool()
  })

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it("has correct metadata", () => {
    expect(tool.name).toBe("move_file")
    expect(tool.category).toBe("filesystem")
    expect(tool.isSafe).toBe(false)
  })

  it("has correct schema", () => {
    expect(tool.schema.name).toBe("move_file")
    expect(tool.schema.required).toContain("source")
    expect(tool.schema.required).toContain("destination")
    expect(tool.schema.parameters.source).toBeDefined()
    expect(tool.schema.parameters.destination).toBeDefined()
  })

  it("moves a file", async () => {
    const srcPath = path.join(tmpDir, "source.txt")
    const dstPath = path.join(tmpDir, "dest.txt")
    await fs.writeFile(srcPath, "move me")
    const result = await tool.execute({ source: srcPath, destination: dstPath })
    expect(result.success).toBe(true)
    expect(result.output).toContain("Перемещено")
    const content = await fs.readFile(dstPath, "utf-8")
    expect(content).toBe("move me")
    await expect(fs.stat(srcPath)).rejects.toThrow()
  })

  it("renames a file", async () => {
    const srcPath = path.join(tmpDir, "old-name.txt")
    const dstPath = path.join(tmpDir, "new-name.txt")
    await fs.writeFile(srcPath, "renamed")
    const result = await tool.execute({ source: srcPath, destination: dstPath })
    expect(result.success).toBe(true)
    const content = await fs.readFile(dstPath, "utf-8")
    expect(content).toBe("renamed")
    await expect(fs.stat(srcPath)).rejects.toThrow()
  })

  it("moves a directory", async () => {
    const srcPath = path.join(tmpDir, "old-dir")
    const dstPath = path.join(tmpDir, "new-dir")
    await fs.mkdir(srcPath, { recursive: true })
    await fs.writeFile(path.join(srcPath, "file.txt"), "data")
    const result = await tool.execute({ source: srcPath, destination: dstPath })
    expect(result.success).toBe(true)
    const content = await fs.readFile(path.join(dstPath, "file.txt"), "utf-8")
    expect(content).toBe("data")
    await expect(fs.stat(srcPath)).rejects.toThrow()
  })

  it("creates destination parent directories", async () => {
    const srcPath = path.join(tmpDir, "to-move.txt")
    const dstPath = path.join(tmpDir, "a", "b", "moved.txt")
    await fs.writeFile(srcPath, "deep move")
    const result = await tool.execute({ source: srcPath, destination: dstPath })
    expect(result.success).toBe(true)
    const content = await fs.readFile(dstPath, "utf-8")
    expect(content).toBe("deep move")
    await expect(fs.stat(srcPath)).rejects.toThrow()
  })

  it("returns error for missing source", async () => {
    const result = await tool.execute({
      source: path.join(tmpDir, "nonexistent.txt"),
      destination: path.join(tmpDir, "dest.txt"),
    })
    expect(result.success).toBe(false)
    expect(result.output).toContain("Не удалось")
  })

  it("returns error for empty source", async () => {
    const result = await tool.execute({ source: "", destination: "dest" })
    expect(result.success).toBe(false)
    expect(result.output).toContain("Не указаны")
  })

  it("returns error for empty destination", async () => {
    const srcPath = path.join(tmpDir, "empty-dst.txt")
    await fs.writeFile(srcPath, "data")
    const result = await tool.execute({ source: srcPath, destination: "" })
    expect(result.success).toBe(false)
    expect(result.output).toContain("Не указаны")
  })

  it("blocks move outside workspace when workDir is set (source)", async () => {
    const outsideDir = path.join(os.tmpdir(), `outside-move-${Date.now()}`)
    await fs.mkdir(outsideDir, { recursive: true })
    const outsideFile = path.join(outsideDir, "secret.txt")
    await fs.writeFile(outsideFile, "secret")
    const restrictedTool = new MoveFileTool(tmpDir)
    const result = await restrictedTool.execute({
      source: outsideFile,
      destination: path.join(tmpDir, "stolen.txt"),
    })
    expect(result.success).toBe(false)
    expect(result.output).toContain("Доступ запрещён")
    await fs.rm(outsideDir, { recursive: true, force: true })
  })

  it("blocks move outside workspace when workDir is set (destination)", async () => {
    const outsideDir = path.join(os.tmpdir(), `outside-move-dst-${Date.now()}`)
    await fs.mkdir(outsideDir, { recursive: true })
    const srcPath = path.join(tmpDir, "victim.txt")
    await fs.writeFile(srcPath, "data")
    const restrictedTool = new MoveFileTool(tmpDir)
    const result = await restrictedTool.execute({
      source: srcPath,
      destination: path.join(outsideDir, "moved.txt"),
    })
    expect(result.success).toBe(false)
    expect(result.output).toContain("Доступ запрещён")
    await fs.rm(outsideDir, { recursive: true, force: true })
  })

  it("allows move inside workspace when workDir is set", async () => {
    const restrictedTool = new MoveFileTool(tmpDir)
    const srcPath = path.join(tmpDir, "inside-src.txt")
    const dstPath = path.join(tmpDir, "inside-dst.txt")
    await fs.writeFile(srcPath, "data")
    const result = await restrictedTool.execute({ source: srcPath, destination: dstPath })
    expect(result.success).toBe(true)
    await expect(fs.stat(srcPath)).rejects.toThrow()
    const content = await fs.readFile(dstPath, "utf-8")
    expect(content).toBe("data")
  })
})
