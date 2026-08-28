import type { ITool } from "../tools/ITool"
import type { ISkill } from "../skills/ISkill"
import type { IBackend, IChatMessage } from "./IBackend"
import type { Plan } from "../agent/Plan"
import type { IToolResult } from "../agent/AgentTypes"
import type { AgentModeName, IAgentMode } from "../agent/AgentMode"

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
   * Обработчик `onCompaction` вызывается при компактизации истории.
   */
  run(
    query: string,
    onChunk: (text: string) => void,
    onToolUse?: (name: string, args: Record<string, unknown>) => void,
    onToolResult?: (name: string, result: IToolResult) => void,
    signal?: AbortSignal,
    onCompaction?: (tokensBefore: number, tokensAfter: number) => void,
  ): Promise<IChatMessage>

  /** Перезагрузить навыки и инструменты с диска/конфигурации. */
  reload(): Promise<void>

  /** Освободить ресурсы. */
  dispose(): void

  /** Восстановить контекст сессии из истории сообщений. */
  restoreSession(messages: IChatMessage[]): Promise<void>

  /** Сбросить контекст сессии (новый чат / переключение сессии). */
  resetSession(): void

  /** Очистить текущий план. */
  clearPlan(): void

  /** Вернуть текущий план (или null, если плана нет). */
  getPlan(): Plan | null

  /** Вернуть имя текущего режима. */
  getMode(): AgentModeName

  /** Вернуть полное описание текущего режима (имя, переходы, правила инструментов). */
  getModeInfo(): IAgentMode

  /** Переключить режим. Возвращает false, если переход не допустим. */
  switchMode(mode: AgentModeName): boolean

  /** Подписаться на события смены режима. Возвращает объект с dispose(). */
  onModeChanged(handler: (mode: AgentModeName) => void): { dispose(): void }
}
