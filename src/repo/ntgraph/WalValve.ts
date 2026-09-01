/**
 * Регулятор WAL-чекпоинтов — ограничивает рост журнала при массовой индексации.
 *
 * Предотвращает разрастание WAL-файла до нескольких ГБ и выполняет
 * чекпоинты на отдельном потоке.
 */

import { SqliteDatabase } from './Adapter';

const DEFAULT_WAL_VALVE_MB = 256;
const HARD_CAP_MULTIPLIER = 2;
const MAX_PAUSED_BACKFILL_PASSES = 20;
const CHECK_INTERVAL_MS = 2000;

/**
 * Считывает мягкий порог регулятора из переменной окружения.
 */
export function resolveWalValveMb(envVal: string | undefined): number {
  if (envVal !== undefined && envVal !== '') {
    const n = Number(envVal);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return DEFAULT_WAL_VALVE_MB;
}

/**
 * Регулятор WAL-чекпоинтов.
 */
export class WalCheckpointValve {
  private timer: ReturnType<typeof setInterval> | null = null;
  private inflight: Promise<void> | null = null;
  private pause: Promise<void> | null = null;
  private sizeAtLastFullBackfill = 0;
  private readonly softBytes: number;
  private readonly hardBytes: number;

  constructor(
    private readonly db: SqliteDatabase,
    softMb: number = resolveWalValveMb(process.env.NTGRAPH_WAL_VALVE_MB),
    private readonly intervalMs: number = CHECK_INTERVAL_MS,
    private readonly log: (msg: string) => void = () => {}
  ) {
    this.softBytes = softMb * 1024 * 1024;
    this.hardBytes = this.softBytes * HARD_CAP_MULTIPLIER;
  }

  private mb(n: number): string {
    return `${Math.round(n / 1024 / 1024)}MB`;
  }

  /** Оценка роста WAL: байты, добавленные после последнего полного бэкфилла. */
  private growthBytes(): number {
    return this.db.getWalSizeBytes() - this.sizeAtLastFullBackfill;
  }

  /** Запуск наблюдения за WAL. Идемпотентно; таймер не удерживает цикл событий. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.check(), this.intervalMs);
    this.timer.unref?.();
  }

  /** Остановка наблюдения. Чекпоинты, уже запущенные, продолжают работу. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Один опрос: запускает пассивный чекпоинт при превышении мягкого порога. */
  check(): void {
    if (!this.pause && !this.inflight && this.growthBytes() > this.softBytes) {
      this.fire();
    }
  }

  /**
   * Обратное давление записи. Возвращает null, если рост в пределах
   * жёсткого лимита; иначе — Promise, который разрешается после полного бэкфилла.
   */
  backpressure(): Promise<void> | null {
    if (this.pause) return this.pause;
    if (this.growthBytes() <= this.hardBytes) return null;
    this.log(`обратное давление: wal=${this.mb(this.db.getWalSizeBytes())} база=${this.mb(this.sizeAtLastFullBackfill)} — приостановка записи для полного бэкфилла`);
    const t0 = Date.now();
    this.pause = this.backfillFully().finally(() => {
      this.pause = null;
      this.log(`обратное давление снято через ${Date.now() - t0}мс: wal=${this.mb(this.db.getWalSizeBytes())} база=${this.mb(this.sizeAtLastFullBackfill)}`);
    });
    return this.pause;
  }

  /** Ожидание завершения всех запущенных чекпоинтов и пауз записи. */
  async drain(): Promise<void> {
    while (this.pause || this.inflight) {
      if (this.pause) await this.pause;
      if (this.inflight) await this.inflight;
    }
  }

  /**
   * Принудительный бэкфилл WAL на границе фаз.
   * Вызывается между фазами — после парсинга, перед разрешением.
   */
  async foldNow(): Promise<void> {
    await this.drain();
    if (this.growthBytes() <= 0) return;
    this.log(`фолдинг: wal=${this.mb(this.db.getWalSizeBytes())} база=${this.mb(this.sizeAtLastFullBackfill)}`);
    this.pause = this.backfillFully().finally(() => { this.pause = null; });
    await this.pause;
  }

  /**
   * Пассивные проходы до полного бэкфилла.
   */
  private async backfillFully(): Promise<void> {
    for (let i = 0; i < MAX_PAUSED_BACKFILL_PASSES; i++) {
      if (this.inflight) await this.inflight;
      const res = this.db.checkpointWalPassive();
      if (!res) return;
      this.log(`проход бэкфилла ${i + 1}: busy=${res.busy} log=${res.log} checkpointed=${res.checkpointed} wal=${this.mb(this.db.getWalSizeBytes())}`);
      if (res.busy === 0 && res.log === res.checkpointed) {
        this.sizeAtLastFullBackfill = this.db.getWalSizeBytes();
        return;
      }
    }
    this.log(`бэкфилл не удался после ${MAX_PAUSED_BACKFILL_PASSES} проходов — WAL останется неограниченным в этом цикле`);
  }

  /** Запуск чекпоинта в фоне. */
  private fire(): void {
    const p = (async () => {
      try {
        const res = this.db.checkpointWalPassive();
        if (res && res.busy === 0 && res.log === res.checkpointed) {
          this.sizeAtLastFullBackfill = this.db.getWalSizeBytes();
        }
      } catch {
        // ошибки игнорируются
      }
    })();
    p.finally(() => {
      if (this.inflight === p) this.inflight = null;
    });
    this.inflight = p;
  }
}
