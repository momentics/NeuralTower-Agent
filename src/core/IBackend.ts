/**
 * Интерфейс бэкенда искусственного интеллекта.
 * Может быть заменён на любого другого провайдера моделей.
 */
export interface IBackend {
  /** Вернуть список доступных моделей. */
  listModels(): Promise<string[]>

  /** Проверить доступность бэкенда. */
  healthCheck(): Promise<boolean>

  /**
   * Отправить чат-запрос с потоковой передачей ответа.
   * Обработчик `onChunk` вызывается для каждого токена.
   * По завершении возвращается полное сообщение помощника.
   * Параметр `tools` передаёт определения инструментов для нативного function calling.
   */
  chat(messages: ChatMessage[], onChunk: (text: string) => void, tools?: ToolDefinition[]): Promise<ChatMessage>

  /**
   * Отправить чат-запрос с ожиданием структурированного JSON-ответа.
   * Используется для вызова инструментов, планирования и т. д.
   */
  chatJson<T>(messages: ChatMessage[]): Promise<T>

  /** Текущая конфигурация. */
  getConfig(): Promise<BackendConfig>

  /** Обновить конфигурацию. */
  updateConfig(partial: Partial<BackendConfig>): Promise<void>
}

export interface BackendConfig {
  url: string
  model: string
  maxRetries: number
  timeoutMs: number
}

export interface ChatMessage {
  role: "system" | "user" | "assistant"
  content: string
  toolCalls?: ToolCall[]
  timestamp?: number
}

export interface ToolCall {
  id: string
  toolName: string
  arguments: string
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: object
}
