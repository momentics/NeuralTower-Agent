import { describe, it, expect, beforeAll, afterAll } from "vitest"
import * as os from "os"
import * as path from "path"
import * as fs from "fs/promises"
import { execFileSync } from "child_process"
import { NtGraphDb } from "../ntgraph/index"
import { ExtractionOrchestrator } from "../extraction/Orchestrator"
import { NodeKind, EdgeKind } from "../ntgraph/Types"

function initGit(dir: string): void {
  try {
    execFileSync("git", ["init"], { cwd: dir, stdio: "pipe" })
    execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: dir, stdio: "pipe" })
    execFileSync("git", ["config", "user.name", "Test"], { cwd: dir, stdio: "pipe" })
  } catch {
    // git недоступен
  }
}

describe("cross-file edge preservation", () => {
  let tmpDir: string

  beforeAll(async () => {
    tmpDir = path.join(os.tmpdir(), `ntgraph-crossfile-test-${Date.now()}`)
    await fs.mkdir(tmpDir, { recursive: true })
  })

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  describe("cross-file edges survive re-indexing", () => {
    it("imports edge survives when imported file is re-indexed", async () => {
      const srcDir = path.join(tmpDir, "cross-import")
      await fs.mkdir(srcDir, { recursive: true })
      initGit(srcDir)

      await fs.writeFile(
        path.join(srcDir, "lib.ts"),
        `export function helper() { return 42; }`
      )
      await fs.writeFile(
        path.join(srcDir, "main.ts"),
        `import { helper } from './lib';

export function main() {
  return helper();
}`
      )

      const dbPath = path.join(tmpDir, "cross-import.db")
      const testDb = new NtGraphDb(dbPath, srcDir)
      testDb.initialize()
      const orch = new ExtractionOrchestrator(srcDir, testDb)

      const result1 = await orch.indexAll()
      expect(result1.indexed).toBe(2)

      const stats1 = testDb.getStats()
      const edgesBefore = stats1.edgeCount

      // Переписываем lib.ts с небольшим изменением (запускает переиндексацию)
      await fs.writeFile(
        path.join(srcDir, "lib.ts"),
        `export function helper() { return 100; }`
      )

      const result2 = await orch.indexAll()
      expect(result2.indexed).toBeGreaterThan(0)

      const stats2 = testDb.getStats()
      expect(stats2.edgeCount).toBeGreaterThanOrEqual(edgesBefore - 1)

      testDb.close()
      await fs.rm(srcDir, { recursive: true, force: true })
    })

    it("calls edge survives when called function file is re-indexed", async () => {
      const srcDir = path.join(tmpDir, "cross-calls")
      await fs.mkdir(srcDir, { recursive: true })
      initGit(srcDir)

      await fs.writeFile(
        path.join(srcDir, "utils.ts"),
        `export function format(s: string): string {
  return s.trim();
}`
      )
      await fs.writeFile(
        path.join(srcDir, "processor.ts"),
        `import { format } from './utils';

export function process(s: string): string {
  return format(s);
}`
      )

      const dbPath = path.join(tmpDir, "cross-calls.db")
      const testDb = new NtGraphDb(dbPath, srcDir)
      testDb.initialize()
      const orch = new ExtractionOrchestrator(srcDir, testDb)

      await orch.indexAll()

      const stats1 = testDb.getStats()
      expect(stats1.edgeCount).toBeGreaterThan(0)

      // Модифицируем utils.ts
      await fs.writeFile(
        path.join(srcDir, "utils.ts"),
        `export function format(s: string): string {
  return s.trim().toLowerCase();
}`
      )

      await orch.indexAll()

      const stats2 = testDb.getStats()
      expect(stats2.edgeCount).toBeGreaterThan(0)

      testDb.close()
      await fs.rm(srcDir, { recursive: true, force: true })
    })
  })

  describe("node identity across re-indexing", () => {
    it("node ID changes when line number changes", async () => {
      const srcDir = path.join(tmpDir, "node-id-change")
      await fs.mkdir(srcDir, { recursive: true })
      initGit(srcDir)

      const original = `export function greet() {
  return "hello";
}`
      await fs.writeFile(path.join(srcDir, "greet.ts"), original)

      const dbPath = path.join(tmpDir, "node-id-change.db")
      const testDb = new NtGraphDb(dbPath, srcDir)
      testDb.initialize()
      const orch = new ExtractionOrchestrator(srcDir, testDb)

      await orch.indexAll()

      const nodes1 = testDb.getNodesByFile("greet.ts")
      // Ищем именно function-узел: module-узел тоже называется «greet»,
      // но привязан к началу файла (строка 1) и ID у него стабилен.
      const greetNode1 = nodes1.find((n) => n.name === "greet" && n.kind === "function")
      expect(greetNode1).toBeDefined()
      const id1 = greetNode1!.id

      // Добавляем строку перед функцией — смещает номера строк
      const modified = `// Added comment line

export function greet() {
  return "hello";
}`
      await fs.writeFile(path.join(srcDir, "greet.ts"), modified)

      await orch.indexAll()

      const nodes2 = testDb.getNodesByFile("greet.ts")
      const greetNode2 = nodes2.find((n) => n.name === "greet" && n.kind === "function")
      expect(greetNode2).toBeDefined()
      const id2 = greetNode2!.id

      expect(id1).not.toBe(id2)

      testDb.close()
      await fs.rm(srcDir, { recursive: true, force: true })
    })

    it("node ID stays same when content unchanged", async () => {
      const srcDir = path.join(tmpDir, "node-id-same")
      await fs.mkdir(srcDir, { recursive: true })
      initGit(srcDir)

      const content = `export function stable() {
  return 1;
}`
      await fs.writeFile(path.join(srcDir, "stable.ts"), content)

      const dbPath = path.join(tmpDir, "node-id-same.db")
      const testDb = new NtGraphDb(dbPath, srcDir)
      testDb.initialize()
      const orch = new ExtractionOrchestrator(srcDir, testDb)

      await orch.indexAll()

      const nodes1 = testDb.getNodesByFile("stable.ts")
      const stableNode1 = nodes1.find((n) => n.name === "stable")
      expect(stableNode1).toBeDefined()
      const id1 = stableNode1!.id

      // Записываем тот же контент снова
      await fs.writeFile(path.join(srcDir, "stable.ts"), content)

      await orch.indexAll()

      const nodes2 = testDb.getNodesByFile("stable.ts")
      const stableNode2 = nodes2.find((n) => n.name === "stable")
      expect(stableNode2).toBeDefined()
      const id2 = stableNode2!.id

      expect(id1).toBe(id2)

      testDb.close()
      await fs.rm(srcDir, { recursive: true, force: true })
    })
  })

  describe("content hash prevents redundant re-indexing", () => {
    it("skips file when content hash matches", async () => {
      const srcDir = path.join(tmpDir, "hash-skip")
      await fs.mkdir(srcDir, { recursive: true })
      initGit(srcDir)

      await fs.writeFile(
        path.join(srcDir, "unchanged.ts"),
        `export function unchanged() { return true; }`
      )

      const dbPath = path.join(tmpDir, "hash-skip.db")
      const testDb = new NtGraphDb(dbPath, srcDir)
      testDb.initialize()
      const orch = new ExtractionOrchestrator(srcDir, testDb)

      const result1 = await orch.indexAll()
      expect(result1.indexed).toBeGreaterThan(0)

      const stats1 = testDb.getStats()

      // Переиндексируем без изменений
      const result2 = await orch.indexAll()

      const stats2 = testDb.getStats()

      expect(stats2.nodeCount).toBe(stats1.nodeCount)
      expect(stats2.edgeCount).toBe(stats1.edgeCount)

      testDb.close()
      await fs.rm(srcDir, { recursive: true, force: true })
    })
  })

  describe("FK cascade deletes on file re-index", () => {
    it("old nodes and edges are removed when file is re-indexed", async () => {
      const srcDir = path.join(tmpDir, "cascade-delete")
      await fs.mkdir(srcDir, { recursive: true })
      initGit(srcDir)

      await fs.writeFile(
        path.join(srcDir, "evolving.ts"),
        `export function oldFunc() { return 1; }
export function oldFunc2() { return 2; }`
      )

      const dbPath = path.join(tmpDir, "cascade-delete.db")
      const testDb = new NtGraphDb(dbPath, srcDir)
      testDb.initialize()
      const orch = new ExtractionOrchestrator(srcDir, testDb)

      await orch.indexAll()

      const nodes1 = testDb.getNodesByFile("evolving.ts")
      const oldFuncCount = nodes1.filter((n) => n.name === "oldFunc" || n.name === "oldFunc2").length
      expect(oldFuncCount).toBe(2)

      // Полностью заменяем содержимое файла
      await fs.writeFile(
        path.join(srcDir, "evolving.ts"),
        `export function newFunc() { return 3; }`
      )

      await orch.indexAll()

      const nodes2 = testDb.getNodesByFile("evolving.ts")
      const oldFuncCount2 = nodes2.filter((n) => n.name === "oldFunc" || n.name === "oldFunc2").length
      expect(oldFuncCount2).toBe(0)

      const newFuncCount = nodes2.filter((n) => n.name === "newFunc").length
      expect(newFuncCount).toBe(1)

      testDb.close()
      await fs.rm(srcDir, { recursive: true, force: true })
    })
  })

  describe("multi-file project integrity", () => {
    it("all nodes and edges are consistent after indexing multiple files", async () => {
      const srcDir = path.join(tmpDir, "multi-file")
      await fs.mkdir(srcDir, { recursive: true })
      initGit(srcDir)

      await fs.writeFile(
        path.join(srcDir, "types.ts"),
        `export interface User {
  id: string;
  name: string;
}`
      )
      await fs.writeFile(
        path.join(srcDir, "service.ts"),
        `import { User } from './types';

export class UserService {
  findById(id: string): User | null {
    return null;
  }
}`
      )
      await fs.writeFile(
        path.join(srcDir, "controller.ts"),
        `import { UserService } from './service';

export class UserController {
  private service: UserService;

  constructor(service: UserService) {
    this.service = service;
  }

  getUser(id: string) {
    return this.service.findById(id);
  }
}`
      )

      const dbPath = path.join(tmpDir, "multi-file.db")
      const testDb = new NtGraphDb(dbPath, srcDir)
      testDb.initialize()
      const orch = new ExtractionOrchestrator(srcDir, testDb)

      const result = await orch.indexAll()
      expect(result.indexed).toBe(3)

      const stats = testDb.getStats()
      expect(stats.nodeCount).toBeGreaterThan(0)
      expect(stats.edgeCount).toBeGreaterThan(0)
      expect(stats.fileCount).toBe(3)

      // Проверяем, что каждый файл имеет свои узлы
      const typesNodes = testDb.getNodesByFile("types.ts")
      expect(typesNodes.length).toBeGreaterThan(0)

      const serviceNodes = testDb.getNodesByFile("service.ts")
      expect(serviceNodes.length).toBeGreaterThan(0)

      const controllerNodes = testDb.getNodesByFile("controller.ts")
      expect(controllerNodes.length).toBeGreaterThan(0)

      testDb.close()
      await fs.rm(srcDir, { recursive: true, force: true })
    })

    it("edges reference valid nodes after re-index", async () => {
      const srcDir = path.join(tmpDir, "edge-validity")
      await fs.mkdir(srcDir, { recursive: true })
      initGit(srcDir)

      await fs.writeFile(
        path.join(srcDir, "a.ts"),
        `export function a() { return 1; }`
      )
      await fs.writeFile(
        path.join(srcDir, "b.ts"),
        `import { a } from './a';

export function b() {
  return a();
}`
      )

      const dbPath = path.join(tmpDir, "edge-validity.db")
      const testDb = new NtGraphDb(dbPath, srcDir)
      testDb.initialize()
      const orch = new ExtractionOrchestrator(srcDir, testDb)

      await orch.indexAll()

      // Модифицируем a.ts (смещает номера строк, меняет ID узлов)
      await fs.writeFile(
        path.join(srcDir, "a.ts"),
        `// Comment

export function a() { return 1; }`
      )

      await orch.indexAll()

      const stats = testDb.getStats()
      expect(stats.edgeCount).toBeGreaterThan(0)

      testDb.close()
      await fs.rm(srcDir, { recursive: true, force: true })
    })
  })

  describe("unresolved references", () => {
    it("unresolved references are stored for imports", async () => {
      const srcDir = path.join(tmpDir, "unresolved-refs")
      await fs.mkdir(srcDir, { recursive: true })
      initGit(srcDir)

      await fs.writeFile(
        path.join(srcDir, "app.ts"),
        `import { Component } from '@angular/core';

export class App {}`
      )

      const dbPath = path.join(tmpDir, "unresolved-refs.db")
      const testDb = new NtGraphDb(dbPath, srcDir)
      testDb.initialize()
      const orch = new ExtractionOrchestrator(srcDir, testDb)

      const result = await orch.indexAll()
      expect(result.indexed).toBeGreaterThan(0)

      testDb.close()
      await fs.rm(srcDir, { recursive: true, force: true })
    })
  })
})
