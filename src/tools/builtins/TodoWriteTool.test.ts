import { describe, it, expect } from "vitest"
import { TodoWriteTool } from "../../tools/builtins/TodoWriteTool"

describe("TodoWriteTool", () => {
  it("has correct metadata", () => {
    const tool = new TodoWriteTool()
    expect(tool.name).toBe("todo_write")
    expect(tool.isSafe).toBe(true)
    expect(tool.category).toBe("planning")
  })

  it("executes with valid todos", async () => {
    const tool = new TodoWriteTool()
    const result = await tool.execute({
      todos: [
        { content: "Task 1", status: "pending", priority: "high" },
        { content: "Task 2", status: "in_progress", priority: "medium" },
      ],
    })
    expect(result.success).toBe(true)
    expect(result.output).toContain("Task 1")
    expect(result.output).toContain("Task 2")
    expect(result.output).toContain("pending")
    expect(result.output).toContain("in_progress")
  })

  it("returns error for empty todos", async () => {
    const tool = new TodoWriteTool()
    const result = await tool.execute({ todos: [] })
    expect(result.success).toBe(false)
    expect(result.output).toContain("empty")
  })

  it("returns error for missing todos", async () => {
    const tool = new TodoWriteTool()
    const result = await tool.execute({})
    expect(result.success).toBe(false)
    expect(result.output).toContain("empty")
  })

  it("returns error for invalid todos type", async () => {
    const tool = new TodoWriteTool()
    const result = await tool.execute({ todos: "not an array" })
    expect(result.success).toBe(false)
    expect(result.output).toContain("Invalid")
  })

  it("formats all status types", async () => {
    const tool = new TodoWriteTool()
    const result = await tool.execute({
      todos: [
        { content: "A", status: "pending", priority: "high" },
        { content: "B", status: "in_progress", priority: "medium" },
        { content: "C", status: "completed", priority: "low" },
        { content: "D", status: "cancelled", priority: "low" },
      ],
    })
    expect(result.success).toBe(true)
    expect(result.output).toContain("[ ]")
    expect(result.output).toContain("[*]")
    expect(result.output).toContain("[x]")
    expect(result.output).toContain("[~]")
  })
})
