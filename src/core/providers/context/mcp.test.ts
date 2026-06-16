import { describe, it, expect } from "vitest"
import { makeMCPProvider } from "./mcp"

describe("makeMCPProvider", () => {
  it("returns empty when no tools", async () => {
    const provider = makeMCPProvider(() => Promise.resolve([]))
    const result = await provider.resolve("")
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain("не подключены")
  })

  it("returns all tools for empty query", async () => {
    const provider = makeMCPProvider(() => Promise.resolve([
      { server: "s1", tool: { name: "tool1", description: "desc1", schema: {} } },
    ]))
    const result = await provider.resolve("")
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain("tool1")
  })

  it("filters tools by query", async () => {
    const provider = makeMCPProvider(() => Promise.resolve([
      { server: "s1", tool: { name: "tool1", description: "desc1", schema: {} } },
      { server: "s2", tool: { name: "tool2", description: "desc2", schema: {} } },
    ]))
    const result = await provider.resolve("tool1")
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain("tool1")
    expect(result[0].content).not.toContain("tool2")
  })

  it("returns not found for no matches", async () => {
    const provider = makeMCPProvider(() => Promise.resolve([
      { server: "s1", tool: { name: "tool1", description: "desc1", schema: {} } },
    ]))
    const result = await provider.resolve("nonexistent")
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain("не найдены")
  })

  it("loads submenu items", async () => {
    const provider = makeMCPProvider(() => Promise.resolve([
      { server: "s1", tool: { name: "tool1", description: "desc1", schema: {} } },
    ]))
    const items = await provider.loadSubmenuItems?.()
    expect(items).toHaveLength(1)
    expect(items![0].id).toBe("s1:tool1")
  })
})
