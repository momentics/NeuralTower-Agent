import * as vscode from "vscode"
import type { App } from "../core/App"
import type { IAgentOrchestrator } from "../core/IAgent"
import type { IGitService } from "../services/git/GitService"
import type { IDiffViewerProvider } from "../providers/DiffViewerProvider"
import { createEditorCommand } from "./index"
import { EDITOR_ACTIONS } from "./ActionDefinitions"

export function registerEditorCommands(
  app: App,
  agent: IAgentOrchestrator,
  gitService: IGitService,
  diffViewer: IDiffViewerProvider | undefined,
  outputChannel: vscode.OutputChannel,
): void {
  for (const action of EDITOR_ACTIONS) {
    createEditorCommand(app, {
      name: action.name,
      noSelectionMessage: action.noSelectionMessage,
      requireSelection: action.requireSelection,
      promptTemplate: action.editorPromptTemplate,
    }, agent, gitService, diffViewer, outputChannel)
  }
}
