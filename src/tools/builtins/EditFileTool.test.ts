import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { EditFileTool } from "./EditFileTool"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

describe("EditFileTool", () => {
  let tmpDir: string
  let tool: EditFileTool

  beforeAll(() => {
    tmpDir = path.join(os.tmpdir(), `editfile-test-${Date.now()}`)
    tool = new EditFileTool()
  })

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it("replaces single occurrence", async () => {
    const filePath = path.join(tmpDir, "edit1.txt")
    await fs.mkdir(tmpDir, { recursive: true })
    await fs.writeFile(filePath, "foo bar baz")
    const result = await tool.execute({
      filepath: filePath,
      oldString: "bar",
      newString: "qux",
    })
    expect(result.success).toBe(true)
    expect(result.output).toContain("1 вхождений")
    const content = await fs.readFile(filePath, "utf-8")
    expect(content).toBe("foo qux baz")
  })

  it("fails when old string not found", async () => {
    const filePath = path.join(tmpDir, "edit2.txt")
    await fs.writeFile(filePath, "hello world")
    const result = await tool.execute({
      filepath: filePath,
      oldString: "nonexistent",
      newString: "replacement",
    })
    expect(result.success).toBe(false)
    expect(result.output).toContain("не найдено")
  })

  it("fails when multiple occurrences without replaceAll", async () => {
    const filePath = path.join(tmpDir, "edit3.txt")
    await fs.writeFile(filePath, "foo foo foo")
    const result = await tool.execute({
      filepath: filePath,
      oldString: "foo",
      newString: "bar",
    })
    expect(result.success).toBe(false)
    expect(result.output).toContain("3 вхождений")
  })

  it("replaces all occurrences with replaceAll", async () => {
    const filePath = path.join(tmpDir, "edit4.txt")
    await fs.writeFile(filePath, "foo foo foo")
    const result = await tool.execute({
      filepath: filePath,
      oldString: "foo",
      newString: "bar",
      replaceAll: true,
    })
    expect(result.success).toBe(true)
    expect(result.output).toContain("3 вхождений")
    const content = await fs.readFile(filePath, "utf-8")
    expect(content).toBe("bar bar bar")
  })

  it("returns error for missing required args", async () => {
    const result = await tool.execute({ filepath: "test.txt" })
    expect(result.success).toBe(false)
    expect(result.output).toContain("Не указаны")
  })

  it("returns error for empty oldString", async () => {
    const result = await tool.execute({ filepath: "test.txt", oldString: "", newString: "x" })
    expect(result.success).toBe(false)
    expect(result.output).toContain("Не указаны")
  })
})
