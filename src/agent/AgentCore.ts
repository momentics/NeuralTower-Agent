import type { IBackend, IChatMessage } from "../core/IBackend"
import type { IToolRegistry } from "../tools/ToolRegistry"
import type { ISkillManager } from "../skills/SkillManager"
import type { ISkill } from "../skills/ISkill"
import { AgentLoop } from "./AgentLoop"
import { AgentMemory } from "./AgentMemory"
import { Compactor } from "./Compactor"
import { AgentModeManager } from "./AgentMode"
import { AgentContextBuilder } from "./AgentContextBuilder"
import { AgentToolExecutor } from "./AgentToolExecutor"
import { AgentPlanner } from "./AgentPlanner"
import { Replanner } from "./Replanner"
import { SessionContext } from "./SessionContext"
import type { IAgentFullDependencies } from "./AgentDependencies"
import type { IToolResult } from "./AgentTypes"
import type { ISnapshotPatch } from "../services/snapshot/SnapshotTypes"
import type { AgentModeName, IAgentMode } from "./AgentMode"
import type { IContextItem } from "../core/providers/context/Types"
import { TodoStore } from "./TodoStore"
import type { Plan } from "./Plan"
import { PlanRepository } from "./PlanRepository"
import { AbortError, AgentError, errorMessage } from "../core/Errors"
import { createDomainLogger } from "../core/Logger"

const log = createDomainLogger("AgentCore")

/**
 * Создать внутренние компоненты агента.
 * Вынесено из конструктора для снижения глубины вложенности.
 */
function createAgentInternals(
  backend: IBackend,
  toolRegistry: IToolRegistry,
  skillManager: ISkillManager,
 deps: IAgentFullDependencies,
) {
  const memory = new AgentMemory(deps.config.agent.maxTokens)
  const modeManager = new AgentModeManager()
  const sessionContext = new SessionContext(
    `session-${Date.now()}`,
    deps.contextManager,
  )
  const planRepo = new PlanRepository(deps.getWorkDir() || "")

  const contextBuilder = new AgentContextBuilder(
    toolRegistry,
    skillManager,
    memory,
    deps.fileIndex,
    deps.gitService,
    deps.getWorkDir,
    deps.config.agent.injectDiffContext,
    deps.contextManager,
  )

  const toolExecutor = new AgentToolExecutor(
    backend,
    toolRegistry,
    deps.permissionManager,
    modeManager,
  )

  const replanner = new Replanner(backend, toolRegistry)

  const planner = new AgentPlanner(
    backend,
    toolRegistry,
    sessionContext,
    replanner,
    planRepo,
  )

  const compactor = new Compactor(backend, deps.config.compactor)

  const agentLoop = new AgentLoop(
    backend,
    memory,
    compactor,
    modeManager,
    sessionContext,
    contextBuilder,
    toolExecutor,
    planner,
    {
      replanOnFailure: deps.config.agent.replanOnFailure,
      maxReplanAttempts: deps.config.agent.maxReplanAttempts,
    },
    deps.snapshotService,
  )

  return {
    memory,
    modeManager,
    sessionContext,
    planRepo,
    toolExecutor,
    planner,
    agentLoop,
  }
}

/**
 * AgentCore — ядро выполнения агента.
 *
 * Содержит логику выполнения запросов, сессий, планирования
 * и компактизации. Не зависит от VS Code UI и не знает о
 * SubagentRunner.
 */
export class AgentCore {
  private agentLoop: AgentLoop
  private memory: AgentMemory
  private modeManager: AgentModeManager
  private sessionContext: SessionContext
  private toolExecutor: AgentToolExecutor
  private planner: AgentPlanner
  private planRepo: PlanRepository
  private todoStore: TodoStore
  private disposed = false

  constructor(
    private readonly backend: IBackend,
    private readonly toolRegistry: IToolRegistry,
    private readonly skillManager: ISkillManager,
    private readonly deps: IAgentFullDependencies,
    todoStore: TodoStore,
  ) {
    const internals = createAgentInternals(backend, toolRegistry, skillManager, deps)
    this.memory = internals.memory
    this.modeManager = internals.modeManager
    this.sessionContext = internals.sessionContext
    this.planRepo = internals.planRepo
    this.todoStore = todoStore
    this.toolExecutor = internals.toolExecutor
    this.planner = internals.planner
    this.agentLoop = internals.agentLoop
  }

  /**
   * Выполнить запрос агента.
   */
  async run(
    query: string,
    onChunk: (text: string) => void,
    onToolUse?: (name: string, args: Record<string, unknown>) => void,
    onToolResult?: (name: string, result: IToolResult) => void,
    signal?: AbortSignal,
    onCompaction?: (tokensBefore: number, tokensAfter: number) => void,
    onSnapshot?: (patch: ISnapshotPatch | null) => void,
    revertNote?: string,
  ): Promise<IChatMessage> {
    if (this.disposed) {
      throw new AgentError("Агент освобождён")
    }

    if (signal?.aborted) {
      throw new AbortError()
    }

    const activeSkills: ISkill[] = this.skillManager.match(query)

    // Восстановить план из файла, если он есть
    const workDir = this.deps.getWorkDir()
    if (workDir) {
      await this.planner.restorePlanFromFile(workDir)
    }

    // Создать план задачи, если автопланирование включено и плана нет
    if (this.deps.config.agent.autoPlan && !this.planner.getPlan()) {
      // Переключить в режим планирования для создания плана
      this.modeManager.switchMode("plan")

      // Создать план задачи с учётом активных навыков
      const plan = await this.planner.createPlan(query, activeSkills)

      // Сохранить план на диск
      if (workDir) {
        try {
          await this.planRepo.save(plan)
        } catch (err: unknown) {
          log.warn(`Не удалось сохранить план: ${errorMessage(err)}`)
        }
      }

      // Переключить в режим выполнения
      this.modeManager.switchMode("build")
    }

    return this.agentLoop.run(
      query,
      activeSkills,
      onChunk,
      onToolUse,
      onToolResult,
      signal,
      onCompaction,
      onSnapshot,
      revertNote,
    )
  }

  /**
   * Создать план задачи.
   */
  async createPlan(task: string, activeSkills?: ISkill[]): Promise<Plan> {
    return this.planner.createPlan(task, activeSkills)
  }

  /**
   * Вернуть текущий план.
   */
  getPlan(): Plan | null {
    return this.planner.getPlan()
  }

  /**
   * Очистить текущий план.
   */
  clearPlan(): void {
    this.planner.clearPlan()
  }

  /**
   * Вернуть текущий режим.
   */
  getMode(): AgentModeName {
    return this.modeManager.getModeName()
  }

  /**
   * Переключить режим.
   */
  switchMode(newMode: AgentModeName): boolean {
    return this.modeManager.switchMode(newMode)
  }

  /**
   * Вернуть полное описание текущего режима.
   */
  getModeInfo(): IAgentMode {
    return this.modeManager.getMode()
  }

  /**
   * Подписаться на события смены режима.
   */
  onModeChanged(handler: (mode: AgentModeName) => void): { dispose(): void } {
    return this.modeManager.onModeChanged(handler)
  }

  /**
   * Вернуть хранилище задач.
   */
  getTodoStore(): TodoStore {
    return this.todoStore
  }

  /**
   * Восстановить сессию из истории сообщений.
   */
  async restoreSession(messages: IChatMessage[]): Promise<void> {
    this.memory.clear()
    this.sessionContext.reset()
    this.planner.clearPlan()
    this.todoStore.clear()
    this.deps.contextManager.reset()
    this.memory.restoreFromMessages(messages)
    this.sessionContext.restoreMessages(messages)
    // Восстановить план из сериализованного сообщения
    this.planner.restorePlanFromMessages(messages)
  }

  /**
   * Сбросить сессию.
   */
  resetSession(): void {
    this.memory.clear()
    this.sessionContext.reset()
    this.planner.clearPlan()
    this.todoStore.clear()
    this.deps.contextManager.reset()
    this.modeManager.resetMode()
  }

  /**
   * Разрешить провайдер контекста по имени.
   */
  async resolveContextProvider(name: string, query: string): Promise<IContextItem[]> {
    const provider = this.deps.contextProviderRegistry.get(name)
    if (!provider) return []
    return provider.resolve(query)
  }

  /**
   * Освободить ресурсы.
   */
  dispose(): void {
    this.disposed = true
    this.memory.clear()
    this.sessionContext.reset()
    this.planner.clearPlan()
    this.deps.contextManager.reset()
  }
}
