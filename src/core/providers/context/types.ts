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
}

export interface SubmenuItem {
  readonly id: string
  readonly label: string
  readonly description: string
}

export interface ContextProvider {
  readonly description: ProviderDescription
  resolve(query: string): Promise<ContextItem[]>
  loadSubmenuItems?(): Promise<SubmenuItem[]>
}
