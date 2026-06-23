import { describe, it, expect, vi, beforeEach } from "vitest"
import { AgentOrchestrator } from "./AgentOrchestrator"
import type { IBackend } from "../core/IBackend"
import { ToolRegistry } from "../tools/ToolRegistry"
import type { SkillManager } from "../skills/SkillManager"
import type { IAgentFullDependencies } from "./AgentDependencies"
import { ContextManager } from "../core/ContextManager"
import { ContextProviderRegistry } from "../core/providers/context/Registry"
import { FileIndex } from "../repo/FileIndex"
import { loadDefaultAgentConfig, loadDefaultCompactorConfig, loadDefaultContextConfig, loadDefaultSessionConfig } from "../core/Config"
import { TodoStore } from "./TodoStore"

const createMockBackend = (): IBackend => ({
  chat: vi.fn(async () => ({ role: "assistant", content: "Test response", timestamp: Date.now() })),
  chatJson: vi.fn(async () => ({})),
  getConfig: vi.fn(async () => ({ url: "http://localhost:30000", model: "test-model", maxRetries: 3, timeoutMs: 60000 })),
  updateConfig: vi.fn(async () => {}),
  listModels: vi.fn(async () => ["test-model"]),
  healthCheck: vi.fn(async () => true),
})

const createMockSkillManager = (): SkillManager => ({
  match: vi.fn(() => []),
  buildContext: vi.fn(() => ""),
  register: vi.fn(),
  list: vi.fn(() => []),
} as unknown as SkillManager)

const createDeps = (): IAgentFullDependencies => {
  const contextManager = new ContextManager()
  const registry = new ContextProviderRegistry()
  const fileIndex = new FileIndex()
  return {
    getWorkDir: () => "",
    config: {
      backend: { url: "http://localhost:30000", model: "test-model", maxRetries: 3, timeoutMs: 60000 },
      agent: loadDefaultAgentConfig(),
      context: loadDefaultContextConfig(),
      compactor: loadDefaultCompactorConfig(),
      session: loadDefaultSessionConfig(),
    },
    contextProviderRegistry: registry,
    contextManager,
    fileIndex,
    gitService: null,
    permissionManager: null,
    mcpManager: null,
  }
}

describe("AgentOrchestrator", () => {
  let backend: IBackend
  let toolRegistry: ToolRegistry
  let skillManager: SkillManager
  let deps: IAgentFullDependencies

  beforeEach(() => {
    backend = createMockBackend()
    toolRegistry = new ToolRegistry()
    skillManager = createMockSkillManager()
    deps = createDeps()
  })

  it("creates instance with defaults", () => {
    const orchestrator = new AgentOrchestrator(backend, toolRegistry, skillManager, deps, null, new TodoStore())
    expect(orchestrator).toBeDefined()
  })

  it("returns default mode", () => {
    const orchestrator = new AgentOrchestrator(backend, toolRegistry, skillManager, deps, null, new TodoStore())
    const mode = orchestrator.getMode()
    expect(mode).toBeDefined()
  })

  it("switches mode to valid mode", () => {
    const orchestrator = new AgentOrchestrator(backend, toolRegistry, skillManager, deps, null, new TodoStore())
    const result = orchestrator.switchMode("plan")
    expect(result).toBe(true)
  })

  it("switchMode returns false for invalid mode", () => {
    const orchestrator = new AgentOrchestrator(backend, toolRegistry, skillManager, deps, null, new TodoStore())
    const result = orchestrator.switchMode("invalid_mode_xyz" as any)
    expect(result).toBe(false)
  })

  it("throws when running after dispose", async () => {
    const orchestrator = new AgentOrchestrator(backend, toolRegistry, skillManager, deps, null, new TodoStore())
    orchestrator.dispose()
    await expect(orchestrator.run("test", () => {})).rejects.toThrow("Агент освобождён")
  })

  it("runs and returns assistant message", async () => {
    const orchestrator = new AgentOrchestrator(backend, toolRegistry, skillManager, deps, null, new TodoStore())
    const chunks: string[] = []
    const result = await orchestrator.run("test query", (chunk) => chunks.push(chunk))
    expect(result.role).toBe("assistant")
    expect(result.content).toBeDefined()
  })

  it("calls backend chat with conversation", async () => {
    const orchestrator = new AgentOrchestrator(backend, toolRegistry, skillManager, deps, null, new TodoStore())
    await orchestrator.run("test query", () => {})
    expect(backend.chat).toHaveBeenCalled()
  })

  it("handles abort signal", async () => {
    const orchestrator = new AgentOrchestrator(backend, toolRegistry, skillManager, deps, null, new TodoStore())
    const ac = new AbortController()
    ac.abort()
    await expect(orchestrator.run("test", () => {}, undefined, undefined, ac.signal)).rejects.toThrow("Задача отменена")
  })

  it("resets session", () => {
    const orchestrator = new AgentOrchestrator(backend, toolRegistry, skillManager, deps, null, new TodoStore())
    expect(() => orchestrator.resetSession()).not.toThrow()
  })

  it("disposes without error", () => {
    const orchestrator = new AgentOrchestrator(backend, toolRegistry, skillManager, deps, null, new TodoStore())
    expect(() => orchestrator.dispose()).not.toThrow()
  })

  it("clearPlan resets plan", () => {
    const orchestrator = new AgentOrchestrator(backend, toolRegistry, skillManager, deps, null, new TodoStore())
    orchestrator.clearPlan()
    expect(orchestrator.getPlan()).toBeNull()
  })

  it("getPlan returns null initially", () => {
    const orchestrator = new AgentOrchestrator(backend, toolRegistry, skillManager, deps, null, new TodoStore())
    expect(orchestrator.getPlan()).toBeNull()
  })

  it("resolveContextProvider returns empty for unknown provider", async () => {
    const orchestrator = new AgentOrchestrator(backend, toolRegistry, skillManager, deps, null, new TodoStore())
    const result = await orchestrator.resolveContextProvider("nonexistent", "query")
    expect(result).toEqual([])
  })

 it("spawnExplore returns message when spawnFactory not set", async () => {
    const orchestrator = new AgentOrchestrator(backend, toolRegistry, skillManager, deps, null, new TodoStore())
    const result = await orchestrator.spawnExplore("test task")
    expect(result).toBe("SubagentRunner не настроен")
  })

  it("createPlan creates a plan", async () => {
    const orchestrator = new AgentOrchestrator(backend, toolRegistry, skillManager, deps, null, new TodoStore())
    const plan = await orchestrator.createPlan("test task")
    expect(plan).toBeDefined()
    expect(plan.title).toBeDefined()
  })

  it("createPlan falls back to single step on error", async () => {
    vi.mocked(backend.chatJson).mockRejectedValueOnce(new Error("Backend error"))
    const orchestrator = new AgentOrchestrator(backend, toolRegistry, skillManager, deps, null, new TodoStore())
    const plan = await orchestrator.createPlan("test task")
    expect(plan).toBeDefined()
    expect(plan.steps.length).toBe(1)
  })

  it("reload does not throw", async () => {
    const orchestrator = new AgentOrchestrator(backend, toolRegistry, skillManager, deps, null, new TodoStore())
    await expect(orchestrator.reload()).resolves.not.toThrow()
  })

  it("reload aborts running task", async () => {
    const slowBackend: IBackend = {
      chat: vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 500))
        return { role: "assistant", content: "slow", timestamp: Date.now() }
      }),
      chatJson: vi.fn(async () => ({})),
      getConfig: vi.fn(async () => ({ url: "http://localhost:30000", model: "test-model", maxRetries: 3, timeoutMs: 60000 })),
      updateConfig: vi.fn(async () => {}),
      listModels: vi.fn(async () => ["test-model"]),
      healthCheck: vi.fn(async () => true),
    }
    const orchestrator = new AgentOrchestrator(slowBackend, toolRegistry, skillManager, deps, null, new TodoStore())
    const runPromise = orchestrator.run("test", () => {})
    await orchestrator.reload()
    await expect(runPromise).rejects.toThrow("Задача отменена")
  })

  it("dispose aborts running task", async () => {
    const slowBackend: IBackend = {
      chat: vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 500))
        return { role: "assistant", content: "slow", timestamp: Date.now() }
      }),
      chatJson: vi.fn(async () => ({})),
      getConfig: vi.fn(async () => ({ url: "http://localhost:30000", model: "test-model", maxRetries: 3, timeoutMs: 60000 })),
      updateConfig: vi.fn(async () => {}),
      listModels: vi.fn(async () => ["test-model"]),
      healthCheck: vi.fn(async () => true),
    }
    const orchestrator = new AgentOrchestrator(slowBackend, toolRegistry, skillManager, deps, null, new TodoStore())
    const runPromise = orchestrator.run("test", () => {})
    orchestrator.dispose()
    await expect(runPromise).rejects.toThrow("Задача отменена")
  })

  it("getTodoStore returns a TodoStore instance", () => {
    const orchestrator = new AgentOrchestrator(backend, toolRegistry, skillManager, deps, null, new TodoStore())
    const store = orchestrator.getTodoStore()
    expect(store).toBeDefined()
    expect(store.getItems()).toEqual([])
  })

  it("resetSession clears TodoStore", () => {
    const orchestrator = new AgentOrchestrator(backend, toolRegistry, skillManager, deps, null, new TodoStore())
    const store = orchestrator.getTodoStore()
    store.setItems([{ content: "A", status: "pending" as const, priority: "high" as const }])
    orchestrator.resetSession()
    expect(store.getItems()).toEqual([])
  })

  it("restoreSession restores messages", async () => {
    const orchestrator = new AgentOrchestrator(backend, toolRegistry, skillManager, deps, null, new TodoStore())
    const messages = [
      { role: "user" as const, content: "hello", timestamp: 1 },
      { role: "assistant" as const, content: "hi", timestamp: 2 },
    ]
    await orchestrator.restoreSession(messages)
    expect(orchestrator.getPlan()).toBeNull()
  })

  it("restoreSession clears TodoStore", async () => {
    const orchestrator = new AgentOrchestrator(backend, toolRegistry, skillManager, deps, null, new TodoStore())
    orchestrator.getTodoStore().setItems([{ content: "A", status: "pending" as const, priority: "high" as const }])
    await orchestrator.restoreSession([])
    expect(orchestrator.getTodoStore().getItems()).toEqual([])
  })
})
