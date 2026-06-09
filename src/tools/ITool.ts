import type { ToolResult } from "../agent/AgentTypes"

/**
 * Схема инструмента на основе подмножества JSON Schema
 * (имя, описание, параметры).
 */
export interface ToolSchema {
  name: string
  description: string
  parameters: Record<string, ToolParam>
  required?: string[]
}

export interface ToolParam {
  type: "string" | "number" | "boolean" | "array" | "object"
  description?: string
  enum?: string[]
  items?: ToolParam
  properties?: Record<string, ToolParam>
  default?: unknown
}

/**
 * Интерфейс инструмента. Каждый инструмент автономен и не хранит состояние.
 */
export interface ITool {
  /** Уникальное имя инструмента. */
  name: string

  /** Описание для понимания моделью. */
  description: string

  /** Категория: файловая система, процесс, сеть, ИИ и т. д. */
  category: string

  /** JSON Schema для параметров. */
  schema: ToolSchema

  /**
   * Выполнить инструмент с валидированными аргументами.
   * Возвращает структурированный результат с текстом вывода и флагом успеха.
   */
  execute(args: Record<string, unknown>): Promise<ToolResult>

  /**
   * Безопасен ли инструмент для автоматического вызова.
   * Разрушительные инструменты (удаление, принудительная отправка) должны возвращать false.
   */
  readonly isSafe: boolean
}
