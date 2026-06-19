import * as vscode from "vscode"
import * as crypto from "crypto"
import type { ChatMessage } from "../core/IBackend"
import type { IProvider } from "../core/IProvider"
import type { IAgentOrchestrator } from "../core/IAgent"
import type { ISessionStore } from "../shared/PersistentSessionStore"
import type { NotificationService } from "../services/notification/NotificationService"
import type { PermissionManager } from "../services/permission/PermissionManager"
import type { WebviewToExt, ExtToWebview } from "../shared/messages"
import { AbortError, BackendError, NeuralTowerError } from "../core/errors"

export class ChatProvider implements IProvider {
  public readonly viewType = "neuralTowerAgent.chat"
  private panel: vscode.WebviewView | undefined
  private streaming = false
  private abortController: AbortController | null = null

  constructor(
    private readonly extUri: vscode.Uri,
    private readonly agent: IAgentOrchestrator,
    private readonly sessionStore: ISessionStore,
    private readonly notificationService: NotificationService,
    private readonly permissionManager: PermissionManager,
  ) {}

  async resolveWebviewView(
    view: vscode.WebviewView,
    _ctx: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): Promise<void> {
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
    this.panel = undefined
  }

  // ── Обработка сообщений ─────────────────────────────────

  private setupHandler(): void {
    this.panel!.webview.onDidReceiveMessage(async (msg: WebviewToExt) => {
      if (this.streaming && msg.type !== "permissionResponse" && msg.type !== "stopAgent") return

      switch (msg.type) {
        case "sendMessage":
          await this.handleMessage(msg.content)
          break
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
  }

  private setupPermissionHandler(): void {
    this.permissionManager.onDidRequestPermission(async (req) => {
      if (this.panel) {
        this.panel.webview.postMessage({
          type: "permissionRequest",
          requestId: req.id ?? "",
          toolName: req.toolName,
          description: `Инструмент "${req.toolName}" хочет выполнить вызов с аргументами: ${JSON.stringify(req.args).slice(0, 200)}`,
        } as ExtToWebview)
      } else {
        const result = await this.notificationService.askPermission(
          req.toolName,
          `Инструмент "${req.toolName}" хочет выполнить вызов`,
        )
        req.resolve(result !== "deny")
      }
    })
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
    this.streaming = true
    this.abortController = new AbortController()
    this.panel!.webview.postMessage({ type: "messageConfirmed", content } as ExtToWebview)

    await this.sessionStore.push({ role: "user", content, timestamp: Date.now() })

    try {
      const result = await this.agent.run(content, (chunk) => {
        this.panel!.webview.postMessage({ type: "streamChunk", text: chunk } as ExtToWebview)
      }, (toolName, args) => {
        this.panel!.webview.postMessage({
          type: "toolUse",
          toolName,
          args: JSON.stringify(args),
        } as ExtToWebview)
      }, (toolName, result) => {
        this.panel!.webview.postMessage({
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
          content: `__PLAN__${JSON.stringify(plan.toJSON())}`,
          timestamp: Date.now(),
        })
      }

      this.panel!.webview.postMessage({ type: "streamDone" } as ExtToWebview)
      this.panel!.webview.postMessage({ type: "agentDone" } as ExtToWebview)
      this.notificationService.show("agentDone", "Агент завершил задачу")
    } catch (err) {
      if (err instanceof AbortError) {
        this.panel!.webview.postMessage({
          type: "streamError",
          error: "Задача остановлена пользователем",
        } as ExtToWebview)
      } else if (err instanceof BackendError) {
        const errorMsg = `Ошибка бэкенда: ${err.message}`
        this.panel!.webview.postMessage({
          type: "streamError",
          error: errorMsg,
        } as ExtToWebview)
        this.notificationService.show("error", errorMsg)
      } else if (err instanceof NeuralTowerError) {
        const errorMsg = `${err.name}: ${err.message}`
        this.panel!.webview.postMessage({
          type: "streamError",
          error: errorMsg,
        } as ExtToWebview)
        this.notificationService.show("error", errorMsg)
      } else {
        const errorMsg = err instanceof Error ? err.message : "Неизвестная ошибка"
        this.panel!.webview.postMessage({
          type: "streamError",
          error: errorMsg,
        } as ExtToWebview)
        this.notificationService.show("error", errorMsg)
      }
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
        this.panel!.webview.postMessage({ type: "messageConfirmed", content: msg.content } as ExtToWebview)
      } else if (msg.role === "assistant") {
        this.panel!.webview.postMessage({ type: "streamChunk", text: msg.content } as ExtToWebview)
        this.panel!.webview.postMessage({ type: "streamDone" } as ExtToWebview)
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
    const css = this.panel!.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extUri, "resources", "chat.css"),
    )
    const js = this.panel!.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extUri, "resources", "chat.js"),
    )

    return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${this.panel!.webview.cspSource};
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
