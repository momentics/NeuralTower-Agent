import type { ITool, ToolSchema } from "../ITool"
import type { ToolResult } from "../../agent/AgentTypes"
import type { TodoStore, TodoItem } from "../../agent/TodoStore"

/**
 * Инструмент управления списком задач.
 * TodoStore инжектируется через конструктор.
 */
export class TodoWriteTool implements ITool {
  name = "todowrite"
  description = "Управление списком задач для отслеживания прогресса. Используйте для сложных многоступенчатых задач: при получении новых инструкций, после завершения шага, при начале нового шага. Не используйте для тривиальных задач менее 3 шагов."
  category = "agent"
  isSafe = true

  schema: ToolSchema = {
    name: "todowrite",
    description: this.description,
    parameters: {
      todos: {
        type: "array",
        description: "Обновлённый список задач",
        items: {
          type: "object",
          properties: {
            content: { type: "string", description: "Краткое описание задачи" },
            status: {
              type: "string",
              description: "Статус: pending, in_progress, completed, cancelled",
              enum: ["pending", "in_progress", "completed", "cancelled"],
            },
            priority: {
              type: "string",
              description: "Приоритет: high, medium, low",
              enum: ["high", "medium", "low"],
            },
          },
        },
      },
    },
    required: ["todos"],
  }

  constructor(private readonly todoStore: TodoStore) {}

  async execute(args: Record<string, unknown>, _signal?: AbortSignal): Promise<ToolResult> {
    const todos = args.todos as TodoItem[] | undefined
    if (!todos || !Array.isArray(todos)) {
      return {
        output: "Ошибка: параметр todos должен быть массивом",
        success: false,
      }
    }

    this.todoStore.setItems(todos)

    const output = this.todoStore.formatItems()

    return {
      output,
      success: true,
    }
  }
}
