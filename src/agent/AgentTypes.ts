/**
 * Результат агента за один вызов языковой модели.
 * Содержит либо итоговый текст, либо вызовы инструментов.
 */
export interface IAgentTurnResult {
  type: "text" | "tool_calls"
  content?: string
  toolCalls?: IAgentToolCall[]
  thinking?: string
}

export interface IAgentToolCall {
  /** Идентификатор вызова (от бэкенда или локальный). */
  id: string
  toolName: string
  arguments: Record<string, unknown>
}

/** Сгенерировать локальный id вызова инструмента (если бэкенд не прислал свой). */
export function makeLocalToolCallId(): string {
  return `call_nt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Результат выполнения инструмента.
 */
export interface IToolResult {
  output: string
  success: boolean
  durationMs?: number
}
