import * as vscode from "vscode"
import type { IBackend } from "../core/IBackend"
import type { IMCPManager } from "../mcp/MCPManager"
import type { SettingsToExt, ExtToSettings } from "../shared/Messages"
import { UI_MIN_BACKEND_TIMEOUT_MS, UI_SETTINGS_MODELS_TIMEOUT_MS, loadDefaultAgentConfig, loadDefaultSessionConfig } from "../core/Config"
import { buildWebviewHtml } from "../shared/WebviewBuilder"
import { errorMessage } from "../core/Errors"
import { createDomainLogger } from "../core/Logger"

const log = createDomainLogger("Settings")

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
    private readonly mcpManager: IMCPManager | null = null,
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
    this.loadData().catch((err: unknown) => {
      log.error(`Ошибка загрузки настроек: ${errorMessage(err)}`)
    })
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
    const vsCfg = vscode.workspace.getConfiguration("neuralTowerAgent")
    const autoApprove = vsCfg.get<boolean>("autoApprove.enabled", false)
    const maxIterations = vsCfg.get<number>("agent.maxIterations", loadDefaultAgentConfig().maxIterations)
    const maxSessions = vsCfg.get<number>("maxSessions", loadDefaultSessionConfig().maxSessions)
    const notificationsEnabled = vsCfg.get<boolean>("notifications.enabled", true)
    const notifyAgentDone = vsCfg.get<boolean>("notifications.agentCompletion", true)
    const notifyPermissions = vsCfg.get<boolean>("notifications.permissionRequests", true)
    const models = await this.loadModels()
    const mcpServers = this.mcpManager
      ? this.mcpManager.listServers().map((c) => {
          const tools = this.mcpManager!.getToolsByServer().find((s) => s.server === c.name)?.tools ?? []
          return {
            name: c.name,
            command: c.command,
            ready: this.mcpManager!.getReadyServers().includes(c.name),
            toolCount: tools.length,
          }
        })
      : []
    this.getWebview().postMessage({
      type: "settingsData",
      config: {
        ...cfg,
        autoApprove,
        maxIterations,
        maxSessions,
        notificationsEnabled,
        notifyAgentDone,
        notifyPermissions,
        mcpServers,
      },
      models,
    } as ExtToSettings)
  }

  /**
   * Загрузить список моделей, не блокируя панель: при недоступном сервере
   * listModels повторяет запросы до таймаута бэкенда (несколько минут).
   */
  private async loadModels(): Promise<string[]> {
    return Promise.race([
      this.backend.listModels().catch(() => [] as string[]),
      new Promise<string[]>((resolve) => setTimeout(() => resolve([]), UI_SETTINGS_MODELS_TIMEOUT_MS)),
    ])
  }

  private setupHandler(): void {
    const disposable = this.getWebview().onDidReceiveMessage(async (msg: SettingsToExt) => {
      try {
        switch (msg.type) {
          case "settingsSave": {
            const vsCfg = vscode.workspace.getConfiguration("neuralTowerAgent")
            const url = typeof msg.url === "string" ? msg.url.trim() : ""
            const model = typeof msg.model === "string" ? msg.model.trim() : ""
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
            // Модель отправляем всегда: пустое значение — осмысленное
            // состояние (автовыбор), позволяющее вернуться к нему
            // из явного имени.
            config.model = model
            await this.backend.updateConfig(config)
            if (typeof msg.maxRetries === "number" && msg.maxRetries >= 0 && msg.maxRetries <= 10) {
              await this.backend.updateConfig({ maxRetries: msg.maxRetries })
            }
            if (typeof msg.timeoutMs === "number" && msg.timeoutMs >= UI_MIN_BACKEND_TIMEOUT_MS) {
              await this.backend.updateConfig({ timeoutMs: msg.timeoutMs })
            }
            if (typeof msg.autoApprove === "boolean") {
              await vsCfg.update("autoApprove.enabled", msg.autoApprove, true)
            }
            if (typeof msg.maxIterations === "number" && msg.maxIterations >= 1 && msg.maxIterations <= 100) {
              await vsCfg.update("agent.maxIterations", msg.maxIterations, true)
            }
            if (typeof msg.maxSessions === "number" && msg.maxSessions >= 5 && msg.maxSessions <= 200) {
              await vsCfg.update("maxSessions", msg.maxSessions, true)
            }
            if (typeof msg.notificationsEnabled === "boolean") {
              await vsCfg.update("notifications.enabled", msg.notificationsEnabled, true)
            }
            if (typeof msg.notifyAgentDone === "boolean") {
              await vsCfg.update("notifications.agentCompletion", msg.notifyAgentDone, true)
            }
            if (typeof msg.notifyPermissions === "boolean") {
              await vsCfg.update("notifications.permissionRequests", msg.notifyPermissions, true)
            }
            this.getWebview().postMessage({ type: "settingsSaved" } as ExtToSettings)
            vscode.window.showInformationMessage("Настройки сохранены")
            break
          }
          case "settingsTest": {
            const testUrl = typeof msg.url === "string" && msg.url.trim() ? msg.url.trim() : undefined
            let ok: boolean
            if (testUrl) {
              const currentCfg = await this.backend.getConfig()
              await this.backend.updateConfig({ url: testUrl })
              ok = await this.backend.healthCheck()
              if (!ok) {
                await this.backend.updateConfig({ url: currentCfg.url })
              }
            } else {
              ok = await this.backend.healthCheck()
            }
            this.getWebview().postMessage({
              type: "settingsTestResult",
              success: ok,
              message: ok ? "Подключено к серверу" : "Ошибка подключения",
            } as ExtToSettings)
            break
          }
        }
      } catch (err: unknown) {
        const msg = errorMessage(err)
        log.error(`Ошибка обработки сообщения настроек: ${msg}`)
        vscode.window.showErrorMessage(`NeuralTower Agent: ошибка настроек: ${msg}`)
      }
    })
    this.disposables.push(disposable)
  }

  private html(): string {
    return buildWebviewHtml(this.getWebview(), this.extUri, {
      css: "settings.css",
      js: "resources/settings.js",
      body: `
  <h2>
    <svg viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" style="width:18px;height:18px"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
    Настройки
  </h2>

  <div class="settings-section">
    <div class="settings-section-title">Бэкенд</div>
    <div class="setting-row">
      <div>
        <div class="setting-label">Адрес сервера</div>
        <div class="setting-desc">URL NeuralTower-сервера</div>
      </div>
      <input class="setting-input" id="url" type="text">
    </div>
    <div class="setting-row">
      <div>
        <div class="setting-label">Модель</div>
        <div class="setting-desc">ИИ-модель для агента (пусто — автовыбор с сервера, или явное имя)</div>
      </div>
      <input class="setting-input" id="model" type="text" list="model-list" placeholder="авто (модель с сервера)" autocomplete="off" spellcheck="false">
      <datalist id="model-list"></datalist>
    </div>
    <div class="setting-row">
      <div>
        <div class="setting-label">Макс. повторов</div>
      </div>
      <input class="setting-input" id="maxRetries" type="number" value="3" min="0" max="10" style="width:60px">
    </div>
    <div class="setting-row">
      <div>
        <div class="setting-label">Таймаут (мс)</div>
      </div>
      <input class="setting-input" id="timeoutMs" type="number" value="60000" min="1000" style="width:100px">
    </div>
  </div>

  <div class="settings-section">
    <div class="settings-section-title">Агент</div>
    <div class="setting-row">
      <div>
        <div class="setting-label">Макс. итераций</div>
        <div class="setting-desc">Лимит шагов агента за один запрос</div>
      </div>
      <input class="setting-input" id="maxIterations" type="number" value="20" style="width:60px">
    </div>
    <div class="setting-row">
      <div>
        <div class="setting-label">Макс. сессий</div>
      </div>
      <input class="setting-input" id="maxSessions" type="number" value="50" style="width:60px">
    </div>
  </div>

  <div class="settings-section">
    <div class="settings-section-title">Разрешения</div>
    <div class="setting-row">
      <div>
        <div class="setting-label">Автоодобрение</div>
        <div class="setting-desc">Автоматически разрешать инструменты</div>
      </div>
      <div class="toggle" id="autoApprove" onclick="toggleClick(this)"></div>
    </div>
  </div>

  <div class="settings-section">
    <div class="settings-section-title">Уведомления</div>
    <div class="setting-row">
      <div>
        <div class="setting-label">Включить уведомления</div>
      </div>
      <div class="toggle on" id="notificationsEnabled" onclick="toggleClick(this)"></div>
    </div>
    <div class="setting-row">
      <div>
        <div class="setting-label">Завершение агента</div>
      </div>
      <div class="toggle on" id="notifyAgentDone" onclick="toggleClick(this)"></div>
    </div>
    <div class="setting-row">
      <div>
        <div class="setting-label">Запросы разрешений</div>
      </div>
      <div class="toggle on" id="notifyPermissions" onclick="toggleClick(this)"></div>
    </div>
  </div>

  <div class="settings-section">
    <div class="settings-section-title">MCP-серверы</div>
    <div class="setting-desc">Внешние серверы: настройка neuralTowerAgent.mcpServers и .mcp.json проекта</div>
    <div id="mcp-list" class="mcp-list"></div>
  </div>

  <div class="settings-actions">
    <button class="s-btn secondary" id="btn-test">Проверить соединение</button>
    <button class="s-btn primary" id="btn-save">Сохранить</button>
  </div>

  <div class="status-line" id="status"></div>`,
    })
  }
}
