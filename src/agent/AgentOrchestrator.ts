import type { IBackend, IChatMessage } from "../core/IBackend"
import type { IAgentOrchestrator } from "../core/IAgent"
import type { IToolRegistry } from "../tools/ToolRegistry"
import type { ISkillManager } from "../skills/SkillManager"
import type { ISkill } from "../skills/ISkill"
import { AgentCore } from "./AgentCore"
import { SubAgentSpawner } from "./SubAgentSpawner"
import type { AgentModeName, IAgentMode } from "./AgentMode"
import type { IAgentFullDependencies, AgentSpawnFactory } from "./AgentDependencies"
import type { Plan } from "./Plan"
import type { TodoStore } from "./TodoStore"
import type { IToolResult } from "./AgentTypes"
import type { IContextItem } from "../core/providers/context/Types"

/**
 * AgentOrchestrator — тонкий фасад над AgentCore.
 *
 * Содержит только маршрутизацию публичного API и делегирует
 * всю логику выполнения в AgentCore. SubagentRunner
 * подключается через фабрику (AgentSpawnFactory), что
 * разрывает циклическую зависимость. Спавн субагентов
 * вынесен в SubAgentSpawner для соблюдения SRP.
 */
export class AgentOrchestrator implements IAgentOrchestrator {
  private core: AgentCore
  private spawner: SubAgentSpawner
  private disposed = false
  private abortController: AbortController = new AbortController()
  private readonly modeListeners: Set<(mode: AgentModeName) => void> = new Set()
  private coreModeSub: { dispose(): void } | null = null

  constructor(
    private readonly backend: IBackend,
    private readonly toolRegistry: IToolRegistry,
    private readonly skillManager: ISkillManager,
    private readonly deps: IAgentFullDependencies,
    private readonly spawnFactory: AgentSpawnFactory | null = null,
    private readonly todoStore: TodoStore,
  ) {
    this.core = this.createCore()
    this.bindCoreModeEvents()
    this.spawner = new SubAgentSpawner(
      this.deps,
      this.backend,
      this.toolRegistry,
      this.skillManager,
      this.todoStore,
      this.spawnFactory,
    )
  }

  private createCore(): AgentCore {
    return new AgentCore(
      this.backend,
      this.toolRegistry,
      this.skillManager,
      this.deps,
      this.todoStore,
    )
  }

  /**
   * Подписаться на события режима текущего core.
   * Вызывается при создании core (конструктор, restoreSession, reload):
   * отписывается от старого core и уведомляет подписчиков о текущем
   * режиме нового core (свежий core всегда стартует в "build").
   */
  private bindCoreModeEvents(): void {
    this.coreModeSub?.dispose()
    this.coreModeSub = this.core.onModeChanged((mode) => this.emitModeChanged(mode))
    this.emitModeChanged(this.core.getMode())
  }

  private emitModeChanged(mode: AgentModeName): void {
    for (const handler of [...this.modeListeners]) {
      handler(mode)
    }
  }

  // ── Выполнение ─────────────────────────────────────────

  async run(
    query: string,
    onChunk: (text: string) => void,
    onToolUse?: (name: string, args: Record<string, unknown>) => void,
    onToolResult?: (name: string, result: IToolResult) => void,
    signal?: AbortSignal,
    onCompaction?: (tokensBefore: number, tokensAfter: number) => void,
  ): Promise<IChatMessage> {
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

  /**
   * Вернуть полное описание текущего режима.
   */
  getModeInfo(): IAgentMode {
    return this.core.getModeInfo()
  }

  /**
   * Подписаться на события смены режима.
   * Подписка переживает пересоздание внутреннего core
   * (restoreSession, reload).
   */
  onModeChanged(handler: (mode: AgentModeName) => void): { dispose(): void } {
    this.modeListeners.add(handler)
    return {
      dispose: () => {
        this.modeListeners.delete(handler)
      },
    }
  }

  // ── Todo ───────────────────────────────────────────────

  getTodoStore(): TodoStore {
    return this.core.getTodoStore()
  }

  // ── Сессия ─────────────────────────────────────────────

  async restoreSession(messages: IChatMessage[]): Promise<void> {
    this.abortController.abort()
    this.core.dispose()
    this.abortController = new AbortController()
    this.core = this.createCore()
    this.bindCoreModeEvents()
    await this.core.restoreSession(messages)
  }

  resetSession(): void {
    this.core.resetSession()
  }

  // ── Контекст ───────────────────────────────────────────

  async resolveContextProvider(name: string, query: string): Promise<IContextItem[]> {
    return this.core.resolveContextProvider(name, query)
  }

  // ── Субагенты ──────────────────────────────────────────

  async spawnExplore(task: string): Promise<string> {
    return this.spawner.spawnExplore(task)
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
    this.bindCoreModeEvents()
  }

  dispose(): void {
    this.disposed = true
    this.abortController.abort()
    this.core.dispose()
  }
}
