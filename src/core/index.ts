export type { IBackend, BackendConfig, ChatMessage } from "./IBackend"
export type { IProvider } from "./IProvider"
export type { IAgentOrchestrator } from "./IAgent"
export { App } from "./App"
export { ContextManager } from "./ContextManager"
export type {
  ContextSource,
  ContextSnapshot,
  PreparedContext,
  SourceReconcileResult,
  AgentMismatchError,
  AgentReplacementBlockedError,
} from "./ContextSource"
export {
  makeCurrentFileSource,
  makeOpenFilesSource,
  makeProblemsSource,
  makeClipboardSource,
  makeDebuggerSource,
  makeTerminalSource,
  makeOSSource,
  makeRulesSource,
  makeRepoMapSource,
} from "./ContextSources.vscode"
export {
  makeUrlProvider,
  makeWebSearchProvider,
  makeActiveFileProblemsProvider,
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
