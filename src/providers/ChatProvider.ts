import * as vscode from "vscode"
import type { IProvider } from "../core/IProvider"
import type { IAgentOrchestrator } from "../core/IAgent"
import type { ISessionStore } from "../shared/PersistentSessionStore"
import type { INotificationService } from "../services/notification/NotificationService"
import type { IPermissionManager } from "../services/permission/PermissionManager"
import type { ISettingsProvider } from "./SettingsProvider"
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
  private healthMonitor: { init(): void | Promise<void>; resume(): void } | null = null

  constructor(
    private readonly extUri: vscode.Uri,
    private readonly agent: IAgentOrchestrator,
    private readonly sessionStore: ISessionStore,
    private readonly notificationService: INotificationService,
    private readonly permissionManager: IPermissionManager,
    private readonly settingsProvider: ISettingsProvider,
  ) {}

  /** Установить монитор здоровья для ленивой инициализации при первом открытии sidebar. */
  setHealthMonitor(monitor: { init(): void | Promise<void>; resume(): void }): void {
    this.healthMonitor = monitor
  }

  async resolveWebviewView(
    view: vscode.WebviewView,
    _ctx: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    if (this.panel) {
      this.healthMonitor?.resume()
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
      this.settingsProvider,
    )

    this.messageHandler.subscribe(this.disposables)
    this.messageHandler.sendSessionList()
    this.messageHandler.sendActiveMessages()

    // Ленивая инициализация мониторинга здоровья — только когда пользователь открыл sidebar
    if (this.healthMonitor) {
      const r = this.healthMonitor.init()
      if (r && typeof r.catch === "function") r.catch(() => {})
    }
  }

  broadcastNewChat(): void {
    if (this.panel && this.messageHandler) {
      this.sessionStore.newSession().catch(() => {})
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

  <div id="header">
    <div id="brand">NEURALTOWER AGENT</div>
    <div class="header-actions">
      <button title="Новый чат" onclick="vscode.postMessage({type:'createSession'})">＋</button>
      <button title="Настройки" onclick="vscode.postMessage({type:'settings'})">⚙</button>
    </div>
  </div>

  <div id="tasks-section">
    <div id="tasks-label">Tasks</div>
    <div id="tasks-list"></div>
    <div id="view-all"></div>
  </div>

  <div id="messages">
    <div id="empty-state">
      <svg class="empty-icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M24 4C18 4 14 8 14 14c0 3 1 5 3 7-2 1-4 3-4 6 0 4 3 7 7 7h12c4 0 7-3 7-7 0-3-2-5-4-6 2-2 3-4 3-7 0-6-4-10-10-10z"/>
        <circle cx="20" cy="16" r="1.5" fill="currentColor"/>
        <circle cx="28" cy="16" r="1.5" fill="currentColor"/>
        <path d="M20 22c1.5 1.5 6.5 1.5 8 0"/>
      </svg>
    </div>
  </div>

  <form id="chat-form">
    <div id="input-area">
      <div id="input-box">
        <textarea id="input" placeholder="Do anything..." rows="1" autocomplete="off"></textarea>
        <div id="input-toolbar">
          <button type="button" class="toolbar-btn add" title="Прикрепить">+</button>
          <div class="access-badge">
            <span class="icon">⚠</span>
            <select class="toolbar-select" id="access-level">
              <option value="full">Full access</option>
              <option value="limited">Limited</option>
            </select>
          </div>
          <div class="toolbar-separator"></div>
          <button type="button" class="toolbar-btn" title="Контекст IDE">✦ IDE context</button>
          <button type="submit" id="send-btn" title="Отправить">↑</button>
          <button type="button" id="stop-btn" title="Остановить" style="display:none">■</button>
        </div>
      </div>
    </div>
  </form>`,
    })
  }
}
