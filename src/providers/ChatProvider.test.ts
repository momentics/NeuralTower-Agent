import { describe, it, expect, vi, beforeEach } from "vitest"
import { ChatProvider } from "./ChatProvider"
import type { IAgentOrchestrator } from "../core/IAgent"
import type { PersistentSessionStore } from "../shared/PersistentSessionStore"
import type { NotificationService } from "../services/notification/NotificationService"
import type { PermissionManager } from "../services/permission/PermissionManager"

const createMockAgent = (): IAgentOrchestrator => ({
  run: vi.fn(async () => ({ role: "assistant", content: "Response", timestamp: Date.now() })),
  reload: vi.fn(async () => {}),
  dispose: vi.fn(),
  resetSession: vi.fn(),
  switchMode: vi.fn(() => true),
  getMode: vi.fn(() => "agent"),
  resolveContextProvider: vi.fn(async () => []),
  getProviderRegistry: vi.fn(() => ({})),
  createPlan: vi.fn(async () => ({})),
  clearPlan: vi.fn(),
  getPlan: vi.fn(() => null),
  spawnExplore: vi.fn(async () => ""),
})

const createMockSessionStore = (): PersistentSessionStore => ({
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

describe("ChatProvider", () => {
  let provider: ChatProvider
  let agent: IAgentOrchestrator
  let sessionStore: PersistentSessionStore
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
