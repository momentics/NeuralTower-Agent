/**
 * Тесты NtGraphDb.
 *
 * Проверяют: инициализацию, PRAGMA, миграции, размер БД,
 * CRUD proxy, search proxy, аналитику, close.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { NtGraphDb, INode } from "./index"
import * as os from "os"
import * as path from "path"
import * as fs from "fs/promises"

describe("NtGraphDb", () => {
  let tmpDir: string
  let dbPath: string
  let db: NtGraphDb

  beforeAll(() => {
    tmpDir = path.join(os.tmpdir(), `ntgraph-db-test-${Date.now()}`)
    fs.mkdir(tmpDir, { recursive: true })
    dbPath = path.join(tmpDir, "ntgraph.db")
    db = new NtGraphDb(dbPath)
    db.initialize()
  })

  afterAll(async () => {
    db.close()
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it("initializes database", () => {
    expect(db).toBeDefined()
  })

  it("opens existing database", () => {
    const opened = new NtGraphDb(dbPath)
    opened.initialize()
    expect(opened).toBeDefined()
    opened.close()
  })

  it("throws on open of non-existent database", () => {
    expect(() => {
      NtGraphDb.open({ projectRoot: tmpDir, dbPath: "/tmp/nonexistent.db" })
    }).toThrow()
  })

  it("inserts and retrieves nodes", async () => {
    const node: INode = {
      id: "db-test-1",
      kind: "function",
      name: "testFunc",
      qualifiedName: "testFunc",
      filePath: "src/test.ts",
      language: "typescript",
      startLine: 1,
      endLine: 5,
      startColumn: 0,
      endColumn: 10,
      updatedAt: Date.now(),
    }
    await db.insertNode(node)
    const found = db.getNodeById("db-test-1")
    expect(found).not.toBeNull()
    expect(found!.name).toBe("testFunc")
  })

  it("inserts and retrieves edges", async () => {
    const node: INode = {
      id: "db-test-2",
      kind: "class",
      name: "TestClass",
      qualifiedName: "TestClass",
      filePath: "src/test.ts",
      language: "typescript",
      startLine: 10,
      endLine: 20,
      startColumn: 0,
      endColumn: 10,
      updatedAt: Date.now(),
    }
    await db.insertNode(node)
    await db.insertEdge({ source: "db-test-1", target: "db-test-2", kind: "calls" })
    const edges = db.getOutgoingEdges("db-test-1")
    expect(edges.length).toBe(1)
    expect(edges[0]!.kind).toBe("calls")
  })

  it("search returns results", () => {
    const results = db.search("test")
    expect(results.length).toBeGreaterThan(0)
  })

  it("getStats returns stats", () => {
    const stats = db.getStats()
    expect(stats.nodeCount).toBeGreaterThanOrEqual(2)
    expect(stats.edgeCount).toBeGreaterThanOrEqual(1)
    expect(stats.dbSizeBytes).toBeGreaterThan(0)
  })

  it("getSize returns positive number", () => {
    const size = db.getSize()
    expect(size).toBeGreaterThan(0)
  })

  it("getSchemaVersion returns current version", () => {
    const version = db.getSchemaVersion()
    expect(version).toBeGreaterThan(0)
  })

  it("getMigrationHistory returns entries", () => {
    const history = db.getMigrationHistory()
    expect(history.length).toBeGreaterThan(0)
  })

  it("getNodeAndEdgeCount returns counts", () => {
    const count = db.getNodeAndEdgeCount()
    expect(count.nodeCount).toBeGreaterThanOrEqual(2)
    expect(count.edgeCount).toBeGreaterThanOrEqual(1)
  })

  it("runMaintenance does not throw", () => {
    expect(() => db.runMaintenance()).not.toThrow()
  })

  it("close does not throw", async () => {
    const tmpDir2 = path.join(os.tmpdir(), `ntgraph-close-test-${Date.now()}`)
    await fs.mkdir(tmpDir2, { recursive: true })
    const dbPath2 = path.join(tmpDir2, "ntgraph.db")
    const db2 = new NtGraphDb(dbPath2)
    db2.initialize()
    db2.close()
    expect(() => db2.close()).not.toThrow()
    await fs.rm(tmpDir2, { recursive: true, force: true })
  })

  it("getProjectRoot returns project root", () => {
    expect(db.getProjectRoot()).toBe(tmpDir)
  })

  it("getProjectNameTokens returns tokens", () => {
    const tokens = db.getProjectNameTokens()
    expect(Array.isArray(tokens)).toBe(true)
  })

  it("clear removes all data", () => {
    db.clear()
    expect(db.getAllNodes().length).toBe(0)
    expect(db.getNodeAndEdgeCount().edgeCount).toBe(0)
  })

  it("queryBuilder returns QueryBuilder", () => {
    const qb = db.queryBuilder
    expect(qb).toBeDefined()
  })

  it("getDatabase returns SqliteDatabase", () => {
    const adapter = db.getDatabase()
    expect(adapter).toBeDefined()
    expect(adapter.open).toBe(true)
  })

  it("getFtsSearch returns FtsSearch", () => {
    const fts = db.getFtsSearch()
    expect(fts).toBeDefined()
  })
})
