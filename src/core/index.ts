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
} from "./ContextSource"
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
} from "./errors"
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
  makeCodeProvider,
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
  CodeSearchEntry,
  MCPToolListFn,
  RepoSummary,
  FileIndexStats,
} from "./providers/context"
export { ContextProviderRegistry } from "./providers/context"
export { TOKENS_PER_CHAR, estimateTokens } from "./token-utils"
export {
  loadAppConfig,
  loadDefaultBackendConfig,
  loadDefaultAgentConfig,
  loadDefaultContextConfig,
  loadDefaultCompactorConfig,
  loadDefaultSessionConfig,
} from "./config"
export type {
  AppConfig,
  AgentConfig,
  ContextConfig,
  CompactorConfig,
  SessionConfig,
} from "./config"
