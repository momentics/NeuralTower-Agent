import * as vscode from "vscode"

import type { App } from "../core/App"
import type { IAgentOrchestrator } from "../core/IAgent"
import type { IProvider } from "../core/IProvider"
import type { TodoStore } from "../agent/TodoStore"
import type { IBackend } from "../core/IBackend"
import type { GitService } from "../services/git/GitService"
import type { DiffViewerProvider } from "../providers/DiffViewerProvider"
import type { CommitMessageService } from "../services/commit-message/CommitMessageService"
import type { CodebaseIndexer } from "../services/indexing/CodebaseIndexer"
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
  gitService: GitService
  diffViewer: DiffViewerProvider
  commitMessageService: CommitMessageService
  extUri: vscode.Uri
  codebaseIndexer: CodebaseIndexer
}

/** Зарегистрировать все команды расширения. */
export function registerAllCommands(deps: CommandDeps): void {
  registerEditorCommands(deps.app, deps.agent, deps.gitService, deps.diffViewer)
  registerGitCommands(deps.app, deps.commitMessageService)
  registerChatCommands(
    deps.app,
    deps.chatProvider,
    deps.todoStore,
    deps.agent,
    deps.backend,
    deps.gitService,
    deps.diffViewer,
    deps.extUri,
  )
  registerCodeActionCommands(deps.app, deps.agent, deps.gitService, deps.diffViewer)

  deps.app.registerCommand("neuralTowerAgent.reindex", async () => {
    const folder = vscode.workspace.workspaceFolders?.[0]
    if (!folder) {
      vscode.window.showWarningMessage("Рабочая область не открыта")
      return
    }
    await deps.codebaseIndexer.reindex(folder.uri.fsPath)
  })
}
