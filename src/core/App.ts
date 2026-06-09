import * as vscode from "vscode"
import type { IBackend } from "./IBackend"
import type { IProvider } from "./IProvider"

/**
 * Базовый класс приложения. Управляет жизненным циклом:
 * инициализация сервисов, регистрация провайдеров и команд,
 * освобождение ресурсов при завершении работы.
 */
export class App {
  private providers: IProvider[] = []
  private disposables: vscode.Disposable[] = []

  constructor(
    private readonly ctx: vscode.ExtensionContext,
  ) {}

  /** Зарегистрировать провайдер интерфейса. */
  registerProvider(provider: IProvider): void {
    this.providers.push(provider)
    this.disposables.push(
      vscode.window.registerWebviewViewProvider(provider.viewType, provider),
    )
  }

  /** Зарегистрировать команду. */
  registerCommand(id: string, handler: (...args: unknown[]) => void): void {
    this.disposables.push(vscode.commands.registerCommand(id, handler))
  }

  /** Зарегистрировать команду, привязанную к этому экземпляру. */
  registerBoundCommand(id: string, fn: (this: App, ...args: unknown[]) => void): void {
    this.disposables.push(vscode.commands.registerCommand(id, fn.bind(this)))
  }

  /** Вызывается при активации расширения. */
  async init(): Promise<void> {
    console.log(`[nt-agent] инициализация версии ${this.version()}`)
  }

  /** Вызывается при деактивации расширения. */
  dispose(): void {
    for (const p of this.providers) p.dispose()
    for (const d of this.disposables) d.dispose()
    console.log("[nt-agent] ресурсы освобождены")
  }

  private version(): string {
    return this.ctx.extension.packageJSON.version ?? "неизвестно"
  }
}
