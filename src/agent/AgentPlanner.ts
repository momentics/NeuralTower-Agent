import type { IBackend, IChatMessage } from "../core/IBackend"
import type { IToolRegistry } from "../tools/ToolRegistry"
import type { ISkill } from "../skills/ISkill"
import type { IPlanStep } from "./Plan"
import { Plan } from "./Plan"
import type { SessionContext } from "./SessionContext"
import { AbortError, PlanError, errorMessage } from "../core/Errors"
import { Replanner } from "./Replanner"
import { PlanRepository } from "./PlanRepository"
import { createDomainLogger } from "../core/Logger"

const log = createDomainLogger("AgentPlanner")

/** Специальный префикс для системного сообщения с сериализованным планом. */
const PLAN_MESSAGE_PREFIX = "__PLAN__"

export class AgentPlanner {
  private currentPlan: Plan | null = null
  private replanAttemptCount = 0

  constructor(
    private readonly backend: IBackend,
    private readonly toolRegistry: IToolRegistry,
    private readonly sessionContext: SessionContext | null,
    private readonly replanner: Replanner,
    private readonly planRepo: PlanRepository,
  ) {}

  /**
   * Попытка репланирования после провала шага.
   *
   * @param maxAttempts — максимальное число попыток репланирования
   * @returns Новый план или null, если реплан невозможен
   */
  async attemptReplan(
    failedStep: IPlanStep,
    error: string,
    maxAttempts: number,
  ): Promise<Plan | null> {
    const plan = this.currentPlan
    if (!plan) return null

    if (this.replanAttemptCount >= maxAttempts) {
      return null
    }

    this.replanAttemptCount++

    const result = await this.replanner.replan(plan, failedStep, error, this.replanAttemptCount)

    if (result.plan) {
      plan.recordReplan(result.reason, result.attempt)
      this.currentPlan = result.plan
      if (this.sessionContext) {
        this.sessionContext.setPlan(result.plan)
      }
      return result.plan
    }

    return null
  }

  /**
   * Вернуть текущее число попыток репланирования.
   */
  getReplanAttemptCount(): number {
    return this.replanAttemptCount
  }

  /**
   * Сбросить счётчик попыток репланирования.
   */
  resetReplanAttempts(): void {
    this.replanAttemptCount = 0
  }

  /**
   * Десериализовать план из системного сообщения.
   */
  deserializePlan(msg: IChatMessage): Plan | null {
    if (msg.role !== "system" || !msg.content.startsWith(PLAN_MESSAGE_PREFIX)) {
      return null
    }
    try {
      const json = msg.content.slice(PLAN_MESSAGE_PREFIX.length)
      const data = JSON.parse(json)
      const plan = Plan.fromJSON(data)
      this.currentPlan = plan
      if (this.sessionContext) {
        this.sessionContext.setPlan(plan)
      }
      return plan
    } catch (err: unknown) {
      const msg = errorMessage(err)
      log.error(`Планирование не выполнено: ${msg}`)
      return null
    }
  }

  /**
   * Найти и восстановить план из истории сообщений сессии.
   */
  restorePlanFromMessages(messages: IChatMessage[]): Plan | null {
    for (let i = messages.length - 1; i >= 0; i--) {
      const plan = this.deserializePlan(messages[i])
      if (plan) return plan
    }
    return null
  }

  async createPlan(
    query: string,
    activeSkills?: ISkill[],
    signal?: AbortSignal,
  ): Promise<Plan> {
    const toolList = this.toolRegistry
      .list()
      .map((t) => `- ${t.name}: ${t.description}`)
      .join("\n")

    let skillsSection = ""
    if (activeSkills && activeSkills.length > 0) {
      skillsSection = `\nАктивные навыки:\n${activeSkills.map((s) => `- ${s.name}: ${s.description}`).join("\n")}`
    }

    const planningPrompt = `Вы — планировщик задач. Получив пользовательский запрос, доступные инструменты и навыки,
разбейте задачу на последовательные шаги. Каждый шаг должен быть конкретным и выполнимым.
Доступные инструменты:
${toolList}${skillsSection}

Ответьте корректным объектом JSON:
{
  "reasoning": "краткое обоснование вашего плана",
  "steps": [
    {
      "description": "что выполнить на этом шаге",
      "suggestedTools": ["имя_инструмента"],
      "dependsOn": []
    }
  ]
}

Держите план лаконичным. Обычно достаточно 3-7 шагов. Если шаг не требует конкретных инструментов, оставьте suggestedTools пустым.`

    try {
      const result = await this.backend.chatJson<{
        reasoning: string
        steps: { description: string; suggestedTools: string[]; dependsOn?: number[] }[]
      }>([
        { role: "system", content: planningPrompt, timestamp: Date.now() },
        { role: "user", content: query, timestamp: Date.now() },
      ], signal)

      const plan = new Plan({
        title: query.slice(0, 80),
        reasoning: result.reasoning,
        steps: result.steps,
      })

      this.currentPlan = plan
      plan.start()

      if (this.sessionContext) {
        this.sessionContext.setPlan(plan)
      }

      return plan
    } catch (err: unknown) {
      // Отмена пользователем — запасной план не нужен, пробрасываем.
      if (err instanceof AbortError) throw err
      if (err instanceof DOMException && err.name === "AbortError") throw new AbortError()
      // BackendError или PlanError — деградация к простому плану
      const plan = new Plan({
        title: query.slice(0, 80),
        reasoning: err instanceof PlanError ? `Ошибка планирования: ${err.message}` : "Простой одношаговый план",
        steps: [{ description: query, suggestedTools: [] }],
      })
      this.currentPlan = plan
      plan.start()
      return plan
    }
  }

  /**
   * Сохранить текущий план на диск (если есть).
   * Вызывается при каждом изменении статуса плана.
   */
  async persistPlan(): Promise<void> {
    if (!this.currentPlan) return
    try {
      await this.planRepo.save(this.currentPlan)
    } catch (err: unknown) {
      log.warn(`Не удалось сохранить план: ${errorMessage(err)}`)
    }
  }

  clearPlan(): void {
    this.currentPlan = null
    this.replanAttemptCount = 0
    if (this.sessionContext) {
      this.sessionContext.clearPlan()
    }
  }

  getPlan(): Plan | null {
    return this.currentPlan
  }

  setCurrentPlan(plan: Plan | null): void {
    this.currentPlan = plan
  }
}
