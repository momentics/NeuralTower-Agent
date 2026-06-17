import type { ContextProvider } from "./types"

/**
 * Интерфейс ContextProviderRegistry — методы, используемые через AgentDependencies.
 */
export interface IContextProviderRegistry {
  get(name: string): ContextProvider | undefined
}

export class ContextProviderRegistry implements IContextProviderRegistry {
  private providers = new Map<string, ContextProvider>()

  register(provider: ContextProvider): void {
    this.providers.set(provider.description.name, provider)
  }

  unregister(name: string): void {
    this.providers.delete(name)
  }

  get(name: string): ContextProvider | undefined {
    return this.providers.get(name)
  }

  list(): ContextProvider[] {
    return [...this.providers.values()]
  }

  has(name: string): boolean {
    return this.providers.has(name)
  }
}
