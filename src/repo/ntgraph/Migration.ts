/**
 * Миграции схемы БД.
 *
 * Версия 1 — начальная и единственная. Откат — полная пересоздание схемы
 * из schema.sql.
 */

import { SqliteDatabase } from './Adapter';
import { ISchemaVersion } from './Types';

/** Текущая версия схемы. */
export const CURRENT_SCHEMA_VERSION = 1;

/** Интерфейс миграции. */
export interface Migration {
  version: number;
  description: string;
  up: (db: SqliteDatabase) => void;
}

/**
 * Возвращает текущую версию схемы из БД.
 */
export function getCurrentVersion(db: SqliteDatabase): number {
  try {
    const row = db.prepare('SELECT MAX(version) as version FROM schema_versions').get() as { version: number | null } | undefined;
    return row?.version ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Записывает миграцию в таблицу schema_versions.
 */
export function recordMigration(db: SqliteDatabase, version: number, description: string): void {
  db.prepare(
    'INSERT OR REPLACE INTO schema_versions (version, applied_at, description) VALUES (?, ?, ?)'
  ).run(version, Date.now(), description);
}

/**
 * Проверяет необходимость миграции.
 */
export function needsMigration(db: SqliteDatabase): boolean {
  const current = getCurrentVersion(db);
  return current < CURRENT_SCHEMA_VERSION;
}

/**
 * Возвращает список ожидающих миграций.
 */
export function getPendingMigrations(db: SqliteDatabase): Migration[] {
  const current = getCurrentVersion(db);
  return ALL_MIGRATIONS.filter(m => m.version > current);
}

/**
 * История применённых миграций.
 */
export function getMigrationHistory(db: SqliteDatabase): ISchemaVersion[] {
  const rows = db.prepare('SELECT version, description, applied_at FROM schema_versions ORDER BY version').all() as Array<{
    version: number;
    description: string;
    applied_at: number;
  }>;
  return rows.map(r => ({
    version: r.version,
    description: r.description,
    appliedAt: r.applied_at,
  }));
}

/**
 * Применяет все ожидающие миграции.
 */
export function applyMigrations(db: SqliteDatabase): void {
  const pending = getPendingMigrations(db);
  for (const migration of pending) {
    migration.up(db);
    recordMigration(db, migration.version, migration.description);
  }
}

/**
 * Применяет миграции начиная с указанной версии (совместимо с API референса).
 */
export function runMigrations(db: SqliteDatabase, fromVersion: number): void {
  const pending = ALL_MIGRATIONS.filter(m => m.version > fromVersion).sort((a, b) => a.version - b.version);
  for (const migration of pending) {
    db.transaction(() => {
      migration.up(db);
      recordMigration(db, migration.version, migration.description);
    })();
  }
}

// =============================================================================
// Миграции
// =============================================================================

/** v1: начальная схема (все таблицы, индексы, FTS5, триггеры). */
const migrationV1: Migration = {
  version: 1,
  description: 'Начальная схема: nodes, edges, files, unresolved_refs, schema_versions, project_metadata, nodes_fts, индексы, триггеры',
  up: (db: SqliteDatabase) => {
    // Таблица schema_versions уже создана в schema.sql
    // nodes
    db.exec(`
      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        qualified_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        language TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        start_column INTEGER NOT NULL,
        end_column INTEGER NOT NULL,
        docstring TEXT,
        signature TEXT,
        visibility TEXT,
        is_exported INTEGER DEFAULT 0,
        is_async INTEGER DEFAULT 0,
        is_static INTEGER DEFAULT 0,
        is_abstract INTEGER DEFAULT 0,
        decorators TEXT,
        type_parameters TEXT,
        return_type TEXT,
        updated_at INTEGER NOT NULL
      )
    `);

    // edges
    db.exec(`
      CREATE TABLE IF NOT EXISTS edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        target TEXT NOT NULL,
        kind TEXT NOT NULL,
        metadata TEXT,
        line INTEGER,
        col INTEGER,
        provenance TEXT DEFAULT NULL,
        FOREIGN KEY (source) REFERENCES nodes(id) ON DELETE CASCADE,
        FOREIGN KEY (target) REFERENCES nodes(id) ON DELETE CASCADE
      )
    `);

    // files
    db.exec(`
      CREATE TABLE IF NOT EXISTS files (
        path TEXT PRIMARY KEY,
        content_hash TEXT NOT NULL,
        language TEXT NOT NULL,
        size INTEGER NOT NULL,
        modified_at INTEGER NOT NULL,
        indexed_at INTEGER NOT NULL,
        node_count INTEGER DEFAULT 0,
        errors TEXT
      )
    `);

    // unresolved_refs
    db.exec(`
      CREATE TABLE IF NOT EXISTS unresolved_refs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_node_id TEXT NOT NULL,
        reference_name TEXT NOT NULL,
        reference_kind TEXT NOT NULL,
        line INTEGER NOT NULL,
        col INTEGER NOT NULL,
        candidates TEXT,
        file_path TEXT NOT NULL DEFAULT '',
        language TEXT NOT NULL DEFAULT 'unknown',
        FOREIGN KEY (from_node_id) REFERENCES nodes(id) ON DELETE CASCADE
      )
    `);

    // project_metadata
    db.exec(`
      CREATE TABLE IF NOT EXISTS project_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    // Индексы узлов
    db.exec('CREATE INDEX IF NOT EXISTS idx_nodes_kind ON nodes(kind)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_nodes_qualified_name ON nodes(qualified_name)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_nodes_file_path ON nodes(file_path)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_nodes_language ON nodes(language)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_nodes_file_line ON nodes(file_path, start_line)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_nodes_lower_name ON nodes(lower(name))');

    // FTS5
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
        id, name, qualified_name, docstring, signature,
        content='nodes', content_rowid='rowid'
      )
    `);

    // Триггеры FTS
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS nodes_ai AFTER INSERT ON nodes BEGIN
        INSERT INTO nodes_fts(rowid, id, name, qualified_name, docstring, signature)
        VALUES (NEW.rowid, NEW.id, NEW.name, NEW.qualified_name, NEW.docstring, NEW.signature);
      END
    `);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS nodes_ad AFTER DELETE ON nodes BEGIN
        INSERT INTO nodes_fts(nodes_fts, rowid, id, name, qualified_name, docstring, signature)
        VALUES ('delete', OLD.rowid, OLD.id, OLD.name, OLD.qualified_name, OLD.docstring, OLD.signature);
      END
    `);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS nodes_au AFTER UPDATE ON nodes BEGIN
        INSERT INTO nodes_fts(nodes_fts, rowid, id, name, qualified_name, docstring, signature)
        VALUES ('delete', OLD.rowid, OLD.id, OLD.name, OLD.qualified_name, OLD.docstring, OLD.signature);
        INSERT INTO nodes_fts(rowid, id, name, qualified_name, docstring, signature)
        VALUES (NEW.rowid, NEW.id, NEW.name, NEW.qualified_name, NEW.docstring, NEW.signature);
      END
    `);

    // Индексы рёбер
    db.exec('CREATE INDEX IF NOT EXISTS idx_edges_kind ON edges(kind)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_edges_source_kind ON edges(source, kind)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_edges_target_kind ON edges(target, kind)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_edges_provenance ON edges(provenance)');

    // Индексы файлов
    db.exec('CREATE INDEX IF NOT EXISTS idx_files_language ON files(language)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_files_modified_at ON files(modified_at)');

    // Индексы unresolved_refs
    db.exec('CREATE INDEX IF NOT EXISTS idx_unresolved_from_node ON unresolved_refs(from_node_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_unresolved_name ON unresolved_refs(reference_name)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_unresolved_file_path ON unresolved_refs(file_path)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_unresolved_from_name ON unresolved_refs(from_node_id, reference_name)');
  },
};

/** Все миграции в порядке версий. */
const ALL_MIGRATIONS: Migration[] = [
  migrationV1,
];
