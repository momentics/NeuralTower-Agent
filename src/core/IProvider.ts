import * as vscode from "vscode"

export interface IProvider {
  /** Уникальный идентификатор вида для регистрации. */
  readonly viewType: string

  /** Сформировать содержимое веб-представления. */
  resolveWebviewView(
    view: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    token: vscode.CancellationToken,
  ): void | Promise<void>

  /** Отправить сигнал о новом чате. */
  broadcastNewChat?(): void

  /** Установить монитор здоровья для ленивой инициализации и отслеживания статуса подключения. */
  setHealthMonitor?(monitor: {
    init(): void | Promise<void>
    resume(): void
    onStatusChange?(cb: (connected: boolean) => void): void
  }): void

  /** Освободить ресурсы. */
  dispose(): void
}
