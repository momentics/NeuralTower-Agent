import * as vscode from "vscode"
import * as path from "path"
import { workspaceKey } from "../utils/WorkspaceKey"
import { MemoryStore } from "../services/memory/MemoryStore"
import type { IProjectMemory } from "../agent/AgentMemory"
import type { IAppConfig, ISessionConfig } from "../core/Config"
import type { IGitService } from "../services/git/GitService"
import { GitRunner, type IGitRunner } from "../services/git/GitRunner"
import { SnapshotService, SnapshotStore } from "../services/snapshot"
import type { ISnapshotService, ISnapshotStore } from "../services/snapshot"
import type { ICodebaseSearch } from "../repo/CodebaseSearch"
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
import type { IAgentFullDependencies, AgentSpawnFactory } from "../agent/AgentDependencies"
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
import { SubagentRunner, type SubagentHandle } from "../agent/SubagentRunner"
import { TodoStore } from "../agent/TodoStore"
import { InMemoryVectorStore } from "../repo/InMemoryVectorStore"
import { FullTextSearch } from "../repo/FullTextSearch"
import { CodebaseSearch } from "../repo/CodebaseSearch"
import { NtGraphDb, openProjectGraphDb } from "../repo/ntgraph"
import { ExtractionOrchestrator } from "../repo/extraction/Orchestrator"
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
  MultiEditTool,
  DeleteFileTool,
  CreateDirTool,
  MoveFileTool,
  GlobTool,
  GrepTool,
  BashTool,
  WebFetchTool,
  WebSearchTool,
  LspTool,
  TodoWriteTool,
  CodebaseSearchTool,
  GitTool,
  QuestionTool,
  TaskTool,
  SkillTool,
  RememberTool,
} from "../tools"
import { ToolOutputTruncator } from "../tools/Truncate"
import { loadMcpServers, type IMcpServerEntry } from "../mcp/McpConfig"
import { loadUserModes } from "../agent/UserModeLoader"
import type { IAgentMode } from "../agent/AgentMode"
import { loadSkillsFromDir } from "../skills/SkillFileLoader"
import { QuestionServiceHolder } from "../services/question/QuestionService"
import { SubagentLauncherHolder, filterSubagentTools } from "../agent/TaskLauncher"

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
  snapshotService: ISnapshotService | null
  snapshotStore: ISnapshotStore | null
 config: IAppConfig
  agentDeps: IAgentFullDependencies
  fileIndex: IFileIndex
  codebaseSearch: ICodebaseSearch
  codebaseIndexer: CodebaseIndexer
  indexingStatusBar: IndexingStatusBar
  telemetry: TelemetryService
  graphDb: NtGraphDb | null
  setWorkDir: (dir: string) => void
}

// ── Результаты композиции доменов ─────────────────────────

export interface ISearchInfrastructureDeps {
  fileIndex: FileIndex
  repoAnalyzer: RepoAnalyzer
  embeddingProvider: NeuralTowerEmbeddingProvider
  vectorStore: InMemoryVectorStore
  fts: FullTextSearch | null
  codebaseSearch: CodebaseSearch
  graphDb: NtGraphDb | null
  orchestrator: ExtractionOrchestrator | null
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
  agentDeps: IAgentFullDependencies
}

export interface IContextDepsResult {
  contextManager: ContextManager
  contextProviderRegistry: ContextProviderRegistry
 providers: IContextProvider[]
}

export interface IUIDepsResult {
  chatProvider: ChatProvider
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

export function createEmbeddingProvider(backend: IBackend, config: IAppConfig): NeuralTowerEmbeddingProvider {
  return new NeuralTowerEmbeddingProvider({
    getBaseUrl: () => backend.currentUrl(),
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

export function createCodebaseIndexer(
  fileIndex: FileIndex,
  search: ICodebaseSearch,
  embeddingProvider: NeuralTowerEmbeddingProvider,
  orchestrator: ExtractionOrchestrator | null,
  graphDb: NtGraphDb | null,
): CodebaseIndexer {
  return new CodebaseIndexer(fileIndex, search, embeddingProvider, orchestrator, graphDb)
}

export function createIndexingStatusBar(
  indexer: CodebaseIndexer,
): IndexingStatusBar {
  return new IndexingStatusBar(indexer)
}

// ── Домен: Инфраструктура поиска ──────────────────────────

export function createSearchInfrastructure(
  backend: IBackend,
  config: IAppConfig,
  workspaceRoot?: string,
): ISearchInfrastructureDeps {
  const fileIndex = new FileIndex()
  const repoAnalyzer = new RepoAnalyzer()
  const embeddingProvider = createEmbeddingProvider(backend, config)
  const vectorStore = createVectorStore()

  let fts: FullTextSearch | null = null
  let graphDb: NtGraphDb | null = null
  let orchestrator: ExtractionOrchestrator | null = null
  let codebaseSearch: CodebaseSearch

  if (workspaceRoot) {
    // Графовая БД в .ntgraph/ + AST-экстракция (tree-sitter)
    graphDb = openProjectGraphDb(workspaceRoot)
    orchestrator = new ExtractionOrchestrator(workspaceRoot, graphDb)
    codebaseSearch = CodebaseSearch.withGraphDb(vectorStore, embeddingProvider, graphDb)
  } else {
    // Рабочая область не открыта — in-memory FTS как фолбэк
    fts = createFullTextSearch()
    codebaseSearch = createCodebaseSearch(vectorStore, embeddingProvider, fts)
  }

  return {
    fileIndex,
    repoAnalyzer,
    embeddingProvider,
    vectorStore,
    fts,
    codebaseSearch,
    graphDb,
    orchestrator,
  }
}

// ── Домен: Сервисы ────────────────────────────────────────

export async function createServicesDomain(
  ctx: vscode.ExtensionContext,
  vsCfg: vscode.WorkspaceConfiguration,
  sessionConfig: ISessionConfig,
  gitRunner: IGitRunner,
): Promise<IServicesDeps> {
  const sessionStore = PersistentSessionStore.withFileStorage(ctx.globalStorageUri, sessionConfig.maxSessions)
  await sessionStore.init()

  const permissionManager = new PermissionManager(ctx.globalState)
  await permissionManager.init()
  const autoApproveEnabled = vsCfg.get<boolean>("autoApprove.enabled", false)
  const autoApproveTools = vsCfg.get<string[]>("autoApprove.tools", [])
  permissionManager.setAutoApprove({ enabled: autoApproveEnabled, tools: autoApproveTools, maxCost: 0 })

  const gitService = new GitService(gitRunner)
  const notificationService = new NotificationService(new VscodeWindowService())
  await notificationService.init()

  return { sessionStore, permissionManager, gitService, notificationService }
}

// ── Домен: Снапшоты (чекпоинты) ───────────────────────────

export function createSnapshotDomain(
  workspaceRoot: string | undefined,
  globalStorageUri: vscode.Uri,
  gitService: IGitService,
  config: IAppConfig,
  gitRunner: IGitRunner,
): { snapshotService: ISnapshotService | null; snapshotStore: ISnapshotStore | null } {
  if (!workspaceRoot) return { snapshotService: null, snapshotStore: null }

  const dir = path.join(globalStorageUri.fsPath, "snapshot", workspaceKey(workspaceRoot))
  const snapshotService = new SnapshotService(
    workspaceRoot,
    dir,
    gitRunner,
    config.snapshots,
    () => gitService.findRoot(workspaceRoot),
  )
  const snapshotStore = new SnapshotStore(path.join(dir, "ledger.json"))

  return { snapshotService, snapshotStore }
}

// ── Домен: Инструменты ────────────────────────────────────

export async function createToolsDomain(
  workspaceRoot: string | undefined,
  codebaseSearch: ICodebaseSearch | undefined,
  todoStore: TodoStore,
  gitRunner: IGitRunner,
  questionService: QuestionServiceHolder,
  taskLauncher: SubagentLauncherHolder,
  getWorkDir: () => string | null,
  globalSkillsDir: string | undefined,
  memoryStore: MemoryStore | null,
): Promise<IToolsDeps> {
  const tools = new ToolRegistry()

  const skills = new SkillManager()
  skills.registerMany(BUILT_IN_SKILLS)

  // Пользовательские навыки: глобальный каталог, затем проектный
  // (.neuraltower/skills). Проектные переопределяют глобальные по имени.
  if (globalSkillsDir) {
    for (const s of await loadSkillsFromDir(globalSkillsDir)) skills.register(s)
  }
  if (workspaceRoot) {
    for (const s of await loadSkillsFromDir(path.join(workspaceRoot, ".neuraltower", "skills"))) {
      skills.register(s)
    }
  }

  if (workspaceRoot) {
    tools.register(new ReadFileTool(workspaceRoot))
    tools.register(new WriteFileTool(workspaceRoot))
    tools.register(new EditFileTool(workspaceRoot))
    tools.register(new MultiEditTool(workspaceRoot))
    tools.register(new DeleteFileTool(workspaceRoot))
    tools.register(new CreateDirTool(workspaceRoot))
    tools.register(new MoveFileTool(workspaceRoot))
    tools.register(new GlobTool(workspaceRoot))
    tools.register(new GrepTool(workspaceRoot))
    tools.register(new GitTool(workspaceRoot, gitRunner))
    if (memoryStore) {
      tools.register(new RememberTool(memoryStore))
    }
  }

  tools.register(new BashTool())
  tools.register(new WebFetchTool())
  tools.register(new WebSearchTool())
  tools.register(new LspTool(() => workspaceRoot ?? process.cwd()))
  tools.register(new TodoWriteTool(todoStore))
  tools.register(new QuestionTool(questionService))
  tools.register(new SkillTool(skills))
  tools.register(new TaskTool(taskLauncher, getWorkDir))

  if (codebaseSearch) {
    tools.register(new CodebaseSearchTool(codebaseSearch))
  }

  const mcpManager = new MCPManager()
  try {
    // Подключение MCP обрабатывается здесь; синхронизация происходит в createDeps после готовности инструментов
  } catch (err: unknown) {
    log.warn(`MCP-инициализация не выполнена: ${errorMessage(err)}`)
  }

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
  agentDeps: IAgentFullDependencies,
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
    // Разрешённое имя модели: в авто-режиме — то, что реально уходит в запрос.
    () => backend.resolvedModel().then((m) => m || "авто"),
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
  mcpManager: IMCPManager,
  snapshotService: ISnapshotService | null,
  snapshotStore: ISnapshotStore | null,
  gitService: IGitService,
  getWorkDir: () => string,
  questionService: QuestionServiceHolder,
  memoryStore: MemoryStore | null,
): IUIDepsResult {
  const settingsProvider = new SettingsProvider(extUri, backend, mcpManager)
  const diffViewer = new DiffViewerProvider(extUri)
  const chatProvider = new ChatProvider(
    extUri,
    agent,
    sessionStore,
    notificationService,
    permissionManager,
    settingsProvider,
    backend,
    snapshotService,
    snapshotStore,
    diffViewer,
    gitService,
    getWorkDir,
    questionService,
    memoryStore,
  )

  return { chatProvider, diffViewer, settingsProvider }
}

// ── Домен: Мониторинг ─────────────────────────────────────

export async function createMonitoringDomain(
  backend: IBackend,
  contextManager: ContextManager,
  gitService: IGitService,
  fileIndex: FileIndex,
  orchestrator: ExtractionOrchestrator | null,
  graphDb: NtGraphDb | null,
  codebaseSearch: ICodebaseSearch,
  embeddingProvider: NeuralTowerEmbeddingProvider,
): Promise<IMonitoringDepsResult> {
  const healthMonitor = new BackendHealthMonitor(backend, contextManager)

  const commitMessageService = new CommitMessageService(backend, gitService)
  await commitMessageService.init()

  const autocompleteService = new AutocompleteService(backend)
  await autocompleteService.init()

  const codebaseIndexer = createCodebaseIndexer(
    fileIndex,
    codebaseSearch,
    embeddingProvider,
    orchestrator,
    graphDb,
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

  // Ссылка на чат-провайдер для обновления футера при смене конфигурации
  // (объявляется до бэкенда: колбэк onConfigChange ссылается на неё замыканием).
  let chatProviderRef: ChatProvider | null = null

  const backend = createBackend(config, async (partial) => {
    try {
      if (partial.url !== undefined) await vsCfg.update("neuralTowerUrl", partial.url, true)
      if (partial.model !== undefined) await vsCfg.update("model", partial.model, true)
      if (partial.maxRetries !== undefined) await vsCfg.update("maxRetries", partial.maxRetries, true)
      if (partial.timeoutMs !== undefined) await vsCfg.update("timeoutMs", partial.timeoutMs, true)
    } catch (err: unknown) {
      log.error(`Ошибка сохранения конфигурации: ${errorMessage(err)}`)
    }
    // Обновить модель в футере чата при смене конфигурации: показываем
    // разрешённое имя (в авто-режиме — модель, выбранную с сервера).
    // Адрес тоже влияет на разрешённую модель: другой сервер — другой список.
    if (partial.model !== undefined || partial.url !== undefined) {
      const resolved = await backend.resolvedModel()
      chatProviderRef?.postModelInfo(resolved)
    }
  })

  // Единый процессный слой git: снапшоты (Фаза 5), GitService и git-инструмент (Фаза 6)
  const gitRunner = new GitRunner()

  // ── Сервисы ─────────────────────────────────────────────
  const { sessionStore, permissionManager, gitService, notificationService } =
    await createServicesDomain(ctx, vsCfg, config.session, gitRunner)

  // Паттерн-правила разрешений (настройки)
  permissionManager.setPatternRules(config.permissions)

  // ── Корень рабочей области ──────────────────────────────
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath

  // ── Память проекта ───────────────────────────────────────
  let memoryStore: MemoryStore | null = null
  let initialMemory: IProjectMemory | undefined
  if (workspaceRoot) {
    memoryStore = new MemoryStore(
      path.join(ctx.globalStorageUri.fsPath, "memory", `${workspaceKey(workspaceRoot)}.json`),
    )
    const loaded = await memoryStore.load()
    if (loaded) {
      initialMemory = {
        repo: loaded.repo || path.basename(workspaceRoot),
        languages: loaded.languages,
        commands: loaded.commands,
        notes: loaded.notes,
        conventions: loaded.conventions,
      }
    }
  }

  // ── Снапшоты (чекпоинты) ────────────────────────────────
  const { snapshotService, snapshotStore } = createSnapshotDomain(
    workspaceRoot, ctx.globalStorageUri, gitService, config, gitRunner,
  )
  if (snapshotService) {
    // Раз в сессию: очистка старых объектов и устаревших записей
    snapshotService.cleanup().catch((err: unknown) => {
      log.warn(`Очистка снапшотов не выполнена: ${errorMessage(err)}`)
    })
  }
  if (snapshotStore) {
    snapshotStore.prune(config.snapshots.retentionDays).catch((err: unknown) => {
      log.warn(`Очистка реестра чекпоинтов не выполнена: ${errorMessage(err)}`)
    })
  }

  // ── Инфраструктура поиска ───────────────────────────────
  const { fileIndex, repoAnalyzer, embeddingProvider, codebaseSearch, graphDb, orchestrator } =
    createSearchInfrastructure(backend, config, workspaceRoot)

  // ── Состояние рабочей директории ────────────────────────
  const workDirState = {
    current: workspaceRoot ?? "",
  }

  // ── Инструменты ─────────────────────────────────────────
  const todoStore = new TodoStore()
  const questionService = new QuestionServiceHolder()
  const taskLauncher = new SubagentLauncherHolder()
  const { tools, mcpManager, skills } = await createToolsDomain(
    workspaceRoot,
    codebaseSearch,
    todoStore,
    gitRunner,
    questionService,
    taskLauncher,
    () => workDirState.current,
    path.join(ctx.globalStorageUri.fsPath, "skills"),
    memoryStore,
  )
  // Внешние MCP-серверы: настройки VS Code + .mcp.json (проект переопределяет)
  const vsMcpServers = vsCfg.get<Record<string, IMcpServerEntry>>("mcpServers", {}) ?? {}
  const mcpServerConfigs = await loadMcpServers(vsMcpServers, workspaceRoot ?? null)
  for (const serverConfig of mcpServerConfigs) {
    mcpManager.register(serverConfig)
  }
  await syncMCP(mcpManager, tools)

  // ── Движок MCP ntgraph (граф-инструменты для агента) ────
  if (workspaceRoot) {
    try {
      mcpManager.initNtGraphEngine()
      const ntgraphEngine = mcpManager.getNtGraphEngine()
      if (ntgraphEngine) {
        ntgraphEngine.setProjectPathHint(workspaceRoot)
        await ntgraphEngine.ensureInitialized(workspaceRoot)
        await mcpManager.syncNtGraphWithRegistry(tools)
      }
    } catch (err: unknown) {
      log.warn(`Инициализация движка ntgraph не выполнена: ${errorMessage(err)}`)
    }
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

  // ── Обрезка вывода инструментов ─────────────────────────
  const toolOutputTruncator = new ToolOutputTruncator(
    () => path.join(ctx.globalStorageUri.fsPath, "tool-outputs"),
    () => config.toolOutput.maxChars,
  )

  // Пользовательские режимы (.neuraltower/modes)
  let customModes: IAgentMode[] = []
  if (workspaceRoot) {
    customModes = await loadUserModes(path.join(workspaceRoot, ".neuraltower", "modes"))
  }

  // ── Агент ───────────────────────────────────────────────
  const agentDeps: IAgentFullDependencies = {
    getWorkDir: () => workDirState.current,
    config,
    contextProviderRegistry,
    contextManager,
    fileIndex,
    toolOutputTruncator,
    initialMemory,
    customModes,
    gitService,
    permissionManager,
    mcpManager,
    snapshotService,
  }

  // Субагент получает собственный реестр без task и question:
  // исключены рекурсия запусков и вопросы пользователю.
  const spawnFactory: AgentSpawnFactory = (deps, b, t, s, ts) =>
    new AgentOrchestrator(b, filterSubagentTools(t), s, deps, null, ts)

  const { agent, subagentRunner } = createAgentDomain(
    backend, tools, skills, agentDeps, spawnFactory, todoStore,
  )

  // Пускатель субагентов для инструмента task
  taskLauncher.setImpl({
    launch: async (cfg, signal) => {
      let handle: SubagentHandle
      try {
        handle = await subagentRunner.spawn(
          {
            name: cfg.name,
            task:
              "Вы — субагент, запущенный основным агентом для отдельной задачи. " +
              "Работайте автономно, не задавайте вопросов пользователю. " +
              "Ваше финальное сообщение — ответ на задачу: полное и краткое.\n\n" +
              `Задача: ${cfg.task}`,
            mode: cfg.mode,
            workDir: cfg.workDir,
            maxIterations: 15,
            timeoutMs: 300_000,
          },
          undefined,
          undefined,
        )
      } catch (err: unknown) {
        return { ok: false, output: "", error: errorMessage(err) }
      }
      if (signal) {
        signal.addEventListener("abort", () => handle.cancel(), { once: true })
      }
      const result = await handle.wait()
      if (signal?.aborted || result.status === "cancelled") {
        return { ok: false, output: "", error: "Отменено" }
      }
      if (result.status !== "completed") {
        return { ok: false, output: "", error: result.error ?? result.status }
      }
      return { ok: true, output: result.output }
    },
  })

  // ── Интерфейс ───────────────────────────────────────────
  const { chatProvider, diffViewer, settingsProvider } = createUIDomain(
    ctx.extensionUri,
    agent,
    sessionStore,
    notificationService,
    permissionManager,
    backend,
    mcpManager,
    snapshotService,
    snapshotStore,
    gitService,
    () => workDirState.current,
    questionService,
    memoryStore,
  )
  chatProviderRef = chatProvider
  // Статусы агента в UI (например, «Создаю план…»)
  agentDeps.onAgentStatus = (text) => chatProvider.postAgentStatus(text)

  // ── Мониторинг ──────────────────────────────────────────
  const { healthMonitor, commitMessageService, autocompleteService, codebaseIndexer, indexingStatusBar, telemetry } =
    await createMonitoringDomain(
      backend, contextManager, gitService, fileIndex, orchestrator, graphDb, codebaseSearch, embeddingProvider,
    )

  // Связать монитор здоровья с чат-провайдером для ленивой инициализации
  chatProvider.setHealthMonitor?.(healthMonitor)

  // Разрешить бэкенду возобновлять монитор здоровья при изменении конфигурации
  if (typeof (backend as NeuralTowerBackend).setResumeCallback === "function") {
    ;(backend as NeuralTowerBackend).setResumeCallback(() => healthMonitor.resume())
  }

  // ── Постинициализация: определение рабочей директории ──
  if (vscode.workspace.workspaceFolders?.[0]) {
    workDirState.current = vscode.workspace.workspaceFolders[0].uri.fsPath
    await gitService.findRoot(vscode.workspace.workspaceFolders[0].uri.fsPath)
  }

  // Построение файлового индекса и индексация кодовой базы выполняются в фоне
  // (см. Extension.ts, initInBackground)

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
    snapshotService,
    snapshotStore,
    config,
    agentDeps,
    fileIndex,
    codebaseSearch,
    codebaseIndexer,
    indexingStatusBar,
    telemetry,
    graphDb,
    setWorkDir: (dir: string) => { workDirState.current = dir },
    ...options.overrides,
  }
}
