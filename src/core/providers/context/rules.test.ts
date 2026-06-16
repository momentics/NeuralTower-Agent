import { describe, it, expect, vi, beforeEach } from "vitest"
import { makeRulesProvider, loadRulesFiles } from "./rules"

vi.mock("fs/promises", () => ({
  stat: vi.fn(),
  readFile: vi.fn(),
  readdir: vi.fn(),
}))

import * as fs from "fs/promises"

describe("makeRulesProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns empty when no rules found", async () => {
    vi.mocked(fs.readdir).mockRejectedValueOnce(new Error("ENOENT"))
    vi.mocked(fs.readFile).mockRejectedValueOnce(new Error("ENOENT"))
    const provider = makeRulesProvider(() => "/work")
    const result = await provider.resolve("")
    expect(result).toHaveLength(1)
    expect(result[0].content).toBe("")
  })

  it("returns rules from AGENTS.md", async () => {
    vi.mocked(fs.readdir).mockRejectedValueOnce(new Error("ENOENT"))
    vi.mocked(fs.readFile).mockResolvedValueOnce("# Test Rule")
    const provider = makeRulesProvider(() => "/work")
    const result = await provider.resolve("")
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain("# Test Rule")
    expect(result[0].content).toContain("## AGENTS.md")
  })
})

describe("loadRulesFiles", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns empty when no rules exist", async () => {
    vi.mocked(fs.readdir).mockRejectedValueOnce(new Error("ENOENT"))
    vi.mocked(fs.readFile).mockRejectedValueOnce(new Error("ENOENT"))
    const rules = await loadRulesFiles(() => "/work")
    expect(rules).toEqual([])
  })

  it("loads rules from .neuraltower/rules", async () => {
    vi.mocked(fs.readdir).mockResolvedValueOnce(["rule1.md", "rule2.md"])
    vi.mocked(fs.readFile)
      .mockResolvedValueOnce("# Rule 1")
      .mockResolvedValueOnce("# Rule 2")
      .mockRejectedValue(new Error("ENOENT"))
      .mockRejectedValue(new Error("ENOENT"))
      .mockRejectedValue(new Error("ENOENT"))
    const rules = await loadRulesFiles(() => "/work")
    expect(rules).toHaveLength(2)
    expect(rules[0].name).toBe("rule1.md")
    expect(rules[1].name).toBe("rule2.md")
  })
})
