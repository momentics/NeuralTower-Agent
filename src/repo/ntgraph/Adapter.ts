/**
 * Адаптер SQLite.
 *
 * Тонкая обёртка над `node:sqlite` (DatabaseSync), предоставляющая
 * интерфейс, совместимый с better-sqlite3.
 */

/** Prepared statement с методами run, get, all, iterate. */
export interface SqliteStatement {
  run(...params: any[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: any[]): any;
  all(...params: any[]): any[];
  /**
   * Ленивый итератор — O(1) память вместо O(N) как у all().
   * Используется для обхода больших наборов данных.
   */
  iterate(...params: any[]): IterableIterator<any>;
}

/** Интерфейс базы данных SQLite. */
export interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  pragma(str: string, options?: { simple?: boolean }): any;
  transaction<T>(fn: (...args: any[]) => T): (...args: any[]) => T;
  close(): void;
  readonly open: boolean;
  /** Лёгкое обслуживание после пакетных записей. */
  runMaintenance(): void;
  /** Возвращает размер WAL-файла в байтах. */
  getWalSizeBytes(): number;
  /** Пассивный чекпоинт WAL. Возвращает null, если WAL не включён. */
  checkpointWalPassive(): { busy: number; log: number; checkpointed: number } | null;
}

/** Тип активного бэкенда SQLite. */
export type SqliteBackend = 'node-sqlite';

/**
 * Обёртка над `node:sqlite` (DatabaseSync) для соответствия
 * интерфейсу better-sqlite3.
 */
class NodeSqliteAdapter implements SqliteDatabase {
  private _db: any;
  private readonly _dbPath: string;

  constructor(dbPath: string) {
    this._dbPath = dbPath;
    const { DatabaseSync } = require('node:sqlite');
    this._db = new DatabaseSync(dbPath);
  }

  get open(): boolean {
    return this._db.isOpen;
  }

  prepare(sql: string): SqliteStatement {
    const stmt = this._db.prepare(sql);
    return {
      run(...params: any[]) {
        const r = stmt.run(...params);
        return {
          changes: Number(r?.changes ?? 0),
          lastInsertRowid: r?.lastInsertRowid ?? 0,
        };
      },
      get(...params: any[]) {
        return stmt.get(...params);
      },
      all(...params: any[]) {
        return stmt.all(...params);
      },
      iterate(...params: any[]) {
        return stmt.iterate(...params);
      },
    };
  }

  exec(sql: string): void {
    this._db.exec(sql);
  }

  pragma(str: string, options?: { simple?: boolean }): any {
    const trimmed = str.trim();

    // Write pragma ("key = value")
    if (trimmed.includes('=')) {
      this._db.exec(`PRAGMA ${trimmed}`);
      return;
    }

    // Read pragma
    const row = this._db.prepare(`PRAGMA ${trimmed}`).get();
    if (options?.simple) {
      return row && typeof row === 'object' ? Object.values(row)[0] : row;
    }
    return row;
  }

  transaction<T>(fn: (...args: any[]) => T): (...args: any[]) => T {
    return (...args: any[]) => {
      this._db.exec('BEGIN');
      try {
        const result = fn(...args);
        this._db.exec('COMMIT');
        return result;
      } catch (error) {
        this._db.exec('ROLLBACK');
        throw error;
      }
    };
  }

  close(): void {
    if (this._db.isOpen) this._db.close();
  }

  /** Возвращает размер WAL-файла в байтах. */
  getWalSizeBytes(): number {
    const walPath = this._dbPath + '-wal';
    try {
      const stats = require('fs').statSync(walPath);
      return stats.size;
    } catch {
      return 0;
    }
  }

  /** Пассивный чекпоинт WAL. Возвращает null, если WAL не включён. */
  checkpointWalPassive(): { busy: number; log: number; checkpointed: number } | null {
    try {
      const rows = this._db.prepare('PRAGMA wal_checkpoint(PASSIVE)').all();
      if (rows && rows.length > 0) {
        const row = rows[0] as { checkpointed: number; log: number; busy: number };
        return { busy: row.busy, log: row.log, checkpointed: row.checkpointed };
      }
      return null;
    } catch {
      return null;
    }
  }

  /** Лёгкое обслуживание после пакетных записей: PRAGMA optimize + wal_checkpoint(PASSIVE). Ошибки тихо проглатываются. */
  runMaintenance(): void {
    try {
      this._db.exec('PRAGMA optimize');
    } catch {
      // ignore
    }
    try {
      this._db.exec('PRAGMA wal_checkpoint(PASSIVE)');
    } catch {
      // ignore (e.g., not in WAL mode)
    }
  }
}

/**
 * Создаёт подключение к БД через `node:sqlite`.
 * Возвращает бэкенд и подключение для отчётности.
 */
export function createDatabase(dbPath: string): { db: SqliteDatabase; backend: SqliteBackend } {
  try {
    return { db: new NodeSqliteAdapter(dbPath), backend: 'node-sqlite' };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(
      'Не удалось открыть SQLite через node:sqlite.\n' +
      'Требуется Node.js 22.5+ с поддержкой node:sqlite.\n' +
      `Исходная ошибка: ${msg}`
    );
  }
}
