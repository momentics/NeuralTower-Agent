import type {
  ContextSource,
  ContextSnapshot,
  PreparedContext,
  SourceReconcileResult,
} from "./ContextSource"

const TOKENS_PER_CHAR = 0.25
const DEFAULT_TOKEN_BUDGET = 16000

/**
 * ContextManager управляет источниками контекста, строит
 * baseline системного промпта, согласует изменения между
 * ходами агента и отслеживает потребление токенов.
 *
 * Архитектура вдохновлена opencode SystemContext:
 * каждый источник — это типизированный блок с load/baseline/update.
 * ContextManager объединяет источники, создаёт снимок на
 * начало эпохи и согласует изменения при повторных запросах.
 *
 * Token budget: источники сортируются по приоритету и
 * добавляются пока сумма токенов не превысит бюджет.
 * Это защищает от переполнения контекста при огромных
 * файлах и правилах.
 */
export class ContextManager {
  private sources: ContextSource[] = []
  private snapshot: ContextSnapshot[] = []
  private revision = 0
  private previousValues: Map<string, unknown> = new Map()
  private tokenBudget = DEFAULT_TOKEN_BUDGET

  /**
   * Зарегистрировать источник контекста.
   */
  register(source: ContextSource): void {
    this.sources.push(source)
  }

  /**
   * Удалить источник по ключу.
   */
  unregister(key: string): void {
    this.sources = this.sources.filter((s) => s.key !== key)
  }

  /**
   * Установить бюджет токенов для системного промпта.
   * Источники с низким приоритетом будут отброшены,
   * если общая сумма токенов превышает бюджет.
   */
  setTokenBudget(budget: number): void {
    this.tokenBudget = budget
  }

  /**
   * Вернуть текущий бюджет токенов.
   */
  getTokenBudget(): number {
    return this.tokenBudget
  }

  /**
   * Вернуть все зарегистрированные источники.
   */
  list(): ContextSource[] {
    return [...this.sources]
  }

  /**
   * Инициализировать контекст: загрузить все источники,
   * создать baseline и сохранить снимок.
   *
   * Вызывается один раз на начало эпохи сессии.
   */
  async initialize(): Promise<PreparedContext> {
    const snapshots: ContextSnapshot[] = []
    const baselineParts: string[] = []
    this.previousValues.clear()
    this.revision = 1
    let usedTokens = 0

    const sorted = [...this.sources].sort(
      (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
    )

    for (const source of sorted) {
      try {
        const value = await source.load()
        if (value === undefined) continue

        const baseline = source.baseline(value)
        const tokens = estimateTokens(baseline)

        if (usedTokens + tokens > this.tokenBudget && baselineParts.length > 0) {
          continue
        }

        usedTokens += tokens
        this.previousValues.set(source.key, value)
        baselineParts.push(baseline)

        snapshots.push({
          key: source.key,
          value: serializeValue(value),
          baseline,
          revision: this.revision,
        })
      } catch {
        // Источник недоступен — пропускаем
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
   * Подготовить контекст для следующего хода: согласовать
   * источники с предыдущим снимком, вернуть обновлённый
   * системный промпт и дельты.
   *
   * Если источники не изменились — возвращает baseline без дельт.
   */
  async prepare(): Promise<PreparedContext> {
    const deltas: string[] = []
    const newSnapshots: ContextSnapshot[] = []
    this.revision++

    const sorted = [...this.sources].sort(
      (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
    )

    for (const source of sorted) {
      try {
        const current = await source.load()
        const previous = this.previousValues.get(source.key)

        const reconcile = this.reconcile(source, previous, current)

        if (reconcile._tag === "updated") {
          deltas.push(reconcile.text)
        } else if (reconcile._tag === "removed") {
          deltas.push(reconcile.text)
        }

        if (current !== undefined) {
          this.previousValues.set(source.key, current)
          const baseline = source.baseline(current)
          newSnapshots.push({
            key: source.key,
            value: serializeValue(current),
            baseline,
            revision: this.revision,
          })
        } else {
          this.previousValues.delete(source.key)
        }
      } catch {
        // Источник недоступен
      }
    }

    this.snapshot = newSnapshots

    const deltaBlock =
      deltas.length > 0
        ? `\n## Изменения контекста (ревизия ${this.revision})\n${deltas.join("\n\n")}`
        : ""

    const basePrompt = this.snapshot
      .map((s) => s.baseline)
      .join("\n\n")

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
      (sum, s) => sum + estimateTokens(s.baseline),
      0,
    )
  }

  /**
   * Сбросить состояние (новый сеанс).
   */
  reset(): void {
    this.sources = []
    this.snapshot = []
    this.revision = 0
    this.previousValues.clear()
  }

  private reconcile(
    source: ContextSource,
    previous: unknown,
    current: unknown,
  ): SourceReconcileResult {
    if (current === undefined && previous !== undefined) {
      const text = source.removed?.(previous) ?? `Источник "${source.key}" удалён`
      return { _tag: "removed", text }
    }

    if (current === undefined || previous === undefined) {
      return { _tag: "unchanged" }
    }

    if (!valuesEqual(previous, current)) {
      const text = source.update(previous, current)
      return { _tag: "updated", text }
    }

    return { _tag: "unchanged" }
  }
}

// ── Утилиты ───────────────────────────────────────────────

function estimateTokens(text: string): number {
  return Math.ceil(text.length * TOKENS_PER_CHAR)
}

function serializeValue(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return String(value)
  }
}

function valuesEqual(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return a === b
  }
}
