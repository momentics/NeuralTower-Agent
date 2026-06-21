import { describe, it, expect } from "vitest"
import { TodoWriteTool } from "./TodoWriteTool"
import { TodoStore } from "../../agent/TodoStore"

describe("TodoWriteTool", () => {
  it("has correct metadata", () => {
    const tool = new TodoWriteTool(new TodoStore())
    expect(tool.name).toBe("todowrite")
    expect(tool.isSafe).toBe(true)
    expect(tool.category).toBe("agent")
  })

  it("executes with valid todos", async () => {
    const tool = new TodoWriteTool(new TodoStore())
    const result = await tool.execute({
      todos: [
        { content: "Task 1", status: "pending", priority: "high" },
        { content: "Task 2", status: "in_progress", priority: "medium" },
      ],
    })
    expect(result.success).toBe(true)
    expect(result.output).toContain("Task 1")
    expect(result.output).toContain("Task 2")
    expect(result.output).toContain("Список задач обновлён")
  })

  it("returns error for empty todos", async () => {
    const tool = new TodoWriteTool(new TodoStore())
    const result = await tool.execute({ todos: [] })
    expect(result.success).toBe(false)
    expect(result.output).toContain("должен быть непустым")
  })

  it("returns error for missing todos", async () => {
    const tool = new TodoWriteTool(new TodoStore())
    const result = await tool.execute({})
    expect(result.success).toBe(false)
    expect(result.output).toContain("должен быть непустым массивом")
  })

  it("returns error for invalid todos type", async () => {
    const tool = new TodoWriteTool(new TodoStore())
    const result = await tool.execute({ todos: "not an array" })
    expect(result.success).toBe(false)
    expect(result.output).toContain("должен быть непустым массивом")
  })

  it("formats all status types", async () => {
    const tool = new TodoWriteTool(new TodoStore())
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
    expect(result.output).toContain("[~]")
    expect(result.output).toContain("[x]")
    expect(result.output).toContain("[-]")
  })

  it("writes to TodoStore via constructor injection", async () => {
    const store = new TodoStore()
    const tool = new TodoWriteTool(store)
    const items = [
      { content: "A", status: "pending", priority: "high" },
    ]
    await tool.execute({ todos: items })
    expect(store.getItems()).toHaveLength(1)
    expect(store.getItems()[0].content).toBe("A")
  })

  it("uses TodoStore formatItems from constructor", async () => {
    const store = new TodoStore()
    const tool = new TodoWriteTool(store)
    const items = [
      { content: "A", status: "pending", priority: "high" },
      { content: "B", status: "completed", priority: "low" },
    ]
    const result = await tool.execute({ todos: items })
    expect(result.success).toBe(true)
    expect(result.output).toContain("1 активных")
    expect(result.output).toContain("1 завершено")
  })
})
