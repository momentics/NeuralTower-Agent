export interface ITodoItem {
  content: string
  status: "pending" | "in_progress" | "completed" | "cancelled"
  priority: "high" | "medium" | "low"
}

/** Интерфейс хранилища задач. */
export interface ITodoStore {
  setItems(items: ITodoItem[]): void
  getItems(): ITodoItem[]
  clear(): void
  formatItems(): string
}

/**
 * Сервис управления списком задач.
 * Вынесен из TodoWriteTool чтобы не нарушать контракт ITool
 * (инструменты не должны хранить состояние).
 */
export class TodoStore implements ITodoStore {
  private items: ITodoItem[] = []

  /** Колбэк изменения списка задач (для живого обновления UI). */
  onDidChange?: (items: ITodoItem[]) => void

  setItems(items: ITodoItem[]): void {
    this.items = items
    this.onDidChange?.(this.getItems())
  }

  getItems(): ITodoItem[] {
    return [...this.items]
  }

  clear(): void {
    this.items = []
    this.onDidChange?.(this.items)
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
