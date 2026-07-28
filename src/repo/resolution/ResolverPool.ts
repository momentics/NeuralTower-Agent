/**
 * ResolverPool — клиент на основном потоке для параллельного разрешения.
 *
 * resolveBatch() разбивает батч на чанки, распределяет по пулу и собирает
 * результаты в порядке чанков, чтобы порядок вставки рёбер совпадал с
 * последовательным путём. Любой сбой воркера — сбой батча, вызывающий
 * откат к последовательному пути. Выключатель: CODEGRAPH_NO_PARALLEL_RESOLVE=1.
 */

import { Worker } from 'worker_threads';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { IResolvedRef, IUnresolvedReference, IEdge } from '../ntgraph/Types';
import { memoryBudgetBytes } from './MemoryBudget';

/** Результат чанка разрешения. */
export interface ChunkResult {
  resolved: IResolvedRef[];
  unresolved: IUnresolvedReference[];
  deferredChain: IUnresolvedReference[];
  deferredThisMember: IUnresolvedReference[];
  byMethod: Record<string, number>;
}

/** Результат прохода синтеза. */
export interface SynthPassResult {
  edges: IEdge[];
  ms: number;
}

interface PoolWorker {
  worker: Worker;
  ready: Promise<void>;
  busy: number;
}

/** Минимальный размер батча для параллельного разрешения. */
const MIN_PARALLEL_BATCH = 1000;

/** Размер чанка для распределения. */
const CHUNK_SIZE = 500;

/**
 * Минимум ссылок для создания пула. Запуск пула стоит CPU, который
 * конкурирует с последовательным разрешением. Порог 150000 ссылок.
 * Переопределяется: CODEGRAPH_PARALLEL_RESOLVE_MIN=<ссылки>.
 */
export function minRefsForPool(): number {
  const raw = process.env.CODEGRAPH_PARALLEL_RESOLVE_MIN;
  if (raw !== undefined) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return 150_000;
}

export class ResolverPool {
  private workers: PoolWorker[] = [];
  private nextId = 0;
  private waiters = new Map<number, { resolve: (r: ChunkResult) => void; reject: (e: Error) => void }>();
  private synthWaiters = new Map<number, { resolve: (r: SynthPassResult) => void; reject: (e: Error) => void }>();
  private recycleWaiters = new Map<number, () => void>();
  private failed: Error | null = null;

  /**
   * Размер пула из CPU и памяти. CPU: availableParallelism - 1, максимум 6.
   * Память: оценивает стоимость воркера по размеру БД, оставляет 30% для
   * основного потока. Возвращает null, если меньше 2 воркеров.
   */
  static resolvePoolSize(opts: {
    explicit?: string;
    availableParallelism: number;
    memoryBudget: number;
    dbSizeBytes: number;
  }): number | null {
    if (opts.explicit !== undefined && opts.explicit !== '') {
      const n = Number.parseInt(opts.explicit, 10);
      if (Number.isFinite(n)) {
        if (n <= 0) return null;
        return Math.min(n, 16);
      }
    }
    const cpuCap = Math.min(opts.availableParallelism - 1, 6);
    const perWorker = Math.min(Math.max(opts.dbSizeBytes * 0.2, 256 * 1024 * 1024), 1.5 * 1024 * 1024 * 1024);
    const memCap = Math.floor((opts.memoryBudget * 0.7) / perWorker);
    const size = Math.min(cpuCap, memCap);
    return size >= 2 ? size : null;
  }

  /**
   * Создаёт пул, если скомпилированный воркер существует, выключатель
   * выключен, и машина имеет ядра и память. Возвращает null иначе.
   * CODEGRAPH_RESOLVE_WORKERS переопределяет размер (0 — отключает).
   */
  static tryCreate(dbPath: string, projectRoot: string): ResolverPool | null {
    if (process.env.CODEGRAPH_NO_PARALLEL_RESOLVE === '1') return null;
    const workerScript = path.join(__dirname, 'ResolverWorker.js');
    if (!fs.existsSync(workerScript)) return null;
    let dbSizeBytes = 0;
    try {
      dbSizeBytes = fs.statSync(dbPath).size;
    } catch {
      // Новая/отсутствующая БД — применяется минимум 256 МБ на воркер
    }
    const ap = os.availableParallelism();
    const budget = memoryBudgetBytes();
    const size = ResolverPool.resolvePoolSize({
      explicit: process.env.CODEGRAPH_RESOLVE_WORKERS,
      availableParallelism: ap,
      memoryBudget: budget,
      dbSizeBytes,
    });
    if (size === null) return null;
    try {
      return new ResolverPool(workerScript, dbPath, projectRoot, size);
    } catch {
      return null;
    }
  }

  private constructor(workerScript: string, dbPath: string, projectRoot: string, size: number) {
    for (let i = 0; i < size; i++) {
      const worker = new Worker(workerScript);
      let readyResolve!: () => void;
      let readyReject!: (e: Error) => void;
      const ready = new Promise<void>((resolve, reject) => {
        readyResolve = resolve;
        readyReject = reject;
      });
      const pw: PoolWorker = { worker, ready, busy: 0 };
      worker.on('message', (msg: { type: string; id?: number; message?: string } & Partial<ChunkResult>) => {
        if (msg.type === 'ready') {
          readyResolve();
        } else if (msg.type === 'result' && msg.id !== undefined) {
          pw.busy--;
          const waiter = this.waiters.get(msg.id);
          this.waiters.delete(msg.id);
          waiter?.resolve({
            resolved: msg.resolved!,
            unresolved: msg.unresolved!,
            deferredChain: (msg as any).deferredChain ?? [],
            deferredThisMember: (msg as any).deferredThisMember ?? [],
            byMethod: (msg as any).byMethod ?? {},
          });
        } else if (msg.type === 'synth-result' && msg.id !== undefined) {
          pw.busy--;
          const waiter = this.synthWaiters.get(msg.id);
          this.synthWaiters.delete(msg.id);
          waiter?.resolve({ edges: (msg as any).edges ?? [], ms: (msg as any).ms ?? 0 });
        } else if (msg.type === 'recycled' && msg.id !== undefined) {
          const waiter = this.recycleWaiters.get(msg.id);
          this.recycleWaiters.delete(msg.id);
          waiter?.();
        } else if (msg.type === 'error') {
          pw.busy--;
          const err = new Error(`resolver worker: ${msg.message}`);
          if (msg.id !== undefined && this.waiters.has(msg.id)) {
            const waiter = this.waiters.get(msg.id)!;
            this.waiters.delete(msg.id);
            waiter.reject(err);
          } else if (msg.id !== undefined && this.synthWaiters.has(msg.id)) {
            const waiter = this.synthWaiters.get(msg.id)!;
            this.synthWaiters.delete(msg.id);
            waiter.reject(err);
          } else {
            this.fail(err);
          }
        }
      });
      worker.on('error', (err) => {
        this.fail(err instanceof Error ? err : new Error(String(err)));
        readyReject(this.failed!);
      });
      worker.on('exit', (code) => {
        if (code !== 0) {
          this.fail(new Error(`resolver worker завершился с кодом ${code}`));
          readyReject(this.failed!);
        }
      });
      worker.postMessage({ type: 'open', dbPath, projectRoot });
      this.workers.push(pw);
    }
  }

  private fail(err: Error): void {
    if (!this.failed) this.failed = err;
    for (const [, waiter] of this.waiters) waiter.reject(this.failed);
    this.waiters.clear();
    for (const [, waiter] of this.synthWaiters) waiter.reject(this.failed);
    this.synthWaiters.clear();
    for (const [, done] of this.recycleWaiters) done();
    this.recycleWaiters.clear();
  }

  /** Стоит ли распределять этот батч. */
  static worthParallel(batchLength: number): boolean {
    return batchLength >= MIN_PARALLEL_BATCH;
  }

  /** Ожидание готовности всех воркеров. */
  async ready(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.ready));
  }

  /**
   * Разрешает ссылки через пул. Чанки сохраняют порядок; возвращаемые
   * массивы — упорядоченная конкатенация результатов чанков.
   */
  async resolveBatch(refs: IUnresolvedReference[]): Promise<ChunkResult> {
    if (this.failed) throw this.failed;
    const chunkPromises: Promise<ChunkResult>[] = [];
    for (let i = 0; i < refs.length; i += CHUNK_SIZE) {
      const chunk = refs.slice(i, i + CHUNK_SIZE);
      const id = this.nextId++;
      // Диспетчеризация наименее занятому воркеру
      const pw = this.workers.reduce((a, b) => (b.busy < a.busy ? b : a));
      pw.busy++;
      chunkPromises.push(
        new Promise<ChunkResult>((resolve, reject) => {
          this.waiters.set(id, { resolve, reject });
          pw.worker.postMessage({ type: 'resolve', id, refs: chunk });
        })
      );
    }
    const chunks = await Promise.all(chunkPromises);
    const out: ChunkResult = { resolved: [], unresolved: [], deferredChain: [], deferredThisMember: [], byMethod: {} };
    for (const c of chunks) {
      out.resolved.push(...c.resolved);
      out.unresolved.push(...c.unresolved);
      out.deferredChain.push(...c.deferredChain);
      out.deferredThisMember.push(...c.deferredThisMember);
      for (const [k, v] of Object.entries(c.byMethod)) {
        out.byMethod[k] = (out.byMethod[k] || 0) + v;
      }
    }
    return out;
  }

  /** Запускает проход синтеза на наименее занятом воркере. */
  async runSynthPass(passName: string): Promise<SynthPassResult> {
    if (this.failed) throw this.failed;
    const id = this.nextId++;
    const pw = this.workers.reduce((a, b) => (b.busy < a.busy ? b : a));
    pw.busy++;
    return new Promise<SynthPassResult>((resolve, reject) => {
      this.synthWaiters.set(id, { resolve, reject });
      pw.worker.postMessage({ type: 'synth', id, pass: passName });
    });
  }

  /** Переработка всех воркеров: закрытие и reopening БД. */
  async recycleWorkers(): Promise<void> {
    if (this.failed) throw this.failed;
    await Promise.all(
      this.workers.map(
        (pw) => new Promise<void>((resolve, reject) => {
          const id = this.nextId++;
          const t = setTimeout(() => {
            if (this.recycleWaiters.delete(id)) {
              const err = new Error('resolver worker recycle timed out');
              this.fail(err);
              reject(err);
            }
          }, 10_000);
          this.recycleWaiters.set(id, () => {
            clearTimeout(t);
            resolve();
          });
          pw.worker.postMessage({ type: 'recycle', id });
        })
      )
    );
  }

  /** Уничтожение всех воркеров. */
  async destroy(): Promise<void> {
    await Promise.all(
      this.workers.map(
        (pw) =>
          new Promise<void>((resolve) => {
            const t = setTimeout(() => {
            void pw.worker.terminate().then(() => resolve());
          }, 5000);
          pw.worker.once('exit', () => {
            clearTimeout(t);
            resolve();
          });
          pw.worker.postMessage({ type: 'close' });
        })
      )
    );
  }
}
