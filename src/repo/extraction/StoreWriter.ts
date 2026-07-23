/**
 * StoreWriter — клиент на основном потоке для store-worker.
 *
 * Используется ТОЛЬКО на пути массовой индексации с чистой БД:
 * bundle отправляются в порядке файлов, воркер применяет их в порядке
 * поступления, поэтому назначение rowid (и, следовательно, разрешение
 * неоднозначностей по порядку вставки) идентично хранению на основном
 * потоке. Аварийное отключение: CODEGRAPH_NO_STORE_WORKER=1.
 */

import { Worker } from 'worker_threads';
import {
  INode,
  IEdge,
  IUnresolvedReference,
  IFileRecord,
} from '../ntgraph/Types';

/** Полный payload хранения одного файла (предварительно отфильтрованный — см. storeFileBundle). */
export interface StoreBundle {
  nodes: INode[];
  edges: IEdge[];
  refs: IUnresolvedReference[];
  file: IFileRecord;
}

/**
 * Валидация/денормализация каждого bundle перед storeFileBundle —
 * общая для object-пути оркестратора и пути воркера, чтобы они
 * не могли расходиться:
 *   - узлы без обязательных полей identity отбрасываются,
 *   - рёбра должны соединять вставленные узлы (FK-целостность),
 *   - ссылки должны исходить из вставленных узлов и содержать
 *     денормализованные filePath/language, которые читает резолвер.
 */
export function finalizeStoreBundle(
  result: { nodes: INode[]; edges: IEdge[]; unresolvedReferences: IUnresolvedReference[] },
  filePath: string,
  language: string,
  file: IFileRecord
): StoreBundle {
  const validNodes = result.nodes.filter(
    (n) => n.id && n.kind && n.name && n.filePath && n.language
  );
  const insertedIds = new Set(validNodes.map((n) => n.id));
  const validEdges = result.edges.filter(
    (e) => insertedIds.has(e.source) && insertedIds.has(e.target)
  );
  const validRefs = result.unresolvedReferences
    .filter((ref) => insertedIds.has(ref.fromNodeId))
    .map((ref) => ({
      ...ref,
      filePath: ref.filePath ?? filePath,
      language: ref.language ?? (language as any),
    }));
  return { nodes: validNodes, edges: validEdges, refs: validRefs, file };
}

export class StoreWriter {
  private worker: Worker;
  private readyPromise: Promise<void>;
  private firstError: Error | null = null;
  private drainWaiters = new Map<number, { resolve: () => void; reject: (e: Error) => void }>();
  private nextDrainId = 0;
  private exited = false;
  /** Bundle отправлены, но ещё не подтверждены — сигнал backpressure глубины очереди. */
  private outstanding = 0;
  private belowWaiters: Array<{ limit: number; resolve: () => void }> = [];

  constructor(workerScriptPath: string, dbPath: string, fastInit: boolean) {
    this.worker = new Worker(workerScriptPath);
    let readyResolve!: () => void;
    let readyReject!: (e: Error) => void;
    this.readyPromise = new Promise<void>((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });

    this.worker.on('message', (msg: { type: string; id?: number; message?: string }) => {
      if (msg.type === 'ready') {
        readyResolve();
      } else if (msg.type === 'ack') {
        this.settleOne();
      } else if (msg.type === 'drained' && msg.id !== undefined) {
        const waiter = this.drainWaiters.get(msg.id);
        this.drainWaiters.delete(msg.id);
        if (!waiter) return;
        if (this.firstError) waiter.reject(this.firstError);
        else waiter.resolve();
      } else if (msg.type === 'error') {
        if (!this.firstError) this.firstError = new Error(`store worker: ${msg.message}`);
        this.settleOne();
      }
    });
    this.worker.on('error', (err) => {
      this.failAll(err instanceof Error ? err : new Error(String(err)));
      readyReject(this.firstError!);
    });
    this.worker.on('exit', (code) => {
      this.exited = true;
      if (code !== 0) {
        this.failAll(new Error(`store worker завершился с кодом ${code}`));
        readyReject(this.firstError!);
      } else if (this.drainWaiters.size > 0 || this.belowWaiters.length > 0) {
        // Чистый выход с ожидающими waiters — нарушение протокола
        // (только close() должен завершить воркер) — settle вместо повисания.
        this.failAll(new Error('store worker завершился до завершения drain'));
      }
    });

    this.worker.postMessage({ type: 'open', dbPath, fastInit });
    // Воркер удерживает event loop открытым до close(); не делать unref —
    // bundle не должны теряться из-за того, что основной поток закончил работу.
  }

  private failAll(err: Error): void {
    if (!this.firstError) this.firstError = err;
    for (const [, waiter] of this.drainWaiters) waiter.reject(this.firstError);
    this.drainWaiters.clear();
    this.outstanding = 0;
    const waiters = this.belowWaiters;
    this.belowWaiters = [];
    for (const w of waiters) w.resolve();
  }

  private settleOne(): void {
    if (this.outstanding > 0) this.outstanding--;
    if (this.belowWaiters.length === 0) return;
    const still: typeof this.belowWaiters = [];
    for (const w of this.belowWaiters) {
      if (this.outstanding < w.limit) w.resolve();
      else still.push(w);
    }
    this.belowWaiters = still;
  }

  /** Ожидает готовности воркера. */
  ready(): Promise<void> {
    return this.readyPromise;
  }

  /** Отправляет bundle одного файла. Бросает исключение, если writer уже сломался. */
  send(bundle: StoreBundle): void {
    if (this.firstError) throw this.firstError;
    if (this.exited) throw new Error('store worker уже завершился');
    this.outstanding++;
    this.worker.postMessage({ type: 'bundle', bundle });
  }

  /** Backpressure: разрешается, когда un-acked bundle меньше `limit`. */
  waitBelow(limit: number): Promise<void> {
    if (this.firstError || this.exited || this.outstanding < limit) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.belowWaiters.push({ limit, resolve });
    });
  }

  /** Разрешается, когда все bundle, отправленные до этого вызова, применены. */
  drain(): Promise<void> {
    if (this.firstError) return Promise.reject(this.firstError);
    if (this.exited) return Promise.reject(new Error('store worker уже завершился'));
    const id = this.nextDrainId++;
    const p = new Promise<void>((resolve, reject) => {
      this.drainWaiters.set(id, { resolve, reject });
    });
    this.worker.postMessage({ type: 'drain', id });
    return p;
  }

  /** Закрывает соединение воркера с БД и завершает поток. */
  async close(): Promise<void> {
    if (this.exited) return;
    this.worker.postMessage({ type: 'close' });
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        void this.worker.terminate().then(() => resolve());
      }, 5000);
      this.worker.once('exit', () => {
        clearTimeout(t);
        resolve();
      });
    });
  }
}
