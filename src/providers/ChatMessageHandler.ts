import * as vscode from "vscode"
import type { IAgentOrchestrator } from "../core/IAgent"
import type { ISessionStore } from "../shared/PersistentSessionStore"
import type { INotificationService } from "../services/notification/NotificationService"
import type { IPermissionManager } from "../services/permission/PermissionManager"
import type { IGitService } from "../services/git/GitService"
import type { ISnapshotService, ISnapshotStore, ISnapshotPatch } from "../services/snapshot"
import type { ISettingsProvider } from "./SettingsProvider"
import type { IDiffViewerProvider } from "./DiffViewerProvider"
import { BUILT_IN_MODES } from "../agent/AgentMode"
import type { AgentModeName } from "../agent/AgentMode"
import type { WebviewToExt, ExtToWebview } from "../shared/Messages"
import { handleBackendError, errorMessage } from "../core/Errors"
import { createDomainLogger } from "../core/Logger"
import { UI_ARGS_LOG_TRUNCATE } from "../core/Config"

const log = createDomainLogger("ChatHandler")
const PLAN_MARKER = "__PLAN__"

/**
 * Обработчик сообщений чата — изолирует логику маршрутизации
 * и выполнения от жизненного цикла webview.
 */
export class ChatMessageHandler {
  private streaming = false
  private abortController: AbortController | null = null
  private readonly validModes: readonly string[] = Object.keys(BUILT_IN_MODES)

  constructor(
    private readonly agent: IAgentOrchestrator,
    private readonly sessionStore: ISessionStore,
    private readonly notificationService: INotificationService,
    private readonly permissionManager: IPermissionManager,
    private readonly webview: vscode.Webview,
    private readonly settingsProvider: ISettingsProvider,
    private readonly snapshotService: ISnapshotService | null = null,
    private readonly snapshotStore: ISnapshotStore | null = null,
    private readonly diffViewer: IDiffViewerProvider | null = null,
    private readonly gitService: IGitService | null = null,
    private readonly getWorkDir: () => string = () => "",
  ) {}

  /** Получить disposable для всех подписок. */
  subscribe(disposables: vscode.Disposable[]): void {
    disposables.push(this.createMessageHandler())
    disposables.push(this.createPermissionHandler())
    disposables.push(this.agent.onModeChanged(() => this.sendModeChanged()))
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

  /** Отправить текущий режим и допустимые переходы в webview. */
  sendModeChanged(): void {
    const info = this.agent.getModeInfo()
    this.webview.postMessage({
      type: "modeChanged",
      mode: info.name,
      allowed: info.transitions,
    } as ExtToWebview)
  }

  // ── Создание обработчиков ────────────────────────────────

  private createMessageHandler(): vscode.Disposable {
    return this.webview.onDidReceiveMessage(async (msg: WebviewToExt) => {
      try {
        if (
          this.streaming &&
          msg.type !== "permissionResponse" &&
          msg.type !== "stopAgent" &&
          msg.type !== "switchMode"
        ) {
          return
        }

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
            this.sendModeChanged()
            break
          case "createSession": {
            await this.sessionStore.newSession()
            this.agent.clearPlan()
            this.agent.resetSession()
            this.webview.postMessage({ type: "newChat" } as ExtToWebview)
            this.sendSessionList()
            this.sendModeChanged()
            break
          }
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
          case "switchMode":
            this.handleSwitchMode(msg.mode)
            break
          case "revertSnapshot":
            // Откат недоступен во время выполнения агента (защита от гонок)
            if (!this.streaming) {
              await this.handleRevertSnapshot(msg.runId)
            }
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
          description: req.description
            ? `Инструмент "${req.toolName}": ${req.description}`
            : `Инструмент "${req.toolName}" хочет выполнить вызов с аргументами: ${JSON.stringify(req.args).slice(0, UI_ARGS_LOG_TRUNCATE)}`,
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

  /**
   * Обработать запрос смены режима из webview.
   * При успехе сообщение modeChanged отправляет подписка
   * на agent.onModeChanged; при ошибке — modeSwitchError.
   */
  private handleSwitchMode(rawMode: string): void {
    if (!this.validModes.includes(rawMode)) {
      this.webview.postMessage({
        type: "modeSwitchError",
        message: `Неизвестный режим: ${rawMode}`,
      } as ExtToWebview)
      return
    }

    const ok = this.agent.switchMode(rawMode as AgentModeName)
    if (!ok) {
      const info = this.agent.getModeInfo()
      this.webview.postMessage({
        type: "modeSwitchError",
        message: `Переход в режим «${rawMode}» недоступен из режима «${info.name}». Доступно: ${info.transitions.join(", ")}`,
      } as ExtToWebview)
    }
  }

  /**
   * Сохранить запись чекпоинта и сообщить webview о наличии
   * откатываемых изменений (только если файлов больше нуля).
   */
  private handleSnapshotInfo(patch: ISnapshotPatch | null, runId: string): void {
    if (!patch) return
    const sessionId = this.sessionStore.activeId
    this.snapshotStore
      ?.save({
        runId,
        sessionId,
        hash: patch.hash,
        files: patch.files,
        createdAt: Date.now(),
      })
      .catch((err: unknown) => {
        log.warn(`Не удалось сохранить чекпоинт: ${errorMessage(err)}`)
      })
    if (patch.files.length > 0) {
      this.webview.postMessage({
        type: "snapshotInfo",
        runId,
        hash: patch.hash,
        fileCount: patch.files.length,
      } as ExtToWebview)
    }
  }

  /**
   * Откатить изменения запроса к состоянию чекпоинта.
   * Результат сообщается webview; при успехе обновляется
   * DiffViewer (если открыт) и показывается уведомление.
   */
  private async handleRevertSnapshot(runId: string): Promise<void> {
    const fail = (error: string): void => {
      this.webview.postMessage({
        type: "snapshotReverted",
        runId,
        ok: false,
        error,
      } as ExtToWebview)
    }

    if (!this.snapshotService || !this.snapshotStore) {
      fail("Чекпоинты недоступны")
      return
    }

    const record = await this.snapshotStore.get(runId)
    if (!record) {
      fail("Чекпоинт не найден")
      return
    }

    try {
      const result = await this.snapshotService.revert(record)
      const ok = result.failed.length === 0
      this.webview.postMessage({
        type: "snapshotReverted",
        runId,
        ok,
        error: ok ? undefined : result.failed.map((f) => f.error).join("; "),
      } as ExtToWebview)

      if (ok) {
        const count = result.restored.length + result.deleted.length
        this.notificationService.show("agentDone", `Изменения откатлены (${count} файлов)`)
        await this.refreshDiffViewer()
      }
    } catch (err: unknown) {
      fail(errorMessage(err))
    }
  }

  /** Обновить статус diff в DiffViewer, если панель открыта. */
  private async refreshDiffViewer(): Promise<void> {
    if (!this.diffViewer?.isOpen() || !this.gitService) return
    const dir = this.getWorkDir()
    if (!dir) return
    try {
      const diff = await this.gitService.getDiff(dir)
      this.diffViewer.openPanel(diff)
    } catch (err: unknown) {
      log.warn(`Не удалось обновить diff после отката: ${errorMessage(err)}`)
    }
  }

  private async handleMessage(content: string): Promise<void> {
    if (this.streaming) return
    this.streaming = true
    this.abortController = new AbortController()
    this.webview.postMessage({ type: "messageConfirmed", content } as ExtToWebview)

    // runId запроса — timestamp user-сообщения
    const userTimestamp = Date.now()
    await this.sessionStore.push({ role: "user", content, timestamp: userTimestamp })

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
      }, this.abortController.signal, undefined, (patch) => {
        this.handleSnapshotInfo(patch, String(userTimestamp))
      })

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
