import * as vscode from "vscode"
import type { IProvider } from "../core/IProvider"
import type { IAgentOrchestrator } from "../core/IAgent"
import type { ISessionStore } from "../shared/PersistentSessionStore"
import type { INotificationService } from "../services/notification/NotificationService"
import type { IPermissionManager } from "../services/permission/PermissionManager"
import type { ExtToWebview } from "../shared/Messages"
import { buildWebviewHtml } from "../shared/WebviewBuilder"
import { ChatMessageHandler } from "./ChatMessageHandler"

/**
 * Провайдер чата — управляет только жизненным циклом webview.
 * Вся бизнес-логика делегирована ChatMessageHandler.
 */
export class ChatProvider implements IProvider {
  public readonly viewType = "neuralTowerAgent.chat"
  private panel: vscode.WebviewView | undefined
  private disposables: vscode.Disposable[] = []
  private messageHandler: ChatMessageHandler | null = null

  constructor(
    private readonly extUri: vscode.Uri,
    private readonly agent: IAgentOrchestrator,
    private readonly sessionStore: ISessionStore,
    private readonly notificationService: INotificationService,
    private readonly permissionManager: IPermissionManager,
  ) {}

  async resolveWebviewView(
    view: vscode.WebviewView,
    _ctx: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    if (this.panel) {
      return
    }
    this.panel = view
    view.webview.options = { enableScripts: true, localResourceRoots: [this.extUri] }
    view.webview.html = this.html()

    this.messageHandler = new ChatMessageHandler(
      this.agent,
      this.sessionStore,
      this.notificationService,
      this.permissionManager,
      view.webview,
    )

    this.messageHandler.subscribe(this.disposables)
    this.messageHandler.sendSessionList()
    this.messageHandler.sendActiveMessages()
  }

  broadcastNewChat(): void {
    if (this.panel && this.messageHandler) {
      this.sessionStore.newSession()
      this.messageHandler.sendSessionList()
      this.panel.webview.postMessage({ type: "newChat" } as ExtToWebview)
    }
  }

  dispose(): void {
    this.messageHandler?.abort()
    this.messageHandler = null
    for (const d of this.disposables) {
      d.dispose()
    }
    this.disposables = []
    this.panel = undefined
  }

  private getWebview(): vscode.Webview {
    if (!this.panel) {
      throw new Error("Панель не инициализирована")
    }
    return this.panel.webview
  }

  private html(): string {
    return buildWebviewHtml(this.getWebview(), this.extUri, {
      css: "chat.css",
      js: "chat.js",
      body: `
  <div id="session-bar"></div>
  <div id="messages"></div>
  <form id="chat-form">
    <input id="input" type="text" placeholder="Спросить..." autocomplete="off">
    <button type="submit">Отправить</button>
  </form>`,
    })
  }
}
