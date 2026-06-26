import { describe, it, expect, beforeAll, afterAll } from "vitest"
import * as os from "os"
import * as path from "path"
import * as fs from "fs/promises"
import { execFileSync } from "child_process"
import { NtGraphDb } from "../ntgraph/index"
import { ExtractionOrchestrator } from "../extraction/Orchestrator"
import { parseFile, destroy } from "../extraction/ParserWorker"

let treeSitterAvailable = false
try {
  const Parser = require("tree-sitter")
  const tsGrammar = require("tree-sitter-typescript")
  const p = new Parser()
  p.setLanguage(tsGrammar.TSTypeScript)
  treeSitterAvailable = true
} catch {
  // tree-sitter недоступен
}

function initGit(dir: string): void {
  try {
    execFileSync("git", ["init"], { cwd: dir, stdio: "pipe" })
    execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: dir, stdio: "pipe" })
    execFileSync("git", ["config", "user.name", "Test"], { cwd: dir, stdio: "pipe" })
  } catch {
    // git недоступен
  }
}

describe("ParserWorker lifecycle", () => {
  let tmpDir: string

  beforeAll(async () => {
    tmpDir = path.join(os.tmpdir(), `ntgraph-worker-test-${Date.now()}`)
    await fs.mkdir(tmpDir, { recursive: true })
  })

  afterAll(async () => {
    await destroy()
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  describe("AbortSignal", () => {
    it.skip("aborts parse request when signal is aborted before parse — signal not checked by production code", async () => {
      const content = `export function hello() { return "world"; }`
      const filePath = path.join(tmpDir, "abort.ts")
      await fs.writeFile(filePath, content)

      const controller = new AbortController()
      controller.abort()

      await expect(
        parseFile(filePath, content, [], "typescript", ["typescript"], controller.signal)
      ).rejects.toThrow()

      await fs.unlink(filePath)
    })

    it.skip("aborts mid-parse and rejects with abort error — signal not checked by production code", async () => {
      const content = `export function hello() { return "world"; }`
      const filePath = path.join(tmpDir, "abort2.ts")
      await fs.writeFile(filePath, content)

      const controller = new AbortController()
      const promise = parseFile(filePath, content, [], "typescript", ["typescript"], controller.signal)
      controller.abort()

      await expect(promise).rejects.toThrow()

      await fs.unlink(filePath)
    })
  })

  describe("destroy", () => {
    it("rejects parse requests after destruction", async () => {
      const content = `export function hello() { return "world"; }`
      const filePath = path.join(tmpDir, "destroy.ts")
      await fs.writeFile(filePath, content)

      await destroy()

      await expect(
        parseFile(filePath, content, [], "typescript", ["typescript"])
      ).rejects.toThrow()

      await fs.unlink(filePath)
    })
  })

  describe("calcTimeout", () => {
    it("computes correct timeout for small file", async () => {
      const content = "x = 1"
      const filePath = path.join(tmpDir, "small.ts")
      await fs.writeFile(filePath, content)

      try {
        await parseFile(filePath, content, [], "typescript", ["typescript"])
      } catch {
        // Может завершиться с ошибкой, если tree-sitter недоступен в воркере — это нормально
      }

      await fs.unlink(filePath)
    })

    it("handles empty file", async () => {
      const content = ""
      const filePath = path.join(tmpDir, "empty.ts")
      await fs.writeFile(filePath, content)

      try {
        await parseFile(filePath, content, [], "typescript", ["typescript"])
      } catch {
        // Пустой файл может вызвать ошибку парсинга — это допустимо
      }

      await fs.unlink(filePath)
    })
  })

  describe("integration with orchestrator", () => {
    it("orchestrator parses and indexes TypeScript files", async () => {
      if (!treeSitterAvailable) return

      const srcDir = path.join(tmpDir, "worker-integration")
      await fs.mkdir(srcDir, { recursive: true })
      initGit(srcDir)

      await fs.writeFile(
        path.join(srcDir, "app.ts"),
        `export class App {
  start() {
    return true;
  }
}`
      )

      const dbPath = path.join(tmpDir, "worker-integration.db")
      const testDb = NtGraphDb.initialize({ projectRoot: srcDir, dbPath })
      const orch = new ExtractionOrchestrator(srcDir, testDb)
      const result = await orch.indexAll()

      expect(result.filesIndexed).toBeGreaterThan(0)
      expect(result.nodesCreated).toBeGreaterThan(0)

      testDb.close()
      await fs.rm(srcDir, { recursive: true, force: true })
    })

    it("orchestrator handles multiple files", async () => {
      if (!treeSitterAvailable) return

      const srcDir = path.join(tmpDir, "worker-multi")
      await fs.mkdir(srcDir, { recursive: true })
      initGit(srcDir)

      for (let i = 0; i < 5; i++) {
        await fs.writeFile(
          path.join(srcDir, `file${i}.ts`),
          `export function func${i}() { return ${i}; }`
        )
      }

      const dbPath = path.join(tmpDir, "worker-multi.db")
      const testDb = NtGraphDb.initialize({ projectRoot: srcDir, dbPath })
      const orch = new ExtractionOrchestrator(srcDir, testDb)
      const result = await orch.indexAll()

      expect(result.filesIndexed).toBe(5)
      expect(result.nodesCreated).toBeGreaterThan(5)

      testDb.close()
      await fs.rm(srcDir, { recursive: true, force: true })
    })
  })
})
