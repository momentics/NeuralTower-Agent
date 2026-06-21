import * as vscode from "vscode"
import type { App } from "../core/App"
import type { ICommitMessageService } from "../services/commit-message/CommitMessageService"

const COMMIT_MSG_TRUNCATE = 50

/** Зарегистрировать Git-команды: генерация сообщения коммита. */
export function registerGitCommands(
  app: App,
  commitMessageService: ICommitMessageService,
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
        vscode.window.showInformationMessage(`Сообщение коммита скопировано: "${confirmed.slice(0, COMMIT_MSG_TRUNCATE)}${confirmed.length > COMMIT_MSG_TRUNCATE ? "..." : ""}"`)
      }
    } else {
      vscode.window.showInformationMessage("Нет добавленных изменений")
    }
  })
}
