import * as vscode from "vscode"
import type { IAgentOrchestrator } from "../core/IAgent"
import type { ISessionStore } from "../shared/PersistentSessionStore"
import type { INotificationService } from "../services/notification/NotificationService"
import type { IPermissionManager } from "../services/permission/PermissionManager"
import type { ISettingsProvider } from "./SettingsProvider"
import type { WebviewToExt, ExtToWebview } from "../shared/Messages"
import { handleBackendError, errorMessage } from "../core/Errors"
import { UI_ARGS_LOG_TRUNCATE } from "../core/Config"

const PLAN_MARKER = "__PLAN__"

/**
 * Обработчик сообщений чата — изолирует логику маршрутизации
 * и выполнения от жизненного цикла webview.
 */
export class ChatMessageHandler {
  private streaming = false
  private abortController: AbortController | null = null

  constructor(
    private readonly agent: IAgentOrchestrator,
    private readonly sessionStore: ISessionStore,
    private readonly notificationService: INotificationService,
    private readonly permissionManager: IPermissionManager,
    private readonly webview: vscode.Webview,
    private readonly settingsProvider: ISettingsProvider,
  ) {}

  /** Получить disposable для всех подписок. */
  subscribe(disposables: vscode.Disposable[]): void {
    disposables.push(this.createMessageHandler())
    disposables.push(this.createPermissionHandler())
  }

  /** Прервать выполнение агента. */
  abort(): void {
    this.abortController?.abort()
    this.abortController = null
  }

  /** Отправить список сессий. */
  sendSessionList(): void {
    const sessions = this.sessionStore.list()
    this.webview.postMessage({
      type: "sessionList",
      sessions: sessions.map((s) => ({
        ...s,
        active: s.id === this.sessionStore.activeId,
      })),
    } as ExtToWebview)
  }

  /** Отправить сообщения активной сессии. */
  sendActiveMessages(): void {
    const messages = this.sessionStore.getActiveMessages()
    for (const msg of messages) {
      if (msg.role === "user") {
        this.webview.postMessage({ type: "messageConfirmed", content: msg.content } as ExtToWebview)
      } else if (msg.role === "assistant") {
        this.webview.postMessage({ type: "streamChunk", text: msg.content } as ExtToWebview)
        this.webview.postMessage({ type: "streamDone" } as ExtToWebview)
      }
    }
  }

  // ── Создание обработчиков ────────────────────────────────

  private createMessageHandler(): vscode.Disposable {
    return this.webview.onDidReceiveMessage(async (msg: WebviewToExt) => {
      try {
        if (this.streaming && msg.type !== "permissionResponse" && msg.type !== "stopAgent") return

        switch (msg.type) {
          case "sendMessage": {
            const content = msg.content?.trim()
            if (!content) return
            await this.handleMessage(content)
            break
          }
          case "switchSession":
            this.sessionStore.setActive(msg.sessionId)
            const messages = this.sessionStore.getActiveMessages()
            await this.agent.restoreSession(messages)
            this.sendActiveMessages()
            this.sendSessionList()
            break
          case "createSession":
            await this.sessionStore.newSession()
            this.sendSessionList()
            break
          case "deleteSession":
            await this.sessionStore.deleteSession(msg.sessionId)
            this.sendSessionList()
            break
          case "pinSession":
            await this.sessionStore.togglePin(msg.sessionId)
            this.sendSessionList()
            break
          case "renameSession":
            await this.sessionStore.rename(msg.sessionId, msg.title)
            this.sendSessionList()
            break
          case "sessionList":
            this.sendSessionList()
            break
          case "permissionResponse":
            this.handlePermissionResponse(msg)
            break
          case "stopAgent":
            this.abortController?.abort()
            break
          case "settings":
            this.settingsProvider.show()
            break
        }
      } catch (err: unknown) {
        const msg = errorMessage(err)
        vscode.window.showErrorMessage(`NeuralTower Agent: ошибка обработки сообщения: ${msg}`)
      }
    })
  }

  private createPermissionHandler(): vscode.Disposable {
    return this.permissionManager.onDidRequestPermission(async (req) => {
      try {
        this.webview.postMessage({
          type: "permissionRequest",
          requestId: req.id ?? "",
          toolName: req.toolName,
          description: `Инструмент "${req.toolName}" хочет выполнить вызов с аргументами: ${JSON.stringify(req.args).slice(0, UI_ARGS_LOG_TRUNCATE)}`,
        } as ExtToWebview)
      } catch (err: unknown) {
        const msg = errorMessage(err)
        vscode.window.showErrorMessage(`NeuralTower Agent: ошибка запроса разрешения: ${msg}`)
      }
    })
  }

  // ── Логика обработки ─────────────────────────────────────

  private handlePermissionResponse(msg: WebviewToExt & { requestId: string; allowed: boolean; always: boolean }): void {
    const resolved = this.permissionManager.resolveRequest(msg.requestId, msg.allowed, msg.always)
    if (!resolved) {
      this.webview.postMessage({
        type: "streamError",
        error: `Истёк срок запроса разрешения для "${msg.requestId}"`,
      } as ExtToWebview)
    }
  }

  private async handleMessage(content: string): Promise<void> {
    if (this.streaming) return
    this.streaming = true
    this.abortController = new AbortController()
    this.webview.postMessage({ type: "messageConfirmed", content } as ExtToWebview)

    await this.sessionStore.push({ role: "user", content, timestamp: Date.now() })

    try {
      const result = await this.agent.run(content, (chunk) => {
        this.webview.postMessage({ type: "streamChunk", text: chunk } as ExtToWebview)
      }, (toolName, args) => {
        this.webview.postMessage({
          type: "toolUse",
          toolName,
          args: JSON.stringify(args),
        } as ExtToWebview)
      }, (toolName, result) => {
        this.webview.postMessage({
          type: "toolResult",
          toolName,
          output: result.output,
          success: result.success,
        } as ExtToWebview)
      }, this.abortController.signal)

      await this.sessionStore.push(result)

      const plan = this.agent.getPlan()
      if (plan) {
        await this.sessionStore.push({
          role: "system",
          content: `${PLAN_MARKER}${JSON.stringify(plan.toJSON())}`,
          timestamp: Date.now(),
        })
      }

      this.webview.postMessage({ type: "streamDone" } as ExtToWebview)
      this.webview.postMessage({ type: "agentDone" } as ExtToWebview)
      this.notificationService.show("agentDone", "Агент завершил задачу")
    } catch (err: unknown) {
      handleBackendError(err, (msg) => {
        this.webview.postMessage({ type: "streamError", error: msg } as ExtToWebview)
      }, (m) => vscode.window.showErrorMessage(m))
    } finally {
      this.streaming = false
      this.abortController = null
      this.sendSessionList()
    }
  }
}
