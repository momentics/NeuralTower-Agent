import { errorMessage } from "../core/errors"

/**
 * Результат безопасного выполнения функции.
 */
export interface SafeResult<T> {
  /** Успешно ли выполнилась функция */
  success: boolean
  /** Результат выполнения (при success: true) */
  value?: T
  /** Сообщение об ошибке (при success: false) */
  error?: string
}

/**
 * Безопасно выполнить асинхронную функцию, перехватывая все ошибки.
 * Заменяет повсеместный паттерн try/catch с errorMessage.
 */
export async function safeExecute<T>(
  fn: () => Promise<T>,
  context: string = "operation",
): Promise<SafeResult<T>> {
  try {
    const value = await fn()
    return { success: true, value }
  } catch (err: unknown) {
    return { success: false, error: `${context}: ${errorMessage(err)}` }
  }
}

/**
 * Безопасно выполнить синхронную функцию, перехватывая все ошибки.
 */
export function safeExecuteSync<T>(
  fn: () => T,
  context: string = "operation",
): SafeResult<T> {
  try {
    const value = fn()
    return { success: true, value }
  } catch (err: unknown) {
    return { success: false, error: `${context}: ${errorMessage(err)}` }
  }
}
