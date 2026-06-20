import type { ITool } from "../tools/ITool"
import type { ISkill } from "../skills/ISkill"
import type { IBackend, ChatMessage } from "./IBackend"
import type { Plan } from "../agent/Plan"
import type { ToolResult } from "../agent/AgentTypes"

/**
 * Интерфейс оркестратора агента. Управляет циклом агента:
 * планирование → выбор инструментов → выполнение → наблюдение →
 * уточнение → ответ.
 */
export interface IAgentOrchestrator {
  /**
   * Запустить агент на пользовательском сообщении.
   * Обработчик `onChunk` вызывается для потоковой передачи
   * текста в интерфейс. Обработчик `onToolUse` вызывается при
   * вызове инструмента. `signal` позволяет отменить выполнение.
   */
  run(
    query: string,
    onChunk: (text: string) => void,
    onToolUse?: (name: string, args: Record<string, unknown>) => void,
    onToolResult?: (name: string, result: ToolResult) => void,
    signal?: AbortSignal,
  ): Promise<ChatMessage>

  /** Перезагрузить навыки и инструменты с диска/конфигурации. */
  reload(): Promise<void>

  /** Освободить ресурсы. */
  dispose(): void

  /** Восстановить контекст сессии из истории сообщений. */
  restoreSession(messages: ChatMessage[]): Promise<void>

  /** Сбросить контекст сессии (новый чат / переключение сессии). */
  resetSession(): void

  /** Очистить текущий план. */
  clearPlan(): void

  /** Вернуть текущий план (или null, если плана нет). */
  getPlan(): Plan | null
}
