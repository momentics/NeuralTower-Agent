import { describe, it, expect, vi, beforeEach } from "vitest"
import { ChatMessageHandler } from "./ChatMessageHandler"
import type { IAgentOrchestrator } from "../core/IAgent"
import type { ISessionStore } from "../shared/PersistentSessionStore"
import type { NotificationService } from "../services/notification/NotificationService"
import type { PermissionManager } from "../services/permission/PermissionManager"
import type { ISettingsProvider } from "./SettingsProvider"

/**
 * Mock агента с реальной матрицей переходов режимов
 * (build/plan/explore) и событием onModeChanged.
 */
function createMockAgent() {
  let mode = "build"
  const transitions: Record<string, string[]> = {
    build: ["plan", "explore"],
    plan: ["build"],
    explore: ["build", "plan"],
  }
  let modeHandler: ((m: string) => void) | null = null
  let runResolver: ((v: { role: string; content: string; timestamp: number }) => void) | null = null
  let runArgs: unknown[] = []

  const agent = {
    run: vi.fn(
      (...args: unknown[]) => {
        runArgs = args
        return new Promise<{ role: string; content: string; timestamp: number }>((resolve) => {
          runResolver = resolve
        })
      },
    ),
    reload: vi.fn(async () => {}),
    dispose: vi.fn(),
    restoreSession: vi.fn(async () => {}),
    resetSession: vi.fn(() => {
      if (mode !== "build") {
        mode = "build"
        if (modeHandler) modeHandler("build")
      }
    }),
    clearPlan: vi.fn(),
    getPlan: vi.fn(() => null),
    getMode: vi.fn(() => mode),
    getModeInfo: vi.fn(() => ({
      name: mode,
      displayName: mode,
      description: "",
      toolRules: [],
      transitions: transitions[mode] ?? [],
      systemPromptAddon: "",
      priority: 1,
    })),
    switchMode: vi.fn((next: string) => {
      if (next === mode) return true
      if (!(transitions[mode] ?? []).includes(next)) return false
      mode = next
      if (modeHandler) modeHandler(next)
      return true
    }),
    onModeChanged: vi.fn((handler: (m: string) => void) => {
      modeHandler = handler
      return { dispose: () => { modeHandler = null } }
    }),
    resolveContextProvider: vi.fn(async () => []),
    createPlan: vi.fn(async () => ({})),
    spawnExplore: vi.fn(async () => ""),
  }

  return {
    agent: agent as unknown as IAgentOrchestrator,
    resolveRun: () => runResolver?.({ role: "assistant", content: "готово", timestamp: Date.now() }),
    getRunArgs: () => runArgs,
  }
}

function createMockWebview() {
  return {
    postMessage: vi.fn(),
    onDidReceiveMessage: vi.fn(() => ({ dispose: () => {} })),
  }
}

function createMockSessionStore(): ISessionStore {
  return {
    init: vi.fn(async () => {}),
    push: vi.fn(async () => {}),
    newSession: vi.fn(async () => "sess-2"),
    deleteSession: vi.fn(async () => true),
    togglePin: vi.fn(async () => {}),
    rename: vi.fn(async () => {}),
    list: vi.fn(() => []),
    setActive: vi.fn(),
    getActiveMessages: vi.fn(() => []),
    get activeId() { return "sess-1" },
    getSession: vi.fn(),
    getMessagesForSession: vi.fn(() => []),
    clearActive: vi.fn(async () => {}),
    truncateMessages: vi.fn(async () => {}),
    dispose: vi.fn(),
  }
}

function createMockNotificationService(): NotificationService {
  return { show: vi.fn(), askPermission: vi.fn(async () => "allow") } as unknown as NotificationService
}

function createMockPermissionManager(): PermissionManager {
  return {
    checkPermission: vi.fn(async () => true),
    onDidRequestPermission: vi.fn(() => ({ dispose: () => {} })),
    resolveRequest: vi.fn(() => true),
  } as unknown as PermissionManager
}

function createMockSettingsProvider(): ISettingsProvider {
  return { show: vi.fn(), dispose: vi.fn() }
}

function createMockSnapshotService() {
  return {
    isEnabled: vi.fn(() => true),
    track: vi.fn(async () => "hash-1"),
    patch: vi.fn(async (hash: string) => ({ hash, endHash: hash, files: [] })),
    requestDiff: vi.fn(async () => null),
    revert: vi.fn(async () => ({ ok: true, restored: [], deleted: [], skipped: [], failed: [] })),
    restore: vi.fn(async () => {}),
    cleanup: vi.fn(async () => {}),
    dispose: vi.fn(),
  }
}

function createMockDiffViewer() {
  return {
    openPanel: vi.fn(),
    isOpen: vi.fn(() => false),
    close: vi.fn(),
    dispose: vi.fn(),
    setRevertSelectedHandler: vi.fn(),
  }
}

function createMockSnapshotStore() {
  return {
    save: vi.fn(async () => {}),
    get: vi.fn(async () => null),
    listBySession: vi.fn(async () => []),
    delete: vi.fn(async () => {}),
    prune: vi.fn(async () => {}),
    dispose: vi.fn(),
  }
}

describe("ChatMessageHandler", () => {
  let agent: IAgentOrchestrator
  let webview: ReturnType<typeof createMockWebview>
  let sessionStore: ISessionStore
  let notificationService: ReturnType<typeof createMockNotificationService>
  let snapshotService: ReturnType<typeof createMockSnapshotService>
  let snapshotStore: ReturnType<typeof createMockSnapshotStore>
  let diffViewer: ReturnType<typeof createMockDiffViewer>
  let handler: ChatMessageHandler
  let onMessage: (msg: unknown) => Promise<void>
  let resolveRun: () => void
  let getRunArgs: () => unknown[]

  beforeEach(() => {
    const mock = createMockAgent()
    agent = mock.agent
    resolveRun = mock.resolveRun
    getRunArgs = mock.getRunArgs
    webview = createMockWebview()
    sessionStore = createMockSessionStore()
    notificationService = createMockNotificationService()
    snapshotService = createMockSnapshotService()
    snapshotStore = createMockSnapshotStore()
    diffViewer = createMockDiffViewer()
    handler = new ChatMessageHandler(
      agent,
      sessionStore,
      notificationService,
      createMockPermissionManager(),
      webview as never,
      createMockSettingsProvider(),
      snapshotService,
      snapshotStore,
      diffViewer,
    )
    handler.subscribe([])
    onMessage = vi.mocked(webview.onDidReceiveMessage).mock.calls[0][0] as (msg: unknown) => Promise<void>
  })

  it("sendModeChanged posts current mode with allowed transitions", () => {
    handler.sendModeChanged()
    expect(webview.postMessage).toHaveBeenCalledWith({
      type: "modeChanged",
      mode: "build",
      allowed: ["plan", "explore"],
    })
  })

  it("subscribe forwards agent mode changes to webview", () => {
    expect(agent.onModeChanged).toHaveBeenCalledTimes(1)
    vi.mocked(agent.switchMode)("plan")
    expect(webview.postMessage).toHaveBeenCalledWith({
      type: "modeChanged",
      mode: "plan",
      allowed: ["build"],
    })
  })

  it("switchMode to allowed mode delegates to agent and syncs webview", async () => {
    await onMessage({ type: "switchMode", mode: "plan" })
    expect(agent.switchMode).toHaveBeenCalledWith("plan")
    expect(webview.postMessage).toHaveBeenCalledWith({
      type: "modeChanged",
      mode: "plan",
      allowed: ["build"],
    })
  })

  it("switchMode with unknown mode posts modeSwitchError without agent call", async () => {
    await onMessage({ type: "switchMode", mode: "hacker_mode" })
    expect(agent.switchMode).not.toHaveBeenCalled()
    expect(webview.postMessage).toHaveBeenCalledWith({
      type: "modeSwitchError",
      message: "Неизвестный режим: hacker_mode",
    })
  })

  it("switchMode with disallowed transition posts modeSwitchError naming current mode", async () => {
    await onMessage({ type: "switchMode", mode: "plan" })
    await onMessage({ type: "switchMode", mode: "explore" })
    expect(agent.switchMode).toHaveBeenLastCalledWith("explore")
    expect(webview.postMessage).toHaveBeenCalledWith({
      type: "modeSwitchError",
      message: "Переход в режим «explore» недоступен из режима «plan». Доступно: build",
    })
  })

  it("switchMode is processed while streaming", async () => {
    onMessage({ type: "sendMessage", content: "привет" })
    await vi.waitFor(() => expect(agent.run).toHaveBeenCalledTimes(1))
    await onMessage({ type: "switchMode", mode: "plan" })
    expect(agent.switchMode).toHaveBeenCalledWith("plan")
    resolveRun()
    await new Promise((r) => setTimeout(r, 20))
    expect(webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "streamDone" }))
  })

  it("switchSession restores agent session and resends mode", async () => {
    await onMessage({ type: "switchSession", sessionId: "sess-2" })
    expect(sessionStore.setActive).toHaveBeenCalledWith("sess-2")
    expect(agent.restoreSession).toHaveBeenCalled()
    expect(webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "modeChanged" }))
  })

  it("createSession resets agent, clears webview and syncs mode", async () => {
    await onMessage({ type: "switchMode", mode: "plan" })
    await onMessage({ type: "createSession" })
    expect(sessionStore.newSession).toHaveBeenCalled()
    expect(agent.clearPlan).toHaveBeenCalled()
    expect(agent.resetSession).toHaveBeenCalled()
    expect(webview.postMessage).toHaveBeenCalledWith({ type: "newChat" })
    expect(webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "modeChanged", mode: "build" }),
    )
  })

  // ── Чекпоинты ────────────────────────────────────────────

  it("saves snapshot record and posts snapshotInfo when files changed", async () => {
    onMessage({ type: "sendMessage", content: "задача" })
    await vi.waitFor(() => expect(agent.run).toHaveBeenCalledTimes(1))
    const args = getRunArgs()
    const onSnapshot = args[6] as (p: unknown) => void
    onSnapshot({ hash: "abc123", endHash: "def456", files: ["/work/a.ts", "/work/b.ts"] })
    await new Promise((r) => setTimeout(r, 20))

    expect(snapshotStore.save).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: expect.any(String),
        sessionId: "sess-1",
        kind: "request",
        hash: "abc123",
        endHash: "def456",
        files: ["/work/a.ts", "/work/b.ts"],
      }),
    )
    expect(webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "snapshotInfo", hash: "abc123", fileCount: 2 }),
    )
    resolveRun()
  })

  it("does not post snapshotInfo when no files changed", async () => {
    onMessage({ type: "sendMessage", content: "задача" })
    await vi.waitFor(() => expect(agent.run).toHaveBeenCalledTimes(1))
    const onSnapshot = getRunArgs()[6] as (p: unknown) => void
    onSnapshot({ hash: "abc123", endHash: "abc123", files: [] })
    await new Promise((r) => setTimeout(r, 20))

    expect(snapshotStore.save).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "request", hash: "abc123", endHash: "abc123", files: [] }),
    )
    expect(
      vi.mocked(webview.postMessage).mock.calls.some(
        (c) => (c[0] as { type: string }).type === "snapshotInfo",
      ),
    ).toBe(false)
    resolveRun()
  })

  it("revertSnapshot reverts changes and posts success", async () => {
    const record = {
      runId: "123",
      sessionId: "sess-1",
      kind: "request",
      hash: "abc",
      endHash: "def",
      files: ["/work/a.ts"],
      createdAt: 1,
    }
    vi.mocked(snapshotStore.get).mockResolvedValue(record)
    vi.mocked(snapshotService.revert).mockResolvedValue({
      ok: true,
      restored: ["/work/a.ts"],
      deleted: [],
      skipped: [],
      failed: [],
    })

    await onMessage({ type: "revertSnapshot", runId: "123" })

    expect(snapshotService.revert).toHaveBeenCalledWith(record, { forceFiles: [] })
    expect(webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "snapshotReverted", runId: "123", ok: true }),
    )
    expect(notificationService.show).toHaveBeenCalledWith(
      "agentDone",
      expect.stringContaining("откатлены"),
    )
  })

  it("revertSnapshot posts error when checkpoint not found", async () => {
    vi.mocked(snapshotStore.get).mockResolvedValue(null)
    await onMessage({ type: "revertSnapshot", runId: "404" })
    expect(snapshotService.revert).not.toHaveBeenCalled()
    expect(webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "snapshotReverted",
        runId: "404",
        ok: false,
        error: "Чекпоинт не найден",
      }),
    )
  })

  it("revertSnapshot posts error details on partial failure", async () => {
    const record = {
      runId: "123",
      sessionId: "sess-1",
      kind: "request",
      hash: "abc",
      endHash: "def",
      files: ["/work/a.ts"],
      createdAt: 1,
    }
    vi.mocked(snapshotStore.get).mockResolvedValue(record)
    vi.mocked(snapshotService.revert).mockResolvedValue({
      ok: false,
      restored: [],
      deleted: [],
      skipped: [],
      failed: [{ file: "/work/a.ts", error: "сбой восстановления" }],
    })

    await onMessage({ type: "revertSnapshot", runId: "123" })

    expect(webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "snapshotReverted",
        runId: "123",
        ok: false,
        error: "сбой восстановления",
      }),
    )
  })

  it("успешный откат создаёт запись undo и сообщает undoAvailable", async () => {
    const record = {
      runId: "run-1",
      sessionId: "sess-1",
      kind: "request",
      hash: "abc",
      endHash: "def",
      files: ["/w/a.txt"],
      createdAt: 1,
    }
    vi.mocked(snapshotStore.get).mockResolvedValue(record)
    vi.mocked(snapshotService.track)
      .mockResolvedValueOnce("pre-hash")
      .mockResolvedValueOnce("post-hash")
    vi.mocked(snapshotService.revert).mockResolvedValue({
      ok: true,
      restored: ["/w/a.txt"],
      deleted: [],
      skipped: [],
      failed: [],
    })

    await onMessage({ type: "revertSnapshot", runId: "run-1" })

    expect(snapshotStore.save).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "undo-run-1",
        kind: "preRevert",
        revertsRunId: "run-1",
        hash: "pre-hash",
        endHash: "post-hash",
        files: ["/w/a.txt"],
      }),
    )
    expect(webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "snapshotReverted",
        runId: "run-1",
        ok: true,
        undoAvailable: true,
      }),
    )
  })

  it("undoRevertSnapshot выполняет revert по записи preRevert и удаляет её", async () => {
    const undoRecord = {
      runId: "undo-run-1",
      sessionId: "sess-1",
      kind: "preRevert",
      revertsRunId: "run-1",
      hash: "pre-hash",
      endHash: "post-hash",
      files: ["/w/a.txt"],
      createdAt: 2,
    }
    vi.mocked(snapshotStore.get).mockResolvedValue(undoRecord)
    vi.mocked(snapshotService.revert).mockResolvedValue({
      ok: true,
      restored: ["/w/a.txt"],
      deleted: [],
      skipped: [],
      failed: [],
    })

    await onMessage({ type: "undoRevertSnapshot", runId: "run-1" })

    expect(snapshotService.revert).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "undo-run-1", files: ["/w/a.txt"] }),
      { forceFiles: [] },
    )
    expect(snapshotStore.delete).toHaveBeenCalledWith("undo-run-1")
    expect(webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "undoReverted", runId: "run-1", ok: true }),
    )
  })

  it("undoRevertSnapshot без записи сообщает об ошибке", async () => {
    vi.mocked(snapshotStore.get).mockResolvedValue(null)

    await onMessage({ type: "undoRevertSnapshot", runId: "run-1" })

    expect(snapshotService.revert).not.toHaveBeenCalled()
    expect(webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "undoReverted",
        runId: "run-1",
        ok: false,
        error: "Отмена отката недоступна",
      }),
    )
  })

  it("откат с пропусками передаёт skippedCount", async () => {
    const record = {
      runId: "run-1",
      sessionId: "sess-1",
      kind: "request",
      hash: "abc",
      endHash: "def",
      files: ["/w/a.txt"],
      createdAt: 1,
    }
    vi.mocked(snapshotStore.get).mockResolvedValue(record)
    vi.mocked(snapshotService.revert).mockResolvedValue({
      ok: true,
      restored: [],
      deleted: [],
      skipped: [{ file: "/w/a.txt", reason: "Файл изменялся после запроса" }],
      failed: [],
    })

    await onMessage({ type: "revertSnapshot", runId: "run-1" })

    expect(webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "snapshotReverted",
        runId: "run-1",
        ok: true,
        skippedCount: 1,
      }),
    )
  })

  it("listCheckpoints шлёт только записи request в порядке реестра", async () => {
    const newReq = {
      runId: "run-new",
      sessionId: "sess-1",
      kind: "request" as const,
      hash: "h1",
      endHash: "e1",
      files: ["/w/a.ts"],
      createdAt: 200,
    }
    const preRev = {
      runId: "undo-run-old",
      sessionId: "sess-1",
      kind: "preRevert" as const,
      revertsRunId: "run-old",
      hash: "h2",
      endHash: "e2",
      files: ["/w/b.ts"],
      createdAt: 150,
    }
    const oldReq = {
      runId: "run-old",
      sessionId: "sess-1",
      kind: "request" as const,
      hash: "h3",
      endHash: "e3",
      files: ["/w/b.ts"],
      createdAt: 100,
    }
    vi.mocked(snapshotStore.listBySession).mockResolvedValue([newReq, preRev, oldReq])

    await onMessage({ type: "listCheckpoints" })

    expect(snapshotStore.listBySession).toHaveBeenCalledWith("sess-1")
    expect(webview.postMessage).toHaveBeenCalledWith({
      type: "checkpointList",
      checkpoints: [
        { runId: "run-new", createdAt: 200, fileCount: 1 },
        { runId: "run-old", createdAt: 100, fileCount: 1 },
      ],
    })
  })

  it("restoreCheckpoint отфильтровывает файлы поздних запросов", async () => {
    const record = {
      runId: "run-1",
      sessionId: "sess-1",
      kind: "request" as const,
      hash: "abc",
      endHash: "def",
      files: ["/w/a.ts", "/w/b.ts"],
      createdAt: 100,
    }
    const later = {
      runId: "run-2",
      sessionId: "sess-1",
      kind: "request" as const,
      hash: "h2",
      endHash: "e2",
      files: ["/w/b.ts"],
      createdAt: 200,
    }
    vi.mocked(snapshotStore.get).mockResolvedValue(record)
    vi.mocked(snapshotStore.listBySession).mockResolvedValue([record, later])
    vi.mocked(snapshotService.revert).mockResolvedValue({
      ok: true,
      restored: ["/w/a.ts"],
      deleted: [],
      skipped: [],
      failed: [],
    })

    await onMessage({ type: "restoreCheckpoint", runId: "run-1" })

    expect(snapshotService.revert).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", files: ["/w/a.ts"] }),
      { forceFiles: [] },
    )
    expect(webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "snapshotReverted",
        runId: "run-1",
        ok: true,
        skippedCount: 1,
      }),
    )
  })

  it("restoreCheckpoint с пустым набором файлов не вызывает revert", async () => {
    const record = {
      runId: "run-1",
      sessionId: "sess-1",
      kind: "request" as const,
      hash: "abc",
      endHash: "def",
      files: ["/w/a.ts"],
      createdAt: 100,
    }
    const later = {
      runId: "run-2",
      sessionId: "sess-1",
      kind: "request" as const,
      hash: "h2",
      endHash: "e2",
      files: ["/w/a.ts"],
      createdAt: 200,
    }
    vi.mocked(snapshotStore.get).mockResolvedValue(record)
    vi.mocked(snapshotStore.listBySession).mockResolvedValue([record, later])

    await onMessage({ type: "restoreCheckpoint", runId: "run-1" })

    expect(snapshotService.revert).not.toHaveBeenCalled()
    expect(webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "snapshotReverted",
        runId: "run-1",
        ok: false,
        error: "Все файлы этого запроса были изменены последующими запросами",
      }),
    )
  })

  it("openRequestDiff открывает панель в режиме request", async () => {
    const record = {
      runId: "run-1",
      sessionId: "sess-1",
      kind: "request" as const,
      hash: "abc",
      endHash: "def",
      files: ["/w/a.ts"],
      createdAt: 1,
    }
    vi.mocked(snapshotStore.get).mockResolvedValue(record)
    vi.mocked(snapshotService.requestDiff).mockResolvedValue({
      runId: "run-1",
      files: [{ path: "/w/a.ts", status: "modified" as const, diff: "", userTouched: false }],
    })

    await onMessage({ type: "openRequestDiff", runId: "run-1" })
    await vi.waitFor(() => expect(diffViewer.openPanel).toHaveBeenCalledTimes(1))

    expect(diffViewer.openPanel).toHaveBeenCalledWith({
      type: "request",
      runId: "run-1",
      files: [{ path: "/w/a.ts", status: "modified", diff: "", userTouched: false }],
    })
  })

  it("openRequestDiff без записи не открывает панель", async () => {
    vi.mocked(snapshotStore.get).mockResolvedValue(null)
    await onMessage({ type: "openRequestDiff", runId: "404" })
    await new Promise((r) => setTimeout(r, 20))
    expect(diffViewer.openPanel).not.toHaveBeenCalled()
  })

  it("handleRevertSelected откатывает только выбранные и форсит их", async () => {
    const record = {
      runId: "run-1",
      sessionId: "sess-1",
      kind: "request" as const,
      hash: "abc",
      endHash: "def",
      files: ["/w/a.ts", "/w/b.ts"],
      createdAt: 1,
    }
    vi.mocked(snapshotStore.get).mockResolvedValue(record)
    vi.mocked(snapshotService.revert).mockResolvedValue({
      ok: true,
      restored: ["/w/a.ts"],
      deleted: [],
      skipped: [],
      failed: [],
    })

    await handler.handleRevertSelected("run-1", ["/w/a.ts"])

    expect(snapshotService.revert).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", files: ["/w/a.ts"] }),
      { forceFiles: ["/w/a.ts"] },
    )
  })

  it("handleRevertSelected отклоняет пути вне записи", async () => {
    const record = {
      runId: "run-1",
      sessionId: "sess-1",
      kind: "request" as const,
      hash: "abc",
      endHash: "def",
      files: ["/w/a.ts", "/w/b.ts"],
      createdAt: 1,
    }
    vi.mocked(snapshotStore.get).mockResolvedValue(record)

    await handler.handleRevertSelected("run-1", ["/other/x.ts"])

    expect(snapshotService.revert).not.toHaveBeenCalled()
    expect(webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "snapshotReverted",
        runId: "run-1",
        ok: false,
        error: "Не выбраны файлы для отката",
      }),
    )
  })

  it("revertSnapshot is ignored while streaming", async () => {
    onMessage({ type: "sendMessage", content: "задача" })
    await vi.waitFor(() => expect(agent.run).toHaveBeenCalledTimes(1))
    await onMessage({ type: "revertSnapshot", runId: "123" })
    expect(snapshotService.revert).not.toHaveBeenCalled()
    resolveRun()
    await new Promise((r) => setTimeout(r, 20))
  })

  // ── Обратная связь агенту после отката ───────────────────

  it("после успешного отката следующий run получает заметку", async () => {
    const record = {
      runId: "run-1",
      sessionId: "sess-1",
      kind: "request" as const,
      hash: "abc",
      endHash: "def",
      files: ["/w/a.ts"],
      createdAt: 1,
    }
    vi.mocked(snapshotStore.get).mockResolvedValue(record)
    vi.mocked(snapshotService.revert).mockResolvedValue({
      ok: true,
      restored: ["/w/a.ts"],
      deleted: [],
      skipped: [],
      failed: [],
    })

    await onMessage({ type: "revertSnapshot", runId: "run-1" })

    onMessage({ type: "sendMessage", content: "ещё" })
    await vi.waitFor(() => expect(agent.run).toHaveBeenCalledTimes(1))
    const args = getRunArgs()
    const note = args[args.length - 1]
    expect(note).toBeTypeOf("string")
    expect(note).toContain("откатил")
    expect(note).toContain("a.ts")
    resolveRun()
  })

  it("после undo заметка сбрасывается", async () => {
    const record = {
      runId: "run-1",
      sessionId: "sess-1",
      kind: "request" as const,
      hash: "abc",
      endHash: "def",
      files: ["/w/a.ts"],
      createdAt: 1,
    }
    const undoRecord = {
      runId: "undo-run-1",
      sessionId: "sess-1",
      kind: "preRevert" as const,
      revertsRunId: "run-1",
      hash: "pre-hash",
      endHash: "post-hash",
      files: ["/w/a.ts"],
      createdAt: 2,
    }
    vi.mocked(snapshotStore.get)
      .mockResolvedValueOnce(record)
      .mockResolvedValueOnce(undoRecord)
    vi.mocked(snapshotService.revert).mockResolvedValue({
      ok: true,
      restored: ["/w/a.ts"],
      deleted: [],
      skipped: [],
      failed: [],
    })

    await onMessage({ type: "revertSnapshot", runId: "run-1" })
    await onMessage({ type: "undoRevertSnapshot", runId: "run-1" })

    onMessage({ type: "sendMessage", content: "ещё" })
    await vi.waitFor(() => expect(agent.run).toHaveBeenCalledTimes(1))
    const args = getRunArgs()
    expect(args[args.length - 1]).toBeUndefined()
    resolveRun()
  })

  // ── Полный снимок сессии ─────────────────────────────────

  it("restoreSessionCheckpoint: успех — truncate + restoreSession + пересылка", async () => {
    const record = {
      runId: "run-1",
      sessionId: "sess-1",
      kind: "request" as const,
      hash: "abc",
      endHash: "def",
      files: ["/w/a.ts"],
      createdAt: 1,
      messageCount: 2,
    }
    vi.mocked(snapshotStore.get).mockResolvedValue(record)
    vi.mocked(snapshotStore.listBySession).mockResolvedValue([record])
    vi.mocked(snapshotService.revert).mockResolvedValue({
      ok: true,
      restored: ["/w/a.ts"],
      deleted: [],
      skipped: [],
      failed: [],
    })
    const msgs = [
      { role: "user" as const, content: "m1", timestamp: 1 },
      { role: "assistant" as const, content: "m2", timestamp: 2 },
      { role: "user" as const, content: "m3", timestamp: 3 },
      { role: "assistant" as const, content: "m4", timestamp: 4 },
    ]
    vi.mocked(sessionStore.getMessagesForSession).mockReturnValue(msgs)
    vi.mocked(sessionStore.getActiveMessages).mockReturnValue(msgs.slice(0, 2))

    await onMessage({ type: "restoreSessionCheckpoint", runId: "run-1" })

    expect(sessionStore.truncateMessages).toHaveBeenCalledWith("sess-1", 2)
    expect(agent.restoreSession).toHaveBeenCalledWith(msgs.slice(0, 2))
    expect(webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "sessionCheckpointRestored", runId: "run-1", ok: true }),
    )
    expect(webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "messageConfirmed", content: "m1" }),
    )
    expect(webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "streamChunk", text: "m2" }),
    )
  })

  it("restoreSessionCheckpoint: ошибка revert — переписка не трогается", async () => {
    const record = {
      runId: "run-1",
      sessionId: "sess-1",
      kind: "request" as const,
      hash: "abc",
      endHash: "def",
      files: ["/w/a.ts"],
      createdAt: 1,
      messageCount: 2,
    }
    vi.mocked(snapshotStore.get).mockResolvedValue(record)
    vi.mocked(snapshotStore.listBySession).mockResolvedValue([record])
    vi.mocked(snapshotService.revert).mockResolvedValue({
      ok: false,
      restored: [],
      deleted: [],
      skipped: [],
      failed: [{ file: "/w/a.ts", error: "x" }],
    })

    await onMessage({ type: "restoreSessionCheckpoint", runId: "run-1" })

    expect(sessionStore.truncateMessages).not.toHaveBeenCalled()
    expect(agent.restoreSession).not.toHaveBeenCalled()
    expect(webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "sessionCheckpointRestored", runId: "run-1", ok: false, error: "x" }),
    )
  })

  it("restoreSessionCheckpoint без messageCount — ошибка", async () => {
    const record = {
      runId: "run-1",
      sessionId: "sess-1",
      kind: "request" as const,
      hash: "abc",
      endHash: "def",
      files: ["/w/a.ts"],
      createdAt: 1,
    }
    vi.mocked(snapshotStore.get).mockResolvedValue(record)

    await onMessage({ type: "restoreSessionCheckpoint", runId: "run-1" })

    expect(sessionStore.truncateMessages).not.toHaveBeenCalled()
    expect(agent.restoreSession).not.toHaveBeenCalled()
    expect(webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "sessionCheckpointRestored", runId: "run-1", ok: false }),
    )
  })
})
