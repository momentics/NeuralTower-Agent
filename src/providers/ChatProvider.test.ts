import { describe, it, expect, vi, beforeEach } from "vitest"
import { ChatProvider } from "./ChatProvider"
import type { IBackend } from "../core/IBackend"
import type { IAgentOrchestrator } from "../core/IAgent"
import type { ISessionStore } from "../shared/PersistentSessionStore"
import type { NotificationService } from "../services/notification/NotificationService"
import type { PermissionManager } from "../services/permission/PermissionManager"
import type { ISettingsProvider } from "./SettingsProvider"

const createMockAgent = (): IAgentOrchestrator => ({
  run: vi.fn(async () => ({ role: "assistant", content: "Response", timestamp: Date.now() })),
  reload: vi.fn(async () => {}),
  dispose: vi.fn(),
  restoreSession: vi.fn(async () => {}),
  resetSession: vi.fn(),
  clearPlan: vi.fn(),
  getPlan: vi.fn(() => null),
  getMode: vi.fn(() => "build"),
  getModeInfo: vi.fn(() => ({
    name: "build",
    displayName: "Построение",
    description: "",
    toolRules: [],
    transitions: ["plan", "explore"],
    systemPromptAddon: "",
    priority: 10,
  })),
  switchMode: vi.fn(() => true),
  onModeChanged: vi.fn(() => ({ dispose: () => {} })),
  resolveContextProvider: vi.fn(async () => []),
  createPlan: vi.fn(async () => ({})),
  spawnExplore: vi.fn(async () => ""),
})

const createMockSessionStore = (): ISessionStore => ({
  newSession: vi.fn(async () => "sess-1"),
  setActive: vi.fn(),
  push: vi.fn(async () => {}),
  deleteSession: vi.fn(async () => {}),
  togglePin: vi.fn(async () => {}),
  rename: vi.fn(async () => {}),
  list: vi.fn(() => []),
  getActiveMessages: vi.fn(() => []),
  getActiveId: vi.fn(() => "sess-1"),
  get activeId() { return "sess-1" },
})

const createMockNotificationService = (): NotificationService => ({
  show: vi.fn(),
  askPermission: vi.fn(async () => "allow"),
})

const createMockPermissionManager = (): PermissionManager => ({
  checkPermission: vi.fn(async () => true),
  resolveRequest: vi.fn(() => true),
  onDidRequestPermission: vi.fn(() => ({ dispose: () => {} })),
})

const createMockSettingsProvider = (): ISettingsProvider => ({
  show: vi.fn(),
  dispose: vi.fn(),
})

const createMockBackend = (): IBackend =>
  ({
    getConfig: vi.fn(async () => ({ url: "http://localhost:30000", model: "test-model", maxRetries: 0, timeoutMs: 1000 })),
    listModels: vi.fn(async () => []),
    resolvedModel: vi.fn(async () => "test-model"),
    healthCheck: vi.fn(async () => true),
    chat: vi.fn(),
    chatJson: vi.fn(),
    currentUrl: vi.fn(() => "http://localhost:30000"),
    updateConfig: vi.fn(async () => {}),
  }) as unknown as IBackend

describe("ChatProvider", () => {
  let provider: ChatProvider
  let agent: IAgentOrchestrator
  let sessionStore: ISessionStore
  let notificationService: NotificationService
  let permissionManager: PermissionManager

  beforeEach(() => {
    agent = createMockAgent()
    sessionStore = createMockSessionStore()
    notificationService = createMockNotificationService()
    permissionManager = createMockPermissionManager()
    provider = new ChatProvider(
      { fsPath: "/ext" } as any,
      agent,
      sessionStore,
      notificationService,
      permissionManager,
      createMockSettingsProvider(),
      createMockBackend(),
    )
  })

  it("has correct viewType", () => {
    expect(provider.viewType).toBe("neuralTowerAgent.chat")
  })

  it("broadcasts new chat", () => {
    expect(() => provider.broadcastNewChat()).not.toThrow()
  })

  it("disposes without error", () => {
    expect(() => provider.dispose()).not.toThrow()
  })

  it("broadcastNewChat does not throw without panel", () => {
    expect(() => provider.broadcastNewChat()).not.toThrow()
  })
})
