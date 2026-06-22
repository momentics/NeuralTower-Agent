import * as vscode from "vscode"

import type { App } from "../core/App"
import type { IAgentOrchestrator } from "../core/IAgent"
import type { IProvider } from "../core/IProvider"
import type { ITodoStore } from "../agent/TodoStore"
import type { IGitService } from "../services/git/GitService"
import type { IDiffViewerProvider } from "../providers/DiffViewerProvider"
import type { ICommitMessageService } from "../services/commit-message/CommitMessageService"
import type { ICodebaseIndexer } from "../services/indexing/CodebaseIndexer"
import type { ISettingsProvider } from "../providers/SettingsProvider"
import { registerEditorCommands } from "./EditorCommands"
import { registerGitCommands } from "./GitCommands"
import { registerChatCommands } from "./ChatCommands"
import { registerCodeActionCommands } from "./CodeActionCommands"

/** Зависимости для редакторных команд (ISP: только нужные поля). */
export interface IEditorCommandDeps {
  app: App
  agent: IAgentOrchestrator
  gitService: IGitService
  diffViewer: IDiffViewerProvider | undefined
  outputChannel: vscode.OutputChannel
}

/** Зависимости для команд чата (ISP: только нужные поля). */
export interface IChatCommandDeps {
  app: App
  chatProvider: IProvider
  todoStore: ITodoStore
  agent: IAgentOrchestrator
  gitService: IGitService | undefined
  diffViewer: IDiffViewerProvider | undefined
  settingsProvider: ISettingsProvider
}

/** Зависимости для Git-команд (ISP: только нужные поля). */
export interface IGitCommandDeps {
  app: App
  commitMessageService: ICommitMessageService
}

/** Зависимости для команды реиндексации (ISP: только нужные поля). */
export interface IIndexCommandDeps {
  app: App
  codebaseIndexer: ICodebaseIndexer
}

/** Зарегистрировать все команды расширения. */
export function registerAllCommands(
  editorDeps: IEditorCommandDeps,
  chatDeps: IChatCommandDeps,
  gitDeps: IGitCommandDeps,
  indexDeps: IIndexCommandDeps,
): void {
  registerEditorCommands(editorDeps.app, editorDeps.agent, editorDeps.gitService, editorDeps.diffViewer, editorDeps.outputChannel)
  registerGitCommands(gitDeps.app, gitDeps.commitMessageService)
  registerChatCommands(
    chatDeps.app,
    chatDeps.chatProvider,
    chatDeps.todoStore,
    chatDeps.agent,
    chatDeps.gitService,
    chatDeps.diffViewer,
    chatDeps.settingsProvider,
  )
  registerCodeActionCommands(editorDeps.app, editorDeps.agent, editorDeps.gitService, editorDeps.diffViewer, editorDeps.outputChannel)

  indexDeps.app.registerCommand("neuralTowerAgent.reindex", async () => {
    const folder = vscode.workspace.workspaceFolders?.[0]
    if (!folder) {
      vscode.window.showWarningMessage("Рабочая область не открыта")
      return
    }
    await indexDeps.codebaseIndexer.reindex(folder.uri.fsPath)
  })
}
