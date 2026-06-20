import * as vscode from "vscode"
import type { App } from "../core/App"
import { sendAgentQuery, detectLanguageDisplay } from "./utils"
import type { IAgentOrchestrator } from "../core/IAgent"
import type { IGitService } from "../services/git/GitService"
import type { DiffViewerProvider } from "../providers/DiffViewerProvider"

export interface EditorCommandAction {
  name: string
  noSelectionMessage: string
  promptTemplate: (text: string, lang: string, filePath: string) => string
  requireSelection: boolean
}

/** Создать и зарегистрировать команду редактора для действия (refactor, explain и т.д.). */
export function createEditorCommand(
  app: App,
  action: EditorCommandAction,
  agent: IAgentOrchestrator,
  gitService: IGitService,
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

    const lang = detectLanguageDisplay(filePath)
    const prompt = action.promptTemplate(text, lang, filePath)
    await sendAgentQuery(prompt, filePath, agent, gitService, diffViewer)
  })
}
