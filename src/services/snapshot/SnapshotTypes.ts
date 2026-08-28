/**
 * Типы данных и константы сервиса чекпоинтов (снапшотов) рабочей директории.
 */

export type { ISnapshotConfig } from "../../core/Config"

/**
 * Ошибка сервиса снапшотов (сбой git-операций, недоступный снимок).
 */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SnapshotError"
  }
}

/**
 * Снимок-патч: хэш дерева зеркального git-репозитория
 * и список файлов, изменённых относительно него.
 */
export interface ISnapshotPatch {
  /** Хэш дерева зеркального git-репо. */
  hash: string
  /** Абсолютные пути (с прямыми слэшами) изменённых файлов. */
  files: string[]
}

/**
 * Запись реестра: привязка снимка к запросу пользователя.
 */
export interface ISnapshotRecord {
  /** Идентификатор запроса (timestamp первого сообщения). */
  runId: string
  /** ID сессии, в которой выполнен запрос. */
  sessionId: string
  /** Хэш дерева «до запроса». */
  hash: string
  /** Список файлов, изменённых за запрос (заполняется после patch()). */
  files: string[]
  /** Время создания снимка. */
  createdAt: number
}

/**
 * Результат отката: честный отчёт — успех только если
 * ни один файл не завершился ошибкой.
 */
export interface IRevertResult {
  ok: boolean
  /** Файлы, восстановленные из снимка. */
  restored: string[]
  /** Файлы, удалённые (их не было в снимке). */
  deleted: string[]
  /** Файлы, которые не удалось восстановить. */
  failed: Array<{ file: string; error: string }>
}

/**
 * Сервис снапшотов: зеркальный git-репозиторий в глобальном
 * хранилище; главный .git проекта не затрагивается.
 */
export interface ISnapshotService {
  /** Доступны ли снапшоты (кэшированное состояние после проверки). */
  isEnabled(): boolean
  /** Снять снимок текущего состояния. null — если недоступно или ошибка. */
  track(): Promise<string | null>
  /** Список файлов, изменённых относительно снимка. */
  patch(hash: string): Promise<ISnapshotPatch>
  /** Откатить файлы, изменённые после снимка (по списку из patch). */
  revert(record: ISnapshotRecord): Promise<IRevertResult>
  /** Полное восстановление рабочего дерева к снимку. */
  restore(hash: string): Promise<void>
  /** Очистка старых объектов (gc --prune). Не чаще раза в сессию. */
  cleanup(): Promise<void>
  /** Закрыть ресурс (no-op для git, интерфейс единообразия). */
  dispose(): void
}

/**
 * Реестр снапшотов: персистентность привязки снимков к запросам
 * и очистка по retention.
 */
export interface ISnapshotStore {
  /** Сохранить запись (upsert по runId). */
  save(record: ISnapshotRecord): Promise<void>
  /** Найти запись по runId. */
  get(runId: string): Promise<ISnapshotRecord | null>
  /** Все записи сессии (по убыванию createdAt). */
  listBySession(sessionId: string): Promise<ISnapshotRecord[]>
  /** Удалить записи старше retention и обрезать реестр. */
  prune(retentionDays: number): Promise<void>
  /** Закрыть ресурс (no-op, интерфейс единообразия). */
  dispose(): void
}

// ── Таймауты git-операций ─────────────────────────────────

/** Таймаут track/add/patch. */
export const SNAPSHOT_GIT_TIMEOUT_MS = 30_000
/** Таймаут revert (пофайловые checkout). */
export const SNAPSHOT_REVERT_TIMEOUT_MS = 60_000
/** Таймаут cleanup (gc --prune). */
export const SNAPSHOT_GC_TIMEOUT_MS = 120_000
/** Лимит вывода git-команд снапшотов. */
export const SNAPSHOT_MAX_BUFFER = 4 * 1024 * 1024

// ── Лимиты ────────────────────────────────────────────────

/** Число файлов в одном батче revert. */
export const SNAPSHOT_REVERT_BATCH_SIZE = 100
/** Максимум записей в реестре. */
export const SNAPSHOT_LEDGER_MAX_RECORDS = 500

// ── Внутренние пороги ─────────────────────────────────────

/** Параллельность проверки размеров файлов. */
export const SNAPSHOT_STAT_CONCURRENCY = 8
