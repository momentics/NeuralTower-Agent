import type { AgentModeName } from "./AgentMode"
import type { Plan } from "./Plan"
import type { PreparedContext, ContextSnapshot } from "../core/ContextSource"
import { AgentMismatchError } from "../core/ContextSource"
import type { ContextManager } from "../core/ContextManager"
import type { ChatMessage } from "../core/IBackend"

/**
 * Состояние эпохи контекста сессии.
 *
 * Вдохновлён opencode SessionContextEpoch:
 * управляет baseline контекста, ревизиями и блокировкой
 * замены агента в рамках одной сессии.
 */
export interface SessionEpochState {
  /** ID сессии. */
  sessionID: string

  /** Агент, владеющий эпохой. */
  agent: AgentModeName

  /** Номер текущей ревизии контекста. */
  revision: number

  /** Baseline системного промпта. */
  baselinePrompt: string

  /** Снимок источников контекста. */
  snapshot: ContextSnapshot[]

  /** Время начала эпохи. */
  startedAt: number

  /** Время последнего обновления. */
  updatedAt: number
}

/**
 * Подготовленный результат эпохи для передачи в runner.
 */
export interface EpochPrepared {
  /** Baseline системного промпта. */
  baseline: string

  /** Порядковый номер baseline. */
  baselineSeq: number

  /** Номер ревизии. */
  revision: number
}

/**
 * SessionContext управляет контекстом одной сессии:
 * эпоха контекста, план, история сообщений, режим агента.
 *
 * Аналог opencode SessionContextEpoch + SessionRunState.
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
   * Инициализировать эпоху контекста.
   * Создаёт baseline и фиксирует агента.
   *
   * Если эпоха уже существует и агент не совпадает —
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
   * Подготовить контекст для следующего хода: согласовать
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
   * Заменить историю (после компакций).
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
   * Вернуть состояние эпохи.
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
      throw new Error("Эпоха не инициализирована")
    }
    return {
      baseline: this.epoch.baselinePrompt,
      baselineSeq: this.epoch.revision,
      revision: this.epoch.revision,
    }
  }
}
