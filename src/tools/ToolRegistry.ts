import type { ITool } from "./ITool"
import type { IToolResult } from "../agent/AgentTypes"
import { safeExecute } from "../core/Errors"
import { sanitizeToolName } from "./ToolNames"
import { createDomainLogger } from "../core/Logger"

const log = createDomainLogger("ToolRegistry")

/**
 * Интерфейс реестра инструментов — методы регистрации.
 * Используется компонентами, которые только добавляют/удаляют инструменты.
 */
export interface IToolRegistrar {
  register(tool: ITool): void
  registerMany(tools: ITool[]): void
  unregister(name: string): void
  clear(): void
}

/**
 * Интерфейс реестра инструментов — методы запроса.
 * Используется компонентами, которые только читают список инструментов.
 */
export interface IToolQuerier {
  list(): ITool[]
  get(name: string): ITool | undefined
  toToolDefinitions(): Array<{ name: string; description: string; parameters: Record<string, unknown> }>
}

/**
 * Интерфейс реестра инструментов — вызов.
 * Используется компонентами, которые только вызывают инструменты.
 */
export interface IToolInvoker {
  invoke(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<IToolResult>
}

/**
 * Полный интерфейс реестра инструментов (объединение всех ролей).
 */
export interface IToolRegistry extends IToolRegistrar, IToolQuerier, IToolInvoker {}

/**
 * Преобразовать IToolSchema в формат OpenAI JSON Schema.
 */
export function toOpenAISchema(schema: import("./ITool").IToolSchema): Record<string, unknown> {
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
  parameters: Record<string, import("./ITool").IToolParam>,
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
      case "object":
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
          errors.push(`${key}: ожидался object, получен ${typeof value}`)
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
  ): Promise<IToolResult> {
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
    const result = await safeExecute(() => tool.execute(args, signal))
    if (result.ok) return { ...result.value, durationMs: Date.now() - start }
    return {
      output: `Инструмент "${name}" не выполнен: ${result.error}`,
      success: false,
      durationMs: Date.now() - start,
    }
  }

  /**
   * Сформировать JSON Schema для tool_choice / вызова функций.
   */
  toToolDefinitions(): Array<{ name: string; description: string; parameters: Record<string, unknown> }> {
    return this.list().map((t) => {
      const name = sanitizeToolName(t.name)
      if (name !== t.name) {
        log.warn(`Имя инструмента «${t.name}» некорректно для API — используется «${name}»`)
      }
      return {
        name,
        description: t.description,
        parameters: toOpenAISchema(t.schema),
      }
    })
  }

  /** Очистить все инструменты. */
  clear(): void {
    this.tools.clear()
  }
}
