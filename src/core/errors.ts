import * as vscode from "vscode"

// ── Base ──────────────────────────────────────────────────

/**
 * Корневая ошибка домена NeuralTower Agent.
 * Все доменные ошибки наследуются от этого класса.
 */
export class NeuralTowerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "NeuralTowerError"
  }
}

// ── Backend ───────────────────────────────────────────────

/** Сбой бэкенда: HTTP, сеть, таймаут и т. д. */
export class BackendError extends NeuralTowerError {
  constructor(message: string) {
    super(message)
    this.name = "BackendError"
  }
}

/** Не удалось установить соединение с бэкендом. */
export class ConnectionError extends BackendError {
  constructor(message: string) {
    super(message)
    this.name = "ConnectionError"
  }
}

/** Таймаут запроса к бэкенду. */
export class TimeoutError extends BackendError {
  constructor(message: string) {
    super(message)
    this.name = "TimeoutError"
  }
}

// ── Tool ──────────────────────────────────────────────────

/** Ошибка инструмента: валидация, выполнение и т. д. */
export class ToolError extends NeuralTowerError {
  constructor(message: string) {
    super(message)
    this.name = "ToolError"
  }
}

/** Неверные аргументы инструмента. */
export class ValidationError extends ToolError {
  constructor(message: string) {
    super(message)
    this.name = "ValidationError"
  }
}

/** Ошибка выполнения инструмента. */
export class ExecutionError extends ToolError {
  constructor(message: string) {
    super(message)
    this.name = "ExecutionError"
  }
}

// ── Context ───────────────────────────────────────────────

/** Ошибка контекста: инициализация, подготовка, несоответствие и т. д. */
export class ContextError extends NeuralTowerError {
  constructor(message: string) {
    super(message)
    this.name = "ContextError"
  }
}

/** Агент не совпадает с ожидаемым для текущего этапа. */
export class AgentMismatchError extends ContextError {
  constructor(
    public readonly expectedAgent: string,
    public readonly actualAgent: string,
  ) {
    super(`Несоответствие агента: ожидался "${expectedAgent}", получен "${actualAgent}"`)
    this.name = "AgentMismatchError"
  }
}

/** Замена агента заблокирована в рамках сессии. */
export class AgentReplacementBlockedError extends ContextError {
  constructor(
    public readonly sessionID: string,
    public readonly previousAgent: string,
    public readonly currentAgent: string,
  ) {
    super(
       `Замена агента заблокирована в сессии ${sessionID}: ` +
       `"${previousAgent}" -> "${currentAgent}"`,
     )
    this.name = "AgentReplacementBlockedError"
  }
}

// ── Plan ──────────────────────────────────────────────────

/** Ошибка планирования: загрузка, валидация плана и т. д. */
export class PlanError extends NeuralTowerError {
  constructor(message: string) {
    super(message)
    this.name = "PlanError"
  }
}

// ── Agent ─────────────────────────────────────────────────

/** Ошибка агента: жизненный цикл, отмена и т. д. */
export class AgentError extends NeuralTowerError {
  constructor(message: string) {
    super(message)
    this.name = "AgentError"
  }
}

/** Агент отменён пользователем. */
export class AbortError extends AgentError {
  constructor(message = "Задача отменена") {
    super(message)
    this.name = "AbortError"
  }
}

// ── Error handling ─────────────────────────────────────────

/**
 * Обработать ошибку запроса к бэкенду: вызвать обратный вызов с сообщением,
 * показать уведомление и вернуть флаг прерывания.
 * @param err ошибка для обработки
 * @param onMessage обратный вызов с отформатированным сообщением
 * @param showNotification показать ли уведомление VS Code
 * @returns true если запрос следует прервать (AbortError)
 */
export function handleBackendError(
  err: unknown,
  onMessage: (message: string) => void,
  showNotification: boolean = true,
): boolean {
  if (err instanceof AbortError) {
    onMessage("Задача остановлена пользователем")
    return true
  }

  let message: string
  if (err instanceof BackendError) {
    message = `Ошибка бэкенда: ${err.message}`
  } else if (err instanceof NeuralTowerError) {
    message = `${err.name}: ${err.message}`
  } else {
    message = err instanceof Error ? err.message : "Неизвестная ошибка"
  }

  onMessage(message)

  if (showNotification) {
    vscode.window.showErrorMessage(message)
  }

  return false
}
