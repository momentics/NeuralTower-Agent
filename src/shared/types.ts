/** Общие типы, используемые во всех модулях. */
export type { ChatMessage } from "../core/IBackend"
export type { BackendConfig } from "../core/IBackend"

/**
 * Сервис — базовый компонент с именем, без жизненного цикла.
 * Используйте для простых сервисов, которым не нужна инициализация.
 */
export interface Service {
  /** Имя сервиса. */
  name: string

  /** Версия (опционально). */
  version?: string
}

/**
 * Плагин — компонент с полным жизненным циклом.
 * Наследует Service и добавляет init/dispose.
 */
export interface Plugin extends Service {
  /** Инициализировать плагин. */
  init(): Promise<void>

  /** Освободить ресурсы плагина. */
  dispose(): void
}
