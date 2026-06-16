export type {
  ContextSnapshot,
  PreparedContext,
} from "./ContextManager"

/**
 * Ошибка инициализации контекста: этап заблокирован
 * из-за несоответствия агента.
 */
export class AgentMismatchError extends Error {
  constructor(
    public readonly expectedAgent: string,
    public readonly actualAgent: string,
  ) {
    super(`Agent mismatch: expected "${expectedAgent}", got "${actualAgent}"`)
    this.name = "AgentMismatchError"
  }
}

/**
 * Ошибка блокировки замены агента в рамках сессии.
 */
export class AgentReplacementBlockedError extends Error {
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
