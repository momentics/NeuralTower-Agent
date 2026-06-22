import type { ITool, ToolSchema } from "../ITool"
import type { ToolResult } from "../../agent/AgentTypes"
import { errorMessage } from "../../core/Errors"

/**
 * Базовый класс для инструментов, которые не работают с файловой системой.
 * Обеспечивает единый паттерн: проверка AbortSignal → выполнение → обработка ошибок.
 */
export abstract class BaseTool implements ITool {
  abstract name: string
  abstract description: string
  abstract category: string
  abstract isSafe: boolean
  abstract schema: ToolSchema

  /**
   * Абстрактный метод для выполнения логики инструмента.
   * Вызывается после проверки AbortSignal.
   */
  protected abstract doExecute(
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<ToolResult>

  /**
   * Стандартный execute с проверкой AbortSignal и обработкой ошибок.
   */
  async execute(args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
    if (signal?.aborted) return { output: "Операция отменена", success: false }
    try {
      return await this.doExecute(args, signal)
    } catch (err: unknown) {
      return {
        output: `Не удалось выполнить ${this.name}: ${errorMessage(err)}`,
        success: false,
      }
    }
  }
}
