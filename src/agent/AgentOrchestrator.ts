import type { IBackend, ChatMessage } from "../core/IBackend"
import type { ToolRegistry } from "../tools/ToolRegistry"
import type { SkillManager } from "../skills/SkillManager"
import type { AgentEnvironment } from "./AgentEnvironment"
import { AgentCore } from "./AgentCore"
import type { Plan } from "./Plan"
import type { TodoStore } from "./TodoStore"
import type { ContextProviderRegistry } from "../core/providers/context/registry"
import type { SubagentRunner } from "./SubagentRunner"
import type { GitService } from "../services/git/GitService"
import type { PermissionManager } from "../services/permission/PermissionManager"
import type { MCPManager } from "../mcp/MCPManager"

/**
 * AgentOrchestrator — тонкий фасад над AgentCore.
 *
 * Содержит только маршрутизацию публичного API и делегирует
 * всю логику выполнения в AgentCore. Дополнительно управляет
 * SubagentRunner (субагенты) и mutable-зависимостями через
 * AgentEnvironment.
 */
export class AgentOrchestrator {
  private core: AgentCore | null = null
  private subagentRunner: SubagentRunner | null = null
  private disposed = false

  constructor(
    private readonly backend: IBackend,
    private readonly toolRegistry: ToolRegistry,
    private readonly skillManager: SkillManager,
    private readonly env: AgentEnvironment,
  ) {}

  /**
   * Ленивая инициализация AgentCore.
   */
  private getAgentCore(): AgentCore {
    if (this.disposed) {
      throw new Error("Агент освобождён")
    }
    if (!this.core) {
      this.core = new AgentCore(
        this.backend,
        this.toolRegistry,
        this.skillManager,
        this.env,
      )
    }
    return this.core
  }

  // ── Выполнение ─────────────────────────────────────────

  async run(
    query: string,
    onChunk: (text: string) => void,
    onToolUse?: (name: string, args: Record<string, unknown>) => void,
    onToolResult?: (name: string, result: { output: string; success: boolean }) => void,
    signal?: AbortSignal,
  ): Promise<ChatMessage> {
    return this.getAgentCore().run(query, onChunk, onToolUse, onToolResult, signal)
  }

  // ── Планирование ───────────────────────────────────────

  async createPlan(_task: string, _onChunk?: (chunk: string) => void): Promise<Plan> {
    return this.getAgentCore().createPlan(_task)
  }

  getPlan(): Plan | null {
    return this.getAgentCore().getPlan()
  }

  clearPlan(): void {
    this.getAgentCore().clearPlan()
  }

  // ── Режим ──────────────────────────────────────────────

  getMode() {
    return this.getAgentCore().getMode()
  }

  switchMode(newMode: string): boolean {
    return this.getAgentCore().switchMode(newMode)
  }

  // ── Todo ───────────────────────────────────────────────

  getTodoStore(): TodoStore {
    return this.getAgentCore().getTodoStore()
  }

  // ── Сессия ─────────────────────────────────────────────

  resetSession(): void {
    this.getAgentCore().resetSession()
  }

  // ── Mutable зависимости (через AgentEnvironment) ───────

  setWorkingDir(dir: string): void {
    this.env.workDir = dir
  }

  setGitService(gitService: GitService | null): void {
    this.env.gitService = gitService
  }

  setPermissionManager(permissionManager: PermissionManager | null): void {
    this.env.permissionManager = permissionManager
  }

  setMCPManager(mcpManager: MCPManager | null): void {
    this.env.mcpManager = mcpManager
  }

  setSubagentRunner(runner: SubagentRunner | null): void {
    this.subagentRunner = runner
  }

  // ── Контекст ───────────────────────────────────────────

  async resolveContextProvider(name: string, query: string): Promise<import("../core/providers/context/types").ContextItem[]> {
    return this.env.resolveContextProvider(name, query)
  }

  getProviderRegistry(): ContextProviderRegistry {
    return this.env.contextProviderRegistry
  }

  // ── Субагенты ──────────────────────────────────────────

  async spawnExplore(task: string): Promise<string> {
    if (!this.subagentRunner) {
      return "SubagentRunner не настроен"
    }
    const handle = await this.subagentRunner.spawn({
      name: "explore",
      task,
      mode: "explore",
      workDir: this.env.workDir,
    })
    const result = await handle.wait()
    return result.output
  }

  // ── Жизненный цикл ─────────────────────────────────────

  async reload(): Promise<void> {
    if (!this.env.workDir) return
    // Перезагрузка: сбросить и пересоздать ядро
    this.core?.dispose()
    this.core = null
  }

  dispose(): void {
    this.disposed = true
    this.core?.dispose()
    this.core = null
  }
}
