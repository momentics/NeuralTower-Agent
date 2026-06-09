import type { IBackend, ChatMessage } from "../core/IBackend"
import type { ITool } from "../tools/ITool"

export interface PlannerStep {
  description: string
  suggestedTools: string[]
  dependsOn?: number[]
}

export interface AgentPlan {
  steps: PlannerStep[]
  reasoning: string
}

/**
 * Планировщик задач на основе языковой модели. Разбивает
 * сложные пользовательские запросы на последовательные шаги
 * с предлагаемыми инструментами и отслеживанием зависимостей.
 */
export class AgentPlanner {
  private readonly planningPrompt = `Вы — планировщик задач. Получив пользовательский запрос и доступные инструменты,
разбейте задачу на последовательные шаги. Каждый шаг должен быть конкретным и выполнимым.
Доступные инструменты:
{{TOOLS}}

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

  constructor(
    private readonly backend: IBackend | null,
  ) {}

  async plan(query: string, tools: ITool[]): Promise<AgentPlan> {
    if (!this.backend) {
      return this.fallbackPlan(query)
    }

    const toolList = tools.map((t) => `- ${t.name}: ${t.description}`).join("\n")
    const prompt = this.planningPrompt.replace("{{TOOLS}}", toolList)

    try {
      const messages: ChatMessage[] = [
        { role: "system", content: prompt, timestamp: Date.now() },
        { role: "user", content: query, timestamp: Date.now() },
      ]
      const result = await this.backend.chatJson<AgentPlan>(messages)
      return result
    } catch {
      return this.fallbackPlan(query)
    }
  }

  shouldReplan(stepIndex: number, toolSucceeded: boolean, maxRetries = 3): boolean {
    return !toolSucceeded && stepIndex < maxRetries
  }

  private fallbackPlan(query: string): AgentPlan {
    return {
      reasoning: "Простой одношаговый план (планировщик недоступен)",
      steps: [
        {
          description: query,
          suggestedTools: [],
        },
      ],
    }
  }
}
