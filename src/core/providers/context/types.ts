export interface ContextItem {
  readonly content: string
  readonly name: string
  readonly description?: string
}

export type ProviderType = "normal" | "query" | "submenu"

export interface ProviderDescription {
  readonly name: string
  readonly displayTitle: string
  readonly description: string
  readonly type: ProviderType
  /** Приоритет включения в автоматический контекст (выше = раньше). */
  readonly priority?: number
}

export interface SubmenuItem {
  readonly id: string
  readonly label: string
  readonly description: string
}

/**
 * Единый интерфейс провайдера контекста.
 *
 * Используется и для on-demand запросов (resolve с query),
 * и для автоматического контекста (resolve с пустым query).
 * ContextManager потребляет ContextProvider для построения
 * снимков и обнаружения дельт между ходами агента.
 */
export interface ContextProvider {
  readonly description: ProviderDescription
  resolve(query: string): Promise<ContextItem[]>
  loadSubmenuItems?(): Promise<SubmenuItem[]>
  /**
   * Сформировать краткое описание изменения при изменении
   * содержимого провайдера. Если не определён — используется
   * текст по умолчанию.
   */
  changed?(previous: string, current: string): string
}
