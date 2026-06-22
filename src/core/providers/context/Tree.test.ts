import { describe, it, expect, vi, beforeEach } from "vitest"
import { makeTreeProvider } from "./Tree"

vi.mock("fs/promises", () => ({
  stat: vi.fn(),
  readFile: vi.fn(),
  readdir: vi.fn(),
}))

import * as fs from "fs/promises"

describe("makeTreeProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns tree for work dir", async () => {
    vi.mocked(fs.readdir)
      .mockResolvedValueOnce([
        { name: "src", isDirectory: () => true } as any,
        { name: "package.json", isDirectory: () => false } as any,
      ])
      .mockResolvedValueOnce([])
    const provider = makeTreeProvider(() => "/work")
    const result = await provider.resolve("")
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain("Дерево: /work")
  })

  it("returns error for missing dir", async () => {
    vi.mocked(fs.readdir).mockRejectedValueOnce(new Error("ENOENT"))
    const provider = makeTreeProvider(() => "/work")
    const result = await provider.resolve("/nonexistent")
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain("Не удалось построить дерево")
  })
})
