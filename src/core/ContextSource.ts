import type { ChatMessage } from "../core/IBackend"

/**
 * Источник контекста — типизированный блок данных, который
 * ContextManager загружает, сравнивает с базовым текстом и включает
 * в системный промпт при изменении.
 *
 * Типизированный интерфейс без внешних зависимостей.
 */
export interface ContextSource<T = unknown> {
  /** Уникальный ключ источника. */
  readonly key: string

  /** Загрузить текущее значение источника. */
  load(): Promise<T | undefined>

  /** Сформировать базовый текст из начального значения. */
  baseline(value: T): string

  /** Сформировать текст изменения при изменении значения. */
  update(previous: T, current: T): string

  /** Сформировать текст при удалении источника. */
  removed?(previous: T): string

  /** Приоритет включения в контекст (выше = раньше). */
  readonly priority?: number
}

/**
 * Результат сравнения источника с предыдущим снимком.
 */
export type SourceReconcileResult =
  | { readonly _tag: "unchanged" }
  | { readonly _tag: "updated"; text: string }
  | { readonly _tag: "removed"; text: string }

/**
 * Неподвижный снимок всех источников контекста на момент
 * начала хода агента. Используется для сравнения при
 * повторных запросах в рамках того же этапа.
 */
export interface ContextSnapshot {
  /** Ключ источника. */
  readonly key: string

  /** Сериализуемое значение. */
  readonly value: unknown

  /** Базовый текст. */
  readonly baseline: string

  /** Порядковый номер ревизии. */
  readonly revision: number
}

/**
 * Подготовленный контекст для передачи в цикл агента.
 * Содержит базовый системный промпт и метаданные этапа.
 */
export interface PreparedContext {
  /** Системный промпт (базовый текст всех источников). */
  readonly systemPrompt: string

  /** Номер ревизии контекста. */
  readonly revision: number

  /** Снимок источников для сравнения. */
  readonly snapshot: ContextSnapshot[]

  /** Оценка токенов системного промпта. */
  readonly systemTokens: number
}

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
