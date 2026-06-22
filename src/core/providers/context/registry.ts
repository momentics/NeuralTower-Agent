import type { IContextProvider } from "./Types"

/**
 * Интерфейс ContextProviderRegistry — методы, используемые через IAgentDependencies.
 */
export interface IContextProviderRegistry {
get(name: string): IContextProvider | undefined
}

export class ContextProviderRegistry implements IContextProviderRegistry {
  private providers = new Map<string, IContextProvider>()

  register(provider: IContextProvider): void {
    this.providers.set(provider.description.name, provider)
  }

  unregister(name: string): void {
    this.providers.delete(name)
  }

  get(name: string): IContextProvider | undefined {
    return this.providers.get(name)
  }

  list(): IContextProvider[] {
    return [...this.providers.values()]
  }

  has(name: string): boolean {
    return this.providers.has(name)
  }
}
