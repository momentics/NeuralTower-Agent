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
  <!-- Header -->
  <div id="header">
    <div class="header-left">
      <div class="nt-logo">
        <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
          <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
        </svg>
      </div>
      <span class="chat-title">NeuralTower</span>
    </div>
    <div class="header-actions">
      <button class="icon-btn" title="Новый чат" onclick="vscode.postMessage({type:'createSession'})">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>
      <button class="icon-btn" title="Настройки" onclick="vscode.postMessage({type:'settings'})">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
      </button>
    </div>
  </div>

  <!-- Mode bar -->
  <div id="mode-bar">
    <div class="mode-chip build active" data-mode="build" onclick="switchMode('build')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>
      Построение
    </div>
    <div class="mode-chip plan" data-mode="plan" onclick="switchMode('plan')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg>
      Планирование
    </div>
    <div class="mode-chip explore" data-mode="explore" onclick="switchMode('explore')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      Исследование
    </div>
  </div>

  <!-- Sessions -->
  <div id="sessions-section">
    <div class="sessions-header">
      <span class="sessions-label">Сессии</span>
      <button class="icon-btn" style="width:20px;height:20px;" title="Все сессии" onclick="vscode.postMessage({type:'sessionList'})">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
    </div>
    <div id="sessions-list"></div>
  </div>

  <!-- Messages area -->
  <div id="messages">
    <div id="empty-state">
      <div class="empty-logo">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M12 2a7 7 0 017 7c0 2.5-1.5 4.5-3 6 1.5 1 3 2.5 3 5a7 7 0 01-14 0c0-2.5 1.5-4 3-6-1.5-1.5-3-3.5-3-6a7 7 0 017-7z"/>
          <circle cx="9" cy="9" r="1" fill="currentColor"/><circle cx="15" cy="9" r="1" fill="currentColor"/>
          <path d="M9 13c1 1 5 1 6 0"/>
        </svg>
      </div>
      <div class="empty-title">NeuralTower Agent</div>
      <div class="empty-subtitle">ИИ-ассистент для разработки. Задайте задачу — и агент выполнит её.</div>
      <div class="quick-actions">
        <div class="quick-action" onclick="sendQuick('Исправить баг')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>
          Исправить баг
        </div>
        <div class="quick-action" onclick="sendQuick('Объяснить код')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg>
          Объяснить код
        </div>
        <div class="quick-action" onclick="sendQuick('Написать тесты')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
          Написать тесты
        </div>
        <div class="quick-action" onclick="sendQuick('Искать в коде')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          Искать в коде
        </div>
      </div>
    </div>
  </div>

  <!-- Permission dialog overlay -->
  <div id="perm-overlay" class="perm-overlay" style="display:none">
    <div class="perm-dialog">
      <div class="perm-title">
        <span class="warn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        </span>
        Запрос разрешения
      </div>
      <div class="perm-desc" id="perm-desc"></div>
      <div class="perm-actions">
        <button class="perm-btn deny" onclick="denyPermission()">Отклонить</button>
        <button class="perm-btn allow" onclick="allowPermission()">Разрешить</button>
      </div>
    </div>
  </div>

  <!-- Input area -->
  <form id="chat-form">
    <div id="input-area">
      <div id="context-pills" class="context-pills"></div>
      <div id="input-box">
        <textarea id="input" placeholder="Опишите задачу..." rows="1" autocomplete="off"></textarea>
        <div id="input-toolbar">
          <button type="button" class="tb-btn" title="Прикрепить">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
          </button>
          <button type="button" class="tb-btn" title="Контекст IDE">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
          </button>
          <button type="button" class="tb-btn" title="Модель">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
          </button>
          <div class="tb-spacer"></div>
          <button type="submit" id="send-btn" class="send-btn send" title="Отправить">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
          </button>
          <button type="button" id="stop-btn" class="send-btn stop" title="Остановить" style="display:none">
            <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
          </button>
        </div>
      </div>
    </div>
  </form>

  <!-- Status bar -->
  <div id="status-bar">
    <div class="status-left">
      <div class="status-item">
        <span class="status-dot green" id="status-dot"></span>
        <span id="status-text">Подключено</span>
      </div>
      <div class="status-item" id="status-model">qwen3.6-27b</div>
    </div>
    <div class="status-right">
      <div class="status-item" id="status-mode">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:10px;height:10px"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>
        Построение
      </div>
    </div>
  </div>`,
    })
  }
}
