/**
 * Тесты адаптера SQLite.
 *
 * Проверяют: prepared statements, транзакции, rollback,
 * pragma, close, runMaintenance.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { createDatabase, SqliteDatabase } from "./ntgraph/Adapter"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

describe("Adapter", () => {
  let dbPath: string
  let db: SqliteDatabase

  beforeAll(() => {
    dbPath = path.join(os.tmpdir(), `ntgraph-adapter-test-${Date.now()}.db`)
    const { db: adapter } = createDatabase(dbPath)
    db = adapter
  })

  afterAll(async () => {
    db.close()
    try {
      await fs.unlink(dbPath)
    } catch {
      // ignore
    }
  })

  it("creates database and is open", () => {
    expect(db.open).toBe(true)
  })

  it("executes SQL", () => {
    db.exec("CREATE TABLE IF NOT EXISTS test (id INTEGER PRIMARY KEY, name TEXT)")
    db.exec("INSERT INTO test (name) VALUES ('hello')")
    const row = db.prepare("SELECT name FROM test WHERE id = 1").get()
    expect(row).toBeDefined()
    expect((row as { name: string }).name).toBe("hello")
  })

  it("prepare + run returns changes and lastInsertRowid", () => {
    const stmt = db.prepare("INSERT INTO test (name) VALUES (?)")
    const result = stmt.run("world")
    expect(result.changes).toBe(1)
    expect(result.lastInsertRowid).toBeGreaterThan(0)
  })

  it("prepare + get returns single row", () => {
    const row = db.prepare("SELECT name FROM test WHERE id = ?").get(1)
    expect((row as { name: string }).name).toBe("hello")
  })

  it("prepare + all returns multiple rows", () => {
    const rows = db.prepare("SELECT name FROM test").all() as Array<{ name: string }>
    expect(rows.length).toBe(2)
  })

  it("prepare + iterate yields rows one by one", () => {
    const collected: string[] = []
    for (const row of db.prepare("SELECT name FROM test").iterate()) {
      collected.push((row as { name: string }).name)
    }
    expect(collected).toEqual(["hello", "world"])
  })

  it("transaction commits on success", () => {
    const insertMany = db.transaction(() => {
      db.exec("INSERT INTO test (name) VALUES ('a')")
      db.exec("INSERT INTO test (name) VALUES ('b')")
    })
    insertMany()
    const rows = db.prepare("SELECT name FROM test").all() as Array<{ name: string }>
    expect(rows.length).toBe(4)
  })

  it("transaction rolls back on error", () => {
    const insertFail = db.transaction(() => {
      db.exec("INSERT INTO test (name) VALUES ('c')")
      throw new Error("fail")
    })
    expect(() => insertFail()).toThrow("fail")
    const rows = db.prepare("SELECT name FROM test").all() as Array<{ name: string }>
    expect(rows.length).toBe(4)
  })

  it("pragma write and read", () => {
    db.pragma("journal_mode = WAL")
    const result = db.pragma("journal_mode", { simple: true })
    expect(result).toBe("wal")
  })

  it("close is idempotent", () => {
    db.close()
    db.close()
  })

  it("runMaintenance does not throw", () => {
    const { db: db2 } = createDatabase(dbPath)
    expect(() => db2.runMaintenance()).not.toThrow()
    db2.close()
  })
})
