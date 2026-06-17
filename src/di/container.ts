import * as vscode from "vscode"
import { NeuralTowerBackend } from "../backend/NeuralTowerBackend"
import { AgentOrchestrator } from "../agent/AgentOrchestrator"
import { AgentEnvironment } from "../agent/AgentEnvironment"
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
import { SessionContext } from "../agent/SessionContext"
import { SubagentRunner } from "../agent/SubagentRunner"
import { loadAppConfig } from "../core/config"
import type { AppConfig } from "../core/config"

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

  // ── Окружение агента ────────────────────────────────────
  const agentEnv = new AgentEnvironment(
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "",
    config,
    contextProviderRegistry,
    contextManager,
    fileIndex,
  )

  // ── Оркестратор агента ──────────────────────────────────
  const agent = new AgentOrchestrator(backend, tools, skills, agentEnv)
  const todoStore = agent.getTodoStore()
  agent.setPermissionManager(permissionManager)
  agent.setGitService(gitService)
  agent.setMCPManager(mcpManager)

  // ── Контекст сессии ─────────────────────────────────────
  const sessionContext = new SessionContext(sessionStore.activeId, contextManager)
  agent.setSessionContext(sessionContext)

  // ── Runner подагентов ───────────────────────────────────
  const subagentRunner = new SubagentRunner(backend, tools, skills, agentEnv, permissionManager, gitService)
  agent.setSubagentRunner(subagentRunner)

  if (vscode.workspace.workspaceFolders?.[0]) {
    agent.setWorkingDir(vscode.workspace.workspaceFolders[0].uri.fsPath)
    await gitService.findRoot(vscode.workspace.workspaceFolders[0].uri.fsPath)
    await agent.reload()
  }

  // ── Провайдеры ──────────────────────────────────────────
  const chatProvider = new ChatProvider(ctx.extensionUri, agent, sessionStore, notificationService, permissionManager)
  const diffViewer = new DiffViewerProvider(ctx.extensionUri)

  // ── Мониторинг здоровья бэкенда ─────────────────────────
  const healthMonitor = new BackendHealthMonitor(backend)
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
  }
}
