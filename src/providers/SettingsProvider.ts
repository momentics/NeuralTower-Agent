import * as vscode from "vscode"
import * as crypto from "crypto"
import type { IBackend } from "../core/IBackend"
import type { SettingsToExt, ExtToSettings } from "../shared/messages"

export class SettingsProvider {
  private static current: SettingsProvider | undefined
  private panel: vscode.WebviewPanel | undefined

  constructor(
    private readonly extUri: vscode.Uri,
    private readonly backend: IBackend,
  ) {}

  static render(extUri: vscode.Uri, backend: IBackend): void {
    if (SettingsProvider.current?.panel) {
      SettingsProvider.current.panel.reveal(vscode.ViewColumn.Two)
      return
    }
    const inst = new SettingsProvider(extUri, backend)
    inst.panel = vscode.window.createWebviewPanel(
      "neuralTowerAgent.settings",
      "NeuralTower Agent — Настройки",
      vscode.ViewColumn.Two,
      { enableScripts: true, localResourceRoots: [extUri] },
    )
    inst.panel.webview.html = inst.html()
    inst.setupHandler()
    inst.loadData()
    inst.panel.onDidDispose(() => { SettingsProvider.current = undefined })
    SettingsProvider.current = inst
  }

  private getWebview(): vscode.Webview {
    if (!this.panel) {
      throw new Error("Панель не инициализирована")
    }
    return this.panel.webview
  }

  private async loadData(): Promise<void> {
    const cfg = await this.backend.getConfig()
    const models = await this.backend.listModels().catch(() => [])
    const vsCfg = vscode.workspace.getConfiguration("neuralTowerAgent")
    const autoApprove = vsCfg.get<boolean>("autoApprove.enabled", false)
    this.getWebview().postMessage({
      type: "settingsData",
      config: { ...cfg, autoApprove },
      models,
    } as ExtToSettings)
  }

  private setupHandler(): void {
    this.getWebview().onDidReceiveMessage(async (msg: SettingsToExt) => {
      switch (msg.type) {
        case "settingsSave": {
          await this.backend.updateConfig({ url: msg.url, model: msg.model })
          if (msg.maxRetries !== undefined) await this.backend.updateConfig({ maxRetries: msg.maxRetries })
          if (msg.timeoutMs !== undefined) await this.backend.updateConfig({ timeoutMs: msg.timeoutMs })
          if (msg.autoApprove !== undefined) {
            await vscode.workspace.getConfiguration("neuralTowerAgent").update(
              "autoApprove.enabled",
              msg.autoApprove,
              true,
            )
          }
          this.getWebview().postMessage({ type: "settingsSaved" } as ExtToSettings)
          vscode.window.showInformationMessage("Настройки сохранены")
          break
        }
        case "settingsTest":
          const ok = await this.backend.healthCheck()
          this.getWebview().postMessage({
            type: "settingsTestResult",
            success: ok,
            message: ok ? "Подключено" : "Не удалось подключиться",
          } as ExtToSettings)
          break
      }
    })
  }

  private html(): string {
    const nonce = crypto.randomBytes(16).toString("hex")
    const css = this.getWebview().asWebviewUri(
      vscode.Uri.joinPath(this.extUri, "resources", "settings.css"),
    )
    const js = this.getWebview().asWebviewUri(
      vscode.Uri.joinPath(this.extUri, "resources", "settings.js"),
    )

    return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${this.getWebview().cspSource};
             script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${css}">
</head>
<body>
<div class="container">
  <h1>Настройки</h1>
  <section>
    <h2>Бэкенд</h2>
    <label>Адрес сервера <input id="url" type="text"></label>
    <label>Модель <select id="model"><option value="">(нет)</option></select></label>
    <label>Макс. повторов <input id="maxRetries" type="number" value="3" min="0" max="10"></label>
    <label>Таймаут (мс) <input id="timeoutMs" type="number" value="60000" min="1000"></label>
  </section>
  <section>
    <h2>Разрешения</h2>
    <label><input type="checkbox" id="autoApprove"> Автоодобрение небезопасных инструментов</label>
  </section>
  <section>
    <h2>Действия</h2>
    <div class="actions">
      <button id="btn-test">Проверить соединение</button>
      <button id="btn-save">Сохранить</button>
    </div>
    <p id="status"></p>
  </section>
</div>
<script nonce="${nonce}" src="${js}"></script>
</body>
</html>`
  }
}
