import * as vscode from "vscode"
import type { BackendConfig } from "./IBackend"

// ── Бэкенд ────────────────────────────────────────────────

export function loadDefaultBackendConfig(): BackendConfig {
  return {
    url: "http://localhost:30000",
    model: "qwen3.6-27b",
    maxRetries: 3,
    timeoutMs: 60000,
  }
}

// ── Агент ─────────────────────────────────────────────────

export interface AgentConfig {
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
}

export function loadDefaultAgentConfig(): AgentConfig {
  return {
    maxIterations: 20,
    maxTokens: 60_000,
    injectDiffContext: true,
    maxRecoveryAttempts: 3,
    autoPlan: true,
  }
}

// ── Контекст ──────────────────────────────────────────────

export interface ContextConfig {
  /** Лимит токенов для системного промпта. */
  tokenBudget: number
}

export function loadDefaultContextConfig(): ContextConfig {
  return {
    tokenBudget: 16_000,
  }
}

// ── Компактор ─────────────────────────────────────────────

export interface CompactorConfig {
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

export function loadDefaultCompactorConfig(): CompactorConfig {
  return {
    contextLimit: 128_000,
    bufferTokens: 20_000,
    keepTokens: 8_000,
    maxToolOutputChars: 2_000,
    summaryMaxTokens: 4_096,
  }
}

// ── Сессия ────────────────────────────────────────────────

export interface SessionConfig {
  /** Максимальное число сохраняемых сессий. */
  maxSessions: number
}

export function loadDefaultSessionConfig(): SessionConfig {
  return {
    maxSessions: 50,
  }
}

// ── Автодополнение ────────────────────────────────────────

export interface AutocompleteConfig {
  /** Включить автодополнение кода. */
  enabled: boolean

  /** Интервал дебаунса в миллисекундах. */
  debounceMs: number

  /** Максимальное число токенов в промпте автодополнения. */
  maxPromptTokens: number
}

export function loadDefaultAutocompleteConfig(): AutocompleteConfig {
  return {
    enabled: true,
    debounceMs: 150,
    maxPromptTokens: 2048,
  }
}

// ── Единая конфигурация приложения ────────────────────────

export interface AppConfig {
  backend: BackendConfig
  agent: AgentConfig
  context: ContextConfig
  compactor: CompactorConfig
  session: SessionConfig
  autocomplete: AutocompleteConfig
}

/**
 * Загрузить AppConfig из VS Code settings.
 * Вызывается один раз при активации расширения.
 */
export function loadAppConfig(): AppConfig {
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
  }
}
