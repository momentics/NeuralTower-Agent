import * as vscode from "vscode"
import * as crypto from "crypto"
import type { ChatMessage } from "../core/IBackend"
import type { IProvider } from "../core/IProvider"
import type { IAgentOrchestrator } from "../core/IAgent"
import type { PersistentSessionStore } from "../shared/PersistentSessionStore"
import type { NotificationService } from "../services/notification/NotificationService"
import type { PermissionManager } from "../services/permission/PermissionManager"
import type { WebviewToExt, ExtToWebview } from "../shared/messages"

export class ChatProvider implements IProvider {
  public readonly viewType = "nt-agent.chat"
  private panel: vscode.WebviewView | undefined
  private streaming = false

  constructor(
    private readonly extUri: vscode.Uri,
    private readonly agent: IAgentOrchestrator,
    private readonly sessionStore: PersistentSessionStore,
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
    this.panel = undefined
  }

  // ── Обработка сообщений ─────────────────────────────────

  private setupHandler(): void {
    this.panel!.webview.onDidReceiveMessage(async (msg: WebviewToExt) => {
      if (this.streaming && msg.type !== "permissionResponse") return

      switch (msg.type) {
        case "sendMessage":
          await this.handleMessage(msg.content)
          break
        case "switchSession":
          this.sessionStore.setActive(msg.sessionId)
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
      }
    })
  }

  private setupPermissionHandler(): void {
    this.permissionManager.onDidRequestPermission(async (req) => {
      if (this.panel) {
        this.panel.webview.postMessage({
          type: "permissionRequest",
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

  private handlePermissionResponse(msg: WebviewToExt & { allowed: boolean; always: boolean }): void {
    // Разрешить последний ожидающий запрос для этого инструмента.
    // Обработка выполняется внутри менеджера разрешений.
  }

  private async handleMessage(content: string): Promise<void> {
    this.streaming = true
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
      })

      await this.sessionStore.push(result)
      this.panel!.webview.postMessage({ type: "streamDone" } as ExtToWebview)
      this.panel!.webview.postMessage({ type: "agentDone" } as ExtToWebview)
      this.notificationService.show("agentDone", "Агент завершил задачу")
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Неизвестная ошибка"
      this.panel!.webview.postMessage({
        type: "streamError",
        error: errorMsg,
      } as ExtToWebview)
      this.notificationService.show("error", errorMsg)
    } finally {
      this.streaming = false
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
