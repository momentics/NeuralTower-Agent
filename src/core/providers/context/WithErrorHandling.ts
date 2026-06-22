import type { IContextProvider, IContextItem } from "./Types"
import { errorMessage } from "../../Errors"

/**
 * Создать элемент-ошибку для провайдера контекста.
 */
export function errorItem(content: string, name: string): IContextItem {
  return { content, name, description: "error" }
}

/**
 * Обёртка resolve-метода провайдера контекста.
 *
 * Обрабатывает общий шаблон:
 * 1. Обрезка query, возврат [] при пустом запросе
 * 2. try/catch с errorMessage и возврат error IContextItem
 *
 * @param name — имя провайдера (для error-элемента)
 * @param fn — функция-обработчик, которая получает обрезанный query
 */
export function withContextErrorHandling(
  name: string,
  fn: (query: string) => Promise<IContextItem[]>,
): (query: string) => Promise<IContextItem[]> {
  return async (query: string): Promise<IContextItem[]> => {
    const trimmed = query.trim()
    if (!trimmed) return []

    try {
      return await fn(trimmed)
    } catch (err: unknown) {
      const msg = errorMessage(err)
      return [errorItem(`Ошибка: ${msg}`, name)]
    }
  }
}

/**
 * Обёртка resolve-метода провайдера контекста без проверки пустого запроса.
 *
 * Используется для провайдеров типа "normal", которые всегда возвращают
 * контекст независимо от query (например, Rules, RepoMap).
 */
export function withContextErrorHandlingNoTrim(
  name: string,
  fn: (query: string) => Promise<IContextItem[]>,
): (query: string) => Promise<IContextItem[]> {
  return async (query: string): Promise<IContextItem[]> => {
    try {
      return await fn(query)
    } catch (err: unknown) {
      const msg = errorMessage(err)
      return [errorItem(`Ошибка: ${msg}`, name)]
    }
  }
}

/**
 * Создать IContextProvider с обёрткой обработки ошибок.
 *
 * @param description — описание провайдера
 * @param fn — функция-обработчик resolve
 * @param loadSubmenuItems — опциональный метод подменю
 */
export function createContextProvider(
  description: IContextProvider["description"],
  fn: (query: string) => Promise<IContextItem[]>,
  loadSubmenuItems?: IContextProvider["loadSubmenuItems"],
): IContextProvider {
  return {
    description,
    resolve: withContextErrorHandling(description.name, fn),
    ...(loadSubmenuItems ? { loadSubmenuItems } : {}),
  }
}

/**
 * Создать IContextProvider без проверки пустого запроса.
 *
 * Используется для провайдеров, которые должны работать с пустым query
 * (например, MCP, Tree, Rules, RepoMap).
 */
export function createContextProviderNoTrim(
  description: IContextProvider["description"],
  fn: (query: string) => Promise<IContextItem[]>,
  loadSubmenuItems?: IContextProvider["loadSubmenuItems"],
): IContextProvider {
  return {
    description,
    resolve: withContextErrorHandlingNoTrim(description.name, fn),
    ...(loadSubmenuItems ? { loadSubmenuItems } : {}),
  }
}
