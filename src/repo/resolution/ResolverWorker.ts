/**
 * ResolverWorker — воркер пула параллельного разрешения.
 *
 * Открывает БД проекта в режиме TOЛЬКО ДЛЯ ЧТЕНИЯ на собственном подключении
 * и размещает полный ReferenceResolver. Основной поток разбивает каждый батч
 * на упорядоченные чанки, распределяет их по пулу и ПРИНИМАЕТ результаты
 * последовательно в порядке чанков — порядок вставки рёбер идентичен
 * однопоточному циклу. Воркеры только читают; все записи остаются на основном потоке.
 */

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  (require('node:module') as { enableCompileCache?: () => void }).enableCompileCache?.();
} catch { /* кэш — попытка без гарантий */ }

import { parentPort } from 'worker_threads';
import { createDatabase, SqliteDatabase } from '../ntgraph/Adapter';
import { QueryBuilder } from '../ntgraph/QueryBuilder';
import { ReferenceResolver } from './Resolver';
import type { IUnresolvedReference } from '../ntgraph/Types';

if (!parentPort) {
  throw new Error('resolver-worker должен запуститься как worker thread');
}
const port = parentPort;

let db: SqliteDatabase | null = null;
let queries: QueryBuilder | null = null;
let resolver: ReferenceResolver | null = null;

type InMessage =
  | { type: 'open'; dbPath: string; projectRoot: string }
  | { type: 'resolve'; id: number; refs: IUnresolvedReference[] }
  | { type: 'synth'; id: number; pass: string }
  | { type: 'recycle'; id: number }
  | { type: 'close' };

let dbPath: string | null = null;
let projectRoot: string | null = null;

port.on('message', (msg: InMessage) => {
  try {
    switch (msg.type) {
      case 'open': {
        dbPath = msg.dbPath;
        projectRoot = msg.projectRoot;
        const created = createDatabase(msg.dbPath);
        db = created.db;
        db.pragma('busy_timeout = 5000');
        db.pragma('cache_size = -32000');
        queries = new QueryBuilder(db);
        resolver = new ReferenceResolver(msg.projectRoot, queries);
        resolver.initialize();
        port.postMessage({ type: 'ready' });
        break;
      }
      case 'resolve': {
        if (!resolver) throw new Error('resolver-worker: разрешение до open');
        const out = resolver.resolveAll(msg.refs);
        port.postMessage({
          type: 'result',
          id: msg.id,
          resolved: out.resolved,
          unresolved: out.unresolved,
          deferredChain: [],
          deferredThisMember: [],
          byMethod: {},
        });
        break;
      }
      case 'synth': {
        if (!resolver) throw new Error('resolver-worker: синтез до open');
        const synthStart = Date.now();
        const synthEdges: any[] = [];
        port.postMessage({ type: 'synth-result', id: msg.id, edges: synthEdges, ms: Date.now() - synthStart });
        break;
      }
      case 'recycle': {
        if (!db || !dbPath || !projectRoot) throw new Error('resolver-worker: переработка до open');
        try {
          db.close();
        } catch {
          /* уже закрыто */
        }
        const recreated = createDatabase(dbPath);
        db = recreated.db;
        db.pragma('busy_timeout = 5000');
        db.pragma('cache_size = -32000');
        if (queries) {
          queries.rebind(db);
        }
        resolver = new ReferenceResolver(projectRoot, queries!);
        resolver.initialize();
        port.postMessage({ type: 'recycled', id: msg.id });
        break;
      }
      case 'close': {
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
    port.postMessage({
      type: 'error',
      id: (msg as { id?: number }).id,
      message: err instanceof Error ? err.message : String(err),
    });
  }
});
