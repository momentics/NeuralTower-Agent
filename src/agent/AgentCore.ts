import type { IBackend, ChatMessage } from "../core/IBackend"
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
import type { AgentDependencies } from "./AgentDependencies"
import type { ToolResult } from "./AgentTypes"
import type { AgentModeName } from "./AgentMode"
import { TodoStore } from "./TodoStore"
import type { Plan } from "./Plan"
import { PlanRepository } from "./PlanRepository"
import { AbortError, AgentError, errorMessage } from "../core/errors"
import { createDomainLogger } from "../core/logger"

const log = createDomainLogger("AgentCore")

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
  private todoStore: TodoStore
  private disposed = false

  constructor(
    private readonly backend: IBackend,
    private readonly toolRegistry: IToolRegistry,
    private readonly skillManager: ISkillManager,
    private readonly deps: AgentDependencies,
    todoStore: TodoStore,
  ) {
    this.memory = new AgentMemory(deps.config.agent.maxTokens)
    this.modeManager = new AgentModeManager()
    this.sessionContext = new SessionContext(
      `session-${Date.now()}`,
      deps.contextManager,
    )
    this.todoStore = todoStore

    const contextBuilder = new AgentContextBuilder(
      toolRegistry,
      skillManager,
      this.memory,
      deps.fileIndex,
      deps.gitService,
      deps.getWorkDir,
      deps.config.agent.injectDiffContext,
      deps.contextManager,
    )

    this.toolExecutor = new AgentToolExecutor(
      backend,
      toolRegistry,
      deps.permissionManager,
      this.modeManager,
      this.memory,
      this.sessionContext,
    )

    this.planner = new AgentPlanner(
      backend,
      toolRegistry,
      this.sessionContext,
      new Replanner(backend, toolRegistry),
    )

    const compactor = new Compactor(backend, deps.config.compactor)

    this.agentLoop = new AgentLoop(
      backend,
      this.memory,
      compactor,
      this.modeManager,
      this.sessionContext,
      contextBuilder,
      this.toolExecutor,
      this.planner,
      undefined,
      undefined,
      deps.config.agent.replanOnFailure,
      deps.config.agent.maxReplanAttempts,
    )
  }

  /**
   * Выполнить запрос агента.
   */
  async run(
    query: string,
    onChunk: (text: string) => void,
    onToolUse?: (name: string, args: Record<string, unknown>) => void,
    onToolResult?: (name: string, result: ToolResult) => void,
    signal?: AbortSignal,
    onCompaction?: (tokensBefore: number, tokensAfter: number) => void,
  ): Promise<ChatMessage> {
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
          await new PlanRepository(workDir).save(plan)
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
   * Вернуть хранилище задач.
   */
  getTodoStore(): TodoStore {
    return this.todoStore
  }

  /**
   * Восстановить сессию из истории сообщений.
   */
  async restoreSession(messages: ChatMessage[]): Promise<void> {
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
  }

  /**
   * Освободить ресурсы.
   */
  dispose(): void {
    this.disposed = true
  }
}
