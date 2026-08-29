import * as vscode from "vscode"
import type { App } from "../core/App"
import type { IProvider } from "../core/IProvider"
import type { IAgentOrchestrator } from "../core/IAgent"
import type { ITodoStore } from "../agent/TodoStore"
import type { IGitService } from "../services/git/GitService"
import type { IDiffViewerProvider } from "../providers/DiffViewerProvider"
import type { ISettingsProvider } from "../providers/SettingsProvider"

/** Зарегистрировать команды чата: новый чат, фокус ввода, настройки, список сессий, diff-viewer. */
export function registerChatCommands(
  app: App,
  chatProvider: IProvider,
  todoStore: ITodoStore,
  agent: IAgentOrchestrator,
  gitService: IGitService | undefined,
  diffViewer: IDiffViewerProvider | undefined,
  settingsProvider: ISettingsProvider,
): void {
  app.registerCommand("neuralTowerAgent.newChat", () => {
    chatProvider.broadcastNewChat?.()
    todoStore.clear()
    agent.clearPlan()
    agent.resetSession()
  })

  app.registerCommand("neuralTowerAgent.focusChatInput", () => {
    vscode.commands.executeCommand("neuralTowerAgent.chat.focus")
  })

  app.registerCommand("neuralTowerAgent.settings", () => {
    settingsProvider.show()
  })

  app.registerCommand("neuralTowerAgent.session.list", () => {
    vscode.commands.executeCommand("neuralTowerAgent.chat.focus")
  })

  app.registerCommand("neuralTowerAgent.openDiffViewer", async () => {
    if (!vscode.workspace.workspaceFolders?.[0] || !gitService) return
    const dir = vscode.workspace.workspaceFolders[0].uri.fsPath
    const diff = await gitService.getDiff(dir)
    diffViewer?.openPanel({ type: "workspace", diff })
  })
}
