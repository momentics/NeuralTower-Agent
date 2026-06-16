export interface TodoItem {
  content: string
  status: "pending" | "in_progress" | "completed" | "cancelled"
  priority: "high" | "medium" | "low"
}

/**
 * Сервис управления списком задач.
 * Вынесен из TodoWriteTool чтобы не нарушать контракт ITool
 * (инструменты не должны хранить состояние).
 */
export class TodoStore {
  private items: TodoItem[] = []

  setItems(items: TodoItem[]): void {
    this.items = items
  }

  getItems(): TodoItem[] {
    return [...this.items]
  }

  clear(): void {
    this.items = []
  }

  formatItems(): string {
    const active = this.items.filter((t) => t.status !== "completed" && t.status !== "cancelled")
    const completed = this.items.filter((t) => t.status === "completed")

    const lines = this.items.map((t, i) => {
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
