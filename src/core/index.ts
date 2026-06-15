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
} from "./ContextProvider"
export type {
  ContextItem,
  ProviderType,
  ProviderDescription,
  SubmenuItem,
  ContextProvider,
  CodeSearchEntry,
  MCPToolListFn,
} from "./ContextProvider"
export { ContextProviderRegistry } from "./ContextProvider"
