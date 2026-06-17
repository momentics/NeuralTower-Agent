import * as vscode from "vscode"
import type { IAgentOrchestrator, ChatMessage } from "../core"
import type { IBackend } from "../core/IBackend"
import type { ISkill } from "../skills/ISkill"
import type { ToolRegistry } from "../tools/ToolRegistry"
import type { SkillManager } from "../skills/SkillManager"
import type { ToolResult } from "./AgentTypes"
import type { PermissionManager } from "../services/permission/PermissionManager"
import type { GitService } from "../services/git/GitService"
import type { MCPManager } from "../mcp/MCPManager"
import { AgentMemory } from "./AgentMemory"
import { RepoAnalyzer } from "../repo/RepoAnalyzer"
import { FileIndex } from "../repo/FileIndex"
import { ContextManager } from "../core/ContextManager"
import { AgentError } from "../core/errors"
import {
  makeEnvironmentProvider,
  makeRepoProvider,
  makeFileIndexProvider,
  makeProjectMemoryProvider,
  makeGitDiffProvider,
} from "../core/ContextSources"
import {
  makeCurrentFileProvider,
  makeOpenFilesProvider,
  makeProblemsProvider,
  makeClipboardProvider,
  makeDebuggerProvider,
  makeTerminalProvider,
  makeOSProvider,
} from "../core/ContextSources.vscode"
import {
  ContextProviderRegistry,
  makeUrlProvider,
  makeWebSearchProvider,
  makeFileProvider,
  makeCodeProvider,
  makeTreeProvider,
  makeRepoMapProvider,
  makeRulesProvider,
  makeLspProvider,
  makeMCPProvider,
  type ContextProvider,
  type ContextItem,
  type MCPToolListFn,
} from "../core/providers/context"
import { Plan } from "./Plan"
import { AgentModeManager, builtInModes, type AgentModeName } from "./AgentMode"
import { Compactor } from "./Compactor"
import { SessionContext } from "./SessionContext"
import { SubagentRunner } from "./SubagentRunner"
import { AgentContextBuilder } from "./AgentContextBuilder"
import { AgentToolExecutor } from "./AgentToolExecutor"
import { AgentPlanner } from "./AgentPlanner"
import { AgentLoop } from "./AgentLoop"
import { TodoStore } from "./TodoStore"
import type { AgentConfig, CompactorConfig } from "../core/config"
import { loadDefaultAgentConfig, loadDefaultCompactorConfig } from "../core/config"

export class AgentOrchestrator implements IAgentOrchestrator {
  private workDir = "."
  private permissionManager: PermissionManager | null = null
  private gitService: GitService | null = null
  private mcpManager: MCPManager | null = null
  private memory: AgentMemory
  private repoAnalyzer: RepoAnalyzer = new RepoAnalyzer()
  private fileIndex: FileIndex = new FileIndex()
  private disposables: vscode.Disposable[] = []
  private disposed = false

  private contextManager: ContextManager
  private modeManager: AgentModeManager = new AgentModeManager()
  private compactor: Compactor
  private providerRegistry: ContextProviderRegistry
  private sessionContext: SessionContext | null = null
  private subagentRunner: SubagentRunner | null = null
  private todoStore: TodoStore = new TodoStore()

  private contextBuilder: AgentContextBuilder
  private toolExecutor: AgentToolExecutor
  private planner: AgentPlanner
  private loop: AgentLoop

  private readonly agentConfig: AgentConfig
  private readonly compactorConfig: CompactorConfig

  constructor(
    private readonly backend: IBackend,
    private readonly toolRegistry: ToolRegistry,
    private readonly skillManager: SkillManager,
    contextManager?: ContextManager,
    agentConfig?: AgentConfig,
    compactorConfig?: CompactorConfig,
  ) {
    this.agentConfig = agentConfig ?? loadDefaultAgentConfig()
    this.compactorConfig = compactorConfig ?? loadDefaultCompactorConfig()
    this.memory = new AgentMemory(this.agentConfig.maxTokens)
    this.contextManager = contextManager ?? new ContextManager()
    this.compactor = new Compactor(backend, this.compactorConfig)
    this.providerRegistry = new ContextProviderRegistry()

    this.registerProviders()

    this.contextBuilder = new AgentContextBuilder(
      backend,
      toolRegistry,
      skillManager,
      this.memory,
      this.fileIndex,
      this.gitService,
      () => this.workDir,
      this.agentConfig.injectDiffContext,
    )

    this.toolExecutor = new AgentToolExecutor(
      backend,
      toolRegistry,
      this.permissionManager,
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

    this.loop = new AgentLoop(
      backend,
      this.memory,
      this.compactor,
      this.modeManager,
      this.sessionContext,
      this.contextBuilder,
      this.toolExecutor,
      this.planner,
      this.agentConfig.maxIterations,
    )
  }

  setWorkingDir(dir: string): void {
    this.workDir = dir
  }

  setPermissionManager(pm: PermissionManager): void {
    this.permissionManager = pm
    this.toolExecutor = this.recreateToolExecutor()
  }

  setGitService(git: GitService): void {
    this.gitService = git
    this.contextBuilder = this.recreateContextBuilder()
  }

  setMCPManager(mcp: MCPManager): void {
    this.mcpManager = mcp
  }

  setSessionContext(sc: SessionContext): void {
    this.sessionContext = sc
    this.toolExecutor = this.recreateToolExecutor()
    this.planner = this.recreatePlanner()
    this.loop = this.recreateLoop()
  }

  setSubagentRunner(runner: SubagentRunner): void {
    this.subagentRunner = runner
  }

  switchMode(mode: AgentModeName): boolean {
    return this.modeManager.switchMode(mode)
  }

  getMode(): AgentModeName {
    return this.modeManager.getModeName()
  }

  getProviderRegistry(): ContextProviderRegistry {
    return this.providerRegistry
  }

  getContextManager(): ContextManager {
    return this.contextManager
  }

  getTodoStore(): TodoStore {
    return this.todoStore
  }

  async resolveContextProvider(name: string, query: string): Promise<ContextItem[]> {
    const provider = this.providerRegistry.get(name)
    if (!provider) return []
    return provider.resolve(query)
  }

  async reload(): Promise<void> {
    if (this.sessionContext?.getEpoch()) return
    if (this.workDir && !this.disposed) {
      try {
        await this.fileIndex.build(this.workDir)
        const summary = await this.repoAnalyzer.analyze(this.workDir)
        this.memory.setProject({
          repo: this.workDir.split(/[\\/]/).pop() ?? this.workDir,
          languages: Object.keys(summary.languages).filter(
            (l) => summary.languages[l] > 3,
          ),
          commands: this.extractCommands(summary.buildSystems),
        })

        this.registerAutoContextProviders()
      } catch {
        // анализ не критичен
      }
    }
  }

  dispose(): void {
    this.disposed = true
    this.memory.clear()
    this.fileIndex.clear()
    this.contextManager.reset()
    this.subagentRunner?.cancelAll()
    for (const d of this.disposables) d.dispose()
    this.disposables = []
  }

  resetSession(): void {
    this.sessionContext?.reset()
    this.planner.clearPlan()
    this.todoStore.clear()
  }

  // ── Цикл агента ──────────────────────────────────────────

  async run(
    query: string,
    onChunk: (text: string) => void,
    onToolUse?: (name: string, args: Record<string, unknown>) => void,
    onToolResult?: (name: string, result: { output: string; success: boolean }) => void,
    signal?: AbortSignal,
  ): Promise<ChatMessage> {
    if (this.disposed) throw new AgentError("Агент освобождён")

    const currentMode = this.modeManager.getModeName()
    const activeSkills = this.skillManager.match(query)

    return this.loop.run(
      query,
      activeSkills,
      onChunk,
      onToolUse,
      onToolResult,
      signal,
    )
  }

  // ── Планирование ─────────────────────────────────────────

  async createPlan(
    query: string,
    onChunk: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<Plan> {
    const plan = await this.planner.createPlan(query)
    return plan
  }

  clearPlan(): void {
    this.planner.clearPlan()
  }

  getPlan(): Plan | null {
    return this.planner.getPlan()
  }

  // ── Подагенты ──────────────────────────────────────────────

  async spawnExplore(
    task: string,
    onChunk?: (text: string) => void,
  ): Promise<string> {
    if (!this.subagentRunner) {
      return "SubagentRunner не настроен"
    }

    const results = await this.subagentRunner.spawnAll(
      [
        {
          name: "explore",
          task,
          mode: "explore",
          workDir: this.workDir,
          maxIterations: 10,
        },
      ],
      (_id, text) => onChunk?.(text),
    )

    return results[0]?.output ?? "Подагент не вернул результат"
  }

  // ── Регистрация провайдеров ─────────────────────────────

  /**
   * Регистрация on-demand провайдеров (для resolveContextProvider).
   * Вызывается один раз в конструкторе.
   */
  private registerProviders(): void {
    this.providerRegistry.register(makeUrlProvider())
    this.providerRegistry.register(makeWebSearchProvider())
    this.providerRegistry.register(makeFileProvider(() => this.workDir))
    this.providerRegistry.register(makeCodeProvider(() => this.workDir, () => this.fileIndex))
    this.providerRegistry.register(makeTreeProvider(() => this.workDir))
    this.providerRegistry.register(makeRepoMapProvider(
      () => this.workDir,
      () => this.fileIndex,
      () => this.repoAnalyzer.analyze(this.workDir),
    ))
    this.providerRegistry.register(makeRulesProvider(() => this.workDir))
    this.providerRegistry.register(makeLspProvider(() => this.workDir))

    const mcpListFn: MCPToolListFn = async () => {
      if (!this.mcpManager) return []
      try {
        await this.mcpManager.discover()
        const result: Array<{ server: string; tool: { name: string; description: string; schema: Record<string, unknown> } }> = []
        for (const { server, tools } of this.mcpManager.getToolsByServer()) {
          for (const t of tools) {
            result.push({ server, tool: t })
          }
        }
        return result
      } catch {
        return []
      }
    }
    this.providerRegistry.register(makeMCPProvider(mcpListFn))
  }

  /**
   * Регистрация провайдеров автоматического контекста.
   * Вызывается при reload() — после инициализации fileIndex
   * и repoAnalyzer.
   *
   * Все провайдеры регистрируются в единой ContextManager.
   * On-demand провайдеры (rules, repo-map) также добавляются
   * сюда для автоматического контекста.
   */
  private registerAutoContextProviders(): void {
    this.contextManager.reset()

    const workDirFn = () => this.workDir
    const modelFn = async () => {
      try {
        return (await this.backend.getConfig()).model
      } catch {
        return "unknown"
      }
    }

    this.contextManager.register(makeOSProvider())
    this.contextManager.register(makeEnvironmentProvider(workDirFn, modelFn, this.gitService))
    this.contextManager.register(makeCurrentFileProvider())
    this.contextManager.register(makeOpenFilesProvider())
    this.contextManager.register(makeRepoProvider(workDirFn, this.repoAnalyzer))
    this.contextManager.register(makeProjectMemoryProvider(this.memory))
    this.contextManager.register(makeFileIndexProvider(this.fileIndex))
    this.contextManager.register(makeProblemsProvider(workDirFn))
    this.contextManager.register(makeDebuggerProvider())
    this.contextManager.register(makeClipboardProvider())
    this.contextManager.register(makeTerminalProvider())

    if (this.gitService) {
      this.contextManager.register(makeGitDiffProvider(workDirFn, this.gitService))
    }

   const rulesProvider = this.providerRegistry.get("rules")
    if (rulesProvider) this.contextManager.register(rulesProvider)
    const repoMapProvider = this.providerRegistry.get("repo-map")
    if (repoMapProvider) this.contextManager.register(repoMapProvider)
  }

  private recreateContextBuilder(): AgentContextBuilder {
    return new AgentContextBuilder(
      this.backend,
      this.toolRegistry,
      this.skillManager,
      this.memory,
      this.fileIndex,
      this.gitService,
      () => this.workDir,
      this.agentConfig.injectDiffContext,
    )
  }

  private recreateToolExecutor(): AgentToolExecutor {
    return new AgentToolExecutor(
      this.backend,
      this.toolRegistry,
      this.permissionManager,
      this.modeManager,
      this.memory,
      this.sessionContext,
      this.todoStore,
    )
  }

  private recreatePlanner(): AgentPlanner {
    return new AgentPlanner(
      this.backend,
      this.toolRegistry,
      this.sessionContext,
    )
  }

  private recreateLoop(): AgentLoop {
    return new AgentLoop(
      this.backend,
      this.memory,
      this.compactor,
      this.modeManager,
      this.sessionContext,
      this.contextBuilder,
      this.toolExecutor,
      this.planner,
    )
  }

  private extractCommands(buildSystems: string[]): Record<string, string> {
    const commands: Record<string, string> = {}
    if (buildSystems.includes("npm")) {
      commands["build"] = "npm run build"
      commands["test"] = "npm test"
    }
    if (buildSystems.includes("cargo")) {
      commands["build"] = "cargo build"
      commands["test"] = "cargo test"
    }
    if (buildSystems.includes("maven")) {
      commands["build"] = "mvn compile"
      commands["test"] = "mvn test"
    }
    if (buildSystems.includes("go")) {
      commands["build"] = "go build ./..."
      commands["test"] = "go test ./..."
    }
    return commands
  }
}
