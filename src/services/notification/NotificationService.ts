import * as vscode from "vscode"
import type { Plugin } from "../../shared/types"

export type NotificationType = "info" | "warning" | "error" | "agentDone" | "permissionRequest"

export interface NotificationServiceOptions {
  enabled: boolean
  sounds: boolean
  agentCompletion: boolean
  permissionRequests: boolean
}

/** Сервис уведомлений: отображение сообщений и запросы разрешений в VS Code. */
export class NotificationService implements Plugin {
  name = "notifications"
  private options: NotificationServiceOptions = {
    enabled: true,
    sounds: false,
    agentCompletion: true,
    permissionRequests: true,
  }

  /** Инициализация не требуется. */
  async init(): Promise<void> {}

  /** Показать уведомление указанного типа с опциональными действиями. */
  async show(type: NotificationType, message: string, actions?: string[]): Promise<void> {
    if (!this.options.enabled) return
    const opts = actions ?? []
    switch (type) {
      case "info":
        await vscode.window.showInformationMessage(message, ...opts)
        break
      case "warning":
        await vscode.window.showWarningMessage(message, ...opts)
        break
      case "error":
        await vscode.window.showErrorMessage(message, ...opts)
        break
      case "agentDone":
        if (this.options.agentCompletion) {
          await vscode.window.showInformationMessage(message, ...opts)
        }
        break
      case "permissionRequest":
        if (this.options.permissionRequests) {
          await vscode.window.showWarningMessage(message, ...opts)
        }
        break
    }
  }

  /** Запросить разрешение пользователя на действие инструмента. */
  async askPermission(
    toolName: string,
    description: string,
  ): Promise<"allow" | "deny" | "allowAlways"> {
    if (!this.options.enabled || !this.options.permissionRequests) return "deny"
    const result = await vscode.window.showWarningMessage(
      `[${toolName}] ${description}`,
      { modal: true },
      "Разрешить",
      "Разрешить всегда",
      "Запретить",
    )
    return result === "Разрешить всегда" ? "allowAlways" : result === "Разрешить" ? "allow" : "deny"
  }

  /** Обновить настройки уведомлений. */
  setOptions(partial: Partial<NotificationServiceOptions>): void {
    Object.assign(this.options, partial)
  }

  /** Вернуть текущие настройки уведомлений. */
  getOptions(): NotificationServiceOptions {
    return { ...this.options }
  }

  /** Освобождение ресурсов не требуется. */
  dispose(): void {}
}
