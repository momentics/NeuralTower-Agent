import type { AgentModeName } from "./AgentMode"
import type { Plan } from "./Plan"
import type { PreparedContext, ContextSnapshot } from "../core/ContextSource"
import { AgentMismatchError } from "../core/ContextSource"
import type { ContextManager } from "../core/ContextManager"
import type { ChatMessage } from "../core/IBackend"

/**
 * Состояние этапа контекста сессии.
 *
 * Управляет базовым контекстом, ревизиями и блокировкой
 * замены агента в рамках одной сессии.
 */
export interface SessionEpochState {
  /** ID сессии. */
  sessionID: string

  /** Агент, владеющий этапом. */
  agent: AgentModeName

  /** Номер текущей ревизии контекста. */
  revision: number

  /** Базовый системный промпт. */
  baselinePrompt: string

  /** Снимок источников контекста. */
  snapshot: ContextSnapshot[]

  /** Время начала этапа. */
  startedAt: number

  /** Время последнего обновления. */
  updatedAt: number
}

/**
 * Подготовленный результат этапа для передачи в исполнитель.
 */
export interface EpochPrepared {
  /** Базовый системный промпт. */
  baseline: string

  /** Порядковый номер базового текста. */
  baselineSeq: number

  /** Номер ревизии. */
  revision: number
}

/**
 * SessionContext управляет контекстом одной сессии:
 * этап контекста, план, история сообщений, режим агента.
 *
 * Управляет этапом контекста, планом, историей сообщений и режимом агента.
 */
export class SessionContext {
  private epoch: SessionEpochState | null = null
  private messageHistory: ChatMessage[] = []
  private plan: Plan | null = null
  private compacted = false

  constructor(
    public readonly sessionID: string,
    private readonly contextManager: ContextManager,
  ) {}

 /**
   * Инициализировать этап контекста.
   * Создаёт базовый текст и фиксирует агента.
   *
   * Если этап уже существует и агент не совпадает —
   * бросает AgentMismatchError.
   */
  async initialize(agent: AgentModeName): Promise<EpochPrepared> {
    if (this.epoch) {
      if (this.epoch.agent !== agent) {
        throw new AgentMismatchError(this.epoch.agent, agent)
      }
      return this.toPrepared()
    }

    const prepared = await this.contextManager.initialize()

    this.epoch = {
      sessionID: this.sessionID,
      agent,
      revision: prepared.revision,
      baselinePrompt: prepared.systemPrompt,
      snapshot: prepared.snapshot,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    }

    return this.toPrepared()
  }

 /**
   * Подготовить контекст для следующего хода: сравнить
   * источники с предыдущим снимком.
   *
   * Если агент не совпадает — бросает ошибку.
   */
  async prepare(agent: AgentModeName): Promise<EpochPrepared> {
    if (!this.epoch) {
      return await this.initialize(agent)
    }

    if (this.epoch.agent !== agent) {
      throw new AgentMismatchError(this.epoch.agent, agent)
    }

    const prepared = await this.contextManager.prepare()

    this.epoch.revision = prepared.revision
    this.epoch.baselinePrompt = prepared.systemPrompt
    this.epoch.snapshot = prepared.snapshot
    this.epoch.updatedAt = Date.now()

    return this.toPrepared()
  }

  /**
   * Добавить сообщение в историю сессии.
   */
  pushMessage(message: ChatMessage): void {
    this.messageHistory.push(message)
  }

  /**
   * Вернуть историю сообщений сессии.
   */
  getMessages(): ChatMessage[] {
    return [...this.messageHistory]
  }

  /**
   * Заменить историю (после сжатия).
   */
  replaceMessages(messages: ChatMessage[]): void {
    this.messageHistory = messages
    this.compacted = true
  }

  /**
   * Вернуть текущий план сессии.
   */
  getPlan(): Plan | null {
    return this.plan
  }

  /**
   * Установить план для сессии.
   */
  setPlan(plan: Plan): void {
    this.plan = plan
  }

  /**
   * Удалить план (после завершения).
   */
  clearPlan(): void {
    this.plan = null
  }

  /**
   * Вернуть состояние этапа.
   */
  getEpoch(): SessionEpochState | null {
    return this.epoch ? { ...this.epoch } : null
  }

  /**
   * Вернуть текущий агент.
   */
  getAgent(): AgentModeName | null {
    return this.epoch?.agent ?? null
  }

  /**
   * Проверить, была ли выполнена компакция.
   */
  isCompacted(): boolean {
    return this.compacted
  }

  /**
   * Сбросить контекст сессии.
   */
  reset(): void {
    this.epoch = null
    this.messageHistory = []
    this.plan = null
    this.compacted = false
    this.contextManager.reset()
  }

  private toPrepared(): EpochPrepared {
    if (!this.epoch) {
      throw new Error("Этап не инициализирован")
    }
    return {
      baseline: this.epoch.baselinePrompt,
      baselineSeq: this.epoch.revision,
      revision: this.epoch.revision,
    }
  }
}
