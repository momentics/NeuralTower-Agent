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
import { AutocompleteService } from "../services/autocomplete/AutocompleteService"
import { MCPManager } from "../mcp/MCPManager"
import { ReadFileTool } from "../tools/builtins/ReadFileTool"
import { WriteFileTool } from "../tools/builtins/WriteFileTool"
import { BashTool } from "../tools/builtins/BashTool"
import { EditFileTool } from "../tools/builtins/EditFileTool"
import { DeleteFileTool } from "../tools/builtins/DeleteFileTool"
import { CreateDirTool } from "../tools/builtins/CreateDirTool"
import { MoveFileTool } from "../tools/builtins/MoveFileTool"
import { GlobTool } from "../tools/builtins/GlobTool"
import { GrepTool } from "../tools/builtins/GrepTool"
import { WebFetchTool } from "../tools/builtins/WebFetchTool"
import { TodoWriteTool } from "../tools/builtins/TodoWriteTool"
import { LspTool } from "../tools/builtins/LspTool"
import { CodebaseSearchTool } from "../tools/builtins/CodebaseSearchTool"
import { ContextManager } from "../core/ContextManager"
import { ContextProviderRegistry } from "../core/providers/context/registry"
import { FileIndex } from "../repo/FileIndex"
import { RepoAnalyzer } from "../repo/RepoAnalyzer"
import { SubagentRunner } from "../agent/SubagentRunner"
import { loadAppConfig } from "../core/config"
import type { AppConfig, SessionConfig } from "../core/config"
import type { AgentDependencies, AgentSpawnFactory } from "../agent/AgentDependencies"
import type { IBackend } from "../core/IBackend"
import type { IAgentOrchestrator } from "../core/IAgent"
import type { IProvider } from "../core/IProvider"
import type { ISessionStore } from "../shared/PersistentSessionStore"
import type { ContextProvider } from "../core/providers/context/types"
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
} from "../core/ContextSources.vscode"
import {
  makeEnvironmentProvider,
  makeGitDiffProvider,
} from "../core/ContextSources"
import { makeCodebaseProvider } from "../core/providers/context/codebase"
import { NeuralTowerEmbeddingProvider } from "../backend/NeuralTowerEmbeddingProvider"
import { InMemoryVectorStore } from "../repo/InMemoryVectorStore"
import { FullTextSearch } from "../repo/FullTextSearch"
import { CodebaseSearch } from "../repo/CodebaseSearch"
import { CodebaseChunker, createDefaultChunkerConfig } from "../repo/CodebaseChunker"
import { CodebaseIndexer } from "../services/indexing/CodebaseIndexer"
import { IndexingStatusBar } from "../services/indexing/IndexingStatusBar"

// ── Публичные типы ────────────────────────────────────────

export interface ExtensionDeps {
  backend: IBackend
  agent: IAgentOrchestrator
  todoStore: ReturnType<AgentOrchestrator["getTodoStore"]>
  chatProvider: IProvider
  diffViewer: DiffViewerProvider
  healthMonitor: BackendHealthMonitor
  commitMessageService: CommitMessageService
  autocompleteService: AutocompleteService
  gitService: GitService
  sessionStore: ISessionStore
  notificationService: NotificationService
  permissionManager: PermissionManager
  mcpManager: MCPManager
  contextManager: ContextManager
  subagentRunner: SubagentRunner
  config: AppConfig
  agentDeps: AgentDependencies
  fileIndex: FileIndex
 codebaseSearch: CodebaseSearch
  codebaseIndexer: CodebaseIndexer
  indexingStatusBar: IndexingStatusBar
  setWorkDir: (dir: string) => void
}

// ── Фабричные функции ─────────────────────────────────────

export function createBackend(config: AppConfig): IBackend {
  return new NeuralTowerBackend(config.backend)
}

export function createEmbeddingProvider(config: AppConfig): NeuralTowerEmbeddingProvider {
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
  chunker: CodebaseChunker,
  search: CodebaseSearch,
  embeddingProvider: NeuralTowerEmbeddingProvider,
): CodebaseIndexer {
  return new CodebaseIndexer(fileIndex, chunker, search, embeddingProvider)
}

export function createIndexingStatusBar(
  indexer: CodebaseIndexer,
): IndexingStatusBar {
  return new IndexingStatusBar(indexer)
}

export async function createSessionStore(
  ctx: vscode.ExtensionContext,
  sessionConfig: SessionConfig,
): Promise<ISessionStore> {
  const store = new PersistentSessionStore(ctx.globalStorageUri, sessionConfig.maxSessions)
  await store.init()
  return store
}

export function createPermissionManager(
  vsCfg: vscode.WorkspaceConfiguration,
  globalState: vscode.Memento,
): PermissionManager {
  const pm = new PermissionManager(globalState)
  pm.init()
  const autoApproveEnabled = vsCfg.get<boolean>("autoApprove.enabled", false) ?? false
  const autoApproveTools = vsCfg.get<string[]>("autoApprove.tools", []) ?? []
  pm.setAutoApprove({ enabled: autoApproveEnabled, tools: autoApproveTools, maxCost: 0 })
  return pm
}

export async function createServices(): Promise<{
  gitService: GitService
  notificationService: NotificationService
}> {
  const gitService = new GitService()
  await gitService.init()
  const notificationService = new NotificationService()
  await notificationService.init()
  return { gitService, notificationService }
}

export function createToolRegistry(
  workspaceRoot: string | undefined,
  codebaseSearch: CodebaseSearch | null,
): ToolRegistry {
  const tools = new ToolRegistry()
tools.register(new ReadFileTool(workspaceRoot))
  tools.register(new WriteFileTool(workspaceRoot))
  tools.register(new BashTool())
  tools.register(new EditFileTool(workspaceRoot))
  tools.register(new DeleteFileTool(workspaceRoot))
  tools.register(new CreateDirTool(workspaceRoot))
  tools.register(new MoveFileTool(workspaceRoot))
  tools.register(new GlobTool(workspaceRoot))
  tools.register(new GrepTool(workspaceRoot))
  tools.register(new WebFetchTool())
  tools.register(new LspTool())
  tools.register(new TodoWriteTool())

  // Добавить инструмент семантического поиска (если доступен)
  if (codebaseSearch) {
    tools.register(new CodebaseSearchTool(codebaseSearch))
  }

  return tools
}

export async function createMCPChain(
  tools: ToolRegistry,
): Promise<MCPManager> {
  const mcpManager = new MCPManager()
  await mcpManager.connect()
  await mcpManager.syncWithRegistry(tools)
  return mcpManager
}

export function createSkillManager(): SkillManager {
  const skills = new SkillManager()
  skills.registerMany(builtInSkills)
  return skills
}

export function createRepoInfrastructure(): {
  fileIndex: FileIndex
  repoAnalyzer: RepoAnalyzer
} {
  return {
    fileIndex: new FileIndex(),
    repoAnalyzer: new RepoAnalyzer(),
  }
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
  codebaseSearch: CodebaseSearch,
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
 providers.push(register(makeGitDiffProvider(getWorkDir, gitService)))

  // ── Специализированные провайдеры ───────────────────────
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
          schema: (t as any).inputSchema ?? {},
        },
      })),
    )
  })))
  providers.push(register(makeLspProvider(getWorkDir)))

  // ── Семантический поиск по коду ────────────────────────
  providers.push(register(makeCodebaseProvider(codebaseSearch)))

  return providers
}

export function createContextChain(
  contextManager: ContextManager,
  contextProviderRegistry: ContextProviderRegistry,
  backend: NeuralTowerBackend,
  gitService: GitService,
  mcpManager: MCPManager,
  fileIndex: FileIndex,
  repoAnalyzer: RepoAnalyzer,
  codebaseSearch: CodebaseSearch,
  getWorkDir: () => string,
): ContextProvider[] {
  return registerContextProviders(
    contextManager,
    contextProviderRegistry,
    backend,
    gitService,
    mcpManager,
    fileIndex,
    repoAnalyzer,
    codebaseSearch,
    getWorkDir,
  )
}

export function createAgentChain(
  backend: IBackend,
  tools: ToolRegistry,
  skills: SkillManager,
  agentDeps: AgentDependencies,
  spawnFactory: AgentSpawnFactory,
): { agent: AgentOrchestrator; todoStore: ReturnType<AgentOrchestrator["getTodoStore"]> } {
  const agent = new AgentOrchestrator(backend, tools, skills, agentDeps, spawnFactory)
  const todoStore = agent.getTodoStore()
  return { agent, todoStore }
}

export function createUIProviders(
  extUri: vscode.Uri,
  agent: IAgentOrchestrator,
  sessionStore: ISessionStore,
  notificationService: NotificationService,
  permissionManager: PermissionManager,
): { chatProvider: IProvider; diffViewer: DiffViewerProvider } {
  const chatProvider = new ChatProvider(extUri, agent, sessionStore, notificationService, permissionManager)
  const diffViewer = new DiffViewerProvider(extUri)
  return { chatProvider, diffViewer }
}

export async function createMonitoringChain(
  backend: IBackend,
  contextManager: ContextManager,
): Promise<BackendHealthMonitor> {
  const healthMonitor = new BackendHealthMonitor(backend, contextManager)
  await healthMonitor.init()
  return healthMonitor
}

export async function createCommitService(
  backend: IBackend,
  gitService: GitService,
): Promise<CommitMessageService> {
  const commitMessageService = new CommitMessageService(backend, gitService)
  await commitMessageService.init()
  return commitMessageService
}

export async function createAutocompleteService(
  backend: IBackend,
): Promise<AutocompleteService> {
  const autocompleteService = new AutocompleteService(backend)
  await autocompleteService.init()
  return autocompleteService
}

// ── Главный оркестратор ───────────────────────────────────

export async function createDeps(
  ctx: vscode.ExtensionContext,
): Promise<ExtensionDeps> {
  const config = loadAppConfig()
  const backend = createBackend(config)
  const sessionStore = await createSessionStore(ctx, config.session)
  const vsCfg = vscode.workspace.getConfiguration("neuralTowerAgent")
  const permissionManager = createPermissionManager(vsCfg, ctx.globalState)
  const { gitService, notificationService } = await createServices()

  const { fileIndex, repoAnalyzer } = createRepoInfrastructure()

  // ── Инфраструктура семантического поиска ────────────────
  const embeddingProvider = createEmbeddingProvider(config)
  const vectorStore = createVectorStore()
  const fts = createFullTextSearch()
  const codebaseSearch = createCodebaseSearch(vectorStore, embeddingProvider, fts)
  const chunker = createCodebaseChunker(fileIndex)

  // ── Инструменты (после создания codebaseSearch) ────────
  const tools = createToolRegistry(
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    codebaseSearch,
  )
  const mcpManager = await createMCPChain(tools)
  const skills = createSkillManager()

  const contextManager = new ContextManager(config.context.tokenBudget)
  const contextProviderRegistry = new ContextProviderRegistry()

  const workDirRef = {
    current: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "",
  }

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

  const spawnFactory: AgentSpawnFactory = (deps, b, t, s) =>
    new AgentOrchestrator(b, t, s, deps)

  const { agent, todoStore } = createAgentChain(backend, tools, skills, agentDeps, spawnFactory)
  const subagentRunner = new SubagentRunner(backend, tools, skills, agentDeps, spawnFactory)

  if (vscode.workspace.workspaceFolders?.[0]) {
    workDirRef.current = vscode.workspace.workspaceFolders[0].uri.fsPath
    await gitService.findRoot(vscode.workspace.workspaceFolders[0].uri.fsPath)
  }

  if (workDirRef.current) {
    await fileIndex.build(workDirRef.current)
  }

  createContextChain(
    contextManager,
    contextProviderRegistry,
    backend as NeuralTowerBackend,
    gitService,
    mcpManager,
    fileIndex,
    repoAnalyzer,
    codebaseSearch,
    () => workDirRef.current,
  )

  const { chatProvider, diffViewer } = createUIProviders(
    ctx.extensionUri,
    agent,
    sessionStore,
    notificationService,
    permissionManager,
  )

  const healthMonitor = await createMonitoringChain(backend, contextManager)
  const commitMessageService = await createCommitService(backend, gitService)
  const autocompleteService = await createAutocompleteService(backend)

  // ── Индексация репозитория ─────────────────────────────
  const codebaseIndexer = createCodebaseIndexer(
    fileIndex,
    chunker,
    codebaseSearch,
    embeddingProvider,
  )

  // Запустить индексацию (если есть рабочая область)
 if (vscode.workspace.workspaceFolders?.[0]) {
    await codebaseIndexer.start(vscode.workspace.workspaceFolders[0].uri)
  }

  const indexingStatusBar = createIndexingStatusBar(codebaseIndexer)
  await indexingStatusBar.init()

  return {
    backend,
    agent,
    todoStore,
    chatProvider,
    diffViewer,
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
    setWorkDir: (dir: string) => { workDirRef.current = dir },
  }
}
