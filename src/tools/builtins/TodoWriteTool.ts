import type { ToolSchema } from "../ITool"
import type { ToolResult } from "../../agent/AgentTypes"
import type { TodoStore, TodoItem } from "../../agent/TodoStore"
import { BaseTool } from "./BaseTool"
import { arr } from "../ToolArgs"

/**
 * Допустимые значения для status и priority.
 */
const VALID_STATUSES = new Set(["pending", "in_progress", "completed", "cancelled"])
const VALID_PRIORITIES = new Set(["high", "medium", "low"])

/**
 * Инструмент управления списком задач.
 * TodoStore инжектируется через конструктор.
 */
export class TodoWriteTool extends BaseTool {
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

  constructor(private readonly todoStore: TodoStore) {
    super()
  }

  protected async doExecute(args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
    const todos = arr<Record<string, unknown>>(args, "todos")
    if (todos.length === 0) {
      return {
        output: "Ошибка: параметр todos должен быть непустым массивом",
        success: false,
      }
    }

    const validated: TodoItem[] = []

    for (const item of todos) {
      const content = typeof item.content === "string" ? item.content : ""
      const status = VALID_STATUSES.has(item.status as string) ? (item.status as TodoItem["status"]) : "pending"
      const priority = VALID_PRIORITIES.has(item.priority as string)
        ? item.priority as TodoItem["priority"]
        : "medium"

      validated.push({ content, status, priority })
    }

    this.todoStore.setItems(validated)

    const output = this.todoStore.formatItems()

    return {
      output,
      success: true,
    }
  }
}
