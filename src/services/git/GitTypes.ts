/** Результат операции git (общий для всех операций). */
export interface IGitOpResult {
  /** Текст для LLM (отформатированный, обрезанный). */
  output: string
  /** Успешно ли выполнена операция. */
  success: boolean
}

/** Класс операции по уровню риска. */
export type GitOperationClass = "safe" | "ask" | "dangerous"

/** Все операции git-инструмента. */
export const GIT_OPERATIONS = [
  "status",
  "diff",
  "log",
  "show",
  "branch_list",
  "remote_list",
  "stash_list",
  "add",
  "commit",
  "checkout",
  "branch_create",
  "switch",
  "stash_push",
  "stash_pop",
  "fetch",
  "push",
  "pull",
  "reset",
  "clean",
] as const

export type GitOperation = (typeof GIT_OPERATIONS)[number]

/** Read-only операции: не изменяют репозиторий и working tree. */
export const SAFE_GIT_OPERATIONS = new Set<string>([
  "status",
  "diff",
  "log",
  "show",
  "branch_list",
  "remote_list",
  "stash_list",
])

/** Сетевые и необратимые операции: максимальный класс риска. */
export const DANGEROUS_GIT_OPERATIONS = new Set<string>([
  "push",
  "pull",
  "reset",
  "clean",
])

/** Сетевые операции: неинтерактивное окружение и сетевой таймаут. */
export const NETWORK_GIT_OPERATIONS = new Set<string>(["fetch", "push", "pull"])

// ── Таймауты (мс) ─────────────────────────────────────────

/** safe-операции (чтение). */
export const GIT_READ_TIMEOUT_MS = 10_000
/** ask-операции (локальные изменения). */
export const GIT_WRITE_TIMEOUT_MS = 30_000
/** fetch/push/pull (сеть). */
export const GIT_NETWORK_TIMEOUT_MS = 120_000

// ── Лимиты вывода ─────────────────────────────────────────

/** Максимальная длина вывода diff/show (защита контекстного окна). */
export const GIT_DIFF_MAX_OUTPUT_CHARS = 20_000
/** Максимальная длина вывода остальных операций. */
export const GIT_MAX_OUTPUT_CHARS = 8_000
/** Максимальное число коммитов в log. */
export const GIT_LOG_LIMIT_MAX = 100
/** Максимальная длина commit/stash-сообщения. */
export const GIT_MESSAGE_MAX_LENGTH = 5_000
/** Максимальная длина имени ветки/ref/remote. */
export const GIT_NAME_MAX_LENGTH = 255
