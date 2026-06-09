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

  /** Освободить ресурсы. */
  dispose(): void
}
