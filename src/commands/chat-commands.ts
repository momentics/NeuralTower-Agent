import * as vscode from "vscode"
import type { App } from "../core/App"
import type { IProvider } from "../core/IProvider"
import type { IAgentOrchestrator } from "../core/IAgent"
import type { TodoStore } from "../agent/TodoStore"
import type { IBackend } from "../core/IBackend"
import type { GitService } from "../services/git/GitService"
import type { DiffViewerProvider } from "../providers/DiffViewerProvider"
import { SettingsProvider } from "../providers/SettingsProvider"

export function registerChatCommands(
  app: App,
  chatProvider: IProvider,
  todoStore: TodoStore,
  agent: IAgentOrchestrator,
  backend: IBackend,
  gitService: GitService | undefined,
  diffViewer: DiffViewerProvider | undefined,
  extUri: vscode.Uri,
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
    SettingsProvider.render(extUri, backend)
  })

  app.registerCommand("neuralTowerAgent.session.list", () => {
    vscode.commands.executeCommand("neuralTowerAgent.chat.focus")
  })

  app.registerCommand("neuralTowerAgent.openDiffViewer", async () => {
    if (!vscode.workspace.workspaceFolders?.[0] || !gitService) return
    const dir = vscode.workspace.workspaceFolders[0].uri.fsPath
    const diff = await gitService.getDiff(dir)
    diffViewer?.openPanel(diff)
  })
}
