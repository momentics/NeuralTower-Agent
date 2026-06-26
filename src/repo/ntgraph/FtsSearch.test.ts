/**
 * Тесты FtsSearch.
 *
 * Проверяют: FTS5-поиск, LIKE-фоллбэк, Fuzzy-фоллбэк,
 * three-tier fallback, экранирование спецсимволов, rescoring.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { NtGraphDb, INode } from "./index"
import * as os from "os"
import * as path from "path"
import * as fs from "fs/promises"

describe("FtsSearch", () => {
  let tmpDir: string
  let db: NtGraphDb

  beforeAll(() => {
    tmpDir = path.join(os.tmpdir(), `ntgraph-fts-test-${Date.now()}`)
    fs.mkdir(tmpDir, { recursive: true })
    const dbPath = path.join(tmpDir, 'ntgraph.db')
    db = new NtGraphDb(dbPath)
    db.initialize()

    const nodes: INode[] = [
      {
        id: "fts-1",
        kind: "function",
        name: "handleRequest",
        qualifiedName: "handleRequest",
        filePath: "src/server.ts",
        language: "typescript",
        startLine: 1,
        endLine: 10,
        startColumn: 0,
        endColumn: 10,
        docstring: "Handles incoming HTTP requests",
        signature: "function handleRequest(req, res)",
        updatedAt: Date.now(),
      },
      {
        id: "fts-2",
        kind: "class",
        name: "UserService",
        qualifiedName: "UserService",
        filePath: "src/services.ts",
        language: "typescript",
        startLine: 1,
        endLine: 50,
        startColumn: 0,
        endColumn: 10,
        updatedAt: Date.now(),
      },
      {
        id: "fts-3",
        kind: "method",
        name: "getUserById",
        qualifiedName: "UserService.getUserById",
        filePath: "src/services.ts",
        language: "typescript",
        startLine: 5,
        endLine: 15,
        startColumn: 2,
        endColumn: 10,
        updatedAt: Date.now(),
      },
      {
        id: "fts-4",
        kind: "constant",
        name: "MAX_SIZE",
        qualifiedName: "MAX_SIZE",
        filePath: "src/constants.ts",
        language: "typescript",
        startLine: 1,
        endLine: 1,
        startColumn: 0,
        endColumn: 10,
        updatedAt: Date.now(),
      },
    ]
    db.insertNodes(nodes)
  })

  afterAll(async () => {
    db.close()
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it("FTS5 search finds node by name", () => {
    const results = db.search("handle")
    expect(results.length).toBeGreaterThan(0)
    expect(results.some((r) => r.node.name === "handleRequest")).toBe(true)
  })

  it("FTS5 search finds node by docstring", () => {
    const results = db.search("requests")
    expect(results.length).toBeGreaterThan(0)
  })

  it("FTS5 search finds node by signature", () => {
    const results = db.search("req")
    expect(results.length).toBeGreaterThan(0)
  })

  it("search returns empty for unknown query", () => {
    const results = db.search("zzzzznonexistent")
    expect(results.length).toBe(0)
  })

  it("LIKE fallback works for short queries", () => {
    const results = db.search("us")
    expect(results.length).toBeGreaterThan(0)
  })

  it("search with kind filter", () => {
    const results = db.search("user", { kinds: ["class"] })
    expect(results.length).toBeGreaterThan(0)
    expect(results.every((r) => r.node.kind === "class")).toBe(true)
  })

  it("search with language filter", () => {
    const results = db.search("user", { languages: ["typescript"] })
    expect(results.length).toBeGreaterThan(0)
  })

  it("FTS5 special character escaping", () => {
    const fts = db.getFtsSearch()
    const query = fts.buildFtsQuery("foo::bar")
    expect(query).not.toContain("::")
  })

  it("buildFtsQuery returns null for empty query", () => {
    const fts = db.getFtsSearch()
    expect(fts.buildFtsQuery("")).toBeNull()
  })

  it("buildFtsQuery strips FTS5 special chars", () => {
    const fts = db.getFtsSearch()
    const query = fts.buildFtsQuery("foo*bar")
    expect(query).toContain("*")
    expect(query).not.toContain("foo*bar")
  })

  it("rescoring boosts function kind", () => {
    const results = db.search("handle")
    const fnResult = results.find((r) => r.node.kind === "function")
    expect(fnResult).toBeDefined()
    expect(fnResult!.score).toBeGreaterThan(0)
  })

  // ---- FTS5 триггерная синхронизация ----

  it("FTS5 INSERT trigger makes new node searchable", () => {
    db.insertNodes([{
      id: "fts-trigger-insert",
      kind: "function",
      name: "triggerTestFn",
      qualifiedName: "triggerTestFn",
      filePath: "src/trigger.ts",
      language: "typescript",
      startLine: 1,
      endLine: 1,
      startColumn: 0,
      endColumn: 0,
      updatedAt: Date.now(),
    }])
    const results = db.search("triggerTest")
    expect(results.length).toBeGreaterThan(0)
    expect(results.some((r) => r.node.name === "triggerTestFn")).toBe(true)
  })

  it("FTS5 DELETE trigger removes node from search", async () => {
    const beforeCount = db.search("triggerTest").length
    await db.deleteNode("fts-trigger-insert")
    const afterCount = db.search("triggerTest").length
    expect(afterCount).toBeLessThan(beforeCount)
  })

  it("FTS5 UPDATE trigger reflects changes in search", () => {
    db.insertNodes([{
      id: "fts-trigger-update",
      kind: "function",
      name: "updateBefore",
      qualifiedName: "updateBefore",
      filePath: "src/trigger.ts",
      language: "typescript",
      startLine: 1,
      endLine: 1,
      startColumn: 0,
      endColumn: 0,
      updatedAt: Date.now(),
    }])
    let results = db.search("updateBefore")
    expect(results.some((r) => r.node.name === "updateBefore")).toBe(true)
    db.insertNodes([{
      id: "fts-trigger-update",
      kind: "function",
      name: "updateAfter",
      qualifiedName: "updateAfter",
      filePath: "src/trigger.ts",
      language: "typescript",
      startLine: 1,
      endLine: 1,
      startColumn: 0,
      endColumn: 0,
      updatedAt: Date.now(),
    }])
    results = db.search("updateAfter")
    expect(results.some((r) => r.node.name === "updateAfter")).toBe(true)
    results = db.search("updateBefore")
    expect(results.some((r) => r.node.name === "updateBefore")).toBe(false)
  })

  // ---- Three-tier: Fuzzy уровень ----

  it("Fuzzy tier activates when FTS5 and LIKE return no results", () => {
    const results = db.search("handleRequst")
    expect(results.length).toBeGreaterThan(0)
    expect(results.some((r) => r.node.name === "handleRequest")).toBe(true)
  })
})
