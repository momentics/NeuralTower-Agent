import * as vscode from "vscode"
import { basename } from "path"
import type { IBackend } from "../core/IBackend"
import type { IAgentOrchestrator } from "../core/IAgent"
import type { ISessionStore } from "../shared/PersistentSessionStore"
import type { INotificationService } from "../services/notification/NotificationService"
import type { IPermissionManager } from "../services/permission/PermissionManager"
import type { IGitService } from "../services/git/GitService"
import type { ISnapshotService, ISnapshotStore, ISnapshotPatch, ISnapshotRecord, IRevertResult } from "../services/snapshot"
import { pathKey } from "../services/snapshot"
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

/** Результат отката с флагом возможности отмены (undo-запись создана). */
interface IPerformedRevert extends IRevertResult {
  undoAvailable: boolean
}

/**
 * Обработчик сообщений чата — изолирует логику маршрутизации
 * и выполнения от жизненного цикла webview.
 */
export class ChatMessageHandler {
  private streaming = false
  private abortController: AbortController | null = null
  private readonly validModes: readonly string[] = Object.keys(BUILT_IN_MODES)
  /** Заметка об откате пользователя для следующего запроса агента. */
  private pendingRevertNote: string | null = null
  /** Число сообщений активной сессии до последнего запроса (полный снимок сессии). */
  private lastRunBeforeCount = 0

  constructor(
    private readonly agent: IAgentOrchestrator,
    private readonly sessionStore: ISessionStore,
    private readonly notificationService: INotificationService,
    private readonly permissionManager: IPermissionManager,
    private readonly webview: vscode.Webview,
    private readonly settingsProvider: ISettingsProvider,
    private readonly backend: IBackend,
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

  /** Отправить текущую модель в webview (футер чата). */
  sendModelInfo(): void {
    this.backend
      .getConfig()
      .then((c) => {
        this.webview.postMessage({ type: "modelInfo", model: c.model } as ExtToWebview)
      })
      .catch(() => {})
  }

  /** Отправить сообщения активной сессии в webview (структурная история). */
  sendActiveMessages(): void {
    const messages = this.sessionStore.getActiveMessages()
    this.webview.postMessage({
      type: "history",
      messages: messages
        .filter((m) => m.role !== "system")
        .map((m) => ({
          role: m.role,
          content: m.content,
          toolCalls: m.toolCalls,
          toolCallId: m.toolCallId,
          name: m.name,
        })),
    } as ExtToWebview)
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
            // Заметка привязана к конкретной сессии
            this.pendingRevertNote = null
            const messages = this.sessionStore.getActiveMessages()
            await this.agent.restoreSession(messages)
            this.sendActiveMessages()
            this.sendSessionList()
            this.sendModeChanged()
            break
          case "createSession": {
            await this.sessionStore.newSession()
            // Заметка привязана к конкретной сессии
            this.pendingRevertNote = null
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
          case "undoRevertSnapshot":
            // Отмена отката тоже недоступна во время выполнения агента
            if (!this.streaming) {
              await this.handleUndoRevertSnapshot(msg.runId)
            }
            break
          case "listCheckpoints":
            this.handleListCheckpoints()
            break
          case "restoreCheckpoint":
            // Возврат к чекпоинту недоступен во время выполнения агента
            if (!this.streaming) {
              await this.handleRestoreCheckpoint(msg.runId)
            }
            break
          case "openRequestDiff":
            // Предпросмотр запроса недоступен во время выполнения агента
            if (!this.streaming) {
              void this.handleOpenRequestDiff(msg.runId)
            }
            break
          case "restoreSessionCheckpoint":
            // Полное восстановление сессии недоступно во время выполнения агента
            if (!this.streaming) {
              await this.handleRestoreSessionCheckpoint(msg.runId)
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
        kind: "request",
        hash: patch.hash,
        endHash: patch.endHash,
        files: patch.files,
        messageCount: this.lastRunBeforeCount,
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
   * Выполнить откат файлов записи. Для kind="request" дополнительно создаёт
   * запись undo (снимки до/после отката) и сообщает webview о возможности отмены.
   * Возвращает null, если сервисы недоступны.
   */
  private async performRevert(
    record: ISnapshotRecord,
    filesToRevert: string[],
    forceFiles: Iterable<string>,
    extraSkipped = 0,
  ): Promise<IPerformedRevert | null> {
    if (!this.snapshotService || !this.snapshotStore) return null
    const pre = record.kind === "request" ? await this.snapshotService.track() : null
    const result = await this.snapshotService.revert(
      { ...record, files: filesToRevert },
      { forceFiles },
    )
    const ok = result.failed.length === 0
    let undoAvailable = false
    if (ok && record.kind === "request" && pre) {
      const post = await this.snapshotService.track()
      if (post) {
        const revertedFiles = [...result.restored, ...result.deleted]
        await this.snapshotStore.save({
          runId: `undo-${record.runId}`,
          sessionId: record.sessionId,
          kind: "preRevert",
          revertsRunId: record.runId,
          hash: pre,
          endHash: post,
          files: revertedFiles,
          createdAt: Date.now(),
        })
        undoAvailable = revertedFiles.length > 0
      }
    }
    if (ok) {
      if (result.restored.length + result.deleted.length > 0 && record.kind === "request") {
        const names = [...result.restored, ...result.deleted]
          .slice(0, 10)
          .map((f) => basename(f))
          .join(", ")
        this.pendingRevertNote =
          `Пользователь откатил изменения агента (файлы: ${names}). ` +
          "Не повторяй эти изменения, пока пользователь не подтвердит их снова."
      }
      const count = result.restored.length + result.deleted.length
      this.notificationService.show("agentDone", `Изменения откатлены (${count} файлов)`)
      await this.refreshDiffViewer()
    }
    return { ...result, undoAvailable }
  }

  /** Сообщить webview о результате отката. */
  private postRevert(runId: string, ok: boolean, error?: string, skippedCount = 0, undoAvailable = false): void {
    this.webview.postMessage({ type: "snapshotReverted", runId, ok, error, skippedCount, undoAvailable } as ExtToWebview)
  }

  /**
   * Откатить изменения запроса к состоянию чекпоинта.
   * Результат сообщается webview; при успехе обновляется
   * DiffViewer (если открыт) и показывается уведомление.
   */
  private async handleRevertSnapshot(runId: string): Promise<void> {
    const record = await this.snapshotStore?.get(runId)
    if (!this.snapshotService || !this.snapshotStore || !record || record.kind !== "request") {
      this.postRevert(runId, false, "Чекпоинт не найден")
      return
    }
    try {
      const result = await this.performRevert(record, record.files, [])
      if (!result) {
        this.postRevert(runId, false, "Чекпоинты недоступны")
        return
      }
      this.postRevert(
        runId,
        result.ok,
        result.ok ? undefined : result.failed.map((f) => f.error).join("; "),
        result.skipped.length,
        result.undoAvailable,
      )
    } catch (err: unknown) {
      this.postRevert(runId, false, errorMessage(err))
    }
  }

  /**
   * Отменить откат: восстановить файлы по записи undo (kind="preRevert")
   * и удалить её из реестра.
   */
  private async handleUndoRevertSnapshot(runId: string): Promise<void> {
    const undoRunId = `undo-${runId}`
    const record = await this.snapshotStore?.get(undoRunId)
    if (!this.snapshotService || !this.snapshotStore || !record) {
      this.webview.postMessage({ type: "undoReverted", runId, ok: false, error: "Отмена отката недоступна" } as ExtToWebview)
      return
    }
    try {
      const result = await this.performRevert(record, record.files, [])
      if (!result) {
        this.webview.postMessage({ type: "undoReverted", runId, ok: false, error: "Чекпоинты недоступны" } as ExtToWebview)
        return
      }
      if (result.ok) {
        // Изменения возвращены — заметка неактуальна
        this.pendingRevertNote = null
        await this.snapshotStore.delete(undoRunId)
      }
      this.webview.postMessage({
        type: "undoReverted",
        runId,
        ok: result.ok,
        error: result.ok ? undefined : result.failed.map((f) => f.error).join("; "),
      } as ExtToWebview)
      if (result.ok) await this.refreshDiffViewer()
    } catch (err: unknown) {
      this.webview.postMessage({ type: "undoReverted", runId, ok: false, error: errorMessage(err) } as ExtToWebview)
    }
  }

  /** Отправить webview список чекпоинтов активной сессии (только kind="request"). */
  private handleListCheckpoints(): void {
    if (!this.snapshotStore) {
      this.webview.postMessage({ type: "checkpointList", checkpoints: [] } as ExtToWebview)
      return
    }
    const sessionId = this.sessionStore.activeId
    this.snapshotStore
      .listBySession(sessionId)
      .then((records) => {
        const checkpoints = records
          .filter((r) => r.kind === "request")
          .map((r) => ({ runId: r.runId, createdAt: r.createdAt, fileCount: r.files.length }))
        this.webview.postMessage({ type: "checkpointList", checkpoints } as ExtToWebview)
      })
      .catch((err: unknown) => {
        log.warn(`Не удалось получить список чекпоинтов: ${errorMessage(err)}`)
        this.webview.postMessage({ type: "checkpointList", checkpoints: [] } as ExtToWebview)
      })
  }

  /**
   * Файлы записи, не затронутые более поздними запросами.
   * Возвращает [откатывать, число пропущено из-за поздних запросов].
   */
  private async filterByLaterRequests(record: ISnapshotRecord): Promise<[string[], number]> {
    const all = await this.snapshotStore!.listBySession(this.sessionStore.activeId)
    const later = all.filter((r) => r.kind === "request" && r.createdAt > record.createdAt)
    const laterTouched = new Set(later.flatMap((r) => r.files).map(pathKey))
    const toRevert = record.files.filter((f) => !laterTouched.has(pathKey(f)))
    return [toRevert, record.files.length - toRevert.length]
  }

  /**
   * Вернуть файлы к состоянию чекпоинта, минуя файлы, изменённые
   * последующими запросами (они отчитываются как пропущенные).
   */
  private async handleRestoreCheckpoint(runId: string): Promise<void> {
    const record = await this.snapshotStore?.get(runId)
    if (!this.snapshotService || !this.snapshotStore || !record || record.kind !== "request") {
      this.postRevert(runId, false, "Чекпоинт не найден")
      return
    }
    try {
      const [toRevert, skippedByLater] = await this.filterByLaterRequests(record)
      if (toRevert.length === 0) {
        this.postRevert(runId, false, "Все файлы этого запроса были изменены последующими запросами")
        return
      }
      const result = await this.performRevert(record, toRevert, [], skippedByLater)
      if (!result) {
        this.postRevert(runId, false, "Чекпоинты недоступны")
        return
      }
      this.postRevert(
        runId,
        result.ok,
        result.ok ? undefined : result.failed.map((f) => f.error).join("; "),
        result.skipped.length + skippedByLater,
        result.undoAvailable,
      )
    } catch (err: unknown) {
      this.postRevert(runId, false, errorMessage(err))
    }
  }

  /**
   * Полное восстановление сессии к чекпоинту: откат файлов + отмотка переписки,
   * памяти и плана агента. Переписка откатывается только если файлы откатились
   * без ошибок (skipped допустимы).
   */
  private async handleRestoreSessionCheckpoint(runId: string): Promise<void> {
    const post = (ok: boolean, error?: string): void => {
      this.webview.postMessage({ type: "sessionCheckpointRestored", runId, ok, error } as ExtToWebview)
    }
    const record = await this.snapshotStore?.get(runId)
    if (!this.snapshotService || !this.snapshotStore || !record || record.kind !== "request"
      || record.messageCount === undefined) {
      post(false, "Чекпоинт не найден")
      return
    }
    try {
      const [toRevert, skippedByLater] = await this.filterByLaterRequests(record)
      const result = await this.performRevert(record, toRevert, [], skippedByLater)
      if (!result) {
        post(false, "Чекпоинты недоступны")
        return
      }
      if (result.failed.length > 0) {
        post(false, result.failed.map((f) => f.error).join("; "))
        return
      }
      const sessionId = this.sessionStore.activeId
      const messages = this.sessionStore.getMessagesForSession(sessionId).slice(0, record.messageCount)
      await this.sessionStore.truncateMessages(sessionId, record.messageCount)
      await this.agent.restoreSession(messages)
      this.pendingRevertNote = null
      post(true)
      this.sendActiveMessages()
      this.sendSessionList()
      this.sendModeChanged()
    } catch (err: unknown) {
      post(false, errorMessage(err))
    }
  }

  /** Открыть предпросмотр изменений запроса в DiffViewer (режим request). */
  private async handleOpenRequestDiff(runId: string): Promise<void> {
    if (!this.snapshotService || !this.snapshotStore || !this.diffViewer) return
    const record = await this.snapshotStore.get(runId)
    if (!record || record.kind !== "request") return
    const requestDiff = await this.snapshotService.requestDiff(record)
    if (requestDiff) {
      this.diffViewer.openPanel({ type: "request", runId, files: requestDiff.files })
    }
  }

  /**
   * Выборочный откат: откатить только выбранные пользователем файлы
   * (явная отметка — bypass защиты «изменялось после запроса»).
   * Публичный: вызывается из DiffViewer через setRevertSelectedHandler
   * в ответ на входящее сообщение «revertSelected».
   */
  async handleRevertSelected(runId: string, files: string[]): Promise<void> {
    const record = await this.snapshotStore?.get(runId)
    if (!this.snapshotService || !this.snapshotStore || !record || record.kind !== "request") {
      this.postRevert(runId, false, "Чекпоинт не найден")
      return
    }
    // Только файлы, входящие в запись запроса (защита от чужих путей)
    const allowed = new Set(record.files.map(pathKey))
    const toRevert = files.filter((f) => allowed.has(pathKey(f)))
    if (toRevert.length === 0) {
      this.postRevert(runId, false, "Не выбраны файлы для отката")
      return
    }
    try {
      const result = await this.performRevert(record, toRevert, toRevert)
      if (!result) {
        this.postRevert(runId, false, "Чекпоинты недоступны")
        return
      }
      this.postRevert(
        runId,
        result.ok,
        result.ok ? undefined : result.failed.map((f) => f.error).join("; "),
        result.skipped.length,
        result.undoAvailable,
      )
    } catch (err: unknown) {
      this.postRevert(runId, false, errorMessage(err))
    }
  }

  /** Обновить статус diff в DiffViewer, если панель открыта. */
  private async refreshDiffViewer(): Promise<void> {
    if (!this.diffViewer?.isOpen() || !this.gitService) return
    const dir = this.getWorkDir()
    if (!dir) return
    try {
      const diff = await this.gitService.getDiff(dir)
      this.diffViewer.openPanel({ type: "workspace", diff })
    } catch (err: unknown) {
      log.warn(`Не удалось обновить diff после отката: ${errorMessage(err)}`)
    }
  }

  private async handleMessage(content: string): Promise<void> {
    if (this.streaming) return
    this.streaming = true
    this.abortController = new AbortController()
    this.webview.postMessage({ type: "messageConfirmed", content } as ExtToWebview)

    // Число сообщений до запроса — для полного восстановления сессии к чекпоинту
    this.lastRunBeforeCount = this.sessionStore.getActiveMessages().length
    // runId запроса — timestamp user-сообщения
    const userTimestamp = Date.now()
    await this.sessionStore.push({ role: "user", content, timestamp: userTimestamp })

    try {
      const note = this.pendingRevertNote
      const result = await this.agent.run(content, (chunk) => {
        this.webview.postMessage({ type: "streamChunk", text: chunk } as ExtToWebview)
      }, (toolName, args, id) => {
        this.webview.postMessage({
          type: "toolUse",
          toolName,
          args: JSON.stringify(args),
        } as ExtToWebview)
        // Персистентная история: assistant-сообщение с вызовом.
        // Заблокированный вызов (маркер _blocked в аргументах) дополняем
        // tool-сообщением сразу — иначе в восстановленной истории
        // tool_call останется без ответа и нарушит протокол API.
        const blocked = typeof args === "object" && args !== null && "_blocked" in args
        void this.sessionStore.push({
          role: "assistant",
          content: "",
          toolCalls: [{ id, toolName, arguments: JSON.stringify(args) }],
          timestamp: Date.now(),
        })
        if (blocked) {
          void this.sessionStore.push({
            role: "tool",
            toolCallId: id,
            name: toolName,
            content: String(args._blocked),
            timestamp: Date.now(),
          })
        }
      }, (toolName, result, id) => {
        this.webview.postMessage({
          type: "toolResult",
          toolName,
          output: result.output,
          success: result.success,
        } as ExtToWebview)
        // Персистентная история: tool-сообщение с выводом.
        void this.sessionStore.push({
          role: "tool",
          toolCallId: id,
          name: toolName,
          content: result.output,
          timestamp: Date.now(),
        })
      }, this.abortController.signal, undefined, (patch) => {
        this.handleSnapshotInfo(patch, String(userTimestamp))
      }, note ?? undefined)

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
      this.pendingRevertNote = null
      this.sendSessionList()
    }
  }
}
