import type { App } from "../core/App"
import type { IAgentOrchestrator } from "../core/IAgent"
import type { GitService } from "../services/git/GitService"
import type { DiffViewerProvider } from "../providers/DiffViewerProvider"
import { createEditorCommand } from "./index"
import { EDITOR_ACTIONS } from "./action-definitions"

export function registerEditorCommands(
  app: App,
  agent: IAgentOrchestrator,
  gitService: GitService,
  diffViewer: DiffViewerProvider | undefined,
): void {
  for (const action of EDITOR_ACTIONS) {
    createEditorCommand(app, {
      name: action.name,
      noSelectionMessage: action.noSelectionMessage,
      requireSelection: action.requireSelection,
      promptTemplate: action.editorPromptTemplate,
    }, agent, gitService, diffViewer)
  }
}
