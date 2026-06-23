import type { IBackend } from "../core/IBackend"
import type { IToolRegistry } from "../tools/ToolRegistry"
import type { ISkillManager } from "../skills/SkillManager"
import type { IAgentFullDependencies, AgentSpawnFactory } from "./AgentDependencies"
import type { TodoStore } from "./TodoStore"
import { errorMessage } from "../core/Errors"

/**
 * SubAgentSpawner — изолированная ответственность за запуск субагентов.
 *
 * Вынесено из AgentOrchestrator для соблюдения SRP:
 * оркестратор маршрутизирует API, а спавн субагентов —
 * отдельная область ответственности.
 */
export class SubAgentSpawner {
  constructor(
    private readonly deps: IAgentFullDependencies,
    private readonly backend: IBackend,
    private readonly toolRegistry: IToolRegistry,
    private readonly skillManager: ISkillManager,
    private readonly todoStore: TodoStore,
    private readonly spawnFactory: AgentSpawnFactory | null = null,
  ) {}

  /**
   * Запустить субагент explore для выполнения задачи.
   */
  async spawnExplore(task: string): Promise<string> {
    if (!this.spawnFactory) {
      return "SubagentRunner не настроен"
    }
    const subagent = this.spawnFactory(
      this.deps,
      this.backend,
      this.toolRegistry,
      this.skillManager,
      this.todoStore,
    )
    try {
      const handle = await subagent.run(task, () => {})
      subagent.dispose()
      return handle.content
    } catch (err: unknown) {
      subagent.dispose()
      return `Ошибка субагента: ${errorMessage(err)}`
    }
  }
}
