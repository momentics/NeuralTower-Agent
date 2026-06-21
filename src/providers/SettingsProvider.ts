import * as vscode from "vscode"
import * as crypto from "crypto"
import type { IBackend } from "../core/IBackend"
import type { SettingsToExt, ExtToSettings } from "../shared/messages"

/**
 * Интерфейс провайдера настроек.
 */
export interface ISettingsProvider {
  show(): void
  dispose(): void
}

export class SettingsProvider implements ISettingsProvider {
  private _panel: vscode.WebviewPanel | undefined
  private disposables: vscode.Disposable[] = []

  constructor(
    private readonly extUri: vscode.Uri,
    private readonly backend: IBackend,
  ) {}

  /**
   * Открыть панель настроек. Если панель уже открыта — показать её.
   */
  show(): void {
    if (this._panel) {
      this._panel.reveal(vscode.ViewColumn.Two)
      return
    }
    this._panel = vscode.window.createWebviewPanel(
      "neuralTowerAgent.settings",
      "NeuralTower Agent — Настройки",
      vscode.ViewColumn.Two,
      { enableScripts: true, localResourceRoots: [this.extUri] },
    )
    this._panel.webview.html = this.html()
    this.setupHandler()
    this.loadData()
    this._panel.onDidDispose(() => { this._panel = undefined })
  }

  /**
   * Освободить ресурсы.
   */
  dispose(): void {
    for (const d of this.disposables) {
      d.dispose()
    }
    this.disposables = []
    if (this._panel) {
      this._panel.dispose()
      this._panel = undefined
    }
  }

  private getWebview(): vscode.Webview {
    if (!this._panel) {
      throw new Error("Панель не инициализирована")
    }
    return this._panel.webview
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
    const disposable = this.getWebview().onDidReceiveMessage(async (msg: SettingsToExt) => {
      switch (msg.type) {
        case "settingsSave": {
          const url = typeof msg.url === "string" && msg.url.trim() ? msg.url.trim() : undefined
          const model = typeof msg.model === "string" && msg.model.trim() ? msg.model.trim() : undefined
          if (!url && !model) {
            this.getWebview().postMessage({
              type: "settingsTestResult",
              success: false,
              message: "Укажите адрес сервера или модель",
            } as ExtToSettings)
            break
          }
          const config: Record<string, unknown> = {}
          if (url) config.url = url
          if (model) config.model = model
          await this.backend.updateConfig(config)
          if (typeof msg.maxRetries === "number" && msg.maxRetries >= 0 && msg.maxRetries <= 10) {
            await this.backend.updateConfig({ maxRetries: msg.maxRetries })
          }
          if (typeof msg.timeoutMs === "number" && msg.timeoutMs >= 1000) {
            await this.backend.updateConfig({ timeoutMs: msg.timeoutMs })
          }
          if (typeof msg.autoApprove === "boolean") {
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
    this.disposables.push(disposable)
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
