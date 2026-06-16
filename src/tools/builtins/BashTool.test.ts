import { describe, it, expect, vi, beforeEach } from "vitest"
import { BashTool } from "./BashTool"

describe("BashTool", () => {
  let tool: BashTool

  beforeEach(() => {
    tool = new BashTool()
  })

  it("has correct metadata", () => {
    expect(tool.name).toBe("bash")
    expect(tool.category).toBe("process")
    expect(tool.isSafe).toBe(false)
    expect(tool.description).toContain("команду оболочки")
  })

  it("has correct schema", () => {
    expect(tool.schema.name).toBe("bash")
    expect(tool.schema.required).toContain("command")
    expect(tool.schema.parameters.command).toBeDefined()
    expect(tool.schema.parameters.timeout).toBeDefined()
    expect(tool.schema.parameters.workdir).toBeDefined()
  })

  it("executes a simple command", async () => {
    const result = await tool.execute({ command: "echo hello" })
    expect(result.success).toBe(true)
    expect(result.output).toContain("hello")
  })

  it("returns error for empty command", async () => {
    const result = await tool.execute({ command: "" })
    expect(result.success).toBe(false)
    expect(result.output).toContain("Не указана")
  })

  it("returns error for missing command", async () => {
    const result = await tool.execute({})
    expect(result.success).toBe(false)
    expect(result.output).toContain("Не указана")
  })

  it("returns error for failing command", async () => {
    const result = await tool.execute({ command: "exit 1" })
    expect(result.success).toBe(false)
    expect(result.output).toContain("не выполнена")
  })

  it("respects custom timeout", async () => {
    const result = await tool.execute({
      command: "sleep 10",
      timeout: 500,
    })
    expect(result.success).toBe(false)
    expect(result.output).toContain("не выполнена")
  })

  it("captures stderr output", async () => {
    const result = await tool.execute({ command: "echo error >&2" })
    expect(result.success).toBe(true)
    expect(result.output).toContain("ВЫВОД ОШИБОК")
    expect(result.output).toContain("error")
  })

  it("returns no output message when command produces nothing", async () => {
    const result = await tool.execute({ command: "powershell -Command \"Write-Output ''\"" })
    expect(result.success).toBe(true)
    expect(result.output).toContain("нет вывода")
  })

  it("uses default timeout of 30000", () => {
    expect(tool.schema.parameters.timeout.default).toBe(30000)
  })
})
