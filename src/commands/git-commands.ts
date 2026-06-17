import * as vscode from "vscode"
import type { App } from "../core/App"
import type { CommitMessageService } from "../services/commit-message/CommitMessageService"

export function registerGitCommands(
  app: App,
  commitMessageService: CommitMessageService,
): void {
  app.registerCommand("neuralTowerAgent.generateCommitMessage", async () => {
    if (!vscode.workspace.workspaceFolders?.[0]) return
    const dir = vscode.workspace.workspaceFolders[0].uri.fsPath
    const msg = await commitMessageService.generate(dir)
    if (msg) {
      const confirmed = await vscode.window.showInputBox({
        placeHolder: "Сообщение коммита",
        value: msg,
        prompt: "Сгенерировать сообщение коммита из добавленных изменений",
      })
      if (confirmed) {
        vscode.env.clipboard.writeText(confirmed)
        vscode.window.showInformationMessage(`Сообщение коммита скопировано: "${confirmed.slice(0, 50)}${confirmed.length > 50 ? "..." : ""}"`)
      }
    } else {
      vscode.window.showInformationMessage("Нет добавленных изменений")
    }
  })
}
