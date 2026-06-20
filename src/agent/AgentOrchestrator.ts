import type { IBackend, ChatMessage } from "../core/IBackend"
import type { ToolRegistry } from "../tools/ToolRegistry"
import type { SkillManager } from "../skills/SkillManager"
import type { ISkill } from "../skills/ISkill"
import { AgentCore } from "./AgentCore"
import type { AgentModeName } from "./AgentMode"
import type { AgentDependencies, AgentSpawnFactory } from "./AgentDependencies"
import type { Plan } from "./Plan"
import type { TodoStore } from "./TodoStore"
import type { ToolResult } from "./AgentTypes"
import type { IContextProviderRegistry } from "../core/providers/context/registry"
import type { ContextItem } from "../core/providers/context/types"

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
    this.core = this.createCore()
  }

  private createCore(): AgentCore {
    return new AgentCore(
      this.backend,
      this.toolRegistry,
      this.skillManager,
      this.deps,
    )
  }

  // ── Выполнение ─────────────────────────────────────────

  async run(
    query: string,
    onChunk: (text: string) => void,
    onToolUse?: (name: string, args: Record<string, unknown>) => void,
    onToolResult?: (name: string, result: ToolResult) => void,
    signal?: AbortSignal,
    onCompaction?: (tokensBefore: number, tokensAfter: number) => void,
  ): Promise<ChatMessage> {
    const combined = AbortSignal.any([this.abortController.signal, signal].filter((s): s is AbortSignal => !!s))
    return this.core.run(query, onChunk, onToolUse, onToolResult, combined, onCompaction)
  }

  // ── Планирование ───────────────────────────────────────

  async createPlan(task: string, activeSkills?: ISkill[]): Promise<Plan> {
    return this.core.createPlan(task, activeSkills)
  }

  getPlan(): Plan | null {
    return this.core.getPlan()
  }

  clearPlan(): void {
    this.core.clearPlan()
  }

  // ── Режим ──────────────────────────────────────────────

  getMode(): AgentModeName {
    return this.core.getMode()
  }

  switchMode(newMode: AgentModeName): boolean {
    return this.core.switchMode(newMode)
  }

  // ── Todo ───────────────────────────────────────────────

  getTodoStore(): TodoStore {
    return this.core.getTodoStore()
  }

  // ── Сессия ─────────────────────────────────────────────

  async restoreSession(messages: ChatMessage[]): Promise<void> {
    this.abortController.abort()
    this.core.dispose()
    this.abortController = new AbortController()
    this.core = this.createCore()
    await this.core.restoreSession(messages)
  }

  resetSession(): void {
    this.core.resetSession()
  }

  // ── Контекст ───────────────────────────────────────────

  async resolveContextProvider(name: string, query: string): Promise<ContextItem[]> {
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
    try {
      const handle = await subagent.run(task, () => {})
      subagent.dispose()
      return handle.content
    } catch (err: unknown) {
      subagent.dispose()
      return `Ошибка субагента: ${err instanceof Error ? err.message : String(err)}`
    }
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
    this.core = this.createCore()
  }

  dispose(): void {
    this.disposed = true
    this.abortController.abort()
    this.core.dispose()
  }
}
