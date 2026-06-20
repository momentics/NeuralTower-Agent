/** Общие типы, используемые во всех модулях. */
export type { ChatMessage } from "../core/IBackend"
export type { BackendConfig } from "../core/IBackend"

export interface Plugin {
  name: string
  version?: string
  init(): Promise<void>
  dispose(): void
}
