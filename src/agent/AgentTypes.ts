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
  toolName: string
  arguments: Record<string, unknown>
}

/**
 * Результат выполнения инструмента.
 */
export interface IToolResult {
  output: string
  success: boolean
  durationMs?: number
}
