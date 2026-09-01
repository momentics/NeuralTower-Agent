/**
 * Централизованные константы конфигурации.
 * Все числовые пороги и таймауты собраны в одном месте
 * для единообразия и лёгкой настройки.
 */

import * as vscode from "vscode"
import type { IBackendConfig } from "./IBackend"

// ── Бэкенд ────────────────────────────────────────────────

/** Дефолтный адрес сервера вывода Neural Tower (SGLang). Единственный источник дефолта в коде. */
export const DEFAULT_BACKEND_URL = "http://localhost:30000"

export function loadDefaultBackendConfig(): IBackendConfig {
  return {
    url: DEFAULT_BACKEND_URL,
    // Пустое имя модели — автовыбор: бэкенд берёт модель из списка сервера
    // (/v1/models). Захардкоженное имя не совпадает с фактической моделью
    // сервера и ломает первый запуск.
    model: "",
    maxRetries: 3,
    timeoutMs: 60000,
    temperature: null,
  }
}

/** Температура из настроек: число 0–2 (зажимается) или null — не отправлять. */
function readTemperature(value: number | null | undefined): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) return null
  return Math.min(2, Math.max(0, value))
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

  /** Токенов для сохранения хвоста истории (выбирается по ходам). */
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
    keepTokens: 12_000,
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
/** Дефолт: разогревать зеркало объектами репозитория пользователя. */
export const SNAPSHOT_DEFAULT_SEED = true

export interface ISnapshotConfig {
  /** Включить снапшоты (работает только для git-репозиториев). */
  enabled: boolean

  /** Сколько дней хранить снимки. */
  retentionDays: number

  /** Максимальный размер файла для стейджинга, байты. */
  maxFileSizeBytes: number

  /** Разогревать зеркало объектами репозитория пользователя. */
  seed: boolean
}

export function loadDefaultSnapshotConfig(): ISnapshotConfig {
  return {
    enabled: true,
    retentionDays: SNAPSHOT_DEFAULT_RETENTION_DAYS,
    maxFileSizeBytes: SNAPSHOT_DEFAULT_MAX_FILE_SIZE,
    seed: SNAPSHOT_DEFAULT_SEED,
  }
}

// ── Единая конфигурация приложения ────────────────────────

export interface IAppConfig {
  backend: IBackendConfig
  agent: IAgentConfig
  context: IContextConfig
  compactor: ICompactorConfig
  toolOutput: IToolOutputConfig
  session: ISessionConfig
  autocomplete: IAutocompleteConfig
  snapshots: ISnapshotConfig
  permissions: IPermissionPatternsConfig
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
      temperature: readTemperature(cfg.get<number | null>("temperature", null)),
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
    toolOutput: {
      ...loadDefaultToolOutputConfig(),
      maxChars: cfg.get<number>("toolOutput.maxChars", loadDefaultToolOutputConfig().maxChars)!,
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
      seed: cfg.get<boolean>("snapshots.seed", loadDefaultSnapshotConfig().seed)!,
    },
    permissions: {
      bash: sanitizePatternRules(
        cfg.get<IPermissionPatternRule[]>("permissions.bash", loadDefaultPermissionConfig().bash),
      ),
      files: sanitizePatternRules(
        cfg.get<IPermissionPatternRule[]>("permissions.files", loadDefaultPermissionConfig().files),
      ),
      doomLoopLimit: (() => {
        const v = cfg.get<number>("permissions.doomLoopLimit", loadDefaultPermissionConfig().doomLoopLimit)
        return typeof v === "number" && v >= 2 && v <= 10 ? v : loadDefaultPermissionConfig().doomLoopLimit
      })(),
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
/** Максимальное число результатов, возвращаемых glob-инструментом. */
export const GLOB_MAX_RESULTS = 500
/** Максимальный размер вывода read_file в байтах. */
export const FS_MAX_READ_OUTPUT_BYTES = 512 * 1024

// ── Вывод инструментов ─────────────────────────────────────

/**
 * Настройки вывода инструментов: лимит длины в разговоре.
 * Более длинный вывод обрезается, полный текст сохраняется в файл
 * (см. ToolOutputTruncator).
 */
export interface IToolOutputConfig {
  /** Максимальная длина вывода инструмента в разговоре, символы. */
  maxChars: number
}

export function loadDefaultToolOutputConfig(): IToolOutputConfig {
  return { maxChars: 30_000 }
}

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

// ── Веб-поиск ─────────────────────────────────────────────

/** Таймаут запроса веб-поиска, миллисекунды */
export const WEB_SEARCH_TIMEOUT_MS = 15_000
/** Максимальная длина HTML-ответа веб-поиска, символы */
export const WEB_SEARCH_MAX_HTML_CHARS = 300_000
/** Максимальное число результатов веб-поиска */
export const WEB_SEARCH_MAX_RESULTS = 10

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

/** Правило-паттерн разрешения (команда или путь к файлу). */
export interface IPermissionPatternRule {
  pattern: string
  level: "allow" | "deny"
}

export interface IPermissionPatternsConfig {
  /** Паттерны команд оболочки (bash). */
  bash: IPermissionPatternRule[]
  /** Паттерны путей к файлам (файловые инструменты). */
  files: IPermissionPatternRule[]
  /** Doom loop: N одинаковых подряд вызовов принудительно подтверждается. */
  doomLoopLimit: number
}

export function loadDefaultPermissionConfig(): IPermissionPatternsConfig {
  return {
    bash: [
      { pattern: "git status", level: "allow" },
      { pattern: "git diff", level: "allow" },
      { pattern: "git log", level: "allow" },
    ],
    files: [],
    doomLoopLimit: 3,
  }
}

/** Отбросить невалидные правила (pattern не строка, level не allow/deny). */
export function sanitizePatternRules(rules: unknown): IPermissionPatternRule[] {
  if (!Array.isArray(rules)) return []
  return rules.filter(
    (r): r is IPermissionPatternRule =>
      !!r &&
      typeof r === "object" &&
      typeof (r as IPermissionPatternRule).pattern === "string" &&
      ((r as IPermissionPatternRule).level === "allow" ||
        (r as IPermissionPatternRule).level === "deny"),
  )
}

// ── UI ───────────────────────────────────────────────────────

/** Длина обрезки аргументов в логе */
export const UI_ARGS_LOG_TRUNCATE = 200
/** Минимальный таймаут бэкенда в миллисекундах */
export const UI_MIN_BACKEND_TIMEOUT_MS = 1000
/** Таймаут загрузки списка моделей в панели настроек, миллисекунды */
export const UI_SETTINGS_MODELS_TIMEOUT_MS = 3000

// ── Git ──────────────────────────────────────────────────────

/** Длина обрезки текста коммита */
export const GIT_COMMIT_MSG_TRUNCATE = 50
