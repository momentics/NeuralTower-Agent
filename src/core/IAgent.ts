import type { ITool } from "../tools/ITool"
import type { ISkill } from "../skills/ISkill"
import type { IBackend, ChatMessage } from "./IBackend"

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
   * вызове инструмента.
   */
  run(
    query: string,
    onChunk: (text: string) => void,
    onToolUse?: (name: string, args: Record<string, unknown>) => void,
  ): Promise<ChatMessage>

  /** Контекст текущей рабочей директории. */
  setWorkingDir(dir: string): void

  /** Перезагрузить навыки и инструменты с диска/конфигурации. */
  reload(): Promise<void>

  /** Освободить ресурсы. */
  dispose(): void
}
