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
 * Снимок-патч: деревья «до» и «после» запроса в зеркальном
 * git-репозитории и список файлов, изменённых между ними.
 */
export interface ISnapshotPatch {
  /** Хэш дерева «до запроса». */
  hash: string
  /** Хэш дерева «после запроса». */
  endHash: string
  /** Абсолютные пути файлов, изменённых между hash и endHash. */
  files: string[]
}

/** Тип записи: снимок запроса или снимок «до отката». */
export type SnapshotRecordKind = "request" | "preRevert"

/**
 * Запись реестра: привязка снимка к запросу пользователя.
 */
export interface ISnapshotRecord {
  /** Идентификатор запроса (timestamp первого сообщения). */
  runId: string
  /** ID сессии, в которой выполнен запрос. */
  sessionId: string
  /** Тип записи: снимок запроса или снимок «до отката». */
  kind: SnapshotRecordKind
  /** Базовое состояние: «до запроса» (request) / «до отката» (preRevert). */
  hash: string
  /** Итоговое состояние: «после запроса» (request) / «после отката» (preRevert). */
  endHash: string
  /** Файлы, изменённые между hash и endHash (абсолютные пути). */
  files: string[]
  /** Время создания снимка. */
  createdAt: number
  /** Для kind=preRevert: runId откатываемого запроса. */
  revertsRunId?: string
}

/**
 * Результат отката: честный отчёт — успех только если
 * ни один файл не завершился ошибкой (пропущенные файлы
 * правок пользователя не делают результат неудачным).
 */
export interface IRevertResult {
  ok: boolean
  /** Файлы, восстановленные из снимка. */
  restored: string[]
  /** Файлы, удалённые (их не было в снимке). */
  deleted: string[]
  /** Файлы, НЕ откатанные: пользователь изменил их после запроса. */
  skipped: Array<{ file: string; reason: string }>
  /** Файлы, которые не удалось восстановить. */
  failed: Array<{ file: string; error: string }>
}

/** Параметры отката. */
export interface IRevertOptions {
  /** Файлы, для которых проверка «пользователь изменял» не применяется (явный выбор пользователя). */
  forceFiles?: Iterable<string>
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
  /** Деревья «до/после» запроса и список файлов, изменённых между ними. */
  patch(hash: string): Promise<ISnapshotPatch>
  /** Откатить файлы, изменённые после снимка (по списку из patch). */
  revert(record: ISnapshotRecord, opts?: IRevertOptions): Promise<IRevertResult>
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

// ── Refs ──────────────────────────────────────────────────

/**
 * Ref цепочки коммитов, фиксирующих деревья снимков.
 * Пока дерево достижимо с этого ref — git gc не удалит его.
 */
export const SNAPSHOT_COMMIT_REF = "refs/nt/snapshots"

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
