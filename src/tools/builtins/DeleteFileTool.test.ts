import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { DeleteFileTool } from "./DeleteFileTool"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

describe("DeleteFileTool", () => {
  let tmpDir: string
  let tool: DeleteFileTool

  beforeAll(async () => {
    tmpDir = path.join(os.tmpdir(), `deletefile-test-${Date.now()}`)
    await fs.mkdir(tmpDir, { recursive: true })
    tool = new DeleteFileTool(tmpDir)
  })

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it("has correct metadata", () => {
    expect(tool.name).toBe("delete_file")
    expect(tool.category).toBe("filesystem")
    expect(tool.isSafe).toBe(false)
  })

  it("has correct schema", () => {
    expect(tool.schema.name).toBe("delete_file")
    expect(tool.schema.required).toContain("filepath")
    expect(tool.schema.parameters.filepath).toBeDefined()
    expect(tool.schema.parameters.recursive).toBeDefined()
  })

  it("deletes a file", async () => {
    const filePath = path.join(tmpDir, "to-delete.txt")
    await fs.writeFile(filePath, "remove me")
    const result = await tool.execute({ filepath: filePath })
    expect(result.success).toBe(true)
    expect(result.output).toContain("Удалено")
    await expect(fs.stat(filePath)).rejects.toThrow()
  })

  it("deletes a directory recursively", async () => {
    const dirPath = path.join(tmpDir, "to-delete-dir")
    await fs.mkdir(path.join(dirPath, "sub"), { recursive: true })
    await fs.writeFile(path.join(dirPath, "sub", "file.txt"), "data")
    const result = await tool.execute({ filepath: dirPath })
    expect(result.success).toBe(true)
    expect(result.output).toContain("директория")
    await expect(fs.stat(dirPath)).rejects.toThrow()
  })

  it("deletes a directory with recursive flag", async () => {
    const dirPath = path.join(tmpDir, "to-delete-dir2")
    await fs.mkdir(dirPath, { recursive: true })
    await fs.writeFile(path.join(dirPath, "file.txt"), "data")
    const result = await tool.execute({ filepath: dirPath, recursive: true })
    expect(result.success).toBe(true)
    await expect(fs.stat(dirPath)).rejects.toThrow()
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

  it("blocks delete outside workspace when workDir is set", async () => {
    const outsideDir = path.join(os.tmpdir(), `outside-del-${Date.now()}`)
    await fs.mkdir(outsideDir, { recursive: true })
    const outsideFile = path.join(outsideDir, "secret.txt")
    await fs.writeFile(outsideFile, "secret")
    const restrictedTool = new DeleteFileTool(tmpDir)
    const result = await restrictedTool.execute({ filepath: outsideFile })
    expect(result.success).toBe(false)
    expect(result.output).toContain("Доступ запрещён")
    await fs.rm(outsideDir, { recursive: true, force: true })
  })

  it("allows delete inside workspace when workDir is set", async () => {
    const restrictedTool = new DeleteFileTool(tmpDir)
    const filePath = path.join(tmpDir, "inside-del.txt")
    await fs.writeFile(filePath, "ok")
    const result = await restrictedTool.execute({ filepath: filePath })
    expect(result.success).toBe(true)
    await expect(fs.stat(filePath)).rejects.toThrow()
  })
})
