import type { ITool, ToolSchema } from "../ITool"
import type { ToolResult } from "../../agent/AgentTypes"
import type { TodoStore, TodoItem } from "../../agent/TodoStore"

/**
 * Инструмент управления списком задач.
 * Состояние хранится в TodoStore, который инжектируется через аргументы.
 * Это сохраняет контракт ITool — инструмент не хранит состояние.
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

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const todos = args.todos as TodoItem[] | undefined
    if (!todos || !Array.isArray(todos)) {
      return {
        output: "Ошибка: параметр todos должен быть массивом",
        success: false,
      }
    }

    const store = args._todoStore as TodoStore | undefined
    if (store) {
      store.setItems(todos)
    }

    const output = store ? store.formatItems() : this.formatItems(todos)

    return {
      output,
      success: true,
    }
  }

  private formatItems(items: TodoItem[]): string {
    const active = items.filter((t) => t.status !== "completed" && t.status !== "cancelled")
    const completed = items.filter((t) => t.status === "completed")

    const lines = items.map((t, i) => {
      const icon =
        t.status === "completed"
          ? "[x]"
          : t.status === "cancelled"
            ? "[-]"
            : t.status === "in_progress"
              ? "[~]"
              : "[ ]"
      return `${icon} [${i + 1}] ${t.content} (${t.priority})`
    })

    return `Список задач обновлён: ${active.length} активных, ${completed.length} завершено\n\n${lines.join("\n")}`
  }
}
