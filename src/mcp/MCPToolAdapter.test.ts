import { describe, it, expect, vi, beforeEach } from "vitest"
import { MCPToolAdapter } from "./MCPToolAdapter"

describe("MCPToolAdapter", () => {
  let adapter: MCPToolAdapter
  let callFn: ReturnType<typeof vi.fn>

  beforeEach(() => {
    adapter = new MCPToolAdapter()
    callFn = vi.fn().mockResolvedValue({ output: "result", success: true })
  })

  it("adapts mcp tool to ITool", () => {
    const tool = adapter.adapt(
      { name: "read_file", description: "Read a file", schema: {} },
      "server1",
      callFn,
    )
    expect(tool.name).toBe("server1:read_file")
    expect(tool.description).toBe("Read a file")
    expect(tool.category).toBe("mcp")
    expect(tool.isSafe).toBe(false)
  })

  it("adapted tool execute calls callFn", async () => {
    const tool = adapter.adapt(
      { name: "read_file", description: "Read", schema: {} },
      "server1",
      callFn,
    )
    await tool.execute({ path: "/test" })
    expect(callFn).toHaveBeenCalledWith("server1", "read_file", { path: "/test" })
  })

  it("adaptAll adapts multiple tools", () => {
    const tools = adapter.adaptAll(
      [
        { name: "t1", description: "d1", schema: {} },
        { name: "t2", description: "d2", schema: {} },
      ],
      "server1",
      callFn,
    )
    expect(tools).toHaveLength(2)
    expect(tools[0].name).toBe("server1:t1")
    expect(tools[1].name).toBe("server1:t2")
  })

  it("toSchema extracts parameters from inputSchema", () => {
    const tool = adapter.adapt(
      {
        name: "read_file",
        description: "Read",
        schema: {
          inputSchema: {
            properties: {
              path: { type: "string", description: "File path" },
              mode: { type: "string", enum: ["r", "w"] },
            },
          },
        },
      },
      "server1",
      callFn,
    )
    expect(tool.schema.parameters).toHaveProperty("path")
    expect(tool.schema.parameters.path.type).toBe("string")
    expect(tool.schema.parameters.path.description).toBe("File path")
    expect(tool.schema.parameters.mode.enum).toEqual(["r", "w"])
  })

  it("toSchema handles empty schema", () => {
    const tool = adapter.adapt(
      { name: "t1", description: "d1", schema: {} },
      "server1",
      callFn,
    )
    expect(tool.schema.parameters).toEqual({})
  })

  it("toSchema handles missing inputSchema", () => {
    const tool = adapter.adapt(
      { name: "t1", description: "d1", schema: { other: "value" } },
      "server1",
      callFn,
    )
    expect(tool.schema.parameters).toEqual({})
  })

  it("uses default description when missing", () => {
    const tool = adapter.adapt(
      { name: "t1", description: "", schema: {} },
      "server1",
      callFn,
    )
    expect(tool.description).toBe("MCP-инструмент из server1")
  })
})
