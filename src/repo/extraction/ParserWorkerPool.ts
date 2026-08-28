/**
 * Пул воркеров для парсинга.
 *
 * Запускает парсинг tree-sitter на N воркер-потоках, чтобы использовать
 * все ядра процессора вместо одного.
 */

import { Worker } from 'worker_threads';
import * as fs from 'fs';
import * as path from 'path';
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
  languages: Language[];
  size: number;
  workerScriptPath?: string;
  recycleInterval?: number;
  parseTimeoutMs?: number;
  createWorker?: () => ParsePoolWorker;
  log?: (msg: string) => void;
  /** execArgv для воркеров (V8-флаги). */
  workerExecArgv?: readonly string[];
}

interface ParseJob {
  id: number;
  task: ParseTask;
  resolve: (r: IExtractionResult) => void;
  reject: (e: Error) => void;
  settled: boolean;
  timer?: ReturnType<typeof setTimeout>;
  /** Полный лимит для парсинга (базовый таймаут + масштабирование по размеру). */
  budgetMs?: number;
  /** Базовый таймер сработал без результата — принимаем поздний результат, убиваем по backstop. */
  timerExpired?: boolean;
  hardKillTimer?: ReturnType<typeof setTimeout>;
}

interface ParseWorkerMessage {
  type?: string;
  id?: number;
  result?: IExtractionResult;
  /** Время парсинга на стороне воркера — его собственные часы, не зависящие от задержек основного потока. */
  parseMs?: number;
}

const DEFAULT_PARSE_POOL_CAP = 8;
const MAX_PARSE_POOL_SIZE = 16;
const DEFAULT_RECYCLE_INTERVAL = 250;
const DEFAULT_PARSE_TIMEOUT_MS = 10_000;
/** Множитель для жёсткого убийства воркера после базового таймаута. */
const HARD_KILL_MULTIPLIER = 3;
/**
 * Максимум воркеров, запускаемых одновременно. Холодный старт воркера тяжёлый
 * (загрузка модуля + компиляция WASM-грамматик); одновременный запуск всего
 * пула перегружает процессор.
 */
const MAX_CONCURRENT_SPAWN = 2;
const CRASH_BUDGET = 100;

export function resolveParsePoolSize(envVal: string | undefined, cpuCount: number): number {
  if (envVal !== undefined && envVal !== '') {
    const n = Number(envVal);
    if (Number.isFinite(n) && n >= 0) {
      return Math.max(0, Math.min(Math.floor(n), MAX_PARSE_POOL_SIZE));
    }
  }
  return Math.max(1, Math.min(cpuCount - 1, DEFAULT_PARSE_POOL_CAP));
}

export function resolveParseTimeoutMs(envVal: string | undefined): number {
  if (envVal !== undefined && envVal !== '') {
    const n = Number(envVal);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return DEFAULT_PARSE_TIMEOUT_MS;
}

export class ParseWorkerPool {
  private idle: ParsePoolWorker[] = [];
  private queue: ParseJob[] = [];
  private inflight = new Map<ParsePoolWorker, ParseJob>();
  private workers = new Set<ParsePoolWorker>();
  // Запущены, но ещё не сообщили 'grammars-loaded'.
  private pending = new Set<ParsePoolWorker>();
  private parseCounts = new Map<ParsePoolWorker, number>();
  private nextId = 1;
  private totalCrashes = 0;
  private destroyed = false;

  private readonly languages: Language[];
  private readonly maxSize: number;
  private readonly recycleInterval: number;
  private readonly parseTimeoutMs: number;
  private readonly createWorker: () => ParsePoolWorker;
  private readonly log: (msg: string) => void;

  constructor(opts: ParseWorkerPoolOptions) {
    this.languages = opts.languages;
    this.maxSize = Math.max(1, Math.min(opts.size, MAX_PARSE_POOL_SIZE));
    this.recycleInterval = opts.recycleInterval ?? DEFAULT_RECYCLE_INTERVAL;
    this.parseTimeoutMs = opts.parseTimeoutMs ?? DEFAULT_PARSE_TIMEOUT_MS;
    this.log = opts.log ?? (() => {});
    if (opts.createWorker) {
      this.createWorker = opts.createWorker;
    } else if (opts.workerScriptPath) {
      const scriptPath = opts.workerScriptPath;
      // Node валидирует ЯВНО переданный execArgv воркера по
      // process.allowedNodeEnvironmentFlags и отклоняет V8-флаги (например
      // --liftoff-only); наследуемый execArgv проверке не подвергается.
      // Поэтому являем только допустимые флаги, а если их нет — не передаём
      // execArgv вовсе: воркер унаследует флаги родителя (в тестовых форках
      // vitest это --liftoff-only; в extension host V8-флагов нет, а воркер
      // грузит только грамматики проекта — стабильно, см. §1.3).
      const execArgv = (opts.workerExecArgv ?? []).filter(
        (f) => process.allowedNodeEnvironmentFlags.has(f),
      );
      this.createWorker = () =>
        execArgv.length > 0
          ? new Worker(scriptPath, { execArgv })
          : new Worker(scriptPath);
    } else {
      throw new Error('ParseWorkerPool требует workerScriptPath или createWorker');
    }
    this.spawnOne();
  }

  /**
   * Запускает весь пул заранее. По умолчанию рост идёт по требованию, но
   * массовая индексация ЗНАЕТ, что понадобятся все ядра — последовательный
   * рост иначе съедает большую часть фазы парсинга.
   */
  prewarm(): void {
    while (this.workers.size < this.maxSize) {
      const before = this.workers.size;
      this.spawnOne();
      if (this.workers.size === before) break;
    }
  }

  get size(): number {
    return this.maxSize;
  }

  get liveWorkers(): number {
    return this.workers.size;
  }

  /** Ложь, если исчерпан бюджет крашей или пул уничтожен. */
  get healthy(): boolean {
    return !this.destroyed && this.totalCrashes < CRASH_BUDGET;
  }

  /** Отправка задачи на парсинг. */
  requestParse(task: ParseTask): Promise<IExtractionResult> {
    if (this.destroyed) return Promise.reject(new Error('Пул уничтожен'));
    return new Promise<IExtractionResult>((resolve, reject) => {
      this.queue.push({ id: this.nextId++, task, resolve, reject, settled: false });
      this.drain();
    });
  }

  /** Создание одного воркера. */
  private spawnOne(): void {
    if (this.destroyed || this.workers.size >= this.maxSize || !this.healthy) return;
    let w: ParsePoolWorker;
    try {
      w = this.createWorker();
    } catch {
      this.totalCrashes++;
      return;
    }
    this.workers.add(w);
    this.pending.add(w);
    this.parseCounts.set(w, 0);

    w.on('message', (m: unknown) => this.onMessage(w, (m ?? {}) as ParseWorkerMessage));

    w.on('error', (e: Error) => this.onWorkerGone(w, `Ошибка воркера: ${e?.message ?? 'неизвестно'}`));

    w.on('exit', (code: number) => {
      if (code !== 0) this.onWorkerGone(w, `Воркер завершился с кодом ${code}`);
    });

    // Загрузка грамматик; воркер отвечает 'grammars-loaded', после чего становится idle.
    // Грамматики воркер читает с диска сам (WasmRuntime.resolveWasmDir).
    w.postMessage({ type: 'load-grammars', languages: this.languages });
  }

  private onMessage(w: ParsePoolWorker, m: ParseWorkerMessage): void {
    if (m.type === 'grammars-loaded') {
      if (!this.workers.has(w)) return;
      this.pending.delete(w);
      this.idle.push(w);
      this.drain();
      return;
    }
    if (m.type === 'parse-result') {
      const job = this.inflight.get(w);
      if (!job || (m.id !== undefined && m.id !== job.id)) return;
      this.inflight.delete(w);
      if (job.timerExpired) {
        const parseMs = typeof m.parseMs === 'number' ? Math.round(m.parseMs) : undefined;
        const detail = parseMs === undefined
          ? ''
          : parseMs < (job.budgetMs ?? this.parseTimeoutMs)
            ? ` (парсинг занял ${parseMs}ms в воркере — основной поток был заблокирован, а не парсинг)`
            : ` (парсинг действительно занял ${parseMs}ms)`;
        this.log(`Поздний результат парсинга принят: ${job.task.filePath}${detail}`);
      }
      if ((this.parseCounts.get(w) ?? 0) >= this.recycleInterval) {
        this.recycle(w);
      } else {
        this.idle.push(w);
      }
      this.settle(job, m.result);
      this.drain();
    }
  }

  /** Воркер погиб (краш / OOM / ошибка запуска). Отклоняем парсинг и возрождаем. */
  private onWorkerGone(w: ParsePoolWorker, message: string): void {
    if (!this.workers.has(w)) return;
    this.removeWorker(w);
    this.totalCrashes++;
    const job = this.inflight.get(w);
    this.inflight.delete(w);
    try { void w.terminate(); } catch { /* уже ушёл */ }
    if (job) this.settle(job, undefined, new Error(message));
    if (this.healthy) this.spawnOne();
    this.drain();
  }

  /** Пересоздание воркера, достигшего порога переработки. Не краш — не учитывается в бюджете. */
  private recycle(w: ParsePoolWorker): void {
    this.log(`Пересоздание воркера после ${this.parseCounts.get(w)} парсингов (heap: ${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB RSS)`);
    this.removeWorker(w);
    try { void w.terminate(); } catch { /* уже ушёл */ }
    if (this.healthy && !this.destroyed) this.spawnOne();
  }

  private removeWorker(w: ParsePoolWorker): void {
    this.workers.delete(w);
    this.pending.delete(w);
    this.parseCounts.delete(w);
    this.idle = this.idle.filter((x) => x !== w);
  }

  /** Отправка задачи воркеру. */
  private dispatch(w: ParsePoolWorker, job: ParseJob): void {
    this.inflight.set(w, job);
    this.parseCounts.set(w, (this.parseCounts.get(w) ?? 0) + 1);
    // Масштабирование таймаута для крупных файлов: база + 10с на 100КБ.
    const timeoutMs = this.parseTimeoutMs + Math.floor(job.task.content.length / 100_000) * 10_000;
    job.budgetMs = timeoutMs;
    job.timer = setTimeout(() => this.onTimeout(w, job, timeoutMs), timeoutMs);
    job.timer.unref?.();
    w.postMessage({
      type: 'parse',
      id: job.id,
      filePath: job.task.filePath,
      content: job.task.content,
      frameworkNames: job.task.frameworkNames,
      language: job.task.language,
    });
  }

  /**
   * Базовый таймер сработал без результата. НЕ убиваем и НЕ завершаем:
   * срабатывание таймера не доказывает, что парсинг ещё идёт — после долгой
   * синхронной работы основного потока Node обслуживает фазу таймеров до
   * фазы опроса, так что уже доставленный parse-result всё ещё в очереди.
   * Помечаем задачу поздней (onMessage примет результат) и включаем
   * backstop для действительно зависших воркеров.
   */
  private onTimeout(w: ParsePoolWorker, job: ParseJob, ms: number): void {
    if (job.settled || !this.workers.has(w)) return;
    const graceMs = ms * (HARD_KILL_MULTIPLIER - 1);
    this.log(`ТАЙМАУТ: ${job.task.filePath} превысил ${ms}мс без результата — ожидаем до ${graceMs}мс ещё для позднего результата перед убийством воркера`);
    job.timerExpired = true;
    job.hardKillTimer = setTimeout(() => this.onHardTimeout(w, job, ms * HARD_KILL_MULTIPLIER), graceMs);
    job.hardKillTimer.unref?.();
  }

  /** Нет результата после полного окна жёсткого убийства — воркер действительно завис. */
  private onHardTimeout(w: ParsePoolWorker, job: ParseJob, totalMs: number): void {
    if (job.settled || !this.workers.has(w)) return;
    this.log(`ТАЙМАУТ: ${job.task.filePath} не получил результат после ${totalMs}мс — убиваем воркер`);
    this.removeWorker(w);
    this.inflight.delete(w);
    try { void w.terminate(); } catch { /* уже ушёл */ }
    this.settle(job, undefined, new Error(`Парсинг превысил таймаут после ${totalMs}мс`));
    if (this.healthy) this.spawnOne();
    this.drain();
  }

  /** Распределение задач из очереди по idle воркерам. */
  private drain(): void {
    // Рост до maxSize, пока очередь превышает доступные воркеры — с ограничением
    // на одновременный холодный старт.
    while (
      this.queue.length > this.idle.length + this.pending.size &&
      this.workers.size < this.maxSize &&
      this.pending.size < MAX_CONCURRENT_SPAWN &&
      !this.destroyed &&
      this.healthy
    ) {
      this.spawnOne();
    }
    // Диспетчеризация задач из очереди на idle воркеры.
    while (this.idle.length && this.queue.length) {
      let job: ParseJob | undefined;
      while (this.queue.length && (job = this.queue.shift()) && job.settled) job = undefined;
      if (!job || job.settled) break;
      const w = this.idle.pop()!;
      this.dispatch(w, job);
    }
    // Защита от зависания: если есть очередь, но некому выполнять (нет idle,
    // нет запускающихся, нет живых), завершаем с ошибкой вместо вечного ожидания.
    if (this.queue.length && this.idle.length === 0 && this.pending.size === 0 && this.workers.size === 0) {
      const reason = this.destroyed ? 'пул парсинга уничтожен' : 'пул парсинга исчерпал бюджет крашей воркеров';
      for (const job of this.queue.splice(0)) this.settle(job, undefined, new Error(reason));
    }
  }

  private settle(job: ParseJob, result?: IExtractionResult, err?: Error): void {
    if (job.settled) return;
    job.settled = true;
    if (job.timer) clearTimeout(job.timer);
    if (job.hardKillTimer) clearTimeout(job.hardKillTimer);
    if (err) job.reject(err);
    else job.resolve(result!);
  }

  /** Пересоздание всех idle воркеров. */
  recycleAll(): void {
    for (const w of [...this.idle]) this.recycle(w);
  }

  /** Уничтожение всех воркеров. */
  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    const ws = [...this.workers];
    this.workers.clear();
    this.pending.clear();
    this.parseCounts.clear();
    this.idle = [];
    for (const job of [...this.inflight.values(), ...this.queue]) {
      this.settle(job, undefined, new Error('пул парсинга уничтожен'));
    }
    this.inflight.clear();
    this.queue = [];
    await Promise.all(ws.map((w) => Promise.resolve(w.terminate()).catch(() => { /* уже ушёл */ })));
  }
}

/**
 * Путь к бандлу воркера парсинга (out/ParserWorker.js) или null,
 * если бандл не собран (dev/тесты без build:worker).
 */
export function resolveParseWorkerPath(): string | null {
  // Бандл (CJS): __dirname = out/. Dev (vitest): каталог исходников —
  // поэтому dev-кандидат ведёт от корня репо (тесты запускаются из корня).
  const here = typeof __dirname !== 'undefined' ? __dirname : process.cwd();
  const candidates = [
    path.join(here, 'ParserWorker.js'), // бандл: out/
    path.join(process.cwd(), 'out', 'ParserWorker.js'), // dev: корень/out
  ];
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isFile()) return c;
    } catch {
      // кандидата нет — пробуем следующий
    }
  }
  return null;
}

/**
 * V8-флаги воркеров парсинга: --liftoff-only исключает OOM/краш
 * турбосhaft-компиляции больших WASM-грамматик (см. план_wasm.md §1.3).
 */
export const WASM_WORKER_EXEC_ARGV: readonly string[] = ['--liftoff-only'];
