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
    super(`Agent mismatch: expected "${expectedAgent}", got "${actualAgent}"`)
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
      `Agent replacement blocked in session ${sessionID}: ` +
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
  constructor(message = "Task aborted") {
    super(message)
    this.name = "AbortError"
  }
}
