import type { IBackend, ChatMessage } from "../core/IBackend"
import type { ToolRegistry } from "../tools/ToolRegistry"
import type { SkillManager } from "../skills/SkillManager"
import { AgentCore } from "./AgentCore"
import type { AgentDependencies, AgentSpawnFactory } from "./AgentDependencies"
import type { Plan } from "./Plan"
import type { TodoStore } from "./TodoStore"
import type { IContextProviderRegistry } from "../core/providers/context/registry"

/**
 * AgentOrchestrator — тонкий фасад над AgentCore.
 *
 * Содержит только маршрутизацию публичного API и делегирует
 * всю логику выполнения в AgentCore. SubagentRunner
 * подключается через фабрику (AgentSpawnFactory), что
 * разрывает циклическую зависимость.
 */
export class AgentOrchestrator {
  private core: AgentCore
  private disposed = false
  private abortController: AbortController = new AbortController()

  constructor(
    private readonly backend: IBackend,
    private readonly toolRegistry: ToolRegistry,
    private readonly skillManager: SkillManager,
    private readonly deps: AgentDependencies,
    private readonly spawnFactory: AgentSpawnFactory | null = null,
  ) {
    this.core = new AgentCore(
      backend,
      toolRegistry,
      skillManager,
      deps,
    )
  }

  // ── Выполнение ─────────────────────────────────────────

  async run(
    query: string,
    onChunk: (text: string) => void,
    onToolUse?: (name: string, args: Record<string, unknown>) => void,
    onToolResult?: (name: string, result: { output: string; success: boolean }) => void,
    signal?: AbortSignal,
  ): Promise<ChatMessage> {
    const combined = AbortSignal.any([this.abortController.signal, signal].filter((s): s is AbortSignal => !!s))
    return this.core.run(query, onChunk, onToolUse, onToolResult, combined)
  }

  // ── Планирование ───────────────────────────────────────

  async createPlan(_task: string, _onChunk?: (chunk: string) => void): Promise<Plan> {
    return this.core.createPlan(_task)
  }

  getPlan(): Plan | null {
    return this.core.getPlan()
  }

  clearPlan(): void {
    this.core.clearPlan()
  }

  // ── Режим ──────────────────────────────────────────────

  getMode() {
    return this.core.getMode()
  }

  switchMode(newMode: string): boolean {
    return this.core.switchMode(newMode)
  }

  // ── Todo ───────────────────────────────────────────────

  getTodoStore(): TodoStore {
    return this.core.getTodoStore()
  }

  // ── Сессия ─────────────────────────────────────────────

  resetSession(): void {
    this.core.resetSession()
  }

  // ── Контекст ───────────────────────────────────────────

  async resolveContextProvider(name: string, query: string): Promise<import("../core/providers/context/types").ContextItem[]> {
    const provider = this.deps.contextProviderRegistry.get(name)
    if (!provider) return []
    return provider.resolve(query)
  }

  getProviderRegistry(): IContextProviderRegistry {
    return this.deps.contextProviderRegistry
  }

  // ── Субагенты ──────────────────────────────────────────

  async spawnExplore(task: string): Promise<string> {
    if (!this.spawnFactory) {
      return "SubagentRunner не настроен"
    }
    const subagent = this.spawnFactory(
      this.deps,
      this.backend,
      this.toolRegistry,
      this.skillManager,
    )
    const handle = await subagent.run(task, () => {})
    subagent.dispose()
    return handle.content
  }

  // ── Жизненный цикл ─────────────────────────────────────

  async reload(): Promise<void> {
    this.abortController.abort()
    this.core.dispose()
    const workDir = this.deps.getWorkDir()
    if (workDir) {
      await this.deps.fileIndex.build(workDir)
    }
    this.abortController = new AbortController()
    this.core = new AgentCore(
      this.backend,
      this.toolRegistry,
      this.skillManager,
      this.deps,
    )
  }

  dispose(): void {
    this.disposed = true
    this.abortController.abort()
    this.core.dispose()
  }
}
