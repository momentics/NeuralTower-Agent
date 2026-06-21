import * as vscode from "vscode"
import * as crypto from "crypto"
import type { ChatMessage } from "../core/IBackend"
import type { IProvider } from "../core/IProvider"
import type { IAgentOrchestrator } from "../core/IAgent"
import type { ISessionStore } from "../shared/PersistentSessionStore"
import type { INotificationService } from "../services/notification/NotificationService"
import type { IPermissionManager } from "../services/permission/PermissionManager"
import type { WebviewToExt, ExtToWebview } from "../shared/messages"
import { handleBackendError } from "../core/errors"

const ARGS_LOG_TRUNCATE = 200
const PLAN_MARKER = "__PLAN__"

export class ChatProvider implements IProvider {
  public readonly viewType = "neuralTowerAgent.chat"
  private panel: vscode.WebviewView | undefined
  private streaming = false
  private abortController: AbortController | null = null
  private disposables: vscode.Disposable[] = []

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
    this.setupHandler()
    this.sendSessionList()
    this.sendActiveMessages()
    this.setupPermissionHandler()
  }

  broadcastNewChat(): void {
    if (this.panel) {
      this.sessionStore.newSession()
      this.sendSessionList()
      this.panel.webview.postMessage({ type: "newChat" } as ExtToWebview)
    }
  }

  dispose(): void {
    this.abortController?.abort()
    this.abortController = null
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

  // ── Обработка сообщений ─────────────────────────────────

  private setupHandler(): void {
    const disposable = this.getWebview().onDidReceiveMessage(async (msg: WebviewToExt) => {
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
      }
    })
    this.disposables.push(disposable)
  }

  private setupPermissionHandler(): void {
    const disposable = this.permissionManager.onDidRequestPermission(async (req) => {
      if (this.panel) {
        this.panel.webview.postMessage({
          type: "permissionRequest",
          requestId: req.id ?? "",
          toolName: req.toolName,
          description: `Инструмент "${req.toolName}" хочет выполнить вызов с аргументами: ${JSON.stringify(req.args).slice(0, ARGS_LOG_TRUNCATE)}`,
        } as ExtToWebview)
      } else {
        const result = await this.notificationService.askPermission(
          req.toolName,
          `Инструмент "${req.toolName}" хочет выполнить вызов`,
        )
        req.resolve(result !== "deny")
      }
    })
    this.disposables.push(disposable)
  }

  private handlePermissionResponse(msg: WebviewToExt & { requestId: string; allowed: boolean; always: boolean }): void {
    const resolved = this.permissionManager.resolveRequest(msg.requestId, msg.allowed, msg.always)
    if (!resolved && this.panel) {
      this.panel.webview.postMessage({
        type: "streamError",
        error: `Истёк срок запроса разрешения для "${msg.requestId}"`,
      } as ExtToWebview)
    }
  }

  private async handleMessage(content: string): Promise<void> {
    if (this.streaming) return
    this.streaming = true
    this.abortController = new AbortController()
    this.getWebview().postMessage({ type: "messageConfirmed", content } as ExtToWebview)

    await this.sessionStore.push({ role: "user", content, timestamp: Date.now() })

    try {
      const result = await this.agent.run(content, (chunk) => {
        this.getWebview().postMessage({ type: "streamChunk", text: chunk } as ExtToWebview)
      }, (toolName, args) => {
        this.getWebview().postMessage({
          type: "toolUse",
          toolName,
          args: JSON.stringify(args),
        } as ExtToWebview)
      }, (toolName, result) => {
        this.getWebview().postMessage({
          type: "toolResult",
          toolName,
          output: result.output,
          success: result.success,
        } as ExtToWebview)
      }, this.abortController.signal)

      await this.sessionStore.push(result)

      // Сохранить план в сессию
      const plan = this.agent.getPlan()
      if (plan) {
        await this.sessionStore.push({
          role: "system",
          content: `${PLAN_MARKER}${JSON.stringify(plan.toJSON())}`,
          timestamp: Date.now(),
        })
      }

      this.getWebview().postMessage({ type: "streamDone" } as ExtToWebview)
      this.getWebview().postMessage({ type: "agentDone" } as ExtToWebview)
      this.notificationService.show("agentDone", "Агент завершил задачу")
    } catch (err: unknown) {
      handleBackendError(err, (msg) => {
        this.getWebview().postMessage({ type: "streamError", error: msg } as ExtToWebview)
      }, (m) => vscode.window.showErrorMessage(m))
    } finally {
      this.streaming = false
      this.abortController = null
      this.sendSessionList()
    }
  }

  private sendActiveMessages(): void {
    const messages = this.sessionStore.getActiveMessages()
    for (const msg of messages) {
      if (msg.role === "user") {
        this.getWebview().postMessage({ type: "messageConfirmed", content: msg.content } as ExtToWebview)
      } else if (msg.role === "assistant") {
        this.getWebview().postMessage({ type: "streamChunk", text: msg.content } as ExtToWebview)
        this.getWebview().postMessage({ type: "streamDone" } as ExtToWebview)
      }
    }
  }

  private sendSessionList(): void {
    if (!this.panel) return
    const sessions = this.sessionStore.list()
    this.panel.webview.postMessage({
      type: "sessionList",
      sessions: sessions.map((s) => ({
        ...s,
        active: s.id === this.sessionStore.activeId,
      })),
    } as ExtToWebview)
  }

  // ── HTML веб-представления ──────────────────────────────

  private html(): string {
    const nonce = crypto.randomBytes(16).toString("hex")
    const css = this.getWebview().asWebviewUri(
      vscode.Uri.joinPath(this.extUri, "resources", "chat.css"),
    )
    const js = this.getWebview().asWebviewUri(
      vscode.Uri.joinPath(this.extUri, "resources", "chat.js"),
    )

    return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${this.getWebview().cspSource};
             script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${css}">
</head>
<body>
  <div id="session-bar"></div>
  <div id="messages"></div>
  <form id="chat-form">
    <input id="input" type="text" placeholder="Спросить..." autocomplete="off">
    <button type="submit">Отправить</button>
  </form>
  <script nonce="${nonce}" src="${js}"></script>
</body>
</html>`
  }
}
