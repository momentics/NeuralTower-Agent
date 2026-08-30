import { PlanError } from "../core/Errors"

const DEFAULT_PLAN_MAX_RETRIES = 3

/**
 * Состояние шага плана.
 */
export type IPlanStepStatus = "pending" | "running" | "done" | "failed" | "skipped"

/**
 * Шаг плана с отслеживанием состояния.
 */
export interface IPlanStep {
  /** Описание шага. */
  description: string

  /** Предлагаемые инструменты для выполнения. */
  suggestedTools: string[]

  /** Зависимости от других шагов (индексы). */
  dependsOn?: number[]

  /** Текущее состояние выполнения. */
  status: IPlanStepStatus

  /** Количество попыток выполнения. */
  attempts: number

  /** Результат выполнения (при завершении). */
  result?: string

  /** Ошибка (при провале). */
  error?: string
}

/**
 * Запись истории репланирования.
 */
export interface IReplanEntry {
  /** Причина репланирования. */
  reason: string

  /** Номер попытки репланирования. */
  attempt: number

  /** Временная метка. */
  timestamp: number
}

/**
 * Состояние плана в целом.
 */
export type PlanStatus = "draft" | "running" | "paused" | "completed" | "failed"

/**
 * План задачи с полным отслеживанием состояния.
 *
 * Управляет прогрессом шагов и поддерживает передачу
 * управления между сессиями. Файловый ввод-вывод
 * вынесен в PlanRepository (SRP).
 */
export class Plan {
  /** Уникальный идентификатор плана. */
  public readonly id: string

  /** Заголовок плана (из запроса пользователя). */
  public title: string

  /** Идентификатор сессии, в которой план создан (для наблюдения за статусом). */
  public sessionId?: string

  /** Обоснование плана от LLM. */
  public reasoning: string

  /** Шаги плана. */
  public steps: IPlanStep[]

  /** Текущее состояние плана. */
  public status: PlanStatus

  /** Индекс текущего выполняемого шага. */
  public currentStepIndex: number

  /** Максимальное число повторных попыток на шаг. */
  public maxRetries: number

  /** Время создания. */
  public readonly createdAt: number

  /** Время последнего обновления. */
  public updatedAt: number

  /** Путь к файлу плана (для сохранения). */
  public filePath?: string

  /** Данные для передачи управления между сессиями. */
  public transferData?: IPlanHandover

  /** История репланирования. */
  public replanHistory: IReplanEntry[]

  constructor(input: {
    id?: string
    title: string
    reasoning: string
    steps: Omit<IPlanStep, "status" | "attempts">[]
    maxRetries?: number
    sessionId?: string
  }) {
    this.id = input.id ?? `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    this.title = input.title
    this.sessionId = input.sessionId
    this.reasoning = input.reasoning
    this.steps = input.steps.map((s) => ({
      ...s,
      status: "pending",
      attempts: 0,
    }))
    this.status = "draft"
    this.currentStepIndex = 0
    this.maxRetries = input.maxRetries ?? DEFAULT_PLAN_MAX_RETRIES
    this.createdAt = Date.now()
    this.updatedAt = this.createdAt
    this.replanHistory = []
  }

  /**
   * Вернуть количество завершённых шагов.
   */
  get completedCount(): number {
    return this.steps.filter((s) => s.status === "done").length
  }

  /**
   * Вернуть количество проваленных шагов.
   */
  get failedCount(): number {
    return this.steps.filter((s) => s.status === "failed").length
  }

  /**
   * Записать событие репланирования в историю.
   */
  recordReplan(reason: string, attempt: number): void {
    this.replanHistory.push({ reason, attempt, timestamp: Date.now() })
  }

  /**
   * Вернуть количество оставшихся шагов.
   */
  get remainingCount(): number {
    return this.steps.length - this.completedCount - this.failedCount
  }

  /**
   * Прогресс выполнения в процентах.
   */
  get progress(): number {
    if (this.steps.length === 0) return 0
    return Math.round((this.completedCount / this.steps.length) * 100)
  }

  /**
   * Текущий шаг (или null, если план завершён).
   */
  get currentStep(): IPlanStep | null {
    if (
      this.currentStepIndex >= 0 &&
      this.currentStepIndex < this.steps.length
    ) {
      return this.steps[this.currentStepIndex]
    }
    return null
  }

  /**
   * Проверить, все ли зависимости шага выполнены.
   */
  dependenciesMet(stepIndex: number): boolean {
    const step = this.steps[stepIndex]
    if (!step || !step.dependsOn?.length) return true
    return step.dependsOn.every(
      (depIdx) => this.steps[depIdx]?.status === "done",
    )
  }

  /**
   * Начать выполнение плана.
   */
  start(): void {
    this.status = "running"
    this.updatedAt = Date.now()
    const step = this.currentStep
    if (step) {
      step.status = "running"
    }
  }

  /**
   * Отметить текущий шаг как выполняющийся.
   */
  markRunning(): IPlanStep | null {
    let step = this.currentStep
    if (!step || step.status === "done" || step.status === "failed") {
      this.advanceToNextPending()
      step = this.currentStep
    }
    if (!step) return null
    step.status = "running"
    step.attempts++
    this.updatedAt = Date.now()
    return step
  }

  /**
   * Отметить текущий шаг как завершённый.
   */
  markDone(result?: string): void {
    const step = this.currentStep
    if (!step) return
    step.status = "done"
    step.result = result
    this.updatedAt = Date.now()
    this.advanceToNextPending()
    this.checkCompletion()
  }

  /**
   * Отметить текущий шаг как проваленный.
   */
  markFailed(error: string): void {
    const step = this.currentStep
    if (!step) return
    step.error = error
    this.updatedAt = Date.now()

    if (step.attempts < this.maxRetries) {
      step.status = "pending"
    } else {
      step.status = "failed"
    }
    this.checkCompletion()
  }

  /**
   * Вернуть план в состояние черновика.
   */
  reset(): void {
    this.status = "draft"
    this.currentStepIndex = 0
    this.replanHistory = []
    for (const step of this.steps) {
      step.status = "pending"
      step.attempts = 0
      step.result = undefined
      step.error = undefined
    }
    this.updatedAt = Date.now()
  }

  /**
   * Сформировать текстовое представление плана для вставки
   * в разговор или для handover.
   */
  toText(): string {
    const statusIcon: Record<IPlanStepStatus, string> = {
      pending: "[ ]",
      running: "[→]",
      done: "[✓]",
      failed: "[✗]",
      skipped: "[−]",
    }

    const header = `## План: ${this.title}\n\n${this.reasoning}\n\n`
    const steps = this.steps
      .map(
        (s, i) =>
          `${i + 1}. ${statusIcon[s.status]} ${s.description}` +
          (s.suggestedTools.length
            ? ` (инструменты: ${s.suggestedTools.join(", ")})`
            : "") +
          (s.error ? `\n   Ошибка: ${s.error}` : "") +
          (s.result ? `\n   Результат: ${s.result.slice(0, 200)}` : ""),
      )
      .join("\n")

    const footer = `\n\nПрогресс: ${this.progress}% (${this.completedCount}/${this.steps.length})`

    let replanInfo = ""
    if (this.replanHistory.length > 0) {
      replanInfo = `\n\n## История репланирования (${this.replanHistory.length})\n`
      for (const entry of this.replanHistory) {
        replanInfo += `- Попытка ${entry.attempt}: ${entry.reason}\n`
      }
    }

    return header + steps + footer + replanInfo
  }

  /**
   * Сериализовать план в JSON.
   */
  toJSON(): IPlanSerialized {
    return {
      id: this.id,
      title: this.title,
      sessionId: this.sessionId,
      reasoning: this.reasoning,
      steps: this.steps,
      status: this.status,
      currentStepIndex: this.currentStepIndex,
      maxRetries: this.maxRetries,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      handover: this.transferData,
      replanHistory: this.replanHistory,
    }
  }

  /**
   * Десериализовать план из JSON.
   */
  static fromJSON(data: IPlanSerialized): Plan {
    const plan = new Plan({
      id: data.id,
      title: data.title,
      reasoning: data.reasoning,
      steps: data.steps.map(({ status, attempts, ...rest }) => rest),
      maxRetries: data.maxRetries,
    })
    plan.status = data.status
    plan.sessionId = data.sessionId
    plan.currentStepIndex = data.currentStepIndex
    // createdAt — только для чтения, используется значение из конструктора
    plan.updatedAt = data.updatedAt
    plan.transferData = data.handover
    plan.replanHistory = data.replanHistory ?? []
    for (const [i, step] of data.steps.entries()) {
      plan.steps[i].status = step.status
      plan.steps[i].attempts = step.attempts
      plan.steps[i].result = step.result
      plan.steps[i].error = step.error
    }
    return plan
  }

  private advanceToNextPending(): void {
    for (let i = this.currentStepIndex + 1; i < this.steps.length; i++) {
      if (this.steps[i].status === "pending") {
        if (this.dependenciesMet(i)) {
          this.currentStepIndex = i
          return
        }
      }
    }
  }

  private checkCompletion(): void {
    if (this.completedCount + this.failedCount === this.steps.length) {
      this.status = this.failedCount > 0 ? "failed" : "completed"
    }
  }
}

/**
 * Данные для передачи между сессиями (handover).
 */
export interface IPlanHandover {
  planId: string
  title: string
  reasoning: string
  progress: number
  completedSteps: { description: string; result?: string }[]
  remainingSteps: { description: string; suggestedTools: string[] }[]
  failedSteps: { description: string; error?: string }[]
  generatedAt: number
}

/**
 * Сериализуемая форма плана.
 */
export interface IPlanSerialized {
  id: string
  title: string
  sessionId?: string
  reasoning: string
  steps: IPlanStep[]
  status: PlanStatus
  currentStepIndex: number
  maxRetries: number
  createdAt: number
  updatedAt: number
  handover?: IPlanHandover
  replanHistory?: IReplanEntry[]
}
