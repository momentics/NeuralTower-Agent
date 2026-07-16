/**
 * Пул воркеров для парсинга.
 *
 * Запускает парсинг tree-sitter на N воркер-потоках, чтобы использовать
 * все ядра процессора вместо одного.
 */

import { Worker } from 'worker_threads';
import { Language, IExtractionResult } from '../ntgraph/Types';

export interface ParsePoolWorker {
  postMessage(msg: unknown): void;
  terminate(): Promise<number> | void;
  on(event: 'message', cb: (m: unknown) => void): void;
  on(event: 'error', cb: (e: Error) => void): void;
  on(event: 'exit', cb: (code: number) => void): void;
}

export interface ParseTask {
  filePath: string;
  content: string;
  language: Language;
  frameworkNames?: string[];
}

interface ParseWorkerPoolOptions {
  languages: string[];
  size: number;
  workerScriptPath: string;
  recycleInterval?: number;
  parseTimeoutMs?: number;
  createWorker?: (script: string, langs: string[]) => ParsePoolWorker;
  log?: (msg: string) => void;
}

interface ParseJob {
  task: ParseTask;
  resolve: (result: IExtractionResult) => void;
  reject: (err: Error) => void;
}

interface ParseWorkerMessage {
  type: 'grammars-loaded' | 'parse-result' | 'parse-error';
  id?: number;
  result?: IExtractionResult;
  error?: string;
}

const DEFAULT_PARSE_POOL_CAP = 8;
const MAX_PARSE_POOL_SIZE = 16;
const DEFAULT_RECYCLE_INTERVAL = 250;
const DEFAULT_PARSE_TIMEOUT_MS = 10_000;
const CRASH_BUDGET = 100;

export function resolveParsePoolSize(envVal: string | undefined, cpuCount: number): number {
  if (envVal !== undefined && envVal !== '') {
    const n = Number(envVal);
    if (Number.isFinite(n) && n > 0) return Math.min(MAX_PARSE_POOL_SIZE, Math.max(1, Math.floor(n)));
    if (n === 0) return 1;
  }
  return Math.min(DEFAULT_PARSE_POOL_CAP, Math.max(1, cpuCount - 1));
}

export function resolveParseTimeoutMs(envVal: string | undefined): number {
  if (envVal !== undefined && envVal !== '') {
    const n = Number(envVal);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return DEFAULT_PARSE_TIMEOUT_MS;
}

export class ParseWorkerPool {
  private readonly languages: string[];
  private readonly size: number;
  private readonly workerScriptPath: string;
  private readonly recycleInterval: number;
  private readonly parseTimeoutMs: number;
  private readonly createWorker: (script: string, langs: string[]) => ParsePoolWorker;
  private readonly log: (msg: string) => void;

  private idleWorkers: ParsePoolWorker[] = [];
  private busyWorkers = new Map<ParsePoolWorker, ParseJob>();
  private queue: ParseJob[] = [];
  private totalCrashes = 0;
  private spawnCount = 0;
  private destroyed = false;
  private nextJobId = 0;

  constructor(opts: ParseWorkerPoolOptions) {
    this.languages = opts.languages;
    this.size = Math.min(MAX_PARSE_POOL_SIZE, Math.max(1, opts.size));
    this.workerScriptPath = opts.workerScriptPath;
    this.recycleInterval = opts.recycleInterval ?? DEFAULT_RECYCLE_INTERVAL;
    this.parseTimeoutMs = opts.parseTimeoutMs ?? DEFAULT_PARSE_TIMEOUT_MS;
    this.createWorker = opts.createWorker ?? this.defaultCreateWorker;
    this.log = opts.log ?? (() => {});
  }

  private defaultCreateWorker(script: string, langs: string[]): ParsePoolWorker {
    const w = new Worker(script, {
      workerData: { languages: langs },
      stdout: true,
      stderr: true,
    });
    return {
      postMessage: (msg: unknown) => w.postMessage(msg),
      terminate: () => w.terminate(),
      on: ((event: 'message' | 'error' | 'exit', cb: (m: unknown) => void) => {
        if (event === 'message') w.on('message', cb);
        else if (event === 'error') w.on('error', cb as (e: Error) => void);
        else w.on('exit', cb as (code: number) => void);
      }) as ParsePoolWorker['on'],
    };
  }

  get healthy(): boolean {
    return this.totalCrashes < CRASH_BUDGET;
  }

  get liveWorkers(): number {
    return this.idleWorkers.length + this.busyWorkers.size;
  }

  get sizeActual(): number {
    return this.size;
  }

  /** Отправка задачи на парсинг. */
  requestParse(task: ParseTask): Promise<IExtractionResult> {
    if (this.destroyed) {
      return Promise.reject(new Error('Пул уничтожен'));
    }

    return new Promise<IExtractionResult>((resolve, reject) => {
      const job: ParseJob = { task, resolve, reject };
      this.queue.push(job);
      this.drain();
    });
  }

  /** Создание одного воркера. */
  private spawnOne(): void {
    if (this.spawnCount >= 2) return;
    if (this.liveWorkers >= this.size) return;

    this.spawnCount++;
    const w = this.createWorker(this.workerScriptPath, this.languages);
    let parseCount = 0;

    w.on('message', (m: unknown) => {
      const msg = m as ParseWorkerMessage;
      if (msg.type === 'grammars-loaded') {
        this.idleWorkers.push(w);
        this.spawnCount = Math.max(0, this.spawnCount - 1);
        this.drain();
      } else if (msg.type === 'parse-result' || msg.type === 'parse-error' || msg.type === 'error') {
        const job = this.busyWorkers.get(w);
        if (job) {
          this.busyWorkers.delete(w);
          parseCount++;

          if (msg.type === 'parse-result' && msg.result) {
            job.resolve(msg.result);
          } else {
            const err = new Error((msg.error ?? (msg as any).message) ?? 'Ошибка парсинга в воркере');
            job.reject(err);
          }

          if (parseCount >= this.recycleInterval) {
            this.recycle(w);
          } else {
            this.idleWorkers.push(w);
            this.drain();
          }
        }
      }
    });

    w.on('error', (e: Error) => {
      this.onWorkerGone(w, `Ошибка воркера: ${e.message}`);
    });

    w.on('exit', (code: number) => {
      if (code !== 0) {
        this.onWorkerGone(w, `Воркер завершился с кодом ${code}`);
      }
    });

    w.postMessage({ type: 'load-grammars', languages: this.languages });
  }

  /** Обработка ухода воркера. */
  private onWorkerGone(w: ParsePoolWorker, message: string): void {
    const job = this.busyWorkers.get(w);
    if (job) {
      this.busyWorkers.delete(w);
      job.reject(new Error(message));
    }

    const idleIdx = this.idleWorkers.indexOf(w);
    if (idleIdx !== -1) this.idleWorkers.splice(idleIdx, 1);

    this.totalCrashes++;
    this.log(`Воркер потерян: ${message} (всего крашей: ${this.totalCrashes})`);

    if (this.totalCrashes >= CRASH_BUDGET) {
      this.log(`Бюджет крашей исчерпан (${CRASH_BUDGET}). Пул больше не возрождает воркеры.`);
      return;
    }

    this.spawnOne();
  }

  /** Пересоздание воркера. */
  private recycle(w: ParsePoolWorker): void {
    try {
      w.terminate();
    } catch {
      // Игнорируем
    }
    this.spawnOne();
  }

  /** Отправка задачи воркеру. */
  private dispatch(w: ParsePoolWorker, job: ParseJob): void {
    const jobId = this.nextJobId++;
    this.busyWorkers.set(w, job);

    const timeoutMs = this.parseTimeoutMs + Math.floor(job.task.content.length / 100_000) * 10_000;

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const j = this.busyWorkers.get(w);
      if (j === job) {
        this.busyWorkers.delete(w);
        job.reject(new Error(`Таймаут парсинга (${timeoutMs}ms)`));
        this.recycle(w);
      }
    }, timeoutMs);

    const safeResolve = (result: IExtractionResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      job.resolve(result);
    };
    const safeReject = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      job.reject(err);
    };

    w.postMessage({
      type: 'parse',
      id: jobId,
      filePath: job.task.filePath,
      content: job.task.content,
      language: job.task.language,
      frameworkNames: job.task.frameworkNames,
    });

    // Замена колбэков задачи на безопасные версии для обработчика сообщений
    job.resolve = safeResolve;
    job.reject = safeReject;
  }

  /** Распределение задач из очереди по idle воркерам. */
  private drain(): void {
    while (this.queue.length > 0 && this.idleWorkers.length > 0) {
      const job = this.queue.shift()!;
      const w = this.idleWorkers.pop()!;
      this.dispatch(w, job);
    }

    // Ленивый спавн
    while (this.queue.length > 0 && this.liveWorkers < this.size) {
      this.spawnOne();
    }
  }

  /** Пересоздание всех idle воркеров. */
  recycleAll(): void {
    for (const w of this.idleWorkers) {
      this.recycle(w);
    }
  }

  /** Уничтожение всех воркеров. */
  async destroy(): Promise<void> {
    this.destroyed = true;
    for (const w of this.idleWorkers) {
      try { w.terminate(); } catch { /* ignore */ }
    }
    for (const w of this.busyWorkers.keys()) {
      try { w.terminate(); } catch { /* ignore */ }
    }
    this.idleWorkers = [];
    this.busyWorkers.clear();
  }
}
