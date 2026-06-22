export type { IBackend, BackendConfig, ChatMessage } from "./IBackend"
export type { IProvider } from "./IProvider"
export type { IAgentOrchestrator } from "./IAgent"
export { App } from "./App"
export { ContextManager } from "./ContextManager"
export type {
  ContextSnapshot,
  PreparedContext,
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
} from "./ContextSources.vscode"
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
  ContextItem,
  ProviderType,
  ProviderDescription,
  SubmenuItem,
  ContextProvider,
  MCPToolListFn,
  RepoSummary,
  FileIndexStats,
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
  AppConfig,
  AgentConfig,
  ContextConfig,
  CompactorConfig,
  SessionConfig,
  AutocompleteConfig,
} from "./Config"
