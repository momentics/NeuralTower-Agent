import type { IToolRegistry } from "../tools/ToolRegistry"
import { ToolRegistry } from "../tools/ToolRegistry"
import type { AgentModeName } from "./AgentMode"

/** Конфигурация запуска субагента инструментом task. */
export interface ITaskLaunchConfig {
  /** Отображаемое имя (краткое название задачи). */
  name: string
  /** Задача для субагента. */
  task: string
  /** Режим субагента. */
  mode: AgentModeName
  /** Рабочая директория. */
  workDir: string
}

/** Результат работы субагента. */
export interface ITaskLaunchResult {
  ok: boolean
  output: string
  error?: string
}

/**
 * Пускатель субагентов для инструмента task.
 */
export interface ISubagentLauncher {
  launch(config: ITaskLaunchConfig, signal?: AbortSignal): Promise<ITaskLaunchResult>
}

/**
 * Держатель пускателя субагентов.
 *
 * Инструмент task создаётся до SubagentRunner; реализация привязывается
 * в контейнере после создания раннера.
 */
export class SubagentLauncherHolder implements ISubagentLauncher {
  private impl: ISubagentLauncher | null = null

  setImpl(impl: ISubagentLauncher | null): void {
    this.impl = impl
  }

  get isAvailable(): boolean {
    return this.impl !== null
  }

  async launch(config: ITaskLaunchConfig, signal?: AbortSignal): Promise<ITaskLaunchResult> {
    if (!this.impl) {
      return { ok: false, output: "", error: "Субагенты недоступны" }
    }
    return this.impl.launch(config, signal)
  }
}

/**
 * Реестр инструментов субагента: все инструменты родителя, кроме `task`
 * и `question`. Исключение `task` предотвращает рекурсию запусков,
 * исключение `question` — вопросы субагента пользователю (субагент
 * работает автономно).
 */
export function filterSubagentTools(registry: IToolRegistry): IToolRegistry {
  const sub = new ToolRegistry()
  for (const tool of registry.list()) {
    if (tool.name === "task" || tool.name === "question") continue
    sub.register(tool)
  }
  return sub
}
