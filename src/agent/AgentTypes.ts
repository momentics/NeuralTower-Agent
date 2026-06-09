/**
 * Результат агента за один вызов языковой модели.
 * Содержит либо итоговый текст, либо вызовы инструментов.
 */
export interface AgentTurnResult {
  type: "text" | "tool_calls"
  content?: string
  toolCalls?: ToolCall[]
  thinking?: string
}

export interface ToolCall {
  toolName: string
  arguments: Record<string, unknown>
}

/**
 * Результат выполнения инструмента.
 */
export interface ToolResult {
  output: string
  success: boolean
  durationMs?: number
}
