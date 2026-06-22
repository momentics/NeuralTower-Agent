import * as vscode from "vscode"

import type { App } from "../core/App"
import type { IAgentOrchestrator } from "../core/IAgent"
import type { IProvider } from "../core/IProvider"
import type { ITodoStore } from "../agent/TodoStore"
import type { IBackend } from "../core/IBackend"
import type { IGitService } from "../services/git/GitService"
import type { IDiffViewerProvider } from "../providers/DiffViewerProvider"
import type { ICommitMessageService } from "../services/commit-message/CommitMessageService"
import type { ICodebaseIndexer } from "../services/indexing/CodebaseIndexer"
import type { ISettingsProvider } from "../providers/SettingsProvider"
import { registerEditorCommands } from "./EditorCommands"
import { registerGitCommands } from "./GitCommands"
import { registerChatCommands } from "./ChatCommands"
import { registerCodeActionCommands } from "./CodeActionCommands"

export interface ICommandDeps {
  app: App
  agent: IAgentOrchestrator
  chatProvider: IProvider
  todoStore: ITodoStore
  backend: IBackend
  gitService: IGitService
  diffViewer: IDiffViewerProvider
  settingsProvider: ISettingsProvider
  commitMessageService: ICommitMessageService
  extUri: vscode.Uri
  codebaseIndexer: ICodebaseIndexer
  outputChannel: vscode.OutputChannel
}

/** Зарегистрировать все команды расширения. */
export function registerAllCommands(deps: ICommandDeps): void {
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
