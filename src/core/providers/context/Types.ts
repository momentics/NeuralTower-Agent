export interface IContextItem {
  readonly content: string
  readonly name: string
  readonly description?: string
}

export type ProviderType = "normal" | "query" | "submenu"

export interface IProviderDescription {
  readonly name: string
  readonly displayTitle: string
  readonly description: string
  readonly type: ProviderType
  /** Приоритет включения в автоматический контекст (выше = раньше). */
  readonly priority?: number
}

export interface ISubmenuItem {
  readonly id: string
  readonly label: string
  readonly description: string
}

/**
 * Единый интерфейс провайдера контекста.
 *
 * Используется и для on-demand запросов (resolve с query),
 * и для автоматического контекста (resolve с пустым query).
 * ContextManager потребляет IContextProvider для построения
 * снимков и обнаружения дельт между ходами агента.
 */
export interface IContextProvider {
  readonly description: IProviderDescription
  resolve(query: string): Promise<IContextItem[]>
  loadSubmenuItems?(): Promise<ISubmenuItem[]>
  /**
   * Сформировать краткое описание изменения при изменении
   * содержимого провайдера. Если не определён — используется
   * текст по умолчанию.
   */
  changed?(previous: string, current: string): string
}
