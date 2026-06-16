import { describe, it, expect, vi, beforeEach } from "vitest"
import { makeCodeProvider } from "./code"

vi.mock("fs/promises", () => ({
  stat: vi.fn(),
  readFile: vi.fn(),
  readdir: vi.fn(),
}))

import * as fs from "fs/promises"

describe("makeCodeProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns empty for empty query", async () => {
    const provider = makeCodeProvider(() => "/work", () => ({
      findByPattern: () => [],
      findByLanguage: () => [],
    }))
    const result = await provider.resolve("")
    expect(result).toEqual([])
  })

  it("returns not found when no matches", async () => {
    const provider = makeCodeProvider(() => "/work", () => ({
      findByPattern: () => [],
      findByLanguage: () => [],
    }))
    const result = await provider.resolve("nonexistent")
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain("не найдены")
  })

  it("returns code matches", async () => {
    vi.mocked(fs.stat).mockResolvedValueOnce({ size: 100 } as any)
    vi.mocked(fs.readFile).mockResolvedValueOnce("export class MyClass {}\nconst myVar = 1")
    const provider = makeCodeProvider(() => "/work", () => ({
      findByPattern: () => [{ path: "/work/test.ts", language: "typescript", size: 100 }],
      findByLanguage: () => [],
    }))
    const result = await provider.resolve("MyClass")
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain("Результаты поиска кода")
  })
})
