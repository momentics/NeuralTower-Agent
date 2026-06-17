import type { ITool } from "./ITool"
import type { ToolResult } from "../agent/AgentTypes"
import { ToolError } from "../core/errors"

/**
 * Центральный реестр всех доступных инструментов.
 * Инструменты загружаются из встроенных, MCP-серверов
 * или пакетов навыков.
 */
export class ToolRegistry {
  private tools = new Map<string, ITool>()

  /** Зарегистрировать один инструмент. */
  register(tool: ITool): void {
    this.tools.set(tool.name, tool)
  }

  /** Зарегистрировать несколько инструментов. */
  registerMany(tools: ITool[]): void {
    for (const t of tools) this.tools.set(t.name, t)
  }

  /** Удалить инструмент по имени. */
  unregister(name: string): void {
    this.tools.delete(name)
  }

  /** Вернуть список всех зарегистрированных инструментов. */
  list(): ITool[] {
    return [...this.tools.values()]
  }

  /** Найти инструмент по имени. */
  get(name: string): ITool | undefined {
    return this.tools.get(name)
  }

  /** Выполнить инструмент по имени. Вернёт ошибку, если инструмент не найден. */
  async invoke(
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const tool = this.tools.get(name)
    if (!tool) {
      return { output: `Инструмент "${name}" не найден`, success: false }
    }
    const start = Date.now()
    try {
      const result = await tool.execute(args)
      if (result.durationMs === undefined) result.durationMs = Date.now() - start
      return result
    } catch (err) {
      const msg = err instanceof ToolError ? `${err.name}: ${err.message}` : err instanceof Error ? err.message : String(err)
      return {
        output: `Инструмент "${name}" не выполнен: ${msg}`,
        success: false,
        durationMs: Date.now() - start,
      }
    }
  }

  /**
   * Сформировать краткий список схем для системного запроса модели.
   * Модель получает эти данные, чтобы знать, какие инструменты доступны.
   */
  toSchemaList(): string {
    const entries = this.list().map((t) => {
      const params = Object.entries(t.schema.parameters).map(([k, p]) => {
        const req = (t.schema.required ?? []).includes(k) ? " (обязат.)" : ""
        return `  ${k}: ${p.type}${p.description ? ` — ${p.description}` : ""}${req}`
      }).join("\n")
      return `• ${t.name}: ${t.description}\n${params}`
    })
    return entries.length > 0
      ? `Доступные инструменты (вызывайте через JSON \{"tool": "...", "args": {...}\}):\n${entries.join("\n\n")}`
      : "Инструменты недоступны."
  }

  /**
   * Сформировать JSON Schema для tool_choice / вызова функций.
   */
  toToolDefinitions(): Array<{ name: string; description: string; parameters: object }> {
    return this.list().map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.schema,
    }))
  }

  /** Очистить все инструменты. */
  clear(): void {
    this.tools.clear()
  }
}
