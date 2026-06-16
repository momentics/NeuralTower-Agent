import type { IBackend } from "../core/IBackend"
import type { ToolRegistry } from "../tools/ToolRegistry"
import { Plan } from "./Plan"
import type { SessionContext } from "./SessionContext"

export class AgentPlanner {
  private currentPlan: Plan | null = null

  constructor(
    private readonly backend: IBackend,
    private readonly toolRegistry: ToolRegistry,
    private readonly sessionContext: SessionContext | null,
  ) {}

  async createPlan(
    query: string,
  ): Promise<Plan> {
    const toolList = this.toolRegistry
      .list()
      .map((t) => `- ${t.name}: ${t.description}`)
      .join("\n")

    const planningPrompt = `Вы — планировщик задач. Получив пользовательский запрос и доступные инструменты,
разбейте задачу на последовательные шаги. Каждый шаг должен быть конкретным и выполнимым.
Доступные инструменты:
${toolList}

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
      ])

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
    } catch {
      const plan = new Plan({
        title: query.slice(0, 80),
        reasoning: "Простой одношаговый план",
        steps: [{ description: query, suggestedTools: [] }],
      })
      this.currentPlan = plan
      plan.start()
      return plan
    }
  }

  clearPlan(): void {
    this.currentPlan = null
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
