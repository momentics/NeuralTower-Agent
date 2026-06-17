import { describe, it, expect, vi } from "vitest"
import { ToolRegistry } from "./ToolRegistry"
import type { ITool } from "./ITool"

const createMockTool = (name: string, isSafe = false): ITool => ({
  name,
  description: `Mock ${name}`,
  category: "test",
  isSafe,
  schema: { name, description: `Mock ${name}`, parameters: {}, required: [] },
  execute: async () => ({ output: name, success: true }),
})

describe("ToolRegistry", () => {
  it("registers and retrieves a tool", () => {
    const registry = new ToolRegistry()
    const tool = createMockTool("test_tool")
    registry.register(tool)
    expect(registry.get("test_tool")).toBe(tool)
  })

  it("returns undefined for unknown tool", () => {
    const registry = new ToolRegistry()
    expect(registry.get("nonexistent")).toBeUndefined()
  })

  it("registers multiple tools", () => {
    const registry = new ToolRegistry()
    registry.register(createMockTool("tool_a"))
    registry.register(createMockTool("tool_b"))
    expect(registry.get("tool_a")).toBeDefined()
    expect(registry.get("tool_b")).toBeDefined()
  })

  it("registers many tools at once", () => {
    const registry = new ToolRegistry()
    registry.registerMany([
      createMockTool("bulk1"),
      createMockTool("bulk2"),
      createMockTool("bulk3"),
    ])
    expect(registry.get("bulk1")).toBeDefined()
    expect(registry.get("bulk2")).toBeDefined()
    expect(registry.get("bulk3")).toBeDefined()
  })

  it("lists all registered tools", () => {
    const registry = new ToolRegistry()
    registry.register(createMockTool("list_a"))
    registry.register(createMockTool("list_b"))
    const list = registry.list()
    expect(list.length).toBe(2)
    expect(list.map((t) => t.name)).toContain("list_a")
    expect(list.map((t) => t.name)).toContain("list_b")
  })

  it("unregisters a tool", () => {
    const registry = new ToolRegistry()
    registry.register(createMockTool("removable"))
    expect(registry.get("removable")).toBeDefined()
    registry.unregister("removable")
    expect(registry.get("removable")).toBeUndefined()
  })

  it("unregistering unknown tool does not throw", () => {
    const registry = new ToolRegistry()
    expect(() => registry.unregister("nonexistent")).not.toThrow()
  })

  it("clears all tools", () => {
    const registry = new ToolRegistry()
    registry.register(createMockTool("clear_a"))
    registry.register(createMockTool("clear_b"))
    registry.clear()
    expect(registry.list().length).toBe(0)
  })

  it("invoke executes tool and returns result", async () => {
    const registry = new ToolRegistry()
    registry.register(createMockTool("mytool"))
    const result = await registry.invoke("mytool", {})
    expect(result.success).toBe(true)
    expect(result.output).toBe("mytool")
  })

  it("invoke returns error for unknown tool", async () => {
    const registry = new ToolRegistry()
    const result = await registry.invoke("unknown", {})
    expect(result.success).toBe(false)
    expect(result.output).toContain("не найден")
  })

  it("invoke catches execution errors", async () => {
    const registry = new ToolRegistry()
    registry.register({
      name: "failing",
      description: "Fails",
      category: "test",
      isSafe: false,
      schema: { name: "failing", description: "Fails", parameters: {}, required: [] },
      execute: async () => { throw new Error("boom") },
    })
    const result = await registry.invoke("failing", {})
    expect(result.success).toBe(false)
    expect(result.output).toContain("boom")
  })

  it("toSchemaList returns formatted list", () => {
    const registry = new ToolRegistry()
    registry.register(createMockTool("tool_a"))
    const schema = registry.toSchemaList()
    expect(schema).toContain("tool_a")
    expect(schema).toContain("Доступные инструменты")
  })

  it("toSchemaList returns message when empty", () => {
    const registry = new ToolRegistry()
    expect(registry.toSchemaList()).toContain("Инструменты недоступны")
  })

  it("toToolDefinitions returns array of definitions", () => {
    const registry = new ToolRegistry()
    registry.register(createMockTool("tool_a"))
    registry.register(createMockTool("tool_b"))
    const defs = registry.toToolDefinitions()
    expect(defs.length).toBe(2)
    expect(defs[0].name).toBe("tool_a")
    expect(defs[0].parameters).toBeDefined()
  })
})
