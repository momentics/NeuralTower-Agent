import * as vscode from "vscode"
import type { IProvider } from "../core/IProvider"
import type { IAgentOrchestrator } from "../core/IAgent"
import type { ISessionStore } from "../shared/PersistentSessionStore"
import type { INotificationService } from "../services/notification/NotificationService"
import type { IPermissionManager } from "../services/permission/PermissionManager"
import type { IGitService } from "../services/git/GitService"
import type { ISnapshotService, ISnapshotStore } from "../services/snapshot"
import type { ISettingsProvider } from "./SettingsProvider"
import type { ExtToWebview } from "../shared/Messages"
import { buildWebviewHtml } from "../shared/WebviewBuilder"
import { ChatMessageHandler } from "./ChatMessageHandler"
import type { IDiffViewerProvider } from "./DiffViewerProvider"
import { chatHtml } from "./chat.html"

/**
 * Провайдер чата — управляет только жизненным циклом webview.
 * Вся бизнес-логика делегирована ChatMessageHandler.
 */
export class ChatProvider implements IProvider {
  public readonly viewType = "neuralTowerAgent.chat"
  private panel: vscode.WebviewView | undefined
  private disposables: vscode.Disposable[] = []
  private messageHandler: ChatMessageHandler | null = null
  private healthMonitor: {
    init(): void | Promise<void>
    resume(): void
    onStatusChange?(cb: (connected: boolean) => void): void
  } | null = null

  constructor(
    private readonly extUri: vscode.Uri,
    private readonly agent: IAgentOrchestrator,
    private readonly sessionStore: ISessionStore,
    private readonly notificationService: INotificationService,
    private readonly permissionManager: IPermissionManager,
    private readonly settingsProvider: ISettingsProvider,
    private readonly snapshotService: ISnapshotService | null = null,
    private readonly snapshotStore: ISnapshotStore | null = null,
    private readonly diffViewer: IDiffViewerProvider | null = null,
    private readonly gitService: IGitService | null = null,
    private readonly getWorkDir: () => string = () => "",
  ) {}

  /** Установить монитор здоровья для ленивой инициализации при первом открытии sidebar. */
  setHealthMonitor(monitor: {
    init(): void | Promise<void>
    resume(): void
    onStatusChange?(cb: (connected: boolean) => void): void
  }): void {
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
      this.snapshotService,
      this.snapshotStore,
      this.diffViewer,
      this.gitService,
      this.getWorkDir,
    )

    this.messageHandler.subscribe(this.disposables)

    // Статус подключения бэкенда в футере чата
    this.healthMonitor?.onStatusChange?.((connected) => {
      if (!this.panel) return
      void this.panel.webview.postMessage({ type: "backendStatus", connected } as ExtToWebview)
    })

    // Выборочный откат из DiffViewer (кнопка «Откатить выбранные файлы»)
    const messageHandler = this.messageHandler
    this.diffViewer?.setRevertSelectedHandler((runId, files) => {
      void messageHandler.handleRevertSelected(runId, files)
    })

    this.messageHandler.sendSessionList()
    this.messageHandler.sendActiveMessages()
    this.messageHandler.sendModeChanged()

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
      js: "out/webview/chat.js",
      body: chatHtml,
    })
  }
}
