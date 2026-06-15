import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { FileIndex } from "../../repo/FileIndex"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

describe("FileIndex", () => {
  let tmpDir: string
  let index: FileIndex

  beforeAll(async () => {
    tmpDir = path.join(os.tmpdir(), `fileindex-test-${Date.now()}`)
    await fs.mkdir(tmpDir, { recursive: true })
    await fs.mkdir(path.join(tmpDir, "src"), { recursive: true })
    await fs.writeFile(path.join(tmpDir, "src", "main.ts"), "const x = 1")
    await fs.writeFile(path.join(tmpDir, "src", "util.js"), "const y = 2")
    await fs.writeFile(path.join(tmpDir, "README.md"), "# Hello")
    await fs.writeFile(path.join(tmpDir, "config.json"), "{}")
    index = new FileIndex()
    await index.build(tmpDir)
  })

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it("builds index with correct file count", () => {
    const stats = index.stats()
    expect(stats.totalFiles).toBe(4)
  })

  it("detects languages correctly", () => {
    const stats = index.stats()
    expect(stats.languages).toBeGreaterThanOrEqual(3)
  })

  it("finds files by pattern", () => {
    const results = index.findByPattern("main")
    expect(results.length).toBe(1)
    expect(results[0].path).toContain("main.ts")
  })

  it("finds files by language", () => {
    const results = index.findByLanguage("ts")
    expect(results.length).toBe(1)
    expect(results[0].path).toContain("main.ts")
  })

  it("finds files by name", () => {
    const results = index.findByName("main.ts")
    expect(results.length).toBe(1)
  })

  it("returns empty for unknown name", () => {
    const results = index.findByName("nonexistent.txt")
    expect(results.length).toBe(0)
  })

  it("returns correct total size", () => {
    const stats = index.stats()
    expect(stats.totalSize).toBeGreaterThan(0)
  })

  it("clears the index", () => {
    index.clear()
    const stats = index.stats()
    expect(stats.totalFiles).toBe(0)
    expect(stats.languages).toBe(0)
    expect(stats.totalSize).toBe(0)
  })
})
