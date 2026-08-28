import * as fs from "fs/promises"
import * as path from "path"
import { Mutex } from "../../shared/Mutex"
import { createDomainLogger } from "../../core/Logger"
import { errorMessage } from "../../core/Errors"
import {
  SNAPSHOT_LEDGER_MAX_RECORDS,
  type ISnapshotRecord,
  type ISnapshotStore,
} from "./SnapshotTypes"

const log = createDomainLogger("SnapshotStore")

const DAY_MS = 86_400_000

interface ILedgerData {
  records: ISnapshotRecord[]
}

/** Проверить, что значение похоже на запись реестра. */
function isValidRecord(value: unknown): value is ISnapshotRecord {
  if (typeof value !== "object" || value === null) return false
  const r = value as Record<string, unknown>
  return (
    typeof r.runId === "string" &&
    typeof r.sessionId === "string" &&
    typeof r.kind === "string" &&
    typeof r.hash === "string" &&
    typeof r.endHash === "string" &&
    Array.isArray(r.files) &&
    typeof r.createdAt === "number"
  )
}

/**
 * Реестр чекпоинтов: привязка снимков к запросам с персистентностью
 * в ledger.json (атомарная запись: .tmp + rename) и очисткой по retention.
 *
 * Записи кэшируются в памяти; с диска реестр читается один раз.
 * Повреждённый JSON не роняет расширение: начинается с пустого реестра.
 */
export class SnapshotStore implements ISnapshotStore {
  private records: ISnapshotRecord[] = []
  private loaded = false
  private disposed = false
  private readonly mutex = new Mutex()

  constructor(
    private readonly ledgerPath: string,
    private readonly maxRecords: number = SNAPSHOT_LEDGER_MAX_RECORDS,
  ) {}

  /**
   * Сохранить запись (upsert по runId) с обрезкой до maxRecords.
   */
  async save(record: ISnapshotRecord): Promise<void> {
    if (this.disposed) return
    await this.mutex.withLock(async () => {
      await this.ensureLoaded()
      const idx = this.records.findIndex((r) => r.runId === record.runId)
      if (idx >= 0) {
        this.records[idx] = record
      } else {
        this.records.push(record)
      }
      if (this.records.length > this.maxRecords) {
        this.records.sort((a, b) => a.createdAt - b.createdAt)
        this.records = this.records.slice(-this.maxRecords)
      }
      await this.saveLocked()
    })
  }

  async get(runId: string): Promise<ISnapshotRecord | null> {
    if (this.disposed) return null
    return await this.mutex.withLock(async () => {
      await this.ensureLoaded()
      return this.records.find((r) => r.runId === runId) ?? null
    })
  }

  async listBySession(sessionId: string): Promise<ISnapshotRecord[]> {
    if (this.disposed) return []
    return await this.mutex.withLock(async () => {
      await this.ensureLoaded()
      return this.records
        .filter((r) => r.sessionId === sessionId)
        .sort((a, b) => b.createdAt - a.createdAt)
    })
  }

  /** Удалить запись по runId. */
  async delete(runId: string): Promise<void> {
    if (this.disposed) return
    await this.mutex.withLock(async () => {
      await this.ensureLoaded()
      const before = this.records.length
      this.records = this.records.filter((r) => r.runId !== runId)
      if (this.records.length !== before) await this.saveLocked()
    })
  }

  /** Удалить записи старше retentionDays. */
  async prune(retentionDays: number): Promise<void> {
    if (this.disposed) return
    await this.mutex.withLock(async () => {
      await this.ensureLoaded()
      const cutoff = Date.now() - retentionDays * DAY_MS
      const before = this.records.length
      this.records = this.records.filter((r) => r.createdAt >= cutoff)
      if (this.records.length !== before) {
        await this.saveLocked()
        log.info(`Реестр чекпоинтов: удалено ${before - this.records.length} устаревших записей`)
      }
    })
  }

  dispose(): void {
    this.disposed = true
  }

  // ── Приватные методы ────────────────────────────────────

  /** Ленивое чтение реестра с диска (один раз на экземпляр). */
  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    try {
      const raw = await fs.readFile(this.ledgerPath, "utf-8")
      const data = JSON.parse(raw) as ILedgerData
      if (data && Array.isArray(data.records)) {
        this.records = data.records.filter(isValidRecord).slice(-this.maxRecords)
      }
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== "ENOENT") {
        log.error(`Не удалось прочитать реестр чекпоинтов, начинаем с пустого: ${errorMessage(err)}`)
      }
      this.records = []
    }
  }

  /**
   * Атомарная запись: write в .tmp + rename.
   * Вызывается только из методов, владеющих mutex.
   */
  private async saveLocked(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.ledgerPath), { recursive: true })
      const tmp = `${this.ledgerPath}.tmp`
      await fs.writeFile(tmp, JSON.stringify({ records: this.records }, null, 2), "utf-8")
      try {
        await fs.unlink(this.ledgerPath)
      } catch {
        // Файла ещё нет — rename создаст его
      }
      await fs.rename(tmp, this.ledgerPath)
    } catch (err: unknown) {
      log.error(`Не удалось сохранить реестр чекпоинтов: ${errorMessage(err)}`)
    }
  }
}
