import type { IBackend } from "../core/IBackend"
import type { IToolRegistry } from "../tools/ToolRegistry"
import { Plan } from "./Plan"
import type { IPlanStep } from "./Plan"
import { createDomainLogger } from "../core/Logger"
import { errorMessage } from "../core/Errors"

const log = createDomainLogger("Replanner")

/**
 * Результат репланирования.
 */
export interface IReplanResult {
  /** Новый план (или null, если реплан не выполнен). */
  plan: Plan | null

  /** Причина репланирования. */
  reason: string

  /** Номер попытки репланирования. */
  attempt: number
}

/**
 * Replanner — адаптивный репланировщик.
 *
 * Когда шаг плана провалился после всех попыток, Replanner
 * запрашивает LLM создать обновлённый план с учётом:
 * - Текущего состояния плана
 * - Ошибки провала
 * - Результатов предыдущих шагов
 *
 * Если LLM недоступен, создаёт одношаговый план завершения.
 */
export class Replanner {
  constructor(
    private readonly backend: IBackend,
    private readonly toolRegistry: IToolRegistry,
  ) {}

  /**
   * Создать обновлённый план после провала шага.
   *
   * @param plan — текущий план (с проваленным шагом)
   * @param failedStep — проваленный шаг
   * @param error — ошибка, приведшая к провалу
   * @param attempt — номер попытки репланирования
   */
  async replan(
    plan: Plan,
    failedStep: IPlanStep,
    error: string,
    attempt: number,
  ): Promise<IReplanResult> {
    const reason = `Шаг "${failedStep.description}" провалился: ${error}`

    try {
      const newPlan = await this.requestReplan(plan, failedStep, error, attempt)
      return { plan: newPlan, reason, attempt }
    } catch (err: unknown) {
      const msg = errorMessage(err)
      log.error(`Повторное планирование не выполнено: ${msg}`)
      return { plan: this.fallbackPlan(plan, failedStep, error), reason, attempt }
    }
  }

  private async requestReplan(
    plan: Plan,
    failedStep: IPlanStep,
    error: string,
    attempt: number,
  ): Promise<Plan> {
    const toolList = this.toolRegistry
      .list()
      .map((t) => `- ${t.name}: ${t.description}`)
      .join("\n")

    const completedSteps = plan.steps
      .filter((s) => s.status === "done")
      .map((s) => `- [✓] ${s.description}${s.result ? ` → ${s.result.slice(0, 100)}` : ""}`)
      .join("\n")

    const remainingSteps = plan.steps
      .filter((s) => s.status !== "done" && s.status !== "failed")
      .map((s) => `- [ ] ${s.description}`)
      .join("\n")

    const failedSteps = plan.steps
      .filter((s) => s.status === "failed")
      .map((s) => `- [✗] ${s.description} (ошибка: ${s.error ?? "неизвестно"})`)
      .join("\n")

    const replanPrompt = `Вы — адаптивный планировщик задач. Текущий план провалился на шаге и требует пересмотра.

Оригинальный план: ${plan.title}
Обоснование: ${plan.reasoning}

Выполнено (${completedSteps.length}):
${completedSteps || "  (нет)"}

Провалено (${failedSteps.length}):
${failedSteps || "  (нет)"}

Осталось (${remainingSteps.length}):
${remainingSteps || "  (нет)"}

Проваленный шаг: ${failedStep.description}
Ошибка: ${error}
Попыток репланирования: ${attempt}

Доступные инструменты:
${toolList}

Создайте обновлённый план, который:
1. Учитывает причину провала и избегает её повторения
2. Сохраняет уже выполненные шаги (не дублирует их)
3. Предлагает альтернативные подходы для проваленного шага
4. При необходимости добавляет новые промежуточные шаги

Ответьте корректным объектом JSON:
{
  "reasoning": "краткое обоснование нового плана",
  "steps": [
    {
      "description": "что выполнить на этом шаге",
      "suggestedTools": ["имя_инструмента"],
      "dependsOn": []
    }
  ]
}

Включайте только шаги, которые ещё нужно выполнить (не дублируйте завершённые).`

    const result = await this.backend.chatJson<{
      reasoning: string
      steps: { description: string; suggestedTools: string[]; dependsOn?: number[] }[]
    }>([
      { role: "system", content: replanPrompt, timestamp: Date.now() },
      { role: "user", content: "Создай обновлённый план с учётом провала.", timestamp: Date.now() },
    ])

    const newPlan = new Plan({
      title: plan.title,
      reasoning: result.reasoning,
      steps: result.steps,
      maxRetries: plan.maxRetries,
    })

    newPlan.start()
    return newPlan
  }

  private fallbackPlan(plan: Plan, failedStep: IPlanStep, error: string): Plan {
    return new Plan({
      title: plan.title,
      reasoning: `Адаптивное завершение: шаг "${failedStep.description}" провалился (${error}). LLM недоступен для репланирования.`,
      steps: [
        {
          description: `Завершить задачу с учётом ошибки: ${error}`,
          suggestedTools: [],
        },
      ],
      maxRetries: plan.maxRetries,
    })
  }
}
