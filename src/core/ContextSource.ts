import type { ChatMessage } from "../core/IBackend"

/**
 * Источник контекста — типизированный блок данных, который
 * ContextManager загружает, сравнивает с baseline и включает
 * в системный промпт при изменении.
 *
 * Аналог opencode Source<A>, но без Effect/Schema.
 */
export interface ContextSource<T = unknown> {
  /** Уникальный ключ источника. */
  readonly key: string

  /** Загрузить текущее значение источника. */
  load(): Promise<T | undefined>

  /** Сформировать baseline-текст из начального значения. */
  baseline(value: T): string

  /** Сформировать delta-текст при изменении значения. */
  update(previous: T, current: T): string

  /** Сформировать текст при удалении источника. */
  removed?(previous: T): string

  /** Приоритет включения в контекст (выше = раньше). */
  readonly priority?: number
}

/**
 * Результат согласования источника с предыдущим снимком.
 */
export type SourceReconcileResult =
  | { readonly _tag: "unchanged" }
  | { readonly _tag: "updated"; text: string }
  | { readonly _tag: "removed"; text: string }

/**
 * Неподвижный снимок всех источников контекста на момент
 * начала хода агента. Используется для согласования при
 * повторных запросах в рамках той же эпохи.
 */
export interface ContextSnapshot {
  /** Ключ источника. */
  readonly key: string

  /** Сериализуемое значение. */
  readonly value: unknown

  /** Baseline-текст. */
  readonly baseline: string

  /** Порядковый номер ревизии. */
  readonly revision: number
}

/**
 * Подготовленный контекст для передачи в цикл агента.
 * Содержит baseline системного промпта и метаданные эпохи.
 */
export interface PreparedContext {
  /** Системный промпт (baseline всех источников). */
  readonly systemPrompt: string

  /** Номер ревизии контекста. */
  readonly revision: number

  /** Снимок источников для согласования. */
  readonly snapshot: ContextSnapshot[]

  /** Оценка токенов системного промпта. */
  readonly systemTokens: number
}

/**
 * Ошибка инициализации контекста: эпоха заблокирована
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
