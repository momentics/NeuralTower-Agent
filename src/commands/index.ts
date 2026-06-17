import * as vscode from "vscode"
import type { App } from "../core/App"
import { sendAgentQuery, getLang } from "./utils"
import type { IAgentOrchestrator } from "../core/IAgent"
import type { GitService } from "../services/git/GitService"
import type { DiffViewerProvider } from "../providers/DiffViewerProvider"

export interface EditorCommandAction {
  name: string
  noSelectionMessage: string
  promptTemplate: (text: string, lang: string, filePath: string) => string
  requireSelection: boolean
}

export function createEditorCommand(
  app: App,
  action: EditorCommandAction,
  agent: IAgentOrchestrator,
  gitService: GitService,
  diffViewer: DiffViewerProvider | undefined,
): void {
  app.registerCommand(`neuralTowerAgent.${action.name}`, async () => {
    const editor = vscode.window.activeTextEditor
    if (!editor) {
      vscode.window.showInformationMessage("Активный редактор отсутствует")
      return
    }
    const selection = editor.selection
    const text = editor.document.getText(selection)
    const filePath = editor.document.uri.fsPath

    if (action.requireSelection && !text.trim()) {
      vscode.window.showInformationMessage(action.noSelectionMessage)
      return
    }

    const lang = getLang(filePath)
    const prompt = action.promptTemplate(text, lang, filePath)
    await sendAgentQuery(prompt, filePath, agent, gitService, diffViewer)
  })
}
