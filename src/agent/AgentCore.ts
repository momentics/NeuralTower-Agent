import type { IBackend, ChatMessage } from "../core/IBackend"
import type { ToolRegistry } from "../tools/ToolRegistry"
import type { SkillManager } from "../skills/SkillManager"
import type { ISkill } from "../skills/ISkill"
import { AgentLoop } from "./AgentLoop"
import { AgentMemory } from "./AgentMemory"
import { Compactor } from "./Compactor"
import { AgentModeManager } from "./AgentMode"
import { AgentContextBuilder } from "./AgentContextBuilder"
import { AgentToolExecutor } from "./AgentToolExecutor"
import { AgentPlanner } from "./AgentPlanner"
import { SessionContext } from "./SessionContext"
import type { AgentDependencies } from "./AgentDependencies"
import { TodoStore } from "./TodoStore"
import type { Plan } from "./Plan"
import { AbortError } from "../core/errors"

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
    private readonly toolRegistry: ToolRegistry,
    private readonly skillManager: SkillManager,
    private readonly deps: AgentDependencies,
  ) {
    this.memory = new AgentMemory(deps.config.agent.maxTokens)
    this.modeManager = new AgentModeManager()
    this.sessionContext = new SessionContext(
      `session-${Date.now()}`,
      deps.contextManager,
    )
    this.todoStore = new TodoStore()

    const contextBuilder = new AgentContextBuilder(
      backend,
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
      this.todoStore,
    )

    this.planner = new AgentPlanner(
      backend,
      toolRegistry,
      this.sessionContext,
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
    )
  }

  /**
   * Выполнить запрос агента.
   */
  async run(
    query: string,
    onChunk: (text: string) => void,
    onToolUse?: (name: string, args: Record<string, unknown>) => void,
    onToolResult?: (name: string, result: { output: string; success: boolean }) => void,
    signal?: AbortSignal,
  ): Promise<ChatMessage> {
    if (this.disposed) {
      throw new Error("Агент освобождён")
    }

    if (signal?.aborted) {
      throw new AbortError("Task aborted")
    }

    const activeSkills: ISkill[] = this.skillManager.match(query)

    return this.agentLoop.run(
      query,
      activeSkills,
      onChunk,
      onToolUse,
      onToolResult,
      signal,
    )
  }

  /**
   * Создать план задачи.
   */
  async createPlan(task: string): Promise<Plan> {
    return this.planner.createPlan(task)
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
  getMode() {
    return this.modeManager.getMode()
  }

  /**
   * Переключить режим.
   */
  switchMode(newMode: string): boolean {
    return this.modeManager.switchMode(newMode as import("./AgentMode").AgentModeName)
  }

  /**
   * Вернуть хранилище задач.
   */
  getTodoStore(): TodoStore {
    return this.todoStore
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
