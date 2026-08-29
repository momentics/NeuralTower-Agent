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
   * Параметр `signal` позволяет прервать запрос извне.
   */
  chat(messages: IChatMessage[], onChunk: (text: string) => void, tools?: IToolDefinition[], signal?: AbortSignal): Promise<IChatMessage>

  /**
   * Отправить чат-запрос с ожиданием структурированного JSON-ответа.
   * Используется для вызова инструментов, планирования и т. д.
   */
  chatJson<T>(messages: IChatMessage[]): Promise<T>

  /** Текущая конфигурация. */
  getConfig(): Promise<IBackendConfig>

  /** Текущий адрес бэкенда (синхронный доступ к in-memory конфигурации). */
  currentUrl(): string

  /** Обновить конфигурацию. */
  updateConfig(partial: Partial<IBackendConfig>): Promise<void>
}

export interface IBackendConfig {
  url: string
  model: string
  maxRetries: number
  timeoutMs: number
}

export interface IChatMessage {
  role: "system" | "user" | "assistant"
  content: string
  toolCalls?: IToolCall[]
  timestamp?: number
}

export interface IToolCall {
  id: string
  toolName: string
  arguments: string
}

export interface IToolDefinition {
  name: string
  description: string
  parameters: object
}
