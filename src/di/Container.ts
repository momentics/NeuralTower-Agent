import * as vscode from "vscode"
import type { IAppConfig, ISessionConfig } from "../core/Config"
import type { IGitService } from "../services/git/GitService"
import type { ICodebaseSearch } from "../repo/CodebaseSearch"
import type { ICodebaseChunker } from "../repo/CodebaseChunker"
import type { IFileIndex } from "../repo/FileIndex"
import type { IBackend, IBackendConfig } from "../core/IBackend"
import type { IAgentOrchestrator } from "../core/IAgent"
import type { IProvider } from "../core/IProvider"
import type { ISessionStore } from "../shared/PersistentSessionStore"
import type { IPermissionManager } from "../services/permission/PermissionManager"
import type { IMCPManager } from "../mcp/MCPManager"
import type { IContextManager } from "../core/ContextManager"
import type { IToolRegistry } from "../tools/ToolRegistry"
import type { ISkillManager } from "../skills/SkillManager"
import type { IDiffViewerProvider } from "../providers/DiffViewerProvider"
import type { INotificationService } from "../services/notification/NotificationService"
import type { IAgentDependencies, AgentSpawnFactory } from "../agent/AgentDependencies"
import type { IContextProvider } from "../core/providers/context/Types"
import {
  NeuralTowerBackend,
  NeuralTowerEmbeddingProvider,
} from "../backend"
import { AgentOrchestrator } from "../agent"
import { ToolRegistry } from "../tools"
import { SkillManager, BUILT_IN_SKILLS } from "../skills"
import { ChatProvider } from "../providers/ChatProvider"
import { DiffViewerProvider } from "../providers/DiffViewerProvider"
import { PersistentSessionStore } from "../shared"
import { PermissionManager } from "../services/permission/PermissionManager"
import { GitService } from "../services/git/GitService"
import { NotificationService } from "../services/notification/NotificationService"
import { VscodeWindowService } from "../core/VscodeApi"
import { BackendHealthMonitor } from "../services/health/BackendHealthMonitor"
import { CommitMessageService } from "../services/commit-message/CommitMessageService"
import { AutocompleteService } from "../services/autocomplete/AutocompleteService"
import { TelemetryService } from "../services/telemetry/TelemetryService"
import { MCPManager } from "../mcp"
import { SettingsProvider } from "../providers/SettingsProvider"
import { ContextManager } from "../core/ContextManager"
import { ContextProviderRegistry } from "../core/providers/context/Registry"
import { FileIndex } from "../repo/FileIndex"
import { RepoAnalyzer } from "../repo/RepoAnalyzer"
import { SubagentRunner } from "../agent/SubagentRunner"
import { TodoStore } from "../agent/TodoStore"
import { InMemoryVectorStore } from "../repo/InMemoryVectorStore"
import { FullTextSearch } from "../repo/FullTextSearch"
import { CodebaseSearch } from "../repo/CodebaseSearch"
import { CodebaseChunker, createDefaultChunkerConfig } from "../repo/CodebaseChunker"
import { CodebaseIndexer } from "../services/indexing/CodebaseIndexer"
import { IndexingStatusBar } from "../services/indexing/IndexingStatusBar"
import { loadAppConfig } from "../core/Config"
import { createDomainLogger } from "../core/Logger"
import { errorMessage } from "../core/Errors"
import {
  makeUrlProvider,
  makeWebSearchProvider,
  makeFileProvider,
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
} from "../core/ContextSourcesVscode"
import {
  makeEnvironmentProvider,
  makeGitDiffProvider,
} from "../core/ContextSources"
import { makeCodebaseProvider } from "../core/providers/context/Codebase"
import {
  ReadFileTool,
  WriteFileTool,
  EditFileTool,
  DeleteFileTool,
  CreateDirTool,
  MoveFileTool,
  GlobTool,
  GrepTool,
  BashTool,
  WebFetchTool,
  LspTool,
  TodoWriteTool,
  CodebaseSearchTool,
} from "../tools"

const log = createDomainLogger("DI")

// ── Публичные типы ────────────────────────────────────────

export interface IExtensionDeps {
  backend: IBackend
  agent: IAgentOrchestrator
  todoStore: TodoStore
  chatProvider: IProvider
  diffViewer: IDiffViewerProvider
  settingsProvider: SettingsProvider
  healthMonitor: BackendHealthMonitor
  commitMessageService: CommitMessageService
  autocompleteService: AutocompleteService
  gitService: IGitService
  sessionStore: ISessionStore
  notificationService: INotificationService
  permissionManager: IPermissionManager
  mcpManager: IMCPManager
  contextManager: IContextManager
  subagentRunner: SubagentRunner
 config: IAppConfig
  agentDeps: IAgentDependencies
  fileIndex: IFileIndex
  codebaseSearch: ICodebaseSearch
  codebaseIndexer: CodebaseIndexer
  indexingStatusBar: IndexingStatusBar
  telemetry: TelemetryService
  setWorkDir: (dir: string) => void
}

// ── Результаты композиции доменов ─────────────────────────

export interface ISearchInfrastructureDeps {
  fileIndex: FileIndex
  repoAnalyzer: RepoAnalyzer
  embeddingProvider: NeuralTowerEmbeddingProvider
  vectorStore: InMemoryVectorStore
  fts: FullTextSearch
  codebaseSearch: CodebaseSearch
  chunker: CodebaseChunker
}

export interface IServicesDeps {
  sessionStore: ISessionStore
  permissionManager: IPermissionManager
  gitService: IGitService
  notificationService: INotificationService
}

export interface IToolsDeps {
  tools: IToolRegistry
  mcpManager: IMCPManager
  skills: ISkillManager
}

export interface IAgentDepsResult {
  agent: IAgentOrchestrator
  subagentRunner: SubagentRunner
  todoStore: TodoStore
  agentDeps: IAgentDependencies
}

export interface IContextDepsResult {
  contextManager: ContextManager
  contextProviderRegistry: ContextProviderRegistry
 providers: IContextProvider[]
}

export interface IUIDepsResult {
  chatProvider: IProvider
  diffViewer: IDiffViewerProvider
  settingsProvider: SettingsProvider
}

export interface IMonitoringDepsResult {
  healthMonitor: BackendHealthMonitor
  commitMessageService: CommitMessageService
  autocompleteService: AutocompleteService
  codebaseIndexer: CodebaseIndexer
  indexingStatusBar: IndexingStatusBar
  telemetry: TelemetryService
}

// ── Независимые фабрики ───────────────────────────────────

export function createBackend(config: IAppConfig, onConfigChange?: (partial: Partial<IBackendConfig>) => void): IBackend {
  return new NeuralTowerBackend(config.backend, onConfigChange)
}

export function createEmbeddingProvider(config: IAppConfig): NeuralTowerEmbeddingProvider {
  return new NeuralTowerEmbeddingProvider({
    baseUrl: config.backend.url,
    timeoutMs: config.backend.timeoutMs,
  })
}

export function createVectorStore(): InMemoryVectorStore {
  return new InMemoryVectorStore()
}

export function createFullTextSearch(): FullTextSearch {
  return new FullTextSearch()
}

export function createCodebaseSearch(
  vectorStore: InMemoryVectorStore,
  embeddingProvider: NeuralTowerEmbeddingProvider,
  fts: FullTextSearch,
): CodebaseSearch {
  return new CodebaseSearch(vectorStore, embeddingProvider, fts)
}

export function createCodebaseChunker(fileIndex: FileIndex): CodebaseChunker {
  return new CodebaseChunker(fileIndex, createDefaultChunkerConfig())
}

export function createCodebaseIndexer(
  fileIndex: FileIndex,
  chunker: ICodebaseChunker,
  search: ICodebaseSearch,
  embeddingProvider: NeuralTowerEmbeddingProvider,
): CodebaseIndexer {
  return new CodebaseIndexer(fileIndex, chunker, search, embeddingProvider)
}

export function createIndexingStatusBar(
  indexer: CodebaseIndexer,
): IndexingStatusBar {
  return new IndexingStatusBar(indexer)
}

// ── Домен: Инфраструктура поиска ──────────────────────────

export function createSearchInfrastructure(config: IAppConfig): ISearchInfrastructureDeps {
  const fileIndex = new FileIndex()
  const repoAnalyzer = new RepoAnalyzer()
  const embeddingProvider = createEmbeddingProvider(config)
  const vectorStore = createVectorStore()
  const fts = createFullTextSearch()
  const codebaseSearch = createCodebaseSearch(vectorStore, embeddingProvider, fts)
  const chunker = createCodebaseChunker(fileIndex)

  return {
    fileIndex,
    repoAnalyzer,
    embeddingProvider,
    vectorStore,
    fts,
    codebaseSearch,
    chunker,
  }
}

// ── Домен: Сервисы ────────────────────────────────────────

export async function createServicesDomain(
  ctx: vscode.ExtensionContext,
  vsCfg: vscode.WorkspaceConfiguration,
  sessionConfig: ISessionConfig,
): Promise<IServicesDeps> {
  const sessionStore = PersistentSessionStore.withFileStorage(ctx.globalStorageUri, sessionConfig.maxSessions)
  await sessionStore.init()

  const permissionManager = new PermissionManager(ctx.globalState)
  await permissionManager.init()
  const autoApproveEnabled = vsCfg.get<boolean>("autoApprove.enabled", false)
  const autoApproveTools = vsCfg.get<string[]>("autoApprove.tools", [])
  permissionManager.setAutoApprove({ enabled: autoApproveEnabled, tools: autoApproveTools, maxCost: 0 })

  const gitService = new GitService()
  const notificationService = new NotificationService(new VscodeWindowService())
  await notificationService.init()

  return { sessionStore, permissionManager, gitService, notificationService }
}

// ── Домен: Инструменты ────────────────────────────────────

export function createToolsDomain(
  workspaceRoot: string | undefined,
  codebaseSearch: ICodebaseSearch | undefined,
  todoStore: TodoStore,
): IToolsDeps {
  const tools = new ToolRegistry()

  if (workspaceRoot) {
    tools.register(new ReadFileTool(workspaceRoot))
    tools.register(new WriteFileTool(workspaceRoot))
    tools.register(new EditFileTool(workspaceRoot))
    tools.register(new DeleteFileTool(workspaceRoot))
    tools.register(new CreateDirTool(workspaceRoot))
    tools.register(new MoveFileTool(workspaceRoot))
    tools.register(new GlobTool(workspaceRoot))
    tools.register(new GrepTool(workspaceRoot))
  }

  tools.register(new BashTool())
  tools.register(new WebFetchTool())
  tools.register(new LspTool(() => workspaceRoot ?? process.cwd()))
  tools.register(new TodoWriteTool(todoStore))

  if (codebaseSearch) {
    tools.register(new CodebaseSearchTool(codebaseSearch))
  }

  const mcpManager = new MCPManager()
  try {
    // Подключение MCP обрабатывается здесь; синхронизация происходит в createDeps после готовности инструментов
  } catch (err: unknown) {
    log.warn(`MCP-инициализация не выполнена: ${errorMessage(err)}`)
  }

  const skills = new SkillManager()
  skills.registerMany(BUILT_IN_SKILLS)

  return { tools, mcpManager, skills }
}

export async function syncMCP(mcpManager: IMCPManager, tools: IToolRegistry): Promise<void> {
  try {
    await mcpManager.connect()
    await mcpManager.syncWithRegistry(tools)
  } catch (err: unknown) {
    log.warn(`MCP-инициализация не выполнена: ${errorMessage(err)}`)
  }
}

// ── Домен: Агент ──────────────────────────────────────────

export function createAgentDomain(
  backend: IBackend,
  tools: IToolRegistry,
  skills: ISkillManager,
  agentDeps: IAgentDependencies,
  spawnFactory: AgentSpawnFactory,
  todoStore: TodoStore,
): IAgentDepsResult {
  const agent = new AgentOrchestrator(backend, tools, skills, agentDeps, spawnFactory, todoStore)
  const subagentRunner = new SubagentRunner(backend, tools, skills, agentDeps, spawnFactory, todoStore)

  return { agent, subagentRunner, todoStore, agentDeps }
}

// ── Домен: Контекст ───────────────────────────────────────

export function createContextDomain(
  config: IAppConfig,
  backend: IBackend,
  gitService: IGitService,
  mcpManager: IMCPManager,
  fileIndex: IFileIndex,
  repoAnalyzer: RepoAnalyzer,
  codebaseSearch: ICodebaseSearch,
  getWorkDir: () => string,
): IContextDepsResult {
  const contextManager = new ContextManager(config.context.tokenBudget)
  const contextProviderRegistry = new ContextProviderRegistry()

  const register = (p: IContextProvider): IContextProvider => {
    contextManager.register(p)
    contextProviderRegistry.register(p)
    return p
  }

  const providers: IContextProvider[] = []

  // VS Code провайдеры
  providers.push(register(makeCurrentFileProvider()))
  providers.push(register(makeOpenFilesProvider()))
  providers.push(register(makeProblemsProvider(getWorkDir)))
  providers.push(register(makeClipboardProvider()))
  providers.push(register(makeDebuggerProvider()))
  providers.push(register(makeTerminalProvider()))
  providers.push(register(makeOSProvider()))

  // Платформенно-независимые провайдеры
  providers.push(register(makeEnvironmentProvider(
    getWorkDir,
    () => backend.getConfig().then((c) => c.model),
    gitService,
  )))
  providers.push(register(makeGitDiffProvider(getWorkDir, gitService)))

  // Специализированные провайдеры
  providers.push(register(makeUrlProvider()))
  providers.push(register(makeWebSearchProvider()))
  providers.push(register(makeFileProvider(getWorkDir)))
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
          schema: t.schema ?? {},
        },
      })),
    )
  })))
  providers.push(register(makeLspProvider(getWorkDir)))

  // Семантический поиск по коду
  providers.push(register(makeCodebaseProvider(codebaseSearch)))

  return { contextManager, contextProviderRegistry, providers }
}

// ── Домен: Интерфейс ──────────────────────────────────────

export function createUIDomain(
  extUri: vscode.Uri,
  agent: IAgentOrchestrator,
  sessionStore: ISessionStore,
  notificationService: INotificationService,
  permissionManager: IPermissionManager,
  backend: IBackend,
): IUIDepsResult {
  const chatProvider = new ChatProvider(extUri, agent, sessionStore, notificationService, permissionManager)
  const diffViewer = new DiffViewerProvider(extUri)
  const settingsProvider = new SettingsProvider(extUri, backend)

  return { chatProvider, diffViewer, settingsProvider }
}

// ── Домен: Мониторинг ─────────────────────────────────────

export async function createMonitoringDomain(
  backend: IBackend,
  contextManager: ContextManager,
  gitService: IGitService,
  fileIndex: FileIndex,
  chunker: ICodebaseChunker,
  codebaseSearch: ICodebaseSearch,
  embeddingProvider: NeuralTowerEmbeddingProvider,
): Promise<IMonitoringDepsResult> {
  const healthMonitor = new BackendHealthMonitor(backend, contextManager)
  await healthMonitor.init()

  const commitMessageService = new CommitMessageService(backend, gitService)
  await commitMessageService.init()

  const autocompleteService = new AutocompleteService(backend)
  await autocompleteService.init()

  const codebaseIndexer = createCodebaseIndexer(
    fileIndex,
    chunker,
    codebaseSearch,
    embeddingProvider,
  )

  const indexingStatusBar = createIndexingStatusBar(codebaseIndexer)
  await indexingStatusBar.init()

  const telemetry = new TelemetryService()
  await telemetry.init()

  return {
    healthMonitor,
    commitMessageService,
    autocompleteService,
    codebaseIndexer,
    indexingStatusBar,
    telemetry,
  }
}

// ── Главный оркестратор ───────────────────────────────────

export interface ICreateDepsOptions {
  /** Переопределить отдельные зависимости (для тестов). */
  overrides?: Partial<IExtensionDeps>
}

export async function createDeps(
  ctx: vscode.ExtensionContext,
  options: ICreateDepsOptions = {},
): Promise<IExtensionDeps> {
  const config = loadAppConfig()
  const vsCfg = vscode.workspace.getConfiguration("neuralTowerAgent")

  const backend = createBackend(config, async (partial) => {
    if (partial.url !== undefined) await vsCfg.update("neuralTowerUrl", partial.url, true)
    if (partial.model !== undefined) await vsCfg.update("model", partial.model, true)
    if (partial.maxRetries !== undefined) await vsCfg.update("maxRetries", partial.maxRetries, true)
    if (partial.timeoutMs !== undefined) await vsCfg.update("timeoutMs", partial.timeoutMs, true)
  })

  // ── Сервисы ─────────────────────────────────────────────
  const { sessionStore, permissionManager, gitService, notificationService } =
    await createServicesDomain(ctx, vsCfg, config.session)

  // ── Инфраструктура поиска ───────────────────────────────
  const { fileIndex, repoAnalyzer, embeddingProvider, codebaseSearch, chunker } =
    createSearchInfrastructure(config)

  // ── Инструменты ─────────────────────────────────────────
  const todoStore = new TodoStore()
  const { tools, mcpManager, skills } = createToolsDomain(
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    codebaseSearch,
    todoStore,
  )
  await syncMCP(mcpManager, tools)

  // ── Состояние рабочей директории ────────────────────────
  const workDirState = {
    current: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "",
  }

  // ── Контекст (должен создаваться до агента) ─────────────
  const { contextManager, contextProviderRegistry } = createContextDomain(
    config,
    backend,
    gitService,
    mcpManager,
    fileIndex,
    repoAnalyzer,
    codebaseSearch,
    () => workDirState.current,
  )

  // ── Агент ───────────────────────────────────────────────
  const agentDeps: IAgentDependencies = {
    getWorkDir: () => workDirState.current,
    config,
    contextProviderRegistry,
    contextManager,
    fileIndex,
    gitService,
    permissionManager,
    mcpManager,
  }

  const spawnFactory: AgentSpawnFactory = (deps, b, t, s, ts) =>
    new AgentOrchestrator(b, t, s, deps, null, ts)

  const { agent, subagentRunner } = createAgentDomain(
    backend, tools, skills, agentDeps, spawnFactory, todoStore,
  )

  // ── Интерфейс ───────────────────────────────────────────
  const { chatProvider, diffViewer, settingsProvider } = createUIDomain(
    ctx.extensionUri, agent, sessionStore, notificationService, permissionManager, backend,
  )

  // ── Мониторинг ──────────────────────────────────────────
  const { healthMonitor, commitMessageService, autocompleteService, codebaseIndexer, indexingStatusBar, telemetry } =
    await createMonitoringDomain(
      backend, contextManager, gitService, fileIndex, chunker, codebaseSearch, embeddingProvider,
    )

  // ── Постинициализация: определение рабочей директории, построение индекса, запуск индексации ──
  if (vscode.workspace.workspaceFolders?.[0]) {
    workDirState.current = vscode.workspace.workspaceFolders[0].uri.fsPath
    await gitService.findRoot(vscode.workspace.workspaceFolders[0].uri.fsPath)
  }

  if (workDirState.current) {
    await fileIndex.build(workDirState.current)
  }

  if (vscode.workspace.workspaceFolders?.[0]) {
    await codebaseIndexer.start(vscode.workspace.workspaceFolders[0].uri)
  }

  return {
    backend,
    agent,
    todoStore,
    chatProvider,
    diffViewer,
    settingsProvider,
    healthMonitor,
    commitMessageService,
    autocompleteService,
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
    codebaseSearch,
    codebaseIndexer,
    indexingStatusBar,
    telemetry,
    setWorkDir: (dir: string) => { workDirState.current = dir },
    ...options.overrides,
  }
}
