import * as vscode from "vscode"
import type { IBackend } from "../../core/IBackend"
import type { Plugin } from "../../shared/types"

export class BackendHealthMonitor implements Plugin {
  name = "backend-health"
  version = "0.1.0"

  private statusBar: vscode.StatusBarItem
  private healthTimer: ReturnType<typeof setInterval> | null = null
  private connected = false
  private checking = false

  constructor(private readonly backend: IBackend) {
    this.statusBar = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      99,
    )
    this.statusBar.command = "nt-agent.settings"
    this.statusBar.tooltip = "Агент Neural Tower: статус подключения"
  }

  async init(): Promise<void> {
    await this.check()
    this.healthTimer = setInterval(async () => {
      await this.check()
    }, 15000)
    if (this.healthTimer) this.healthTimer.unref?.()
  }

  isConnected(): boolean {
    return this.connected
  }

  async check(): Promise<boolean> {
    if (this.checking) return this.connected
    this.checking = true
    try {
      const ok = await this.backend.healthCheck()
      this.connected = ok
      this.syncBar()
      return ok
    } catch {
      this.connected = false
      this.syncBar()
      return false
    } finally {
      this.checking = false
    }
  }

  dispose(): void {
    if (this.healthTimer) clearInterval(this.healthTimer)
    this.healthTimer = null
    this.statusBar.dispose()
  }

  private syncBar(): void {
    if (this.connected) {
      this.statusBar.text = "$(check) Neural Tower"
      this.statusBar.color = new vscode.ThemeColor("testing.iconPassed")
      this.statusBar.tooltip = "Neural Tower: подключено"
    } else if (this.checking) {
      this.statusBar.text = "$(loading~spin) Neural Tower ..."
      this.statusBar.color = new vscode.ThemeColor("editorWarning.foreground")
      this.statusBar.tooltip = "Neural Tower: проверка подключения..."
    } else {
      this.statusBar.text = "$(error) Neural Tower"
      this.statusBar.color = new vscode.ThemeColor("testing.iconErrored")
      this.statusBar.tooltip = "Neural Tower: недоступно\nНажмите для настроек"
    }
    this.statusBar.show()
  }
}
