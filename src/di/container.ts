import * as vscode from "vscode"
import { NeuralTowerBackend } from "../backend/NeuralTowerBackend"
import { AgentOrchestrator } from "../agent/AgentOrchestrator"
import { ToolRegistry } from "../tools/ToolRegistry"
import { SkillManager } from "../skills/SkillManager"
import { builtInSkills } from "../skills/builtInSkills"
import { ChatProvider } from "../providers/ChatProvider"
import { DiffViewerProvider } from "../providers/DiffViewerProvider"
import { PersistentSessionStore } from "../shared/PersistentSessionStore"
import { PermissionManager } from "../services/permission/PermissionManager"
import { GitService } from "../services/git/GitService"
import { NotificationService } from "../services/notification/NotificationService"
import { BackendHealthMonitor } from "../services/health/BackendHealthMonitor"
import { CommitMessageService } from "../services/commit-message/CommitMessageService"
import { MCPManager } from "../mcp/MCPManager"
import { ReadFileTool } from "../tools/builtins/ReadFileTool"
import { WriteFileTool } from "../tools/builtins/WriteFileTool"
import { BashTool } from "../tools/builtins/BashTool"
import { EditFileTool } from "../tools/builtins/EditFileTool"
import { GlobTool } from "../tools/builtins/GlobTool"
import { GrepTool } from "../tools/builtins/GrepTool"
import { WebFetchTool } from "../tools/builtins/WebFetchTool"
import { TodoWriteTool } from "../tools/builtins/TodoWriteTool"
import { LspTool } from "../tools/builtins/LspTool"
import { ContextManager } from "../core/ContextManager"
import { ContextProviderRegistry } from "../core/providers/context/registry"
import { FileIndex } from "../repo/FileIndex"
import { RepoAnalyzer } from "../repo/RepoAnalyzer"
import { SubagentRunner } from "../agent/SubagentRunner"
import { loadAppConfig } from "../core/config"
import type { AppConfig } from "../core/config"
import type { AgentDependencies } from "../agent/AgentDependencies"
import type { ContextProvider } from "../core/providers/context/types"
import {
  makeUrlProvider,
  makeWebSearchProvider,
  makeFileProvider,
  makeCodeProvider,
  makeTreeProvider,
  makeRepoMapProvider,
  makeRulesProvider,
  makeMCPProvider,
  makeLspProvider,
} from "../core/providers/context"
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
  makeEnvironmentProvider,
  makeRepoProvider,
  makeFileIndexProvider,
  makeGitDiffProvider,
} from "../core/ContextSources"

export interface ExtensionDeps {
  backend: NeuralTowerBackend
  agent: AgentOrchestrator
  todoStore: ReturnType<AgentOrchestrator["getTodoStore"]>
  chatProvider: ChatProvider
  diffViewer: DiffViewerProvider
  healthMonitor: BackendHealthMonitor
  commitMessageService: CommitMessageService
  gitService: GitService
  sessionStore: PersistentSessionStore
  notificationService: NotificationService
  permissionManager: PermissionManager
  mcpManager: MCPManager
  contextManager: ContextManager
  subagentRunner: SubagentRunner
  config: AppConfig
  agentDeps: AgentDependencies
  fileIndex: FileIndex
  setWorkDir: (dir: string) => void
}

/**
 * Зарегистрировать все провайдеры контекста в ContextManager
 * и ContextProviderRegistry.
 */
function registerContextProviders(
  contextManager: ContextManager,
  contextProviderRegistry: ContextProviderRegistry,
  backend: NeuralTowerBackend,
  gitService: GitService,
  mcpManager: MCPManager,
  fileIndex: FileIndex,
  repoAnalyzer: RepoAnalyzer,
  getWorkDir: () => string,
): ContextProvider[] {
  const register = (p: ContextProvider) => {
    contextManager.register(p)
    contextProviderRegistry.register(p)
    return p
  }

  const providers: ContextProvider[] = []

  // ── VS Code провайдеры ──────────────────────────────────
  providers.push(register(makeCurrentFileProvider()))
  providers.push(register(makeOpenFilesProvider()))
  providers.push(register(makeProblemsProvider(getWorkDir)))
  providers.push(register(makeClipboardProvider()))
  providers.push(register(makeDebuggerProvider()))
  providers.push(register(makeTerminalProvider()))
  providers.push(register(makeOSProvider()))

  // ── Платформенно-независимые провайдеры ─────────────────
  providers.push(register(makeEnvironmentProvider(
    getWorkDir,
    () => backend.getConfig().then((c) => c.model),
    gitService,
  )))
  providers.push(register(makeRepoProvider(getWorkDir, repoAnalyzer)))
  providers.push(register(makeFileIndexProvider(fileIndex)))
  providers.push(register(makeGitDiffProvider(getWorkDir, gitService)))

  // ── Специализированные провайдеры ───────────────────────
  providers.push(register(makeUrlProvider()))
  providers.push(register(makeWebSearchProvider()))
  providers.push(register(makeFileProvider(getWorkDir)))
  providers.push(register(makeCodeProvider(getWorkDir, () => fileIndex)))
  providers.push(register(makeTreeProvider(getWorkDir)))
  providers.push(register(makeRepoMapProvider(
    getWorkDir,
    () => fileIndex,
    () => repoAnalyzer.analyze(getWorkDir()),
  )))
  providers.push(register(makeRulesProvider(getWorkDir)))
  providers.push(register(makeMCPProvider(async () => {
    const servers = mcpManager.getToolsByServer()
    return servers.flatMap((s) =>
      s.tools.map((t) => ({
        server: s.server,
        tool: {
          name: t.name,
          description: t.description ?? "",
          schema: (t as any).inputSchema ?? {},
        },
      })),
    )
  })))
  providers.push(register(makeLspProvider(getWorkDir)))

  return providers
}

export async function createDeps(
  ctx: vscode.ExtensionContext,
): Promise<ExtensionDeps> {
  const config = loadAppConfig()

  // ── Бэкенд ──────────────────────────────────────────────
  const backend = new NeuralTowerBackend(config.backend)

  // ── Постоянное хранилище сессий ─────────────────────────
  const sessionStore = new PersistentSessionStore(ctx.globalStorageUri, config.session.maxSessions)
  await sessionStore.init()

  // ── Менеджер разрешений ─────────────────────────────────
  const permissionManager = new PermissionManager()
  const vsCfg = vscode.workspace.getConfiguration("neuralTowerAgent")
  const autoApproveEnabled = vsCfg.get<boolean>("autoApprove.enabled", false) ?? false
  const autoApproveTools = vsCfg.get<string[]>("autoApprove.tools", []) ?? []
  permissionManager.setAutoApprove({ enabled: autoApproveEnabled, tools: autoApproveTools, maxCost: 0 })

  // ── Git-сервис ──────────────────────────────────────────
  const gitService = new GitService()
  await gitService.init()

  // ── Сервис уведомлений ──────────────────────────────────
  const notificationService = new NotificationService()
  await notificationService.init()

  // ── Реестр инструментов ─────────────────────────────────
  const tools = new ToolRegistry()
  tools.register(new ReadFileTool())
  tools.register(new WriteFileTool())
  tools.register(new BashTool())
  tools.register(new EditFileTool())
  tools.register(new GlobTool())
  tools.register(new GrepTool())
  tools.register(new WebFetchTool())
  tools.register(new LspTool())
  tools.register(new TodoWriteTool())

  // ── MCP-менеджер ────────────────────────────────────────
  const mcpManager = new MCPManager()
  await mcpManager.connect()
  await mcpManager.syncWithRegistry(tools)

  // ── Менеджер навыков ────────────────────────────────────
  const skills = new SkillManager()
  skills.registerMany(builtInSkills)

  // ── Менеджер контекста ──────────────────────────────────
  const contextManager = new ContextManager()

  // ── Реестр провайдеров контекста ─────────────────────────
  const contextProviderRegistry = new ContextProviderRegistry()

  // ── Файловый индекс ─────────────────────────────────────
  const fileIndex = new FileIndex()

  // ── Анализатор репозитория ──────────────────────────────
  const repoAnalyzer = new RepoAnalyzer()

  // ── Mutable workDir (для шага 8) ────────────────────────
  const workDirRef = {
    current: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "",
  }

  // ── Immutable deps, собраны ДО создания агента ──────────
  const agentDeps: AgentDependencies = {
    getWorkDir: () => workDirRef.current,
    config,
    contextProviderRegistry,
    contextManager,
    fileIndex,
    gitService,
    permissionManager,
    mcpManager,
  }

  // ── Фабрика для создания AgentOrchestrator ──────────────
  const spawnFactory: import("../agent/AgentDependencies").AgentSpawnFactory = (
    deps,
    b,
    t,
    s,
  ) => new AgentOrchestrator(b, t, s, deps)

  // ── Оркестратор агента ──────────────────────────────────
  const agent = new AgentOrchestrator(backend, tools, skills, agentDeps, spawnFactory)
  const todoStore = agent.getTodoStore()

  // ── Runner подагентов ───────────────────────────────────
  const subagentRunner = new SubagentRunner(backend, tools, skills, agentDeps, spawnFactory)

  if (vscode.workspace.workspaceFolders?.[0]) {
    workDirRef.current = vscode.workspace.workspaceFolders[0].uri.fsPath
    await gitService.findRoot(vscode.workspace.workspaceFolders[0].uri.fsPath)
  }

  // ── Построение файлового индекса ────────────────────────
  if (workDirRef.current) {
    await fileIndex.build(workDirRef.current)
  }

  // ── Регистрация провайдеров контекста ───────────────────
  registerContextProviders(
    contextManager,
    contextProviderRegistry,
    backend,
    gitService,
    mcpManager,
    fileIndex,
    repoAnalyzer,
    () => workDirRef.current,
  )

  // ── Провайдеры ──────────────────────────────────────────
  const chatProvider = new ChatProvider(ctx.extensionUri, agent, sessionStore, notificationService, permissionManager)
  const diffViewer = new DiffViewerProvider(ctx.extensionUri)

  // ── Мониторинг здоровья бэкенда ─────────────────────────
  const healthMonitor = new BackendHealthMonitor(backend, contextManager)
  await healthMonitor.init()

  // ── Сервис коммит-сообщений ─────────────────────────────
  const commitMessageService = new CommitMessageService(backend, gitService)
  await commitMessageService.init()

  return {
    backend,
    agent,
    todoStore,
    chatProvider,
    diffViewer,
    healthMonitor,
    commitMessageService,
    gitService,
    sessionStore,
    notificationService,
    permissionManager,
    mcpManager,
    contextManager,
    subagentRunner,
    config,
    agentDeps,
    fileIndex,
    setWorkDir: (dir: string) => { workDirRef.current = dir },
  }
}
