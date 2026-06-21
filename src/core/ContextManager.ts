import type { ContextProvider, ContextItem } from "./providers/context/types"
import { estimateTokens } from "./token-utils"
import { loadDefaultContextConfig } from "./config"
import { createDomainLogger } from "./logger"
import { Mutex } from "../shared/Mutex"
import { errorMessage } from "./errors"

const log = createDomainLogger("ContextManager")

/**
 * Неподвижный снимок провайдера контекста на момент
 * начала хода агента. Используется для сравнения при
 * повторных запросах в рамках того же этапа.
 */
export interface ContextSnapshot {
  /** Имя провайдера. */
  readonly name: string

  /** Содержимое (объединённый content всех ContextItem). */
  readonly content: string

  /** Порядковый номер ревизии. */
  readonly revision: number
}

/**
 * Подготовленный контекст для передачи в цикл агента.
 * Содержит базовый системный промпт и метаданные этапа.
 */
export interface PreparedContext {
  /** Системный промпт (базовый текст всех провайдеров + дельты). */
  readonly systemPrompt: string

  /** Номер ревизии контекста. */
  readonly revision: number

  /** Снимок провайдеров для сравнения. */
  readonly snapshot: ContextSnapshot[]

  /** Оценка токенов системного промпта. */
  readonly systemTokens: number
}

/**
 * Интерфейс ContextManager — методы, используемые через AgentDependencies.
 */
export interface IContextManager {
  initialize(): Promise<PreparedContext>
  prepare(): Promise<PreparedContext>
  reset(): void
  list(): ContextProvider[]
  dispose(): void
}

/**
 * ContextManager управляет провайдерами контекста, строит
 * базовый системный промпт, сравнивает изменения между
 * ходами агента и отслеживает потребление токенов.
 *
 * Консумирует ContextProvider: для автоматического контекста
 * вызывается resolve('') на каждом провайдере, результат
 * сравнивается с предыдущим снимком для обнаружения дельт.
 *
 * Лимит токенов: провайдеры сортируются по приоритету и
 * добавляются, пока сумма токенов не превысит лимит.
 */
export class ContextManager implements IContextManager {
  private providers: ContextProvider[] = []
  private snapshot: ContextSnapshot[] = []
  private revision = 0
  private previousContent: Map<string, string> = new Map()
  private tokenBudget: number
  private readonly mutex = new Mutex()

  constructor(tokenBudget?: number) {
    this.tokenBudget = tokenBudget ?? loadDefaultContextConfig().tokenBudget
  }

  /**
   * Зарегистрировать провайдер контекста.
   */
  register(provider: ContextProvider): void {
    this.providers.push(provider)
  }

  /**
   * Удалить провайдер по имени.
   */
  unregister(name: string): void {
    this.providers = this.providers.filter(
      (p) => p.description.name !== name,
    )
  }

  /**
   * Установить лимит токенов для системного промпта.
   */
  setTokenBudget(budget: number): void {
    this.tokenBudget = budget
  }

  /**
   * Вернуть текущий лимит токенов.
   */
  getTokenBudget(): number {
    return this.tokenBudget
  }

  /**
   * Вернуть все зарегистрированные провайдеры.
   */
  list(): ContextProvider[] {
    return [...this.providers]
  }

  /**
   * Инициализировать контекст: загрузить все провайдеры,
   * создать базовый текст и сохранить снимок.
   *
   * Вызывается один раз на начало этапа сессии.
   */
  async initialize(): Promise<PreparedContext> {
    return await this.mutex.withLock(() => this.doInitialize())
  }

  private async doInitialize(): Promise<PreparedContext> {
    const snapshots: ContextSnapshot[] = []
    const baselineParts: string[] = []
    this.previousContent.clear()
    this.revision = 1
    let usedTokens = 0

    const sorted = [...this.providers].sort(
      (a, b) => (b.description.priority ?? 0) - (a.description.priority ?? 0),
    )

    for (const provider of sorted) {
      try {
        const items = await provider.resolve("")
        const content = extractContent(items)
        if (!content) continue

        const tokens = estimateTokens(content)

        if (usedTokens + tokens > this.tokenBudget && baselineParts.length > 0) {
          continue
        }

        usedTokens += tokens
        this.previousContent.set(provider.description.name, content)
        baselineParts.push(content)

        snapshots.push({
          name: provider.description.name,
          content,
          revision: this.revision,
        })
      } catch (err: unknown) {
        const msg = errorMessage(err)
        log.error(`Провайдер контекста недоступен: ${msg}`)
      }
    }

    this.snapshot = snapshots
    const systemPrompt = baselineParts.join("\n\n")
    const systemTokens = estimateTokens(systemPrompt)

    return {
      systemPrompt,
      revision: this.revision,
      snapshot: this.snapshot,
      systemTokens,
    }
  }

  /**
   * Подготовить контекст для следующего хода: сравнить
   * провайдеры с предыдущим снимком, вернуть обновлённый
   * системный промпт и изменения.
   *
   * Если провайдеры не изменились — возвращает базовый текст без изменений.
   */
  async prepare(): Promise<PreparedContext> {
    return await this.mutex.withLock(() => this.doPrepare())
  }

  private async doPrepare(): Promise<PreparedContext> {
    const deltas: string[] = []
    const newSnapshots: ContextSnapshot[] = []
    const newContent: Map<string, string> = new Map()
    this.revision++

    const sorted = [...this.providers].sort(
      (a, b) => (b.description.priority ?? 0) - (a.description.priority ?? 0),
    )

    for (const provider of sorted) {
      try {
        const items = await provider.resolve("")
        const current = extractContent(items)
        const previous = this.previousContent.get(provider.description.name)

        if (current !== previous) {
          const deltaText =
            provider.changed?.(previous ?? "", current ?? "") ??
            `Источник "${provider.description.name}" изменён`
          if (deltaText) {
            deltas.push(deltaText)
          }
        }

        if (current) {
          newContent.set(provider.description.name, current)
          newSnapshots.push({
            name: provider.description.name,
            content: current,
            revision: this.revision,
          })
        } else {
          newContent.delete(provider.description.name)
        }
      } catch (err: unknown) {
        const msg = errorMessage(err)
        log.error(`Провайдер контекста недоступен при обновлении: ${msg}`)
      }
    }

    this.previousContent = newContent
    this.snapshot = newSnapshots

    const basePrompt = this.snapshot
      .map((s) => s.content)
      .join("\n\n")

    const deltaBlock =
      deltas.length > 0
        ? `\n## Изменения контекста (ревизия ${this.revision})\n${deltas.join("\n\n")}`
        : ""

    const systemPrompt = `${basePrompt}${deltaBlock}`
    const systemTokens = estimateTokens(systemPrompt)

    return {
      systemPrompt,
      revision: this.revision,
      snapshot: this.snapshot,
      systemTokens,
    }
  }

  /**
   * Вернуть текущий снимок контекста.
   */
  getSnapshot(): ContextSnapshot[] {
    return [...this.snapshot]
  }

  /**
   * Вернуть текущую ревизию.
   */
  getRevision(): number {
    return this.revision
  }

  /**
   * Оценить токены системного промпта из снимка.
   */
  estimateSystemTokens(): number {
    return this.snapshot.reduce(
      (sum, s) => sum + estimateTokens(s.content),
      0,
    )
  }

  /**
   * Сбросить состояние (новый сеанс).
   */
  reset(): void {
    this.snapshot = []
    this.revision = 0
    this.previousContent.clear()
  }

  /**
   * Освободить ресурсы и очистить состояние.
   */
  dispose(): void {
    this.providers = []
    this.snapshot = []
    this.previousContent.clear()
    this.revision = 0
  }
}

// ── Утилиты ───────────────────────────────────────────────

function extractContent(items: ContextItem[]): string {
  if (items.length === 0) return ""
  return items.map((i) => i.content).join("\n\n")
}
