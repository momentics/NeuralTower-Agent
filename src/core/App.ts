import * as vscode from "vscode"
import type { IBackend } from "./IBackend"
import type { IProvider } from "./IProvider"
import { createDomainLogger } from "./Logger"

const log = createDomainLogger("App")

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
    log.info(`[NeuralTower Agent] инициализация версии ${this.version()}`)
  }

  /** Вызывается при деактивации расширения. */
  dispose(): void {
    for (const p of this.providers) p.dispose()
    for (const d of this.disposables) d.dispose()
    log.info("[NeuralTower Agent] ресурсы освобождены")
  }

  version(): string {
    return this.ctx.extension.packageJSON.version ?? "неизвестно"
  }
}
