import type { IBackendConfig } from "../core/IBackend"

/** Тестовый адрес бэкенда для фикстур. */
export const TEST_BACKEND_URL = "http://localhost:30000"

/** Стандартная тестовая конфигурация бэкенда. */
export function makeTestBackendConfig(overrides: Partial<IBackendConfig> = {}): IBackendConfig {
  return {
    url: TEST_BACKEND_URL,
    model: "test-model",
    maxRetries: 3,
    timeoutMs: 60000,
    ...overrides,
  }
}
