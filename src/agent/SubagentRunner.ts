import type { IBackend, ChatMessage } from "../core/IBackend"
import type { ToolRegistry } from "../tools/ToolRegistry"
import type { SkillManager } from "../skills/SkillManager"
import type { AgentModeName } from "./AgentMode"
import type { AgentOrchestrator } from "./AgentOrchestrator"
import type { AgentDependencies, AgentSpawnFactory } from "./AgentDependencies"

/**
 * Состояние подагента.
 */
export type SubagentStatus = "running" | "completed" | "failed" | "cancelled"

/**
 * Результат работы подагента.
 */
export interface SubagentResult {
  /** Уникальный ID подагента. */
  id: string

  /** Название подагента. */
  name: string

  /** Задача, которая была поручена. */
  task: string

  /** Режим подагента. */
  mode: AgentModeName

  /** Состояние выполнения. */
  status: SubagentStatus

  /** Вывод подагента. */
  output: string

  /** Ошибка (при провале). */
  error?: string

  /** Длительность выполнения в мс. */
  durationMs: number
}

/**
 * Конфигурация подагента.
 */
export interface SubagentConfig {
  /** Название подагента (для отображения). */
  name: string

  /** Задача для выполнения. */
  task: string

  /** Режим подагента. */
  mode: AgentModeName

  /** Рабочая директория. */
  workDir: string

  /** Максимальное число итераций. */
  maxIterations?: number

  /** Таймаут в мс. */
  timeoutMs?: number
}

/**
 * SubagentRunner управляет запуском подагентов для
 * параллельных/независимых задач.
 *
 * Каждый подагент — это изолированный экземпляр
 * AgentOrchestrator с собственным контекстом и ограничениями.
 *
 * Циклическая зависимость с AgentOrchestrator разорвана
 * через фабрику (AgentSpawnFactory).
 */
export class SubagentRunner {
  private running: Map<string, SubagentHandle> = new Map()
  private nextId = 0

  constructor(
    private readonly backend: IBackend,
    private readonly toolRegistry: ToolRegistry,
    private readonly skillManager: SkillManager,
    private readonly deps: AgentDependencies,
    private readonly spawnFactory: AgentSpawnFactory,
  ) {}

  /**
   * Запустить подагент.
   */
  async spawn(
    config: SubagentConfig,
    onChunk?: (text: string) => void,
    onDone?: (result: SubagentResult) => void,
  ): Promise<SubagentHandle> {
    const id = `subagent-${Date.now()}-${this.nextId++}`
    const startTime = Date.now()

    const orchestrator = this.createOrchestrator()
    const abortController = new AbortController()

    const handle = new SubagentHandle(
      id,
      config,
      orchestrator,
      abortController,
    )

    this.running.set(id, handle)

    const resultPromise = (async (): Promise<SubagentResult> => {
      try {
        const message = await orchestrator.run(
          config.task,
          (chunk) => onChunk?.(chunk),
          undefined,
          undefined,
          abortController.signal,
        )

        const duration = Date.now() - startTime
        const result: SubagentResult = {
          id,
          name: config.name,
          task: config.task,
          mode: config.mode,
          status: "completed",
          output: message.content,
          durationMs: duration,
        }
        onDone?.(result)
        return result
      } catch (err: unknown) {
        const duration = Date.now() - startTime
        const isCancelled = abortController.signal.aborted
        const result: SubagentResult = {
          id,
          name: config.name,
          task: config.task,
          mode: config.mode,
          status: isCancelled ? "cancelled" : "failed",
          output: "",
          error: err instanceof Error ? err.message : String(err),
          durationMs: duration,
        }
        onDone?.(result)
        return result
      } finally {
        if (handle._timeout) {
          clearTimeout(handle._timeout)
          handle._timeout = undefined
        }
        orchestrator.dispose()
        this.running.delete(id)
      }
    })()

    if (config.timeoutMs) {
      handle._timeout = setTimeout(() => handle.cancel(), config.timeoutMs)
    }

    handle._result = resultPromise
    return handle
  }

  /**
   * Запустить несколько подагентов параллельно.
   */
  async spawnAll(
    configs: SubagentConfig[],
    onChunk?: (id: string, text: string) => void,
    onDone?: (result: SubagentResult) => void,
  ): Promise<SubagentResult[]> {
    const handles = await Promise.all(configs.map((config) =>
      this.spawn(
        config,
        (text) => onChunk?.(config.name, text),
        onDone,
      ),
    ))

    return Promise.all(handles.map((h) => h.wait()))
  }

  /**
   * Вернуть все запущенные подагенты.
   */
  listRunning(): SubagentHandle[] {
    return [...this.running.values()]
  }

  /**
   * Отменить подагент по ID.
   */
  cancel(id: string): boolean {
    const handle = this.running.get(id)
    if (handle) {
      handle.cancel()
      return true
    }
    return false
  }

  /**
   * Отменить все подагенты.
   */
  cancelAll(): void {
    for (const handle of this.running.values()) {
      handle.cancel()
    }
  }

  /**
   * Ожидать завершения всех подагентов.
   */
  async waitForAll(): Promise<SubagentResult[]> {
    const handles = [...this.running.values()]
    return Promise.all(handles.map((h) => h.wait()))
  }

  private createOrchestrator(): AgentOrchestrator {
    return this.spawnFactory(
      this.deps,
      this.backend,
      this.toolRegistry,
      this.skillManager,
    )
  }
}

/**
 * Дескриптор запущенного подагента.
 */
export class SubagentHandle {
  public readonly id: string
  public readonly config: SubagentConfig
  public _result: Promise<SubagentResult> | null = null
  public _timeout: ReturnType<typeof setTimeout> | undefined

  constructor(
    id: string,
    config: SubagentConfig,
    private readonly orchestrator: AgentOrchestrator,
    private readonly abortController: AbortController,
  ) {
    this.id = id
    this.config = config
  }

  /**
   * Ожидать завершения подагента.
   */
  async wait(): Promise<SubagentResult> {
    return await this._result!
  }

  /**
   * Отменить выполнение.
   */
  cancel(): void {
    if (this._timeout) {
      clearTimeout(this._timeout)
      this._timeout = undefined
    }
    this.abortController.abort()
  }

  /**
   * Проверить, отменён ли подагент.
   */
  isCancelled(): boolean {
    return this.abortController.signal.aborted
  }
}
