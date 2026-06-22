import type { IToolResult } from "../agent/AgentTypes"

/**
 * Схема инструмента на основе подмножества JSON Schema
 * (имя, описание, параметры).
 */
export interface IToolSchema {
  name: string
  description: string
  parameters: Record<string, IToolParam>
  required?: string[]
}

export interface IToolParam {
  type: "string" | "number" | "boolean" | "array" | "object"
  description?: string
  enum?: string[]
  items?: IToolParam
  properties?: Record<string, IToolParam>
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
  schema: IToolSchema

 /**
    * Выполнить инструмент с валидированными аргументами.
    * Возвращает структурированный результат с текстом вывода и флагом успеха.
    * @param signal сигнал отмены для длительных операций
    */
  execute(args: Record<string, unknown>, signal?: AbortSignal): Promise<IToolResult>

  /**
   * Безопасен ли инструмент для автоматического вызова.
   * Разрушительные инструменты (удаление, принудительная отправка) должны возвращать false.
   */
  readonly isSafe: boolean
}
