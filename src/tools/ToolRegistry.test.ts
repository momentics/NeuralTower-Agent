import { describe, it, expect } from "vitest"
import { ToolRegistry } from "../../tools/ToolRegistry"
import type { ITool, ToolSchema } from "../../tools/ITool"

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
    const found = registry.get("test_tool")
    expect(found).toBe(tool)
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

  it("filters tools by category", () => {
    const registry = new ToolRegistry()
    registry.register(createMockTool("cat_a"))
    registry.register(createMockTool("cat_b"))
    const filtered = registry.byCategory("test")
    expect(filtered.length).toBe(2)
  })

  it("filters tools by safety", () => {
    const registry = new ToolRegistry()
    registry.register(createMockTool("safe_tool", true))
    registry.register(createMockTool("unsafe_tool", false))
    const safe = registry.safeOnly()
    expect(safe.length).toBe(1)
    expect(safe[0].name).toBe("safe_tool")
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
})
