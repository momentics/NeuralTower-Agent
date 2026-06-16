import { describe, it, expect, vi, beforeEach } from "vitest"
import { AgentOrchestrator } from "./AgentOrchestrator"
import type { IBackend } from "../core/IBackend"
import { ToolRegistry } from "../tools/ToolRegistry"
import type { SkillManager } from "../skills/SkillManager"

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

describe("AgentOrchestrator", () => {
  let backend: IBackend
  let toolRegistry: ToolRegistry
  let skillManager: SkillManager

  beforeEach(() => {
    backend = createMockBackend()
    toolRegistry = new ToolRegistry()
    skillManager = createMockSkillManager()
  })

  it("creates instance with defaults", () => {
    const orchestrator = new AgentOrchestrator(backend, toolRegistry, skillManager)
    expect(orchestrator).toBeDefined()
  })

  it("sets working directory", () => {
    const orchestrator = new AgentOrchestrator(backend, toolRegistry, skillManager)
    orchestrator.setWorkingDir("/some/path")
    expect(() => orchestrator.getMode()).not.toThrow()
  })

  it("returns default mode", () => {
    const orchestrator = new AgentOrchestrator(backend, toolRegistry, skillManager)
    const mode = orchestrator.getMode()
    expect(mode).toBeDefined()
  })

  it("switches mode to valid mode", () => {
    const orchestrator = new AgentOrchestrator(backend, toolRegistry, skillManager)
    const result = orchestrator.switchMode("plan")
    expect(result).toBe(true)
  })

  it("switchMode returns false for invalid mode", () => {
    const orchestrator = new AgentOrchestrator(backend, toolRegistry, skillManager)
    const result = orchestrator.switchMode("invalid_mode_xyz" as any)
    expect(result).toBe(false)
  })

  it("throws when running after dispose", async () => {
    const orchestrator = new AgentOrchestrator(backend, toolRegistry, skillManager)
    orchestrator.dispose()
    await expect(orchestrator.run("test", () => {})).rejects.toThrow("Агент освобождён")
  })

  it("runs and returns assistant message", async () => {
    const orchestrator = new AgentOrchestrator(backend, toolRegistry, skillManager)
    const chunks: string[] = []
    const result = await orchestrator.run("test query", (chunk) => chunks.push(chunk))
    expect(result.role).toBe("assistant")
    expect(result.content).toBeDefined()
  })

  it("calls backend chat with conversation", async () => {
    const orchestrator = new AgentOrchestrator(backend, toolRegistry, skillManager)
    await orchestrator.run("test query", () => {})
    expect(backend.chat).toHaveBeenCalled()
  })

  it("handles abort signal", async () => {
    const orchestrator = new AgentOrchestrator(backend, toolRegistry, skillManager)
    const ac = new AbortController()
    ac.abort()
    await expect(orchestrator.run("test", () => {}, undefined, undefined, ac.signal)).rejects.toThrow("Task aborted")
  })

  it("resets session", () => {
    const orchestrator = new AgentOrchestrator(backend, toolRegistry, skillManager)
    expect(() => orchestrator.resetSession()).not.toThrow()
  })

  it("disposes without error", () => {
    const orchestrator = new AgentOrchestrator(backend, toolRegistry, skillManager)
    expect(() => orchestrator.dispose()).not.toThrow()
  })

  it("clearPlan resets plan", () => {
    const orchestrator = new AgentOrchestrator(backend, toolRegistry, skillManager)
    orchestrator.clearPlan()
    expect(orchestrator.getPlan()).toBeNull()
  })

  it("getPlan returns null initially", () => {
    const orchestrator = new AgentOrchestrator(backend, toolRegistry, skillManager)
    expect(orchestrator.getPlan()).toBeNull()
  })

  it("resolveContextProvider returns empty for unknown provider", async () => {
    const orchestrator = new AgentOrchestrator(backend, toolRegistry, skillManager)
    const result = await orchestrator.resolveContextProvider("nonexistent", "query")
    expect(result).toEqual([])
  })

  it("getProviderRegistry returns registry", () => {
    const orchestrator = new AgentOrchestrator(backend, toolRegistry, skillManager)
    const registry = orchestrator.getProviderRegistry()
    expect(registry).toBeDefined()
  })

  it("spawnExplore returns message when subagentRunner not set", async () => {
    const orchestrator = new AgentOrchestrator(backend, toolRegistry, skillManager)
    const result = await orchestrator.spawnExplore("test task")
    expect(result).toBe("SubagentRunner не настроен")
  })

  it("setPermissionManager sets the manager", () => {
    const orchestrator = new AgentOrchestrator(backend, toolRegistry, skillManager)
    const mockPM = {} as any
    orchestrator.setPermissionManager(mockPM)
    expect(() => orchestrator.getMode()).not.toThrow()
  })

  it("setGitService sets the service", () => {
    const orchestrator = new AgentOrchestrator(backend, toolRegistry, skillManager)
    const mockGit = {} as any
    orchestrator.setGitService(mockGit)
    expect(() => orchestrator.getMode()).not.toThrow()
  })

  it("setMCPManager sets the manager", () => {
    const orchestrator = new AgentOrchestrator(backend, toolRegistry, skillManager)
    const mockMCP = {} as any
    orchestrator.setMCPManager(mockMCP)
    expect(() => orchestrator.getMode()).not.toThrow()
  })

  it("setSubagentRunner sets the runner", () => {
    const orchestrator = new AgentOrchestrator(backend, toolRegistry, skillManager)
    const mockRunner = {} as any
    orchestrator.setSubagentRunner(mockRunner)
    expect(() => orchestrator.getMode()).not.toThrow()
  })

  it("createPlan creates a plan", async () => {
    const orchestrator = new AgentOrchestrator(backend, toolRegistry, skillManager)
    const plan = await orchestrator.createPlan("test task", () => {})
    expect(plan).toBeDefined()
    expect(plan.title).toBeDefined()
  })

  it("createPlan falls back to single step on error", async () => {
    vi.mocked(backend.chatJson).mockRejectedValueOnce(new Error("Backend error"))
    const orchestrator = new AgentOrchestrator(backend, toolRegistry, skillManager)
    const plan = await orchestrator.createPlan("test task", () => {})
    expect(plan).toBeDefined()
    expect(plan.steps.length).toBe(1)
  })

  it("reload does not throw when workDir is empty", async () => {
    const orchestrator = new AgentOrchestrator(backend, toolRegistry, skillManager)
    await expect(orchestrator.reload()).resolves.not.toThrow()
  })
})
