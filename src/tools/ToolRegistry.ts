import type { ITool } from "./ITool"
import type { ToolResult } from "../agent/AgentTypes"
import { ToolError } from "../core/errors"

/**
 * Интерфейс реестра инструментов.
 */
export interface IToolRegistry {
  register(tool: ITool): void
  registerMany(tools: ITool[]): void
  unregister(name: string): void
  list(): ITool[]
  get(name: string): ITool | undefined
  invoke(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult>
  toSchemaList(): string
  toToolDefinitions(): Array<{ name: string; description: string; parameters: Record<string, unknown> }>
  clear(): void
}

/**
 * Преобразовать ToolSchema в формат OpenAI JSON Schema.
 */
export function toOpenAISchema(schema: import("./ITool").ToolSchema): Record<string, unknown> {
  const result: Record<string, unknown> = {
    type: "object",
  }
  if (Object.keys(schema.parameters).length > 0) {
    result.properties = schema.parameters
  }
  if (schema.required && schema.required.length > 0) {
    result.required = schema.required
  }
  return result
}

/**
 * Проверить типы аргументов по схеме.
 * @returns массив сообщений об ошибках (пустой, если всё верно)
 */
function validateArgs(
  args: Record<string, unknown>,
  parameters: Record<string, import("./ITool").ToolParam>,
): string[] {
  const errors: string[] = []
  for (const [key, param] of Object.entries(parameters)) {
    const value = args[key]
    if (value === undefined || value === null) continue
    switch (param.type) {
      case "string":
        if (typeof value !== "string") {
          errors.push(`${key}: ожидался string, получен ${typeof value}`)
        }
        break
      case "number":
        if (typeof value !== "number" || !isFinite(value)) {
          errors.push(`${key}: ожидался числовой тип, получен ${typeof value}`)
        }
        break
      case "boolean":
        if (typeof value !== "boolean") {
          errors.push(`${key}: ожидался boolean, получен ${typeof value}`)
        }
        break
      case "array":
        if (!Array.isArray(value)) {
          errors.push(`${key}: ожидался массив, получен ${typeof value}`)
        }
        break
    }
  }
  return errors
}

/**
 * Центральный реестр всех доступных инструментов.
 * Инструменты загружаются из встроенных, MCP-серверов
 * или пакетов навыков.
 */
export class ToolRegistry implements IToolRegistry {
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
    signal?: AbortSignal,
  ): Promise<ToolResult> {
    const tool = this.tools.get(name)
    if (!tool) {
      return { output: `Инструмент "${name}" не найден`, success: false }
    }

    const required = tool.schema.required ?? []
    const missing = required.filter((k) => args[k] === undefined || args[k] === null)
    if (missing.length > 0) {
      return {
        output: `Инструмент "${name}": отсутствуют обязательные аргументы: ${missing.join(", ")}`,
        success: false,
      }
    }

    const typeErrors = validateArgs(args, tool.schema.parameters)
    if (typeErrors.length > 0) {
      return {
        output: `Инструмент "${name}": неверные типы аргументов: ${typeErrors.join("; ")}`,
        success: false,
      }
    }

    const start = Date.now()
    try {
      const result = await tool.execute(args, signal)
      return { ...result, durationMs: Date.now() - start }
    } catch (err: unknown) {
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
  toToolDefinitions(): Array<{ name: string; description: string; parameters: Record<string, unknown> }> {
    return this.list().map((t) => ({
      name: t.name,
      description: t.description,
      parameters: toOpenAISchema(t.schema),
    }))
  }

  /** Очистить все инструменты. */
  clear(): void {
    this.tools.clear()
  }
}
