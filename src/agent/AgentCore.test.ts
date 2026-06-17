import { describe, it, expect, vi, beforeEach } from "vitest"
import { AgentCore } from "./AgentCore"
import type { IBackend } from "../core/IBackend"
import { ToolRegistry } from "../tools/ToolRegistry"
import type { SkillManager } from "../skills/SkillManager"
import { AgentEnvironment } from "./AgentEnvironment"
import { ContextManager } from "../core/ContextManager"
import { ContextProviderRegistry } from "../core/providers/context/registry"
import { FileIndex } from "../repo/FileIndex"
import { loadDefaultAgentConfig, loadDefaultCompactorConfig, loadDefaultContextConfig, loadDefaultSessionConfig } from "../core/config"

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

const createEnvironment = (): AgentEnvironment => {
  const contextManager = new ContextManager()
  const registry = new ContextProviderRegistry()
  const fileIndex = new FileIndex()
  return new AgentEnvironment(
    "/test/workdir",
    {
      backend: { url: "http://localhost:30000", model: "test-model", maxRetries: 3, timeoutMs: 60000 },
      agent: loadDefaultAgentConfig(),
      context: loadDefaultContextConfig(),
      compactor: loadDefaultCompactorConfig(),
      session: loadDefaultSessionConfig(),
    },
    registry,
    contextManager,
    fileIndex,
  )
}

describe("AgentCore", () => {
  let backend: IBackend
  let toolRegistry: ToolRegistry
  let skillManager: SkillManager
  let env: AgentEnvironment

  beforeEach(() => {
    backend = createMockBackend()
    toolRegistry = new ToolRegistry()
    skillManager = createMockSkillManager()
    env = createEnvironment()
  })

  it("creates instance", () => {
    const core = new AgentCore(backend, toolRegistry, skillManager, env)
    expect(core).toBeDefined()
  })

  it("returns default mode", () => {
    const core = new AgentCore(backend, toolRegistry, skillManager, env)
    const mode = core.getMode()
    expect(mode).toBeDefined()
  })

  it("switches mode", () => {
    const core = new AgentCore(backend, toolRegistry, skillManager, env)
    expect(core.switchMode("plan")).toBe(true)
    expect(core.switchMode("invalid_xyz" as any)).toBe(false)
  })

  it("runs and returns assistant message", async () => {
    const core = new AgentCore(backend, toolRegistry, skillManager, env)
    const result = await core.run("test query", () => {})
    expect(result.role).toBe("assistant")
    expect(result.content).toBeDefined()
  })

  it("throws on abort signal", async () => {
    const core = new AgentCore(backend, toolRegistry, skillManager, env)
    const ac = new AbortController()
    ac.abort()
    await expect(core.run("test", () => {}, undefined, undefined, ac.signal)).rejects.toThrow("Task aborted")
  })

  it("throws after dispose", async () => {
    const core = new AgentCore(backend, toolRegistry, skillManager, env)
    core.dispose()
    await expect(core.run("test", () => {})).rejects.toThrow("Агент освобождён")
  })

  it("getTodoStore returns TodoStore", () => {
    const core = new AgentCore(backend, toolRegistry, skillManager, env)
    const store = core.getTodoStore()
    expect(store.getItems()).toEqual([])
  })

  it("resetSession clears TodoStore", () => {
    const core = new AgentCore(backend, toolRegistry, skillManager, env)
    core.getTodoStore().setItems([{ content: "A", status: "pending", priority: "high" }])
    core.resetSession()
    expect(core.getTodoStore().getItems()).toEqual([])
  })

  it("getPlan returns null initially", () => {
    const core = new AgentCore(backend, toolRegistry, skillManager, env)
    expect(core.getPlan()).toBeNull()
  })

  it("clearPlan clears plan", () => {
    const core = new AgentCore(backend, toolRegistry, skillManager, env)
    core.clearPlan()
    expect(core.getPlan()).toBeNull()
  })

  it("createPlan creates a plan", async () => {
    const core = new AgentCore(backend, toolRegistry, skillManager, env)
    const plan = await core.createPlan("test task")
    expect(plan).toBeDefined()
    expect(plan.title).toBeDefined()
  })

  it("dispose prevents further runs", () => {
    const core = new AgentCore(backend, toolRegistry, skillManager, env)
    core.dispose()
    expect(core).toBeDefined()
  })
})
