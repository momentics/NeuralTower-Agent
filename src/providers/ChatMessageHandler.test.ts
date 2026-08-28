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

  const agent = {
    run: vi.fn(
      () =>
        new Promise<{ role: string; content: string; timestamp: number }>((resolve) => {
          runResolver = resolve
        }),
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

describe("ChatMessageHandler", () => {
  let agent: IAgentOrchestrator
  let webview: ReturnType<typeof createMockWebview>
  let sessionStore: ISessionStore
  let handler: ChatMessageHandler
  let onMessage: (msg: unknown) => Promise<void>
  let resolveRun: () => void

  beforeEach(() => {
    const mock = createMockAgent()
    agent = mock.agent
    resolveRun = mock.resolveRun
    webview = createMockWebview()
    sessionStore = createMockSessionStore()
    handler = new ChatMessageHandler(
      agent,
      sessionStore,
      createMockNotificationService(),
      createMockPermissionManager(),
      webview as never,
      createMockSettingsProvider(),
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
})
