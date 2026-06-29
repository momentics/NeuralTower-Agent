/**
 * Тесты миграций.
 *
 * Проверяют: CURRENT_SCHEMA_VERSION, needsMigration, getPendingMigrations,
 * getMigrationHistory, applyMigrations, recordMigration.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { createDatabase, SqliteDatabase } from "./Adapter"
import {
  CURRENT_SCHEMA_VERSION,
  needsMigration,
  getPendingMigrations,
  getMigrationHistory,
  applyMigrations,
  recordMigration,
} from "./Migration"
import * as os from "os"
import * as path from "path"
import * as fs from "fs/promises"

describe("Migration", () => {
  let tmpDir: string
  let dbPath: string
  let db: SqliteDatabase

  beforeAll(async () => {
    tmpDir = path.join(os.tmpdir(), `ntgraph-migration-test-${Date.now()}`)
    await fs.mkdir(tmpDir, { recursive: true })
    dbPath = path.join(tmpDir, "ntgraph.db")
    const { db: sqliteDb } = createDatabase(dbPath)
    db = sqliteDb
  })

  afterAll(async () => {
    db.close()
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it("CURRENT_SCHEMA_VERSION is 1", () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(1)
  })

  it("needsMigration returns true on empty database", () => {
    // Создаём таблицу schema_versions (минимальная схема)
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_versions (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL,
        description TEXT NOT NULL
      )
    `)
    expect(needsMigration(db)).toBe(true)
  })

  it("needsMigration returns false after migration applied", () => {
    for (let v = 1; v <= CURRENT_SCHEMA_VERSION; v++) {
      recordMigration(db, v, "Test migration")
    }
    expect(needsMigration(db)).toBe(false)
  })

  it("getPendingMigrations returns empty after all applied", () => {
    const pending = getPendingMigrations(db)
    expect(pending).toEqual([])
  })

  it("getPendingMigrations returns migrations when behind", () => {
    // Удаляем все записи миграций
    db.exec('DELETE FROM schema_versions')
    const pending = getPendingMigrations(db)
    expect(pending.length).toBe(CURRENT_SCHEMA_VERSION)
    expect(pending[0].version).toBe(1)
  })

  it("applyMigrations applies all pending migrations", () => {
    applyMigrations(db)
    expect(needsMigration(db)).toBe(false)
    const pending = getPendingMigrations(db)
    expect(pending).toEqual([])
  })

  it("getMigrationHistory returns applied migrations", () => {
    const history = getMigrationHistory(db)
    expect(history.length).toBe(CURRENT_SCHEMA_VERSION)
    expect(history[0].version).toBe(1)
    expect(history[history.length - 1].version).toBe(CURRENT_SCHEMA_VERSION)
  })

  it("migration v1 creates all required tables", () => {
    // Создаём новую БД и применяем миграцию
    const newDbPath = path.join(tmpDir, "fresh.db")
    const { db: freshDb } = createDatabase(newDbPath)

    try {
      // Создаём schema_versions (создаётся самой миграцией, но для needsMigration нужна)
      freshDb.exec(`
        CREATE TABLE IF NOT EXISTS schema_versions (
          version INTEGER PRIMARY KEY,
          applied_at INTEGER NOT NULL,
          description TEXT NOT NULL
        )
      `)

      applyMigrations(freshDb)

      // Проверяем существование таблиц через pragma_table_info
      const tables = [
        "nodes", "edges", "files", "unresolved_refs",
        "project_metadata", "schema_versions"
      ]

      for (const table of tables) {
        const row = freshDb.prepare(
          `SELECT COUNT(*) as cnt FROM pragma_table_info('${table}')`
        ).get() as { cnt: number }
        expect(row.cnt).toBeGreaterThan(0)
      }
    } finally {
      freshDb.close()
    }
  })

  it("migration v1 creates FTS5 virtual table", () => {
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='nodes_fts'"
    ).get() as { name: string } | null
    expect(row).not.toBeNull()
    expect(row?.name).toBe("nodes_fts")
  })

  it("migration v1 creates FTS triggers", () => {
    const triggers = [
      "nodes_ai", "nodes_ad", "nodes_au"
    ]

    for (const trigger of triggers) {
      const row = db.prepare(
        `SELECT name FROM sqlite_master WHERE type='trigger' AND name=?`
      ).get(trigger) as { name: string } | null
      expect(row).not.toBeNull()
      expect(row?.name).toBe(trigger)
    }
  })

  it("migration v1 creates required indexes", () => {
    const indexes = [
      "idx_nodes_kind", "idx_nodes_name", "idx_nodes_qualified_name",
      "idx_nodes_file_path", "idx_nodes_language", "idx_nodes_file_line",
      "idx_nodes_lower_name",
      "idx_edges_kind", "idx_edges_source_kind", "idx_edges_target_kind",
      "idx_edges_provenance",
      "idx_files_language", "idx_files_modified_at",
      "idx_unresolved_from_node", "idx_unresolved_name",
      "idx_unresolved_file_path", "idx_unresolved_from_name"
    ]

    for (const idx of indexes) {
      const row = db.prepare(
        `SELECT name FROM sqlite_master WHERE type='index' AND name=?`
      ).get(idx) as { name: string } | null
      expect(row).not.toBeNull()
      expect(row?.name).toBe(idx)
    }
  })

  it("recordMigration upserts version record", () => {
    recordMigration(db, 1, "Updated description")
    const history = getMigrationHistory(db)
    const v1 = history.find(h => h.version === 1)
    expect(v1).toBeDefined()
    expect(v1!.description).toBe("Updated description")
  })
})
