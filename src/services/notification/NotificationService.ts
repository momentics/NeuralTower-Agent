import type { IPlugin } from "../../shared/Types"
import type { IWindowService } from "../../core/VscodeApi"

export type NotificationType = "info" | "warning" | "error" | "agentDone" | "permissionRequest"

export interface INotificationServiceOptions {
  enabled: boolean
  sounds: boolean
  agentCompletion: boolean
  permissionRequests: boolean
}

/**
 * Интерфейс сервиса уведомлений.
 */
export interface INotificationService {
  show(type: NotificationType, message: string, actions?: string[]): Promise<void>
  askPermission(toolName: string, description: string): Promise<"allow" | "deny" | "allowAlways">
  setOptions(partial: Partial<INotificationServiceOptions>): void
  getOptions(): INotificationServiceOptions
  dispose(): void
}

/** Сервис уведомлений: отображение сообщений и запросы разрешений в VS Code. */
export class NotificationService implements IPlugin, INotificationService {
  name = "notifications"
  private options: INotificationServiceOptions = {
    enabled: true,
    sounds: false,
    agentCompletion: true,
    permissionRequests: true,
  }

  constructor(private readonly window: IWindowService) {}

  /** Инициализация не требуется. */
  async init(): Promise<void> {}

  /** Показать уведомление указанного типа с опциональными действиями. */
  async show(type: NotificationType, message: string, actions?: string[]): Promise<void> {
    if (!this.options.enabled) return
    const opts = actions ?? []
    switch (type) {
      case "info":
        await this.window.showInformationMessage(message, ...opts)
        break
      case "warning":
        await this.window.showWarningMessage(message, ...opts)
        break
      case "error":
        await this.window.showErrorMessage(message, ...opts)
        break
      case "agentDone":
        if (this.options.agentCompletion) {
          await this.window.showInformationMessage(message, ...opts)
        }
        break
      case "permissionRequest":
        if (this.options.permissionRequests) {
          await this.window.showWarningMessage(message, ...opts)
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
    const result = await this.window.showWarningMessage(
      `[${toolName}] ${description}`,
      { modal: true },
      "Разрешить",
      "Разрешить всегда",
      "Запретить",
    )
    return result === "Разрешить всегда" ? "allowAlways" : result === "Разрешить" ? "allow" : "deny"
  }

  /** Обновить настройки уведомлений. */
  setOptions(partial: Partial<INotificationServiceOptions>): void {
    Object.assign(this.options, partial)
  }

  /** Вернуть текущие настройки уведомлений. */
  getOptions(): INotificationServiceOptions {
    return { ...this.options }
  }

  /** Освобождение ресурсов не требуется. */
  dispose(): void {}
}
