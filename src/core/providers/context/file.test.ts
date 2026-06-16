import { describe, it, expect, vi, beforeEach } from "vitest"
import { makeFileProvider } from "./file"

vi.mock("fs/promises", () => ({
  stat: vi.fn(),
  readFile: vi.fn(),
  readdir: vi.fn(),
}))

import * as fs from "fs/promises"

describe("makeFileProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns empty for empty query", async () => {
    const provider = makeFileProvider(() => "/work")
    const result = await provider.resolve("")
    expect(result).toEqual([])
  })

  it("returns error for directory", async () => {
    vi.mocked(fs.stat).mockResolvedValueOnce({ isDirectory: () => true, size: 0 } as any)
    const provider = makeFileProvider(() => "/work")
    const result = await provider.resolve("somefile")
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain("Это директория")
  })

  it("returns error for too large file", async () => {
    vi.mocked(fs.stat).mockResolvedValueOnce({ isDirectory: () => false, size: 300_000 } as any)
    const provider = makeFileProvider(() => "/work")
    const result = await provider.resolve("bigfile")
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain("слишком большой")
  })

  it("returns file content", async () => {
    vi.mocked(fs.stat).mockResolvedValueOnce({ isDirectory: () => false, size: 100 } as any)
    vi.mocked(fs.readFile).mockResolvedValueOnce("const x = 1")
    const provider = makeFileProvider(() => "/work")
    const result = await provider.resolve("test.ts")
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain("const x = 1")
    expect(result[0].name).toBe("test.ts")
  })

  it("returns error for missing file", async () => {
    vi.mocked(fs.stat).mockRejectedValueOnce(new Error("ENOENT"))
    const provider = makeFileProvider(() => "/work")
    const result = await provider.resolve("missing.ts")
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain("Не удалось прочитать файл")
  })
})
