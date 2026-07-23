/**
 * StoreWorker — выделенный writer-поток для фазы хранения при массовой индексации.
 *
 * При полном индексе самая дорогая последовательная операция на основном потоке —
 * выполнение INSERT-пакетов на файл. Этот воркер выполняет эту работу на
 * собственном SQLite-подключении: оркестратор отправляет по одному сообщению
 * на файл (в порядке файлов), воркер применяет их в порядке поступления,
 * что сохраняет детерминизм порядка вставки rowid.
 *
 * Протокол (main → worker):
 *   {type:'open', dbPath, fastInit}  → открыть соединение, ответить {type:'ready'}
 *   {type:'bundle', bundle}          → применить bundle одного файла
 *   {type:'drain', id}               → ответить {type:'drained', id}
 *   {type:'close'}                   → закрыть БД и выйти
 * Worker → main: {type:'ready'} | {type:'drained', id} | {type:'error', message}
 *
 * Ошибка bundle не убивает воркер; первая ошибка сообщается и отображается
 * клиентом при drain().
 */

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  (require('node:module') as { enableCompileCache?: () => void }).enableCompileCache?.();
} catch { /* кэш — best-effort */ }

import { parentPort } from 'worker_threads';
import { QueryBuilder } from '../ntgraph/QueryBuilder';
import { createDatabase, SqliteDatabase } from '../ntgraph/Adapter';
import { applyMigrations, needsMigration } from '../ntgraph/Migration';
import { StoreBundle } from './StoreWriter';

if (!parentPort) {
  throw new Error('store-worker должен запуститься как worker thread');
}
const port = parentPort;

let db: SqliteDatabase | null = null;
let queries: QueryBuilder | null = null;

// CODEGRAPH_SYNTH_TIMINGS: разделение времени работы writer на две части —
// decode+finalize (материализация JS-объектов) и SQL store — выводится один раз при close.
const STORE_TIMINGS = !!process.env.CODEGRAPH_SYNTH_TIMINGS;
let decodeNs = 0n;
let storeNs = 0n;
let bundleCount = 0;

type InMessage =
  | { type: 'open'; dbPath: string; fastInit: boolean }
  | { type: 'bundle'; bundle: StoreBundle }
  | { type: 'drain'; id: number }
  | { type: 'close' };

port.on('message', (msg: InMessage) => {
  try {
    switch (msg.type) {
      case 'open': {
        const created = createDatabase(msg.dbPath);
        db = created.db;
        // Повторяет конфигурацию из NtGraphDb, с той же оптимизацией fast-init
        // для чистых сборок.
        db.pragma('busy_timeout = 5000');
        db.pragma('foreign_keys = ON');
        if (msg.fastInit) {
          db.pragma('journal_mode = MEMORY');
          db.pragma('synchronous = OFF');
        } else {
          db.pragma('synchronous = NORMAL');
        }
        db.pragma('cache_size = -64000');
        db.pragma('temp_store = MEMORY');

        // Создаём таблицу schema_versions до проверки миграций
        db.exec(`
          CREATE TABLE IF NOT EXISTS schema_versions (
            version INTEGER PRIMARY KEY,
            applied_at INTEGER NOT NULL,
            description TEXT
          )
        `);

        if (needsMigration(db)) {
          applyMigrations(db);
        }

        queries = new QueryBuilder(db);
        port.postMessage({ type: 'ready' });
        break;
      }
      case 'bundle': {
        if (!queries) throw new Error('store-worker: bundle до open');
        if (STORE_TIMINGS) {
          bundleCount++;
          const t0 = process.hrtime.bigint();
          queries.storeFileBundle(msg.bundle);
          decodeNs += process.hrtime.bigint() - t0;
          storeNs += process.hrtime.bigint() - t0;
        } else {
          queries.storeFileBundle(msg.bundle);
        }
        port.postMessage({ type: 'ack' });
        break;
      }
      case 'drain': {
        port.postMessage({ type: 'drained', id: msg.id });
        break;
      }
      case 'close': {
        if (STORE_TIMINGS && bundleCount > 0) {
          console.error(
            `[store-timing] bundles=${bundleCount} decode=${(Number(decodeNs / 1_000_000n) / 1000).toFixed(2)}s store=${(Number(storeNs / 1_000_000n) / 1000).toFixed(2)}s`
          );
        }
        try {
          db?.close();
        } catch {
          /* уже закрыто */
        }
        process.exit(0);
        break;
      }
    }
  } catch (err) {
    // Ответ об ошибке также служит ack для bundle, чтобы счётчик
    // ожидающих подтверждений у клиента всё равно уменьшился.
    port.postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    });
  }
});
