/**
 * Централизованные константы конфигурации.
 * Все числовые пороги и таймауты собраны в одном месте
 * для единообразия и лёгкой настройки.
 */

import * as vscode from "vscode"
import type { IBackendConfig } from "./IBackend"

// ── Бэкенд ────────────────────────────────────────────────

export function loadDefaultBackendConfig(): IBackendConfig {
  return {
    url: "http://localhost:30000",
    model: "qwen3.6-27b",
    maxRetries: 3,
    timeoutMs: 60000,
  }
}

// ── Агент ─────────────────────────────────────────────────

export interface IAgentConfig {
  /** Максимальное число итераций вызова инструментов за один ход агента. */
  maxIterations: number

  /** Максимальное число токенов краткосрочной памяти агента. */
  maxTokens: number

  /** Добавлять контекст git-различий в системный запрос агента. */
  injectDiffContext: boolean

  /** Максимальное число попыток восстановления после сбоя инструмента. */
  maxRecoveryAttempts: number

  /** Автоматически создавать план задачи перед выполнением. */
  autoPlan: boolean

  /** Включить адаптивное репланирование при провале шага. */
  replanOnFailure: boolean

  /** Максимальное число попыток репланирования за одну сессию. */
  maxReplanAttempts: number
}

export function loadDefaultAgentConfig(): IAgentConfig {
  return {
    maxIterations: 20,
    maxTokens: 60_000,
    injectDiffContext: true,
    maxRecoveryAttempts: 3,
    autoPlan: true,
    replanOnFailure: true,
    maxReplanAttempts: 2,
  }
}

// ── Контекст ──────────────────────────────────────────────

export interface IContextConfig {
  /** Лимит токенов для системного промпта. */
  tokenBudget: number
}

export function loadDefaultContextConfig(): IContextConfig {
  return {
    tokenBudget: 16_000,
  }
}

// ── Компактор ─────────────────────────────────────────────

export interface ICompactorConfig {
  /** Лимит контекстных токенов модели. */
  contextLimit: number

  /** Буфер токенов до порога сжатия. */
  bufferTokens: number

  /** Токенов для сохранения хвоста истории. */
  keepTokens: number

  /** Максимальная длина вывода инструмента для сжатия. */
  maxToolOutputChars: number

  /** Целевой размер сводки в токенах. */
  summaryMaxTokens: number
}

export function loadDefaultCompactorConfig(): ICompactorConfig {
  return {
    contextLimit: 128_000,
    bufferTokens: 20_000,
    keepTokens: 8_000,
    maxToolOutputChars: 2_000,
    summaryMaxTokens: 4_096,
  }
}

// ── Сессия ────────────────────────────────────────────────

export interface ISessionConfig {
  /** Максимальное число сохраняемых сессий. */
  maxSessions: number
}

export function loadDefaultSessionConfig(): ISessionConfig {
  return {
    maxSessions: 50,
  }
}

// ── Автодополнение ────────────────────────────────────────

export interface IAutocompleteConfig {
  /** Включить автодополнение кода. */
  enabled: boolean

  /** Интервал дебаунса в миллисекундах. */
  debounceMs: number

  /** Максимальное число токенов в промпте автодополнения. */
  maxPromptTokens: number
}

export function loadDefaultAutocompleteConfig(): IAutocompleteConfig {
  return {
    enabled: true,
    debounceMs: 150,
    maxPromptTokens: 2048,
  }
}

// ── Снапшоты (чекпоинты) ─────────────────────────────────

/** Дефолтное число дней хранения чекпоинтов. */
export const SNAPSHOT_DEFAULT_RETENTION_DAYS = 7
/** Дефолтный максимальный размер файла для чекпоинта, байты. */
export const SNAPSHOT_DEFAULT_MAX_FILE_SIZE = 2 * 1024 * 1024

export interface ISnapshotConfig {
  /** Включить снапшоты (работает только для git-репозиториев). */
  enabled: boolean

  /** Сколько дней хранить снимки. */
  retentionDays: number

  /** Максимальный размер файла для стейджинга, байты. */
  maxFileSizeBytes: number
}

export function loadDefaultSnapshotConfig(): ISnapshotConfig {
  return {
    enabled: true,
    retentionDays: SNAPSHOT_DEFAULT_RETENTION_DAYS,
    maxFileSizeBytes: SNAPSHOT_DEFAULT_MAX_FILE_SIZE,
  }
}

// ── Единая конфигурация приложения ────────────────────────

export interface IAppConfig {
  backend: IBackendConfig
  agent: IAgentConfig
  context: IContextConfig
  compactor: ICompactorConfig
  session: ISessionConfig
  autocomplete: IAutocompleteConfig
  snapshots: ISnapshotConfig
}

/**
 * Загрузить IAppConfig из VS Code settings.
 * Вызывается один раз при активации расширения.
 */
export function loadAppConfig(): IAppConfig {
  const cfg = vscode.workspace.getConfiguration("neuralTowerAgent")

  return {
    backend: {
      url: cfg.get<string>("neuralTowerUrl", loadDefaultBackendConfig().url)!,
      model: cfg.get<string>("model", loadDefaultBackendConfig().model)!,
      maxRetries: cfg.get<number>("maxRetries", loadDefaultBackendConfig().maxRetries)!,
      timeoutMs: cfg.get<number>("timeoutMs", loadDefaultBackendConfig().timeoutMs)!,
    },
    agent: {
      maxIterations: cfg.get<number>("agent.maxIterations", loadDefaultAgentConfig().maxIterations)!,
      maxTokens: loadDefaultAgentConfig().maxTokens,
      injectDiffContext: cfg.get<boolean>("git.injectDiffContext", loadDefaultAgentConfig().injectDiffContext)!,
      maxRecoveryAttempts: cfg.get<number>("agent.maxRecoveryAttempts", loadDefaultAgentConfig().maxRecoveryAttempts)!,
      autoPlan: cfg.get<boolean>("agent.autoPlan", loadDefaultAgentConfig().autoPlan)!,
      replanOnFailure: cfg.get<boolean>("agent.replanOnFailure", loadDefaultAgentConfig().replanOnFailure)!,
      maxReplanAttempts: cfg.get<number>("agent.maxReplanAttempts", loadDefaultAgentConfig().maxReplanAttempts)!,
    },
    context: {
      tokenBudget: loadDefaultContextConfig().tokenBudget,
    },
    compactor: {
      ...loadDefaultCompactorConfig(),
    },
    session: {
      maxSessions: cfg.get<number>("maxSessions", loadDefaultSessionConfig().maxSessions)!,
    },
    autocomplete: {
      enabled: cfg.get<boolean>("autocomplete.enabled", loadDefaultAutocompleteConfig().enabled)!,
      debounceMs: cfg.get<number>("autocomplete.debounceMs", loadDefaultAutocompleteConfig().debounceMs)!,
      maxPromptTokens: cfg.get<number>("autocomplete.maxPromptTokens", loadDefaultAutocompleteConfig().maxPromptTokens)!,
    },
    snapshots: {
      enabled: cfg.get<boolean>("snapshots.enabled", loadDefaultSnapshotConfig().enabled)!,
      retentionDays: cfg.get<number>("snapshots.retentionDays", loadDefaultSnapshotConfig().retentionDays)!,
      maxFileSizeBytes: cfg.get<number>("snapshots.maxFileSizeBytes", loadDefaultSnapshotConfig().maxFileSizeBytes)!,
    },
  }
}

// ── LSP ──────────────────────────────────────────────────────

/** Таймаут LSP-запроса в миллисекундах */
export const LSP_TIMEOUT_MS = 10_000
/** Максимальное число результатов символов */
export const LSP_MAX_SYMBOL_RESULTS = 50
/** Максимальное число результатов ссылок */
export const LSP_MAX_REFERENCE_RESULTS = 30
/** Максимальная длина hover-текста */
export const LSP_MAX_HOVER_CHARS = 4000
/** Максимальная глубина рекурсии символов */
export const LSP_MAX_DEPTH = 4
/** Длина сниппета строки */
export const LSP_SNIPPET_LENGTH = 200

// ── Инструменты файловой системы ─────────────────────────────

/** Максимальная длина содержимого при редактировании */
export const FS_MAX_EDIT_CONTENT_LENGTH = 1_000_000
/** Максимальная длина содержимого при записи */
export const FS_MAX_WRITE_CONTENT_LENGTH = 10_000_000
/** Дефолтный лимит чтения строк */
export const FS_DEFAULT_READ_LIMIT = 2000
/** Максимальный лимит чтения строк */
export const FS_MAX_READ_LIMIT = 10_000
/** Максимальное число удаляемых файлов за раз */
export const FS_MAX_DELETE_FILE_COUNT = 100
/** Длина превью при редактировании */
export const FS_EDIT_PREVIEW_TRUNCATE = 60

// ── Bash-инструмент ──────────────────────────────────────────

/** Дефолтный таймаут Bash-команды в миллисекундах */
export const BASH_DEFAULT_TIMEOUT_MS = 30_000
/** Максимальный буфер вывода Bash */
export const BASH_MAX_BUFFER = 1024 * 1024
/** Минимальный таймаут Bash в миллисекундах */
export const BASH_MIN_TIMEOUT_MS = 1000
/** Максимальный таймаут Bash в миллисекундах */
export const BASH_MAX_TIMEOUT_MS = 300_000

// ── Сеть ─────────────────────────────────────────────────────

/** Дефолтный таймаут запроса в миллисекундах */
export const NET_DEFAULT_TIMEOUT_MS = 15_000
/** Дефолтная максимальная длина ответа */
export const NET_DEFAULT_MAX_LENGTH = 12_000
/** Дефолтный User-Agent */
export const NET_DEFAULT_USER_AGENT = "NeuralTower-Agent/0.1"
/** Максимальное число редиректов */
export const NET_MAX_REDIRECTS = 5

// ── MCP ──────────────────────────────────────────────────────

/** Таймаут MCP-запроса в миллисекундах */
export const MCP_REQUEST_TIMEOUT_MS = 10_000

// ── Индексация ───────────────────────────────────────────────

/** Дебаунс событий файловой системы в миллисекундах */
export const INDEX_FILE_EVENT_DEBOUNCE_MS = 300
/** Максимальное число файлов в индексе */
export const INDEX_DEFAULT_MAX_FILES = 20_000

// ── Разрешения ───────────────────────────────────────────────

/** Таймаут запроса разрешения в миллисекундах */
export const PERMISSION_TIMEOUT_MS = 30_000

// ── UI ───────────────────────────────────────────────────────

/** Длина обрезки аргументов в логе */
export const UI_ARGS_LOG_TRUNCATE = 200
/** Минимальный таймаут бэкенда в миллисекундах */
export const UI_MIN_BACKEND_TIMEOUT_MS = 1000

// ── Git ──────────────────────────────────────────────────────

/** Длина обрезки текста коммита */
export const GIT_COMMIT_MSG_TRUNCATE = 50
