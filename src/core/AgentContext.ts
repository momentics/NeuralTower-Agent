import type { IBackend } from "./IBackend"
import type { ITool } from "../tools/ITool"
import type { ISkill } from "../skills/ISkill"
import type { IAgentOrchestrator } from "./IAgent"

/**
 * Общий изменяемый контекст, передаваемый компонентам цикла агента.
 * Содержит инструменты, навыки, состояние репозитория, память
 * и конфигурацию для одной сессии.
 */
export interface AgentContext {
  /** Бэкенд для вызовов модели. */
  backend: IBackend

  /** Доступные инструменты. */
  tools: ITool[]

  /** Активные навыки на текущем шаге. */
  skills: ISkill[]

  /** Рабочая директория. */
  workDir: string

  /** Инструкции системного запроса (базовые + навыки). */
  systemPrompt: string

  /** История разговора. */
  history: string

  /** Максимальное число итераций вызова инструментов за ход. Предотвращает бесконечные циклы. */
  maxIterations: number

  /** Тайм-аут одного вызова инструмента в миллисекундах. */
  toolTimeoutMs: number
}
