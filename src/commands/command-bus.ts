import * as vscode from "vscode"

import type { App } from "../core/App"
import type { IAgentOrchestrator } from "../core/IAgent"
import type { IProvider } from "../core/IProvider"
import type { TodoStore } from "../agent/TodoStore"
import type { IBackend } from "../core/IBackend"
import type { IGitService } from "../services/git/GitService"
import type { IDiffViewerProvider } from "../providers/DiffViewerProvider"
import type { CommitMessageService } from "../services/commit-message/CommitMessageService"
import type { CodebaseIndexer } from "../services/indexing/CodebaseIndexer"
import type { SettingsProvider } from "../providers/SettingsProvider"
import { registerEditorCommands } from "./editor-commands"
import { registerGitCommands } from "./git-commands"
import { registerChatCommands } from "./chat-commands"
import { registerCodeActionCommands } from "./code-action-commands"

export interface CommandDeps {
  app: App
  agent: IAgentOrchestrator
  chatProvider: IProvider
  todoStore: TodoStore
  backend: IBackend
  gitService: IGitService
  diffViewer: IDiffViewerProvider
  settingsProvider: SettingsProvider
  commitMessageService: CommitMessageService
  extUri: vscode.Uri
  codebaseIndexer: CodebaseIndexer
  outputChannel: vscode.OutputChannel
}

/** Зарегистрировать все команды расширения. */
export function registerAllCommands(deps: CommandDeps): void {
  registerEditorCommands(deps.app, deps.agent, deps.gitService, deps.diffViewer, deps.outputChannel)
  registerGitCommands(deps.app, deps.commitMessageService)
  registerChatCommands(
    deps.app,
    deps.chatProvider,
    deps.todoStore,
    deps.agent,
    deps.backend,
    deps.gitService,
    deps.diffViewer,
    deps.settingsProvider,
    deps.extUri,
    deps.outputChannel,
  )
  registerCodeActionCommands(deps.app, deps.agent, deps.gitService, deps.diffViewer, deps.outputChannel)

  deps.app.registerCommand("neuralTowerAgent.reindex", async () => {
    const folder = vscode.workspace.workspaceFolders?.[0]
    if (!folder) {
      vscode.window.showWarningMessage("Рабочая область не открыта")
      return
    }
    await deps.codebaseIndexer.reindex(folder.uri.fsPath)
  })
}
