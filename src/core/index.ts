export type { IBackend, IBackendConfig, IChatMessage } from "./IBackend"
export type { IProvider } from "./IProvider"
export type { IAgentOrchestrator } from "./IAgent"
export { App } from "./App"
export { ContextManager } from "./ContextManager"
export type {
  IContextSnapshot,
  IPreparedContext,
} from "./ContextManager"
export {
  AgentMismatchError,
  AgentReplacementBlockedError,
} from "./Errors"
export {
  NeuralTowerError,
  BackendError,
  ConnectionError,
  TimeoutError,
  ToolError,
  ValidationError,
  ExecutionError,
  ContextError,
  PlanError,
  AgentError,
  AbortError,
} from "./Errors"
export {
  makeCurrentFileProvider,
  makeOpenFilesProvider,
  makeProblemsProvider,
  makeClipboardProvider,
  makeDebuggerProvider,
  makeTerminalProvider,
  makeOSProvider,
} from "./ContextSourcesVscode"
export {
  makeUrlProvider,
  makeWebSearchProvider,
   makeFileProvider,
  makeTreeProvider,
  makeRepoMapProvider,
  makeRulesProvider,
  makeMCPProvider,
  makeLspProvider,
  loadRulesFiles,
} from "./providers/context"
export type {
  IContextItem,
  ProviderType,
  IProviderDescription,
  ISubmenuItem,
  IContextProvider,
  MCPToolListFn,
  IRepoSummary,
  IFileIndexStats,
} from "./providers/context"
export { ContextProviderRegistry } from "./providers/context"
export { TOKENS_PER_CHAR, estimateTokens } from "./TokenUtils"
export {
  loadAppConfig,
  loadDefaultBackendConfig,
  loadDefaultAgentConfig,
  loadDefaultContextConfig,
  loadDefaultCompactorConfig,
  loadDefaultSessionConfig,
  loadDefaultAutocompleteConfig,
} from "./Config"
export type {
  IAppConfig,
  IAgentConfig,
  IContextConfig,
  ICompactorConfig,
  ISessionConfig,
  IAutocompleteConfig,
} from "./Config"
export {
  VscodeCommandExecutor,
  VscodeWorkspaceConfiguration,
  VscodeDocumentService,
  VscodeWindowService,
} from "./VscodeApi"
export type {
  ICommandExecutor,
  IWorkspaceConfiguration,
  IWorkspaceConfigurationSection,
  IDocumentService,
  IWindowService,
} from "./VscodeApi"
