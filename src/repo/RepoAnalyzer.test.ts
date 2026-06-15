import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { RepoAnalyzer } from "../../repo/RepoAnalyzer"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

describe("RepoAnalyzer", () => {
  let tmpDir: string
  let analyzer: RepoAnalyzer

  beforeAll(async () => {
    tmpDir = path.join(os.tmpdir(), `repoanalyzer-test-${Date.now()}`)
    await fs.mkdir(tmpDir, { recursive: true })
    await fs.mkdir(path.join(tmpDir, "src"), { recursive: true })
    await fs.writeFile(path.join(tmpDir, "src", "main.ts"), "const x = 1")
    await fs.writeFile(path.join(tmpDir, "src", "util.js"), "const y = 2")
    await fs.writeFile(path.join(tmpDir, "README.md"), "# Hello")
    await fs.writeFile(path.join(tmpDir, "package.json"), '{"name":"test"}')
    await fs.writeFile(path.join(tmpDir, "Cargo.toml"), '[package]')
    analyzer = new RepoAnalyzer()
  })

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it("analyzes directory and returns file count", async () => {
    const summary = await analyzer.analyze(tmpDir)
    expect(summary.fileCount).toBe(5)
  })

  it("detects languages", async () => {
    const summary = await analyzer.analyze(tmpDir)
    expect(summary.languages["TypeScript"]).toBe(1)
    expect(summary.languages["JavaScript"]).toBe(1)
    expect(summary.languages["Markdown"]).toBe(1)
    expect(summary.languages["JSON"]).toBe(1)
  })

  it("detects build systems", async () => {
    const summary = await analyzer.analyze(tmpDir)
    expect(summary.buildSystems).toContain("npm")
    expect(summary.buildSystems).toContain("cargo")
  })

  it("finds top directories", async () => {
    const summary = await analyzer.analyze(tmpDir)
    expect(summary.topDirs).toContain("src")
  })

  it("finds notable files", async () => {
    const summary = await analyzer.analyze(tmpDir)
    expect(summary.notableFiles.some((f) => f.includes("README"))).toBe(true)
    expect(summary.notableFiles.some((f) => f.includes("package.json"))).toBe(true)
  })

  it("deepScan reads package.json workspaces", async () => {
    const result = await analyzer.deepScan(tmpDir)
    expect(result.workspaces).toBe(false)
    expect(result.packages).toEqual([])
  })

  it("deepScan detects workspaces", async () => {
    const wsDir = path.join(os.tmpdir(), `ws-test-${Date.now()}`)
    await fs.mkdir(wsDir, { recursive: true })
    await fs.writeFile(path.join(wsDir, "package.json"), JSON.stringify({ workspaces: ["packages/*"] }))
    const result = await analyzer.deepScan(wsDir)
    expect(result.workspaces).toBe(true)
    expect(result.packages).toContain("packages/*")
    await fs.rm(wsDir, { recursive: true, force: true })
  })
})
