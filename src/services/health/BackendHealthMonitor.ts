import * as vscode from "vscode"
import type { IBackend } from "../../core/IBackend"
import type { IContextManager } from "../../core/ContextManager"
import type { Plugin } from "../../shared/Types"
import { createDomainLogger } from "../../core/Logger"
import { StatusBarIndicator } from "../../services/StatusBarIndicator"
import { errorMessage } from "../../core/Errors"

const log = createDomainLogger("BackendHealth")

const HEALTH_CHECK_INTERVAL_MS = 15000

/** Монитор здоровья бэкенда: периодическая проверка подключения и отображение статуса в статус-баре. */
export class BackendHealthMonitor extends StatusBarIndicator implements Plugin {
  name = "backend-health"

  private healthTimer: ReturnType<typeof setInterval> | null = null
  private connected = false
  private checking = false

  constructor(
    private readonly backend: IBackend,
    private readonly contextManager: IContextManager | null = null,
  ) {
    super(
      vscode.StatusBarAlignment.Right,
      99,
      "neuralTowerAgent.settings",
      "NeuralTower Agent: статус подключения",
    )
  }

  /** Инициализировать мониторинг: выполнить первую проверку и запустить периодический таймер. */
  async init(): Promise<void> {
    await this.check()
    if (this.contextManager) {
      const providers = this.contextManager.list()
      if (providers.length === 0) {
        log.warn("ContextManager: провайдеры контекста не зарегистрированы. Агент будет работать без контекста проекта.")
      }
    }
    this.healthTimer = setInterval(async () => {
      await this.check()
    }, HEALTH_CHECK_INTERVAL_MS)
    try {
      (this.healthTimer as NodeJS.Timer).unref()
    } catch {
      /* unref не поддерживается в окружении */
    }
  }

  /** Вернуть текущий статус подключения. */
  isConnected(): boolean {
    return this.connected
  }

  /** Выполнить проверку здоровья бэкенда и обновить статус-бар. */
  async check(): Promise<boolean> {
    if (this.checking) return this.connected
    this.checking = true
    this.syncBar()
    try {
      const ok = await this.backend.healthCheck()
      this.connected = ok
      this.checking = false
      this.syncBar()
      return ok
    } catch (err: unknown) {
      const msg = errorMessage(err)
      log.error(`Проверка здоровья бэкенда не выполнена: ${msg}`)
      this.connected = false
      this.checking = false
      this.syncBar()
      return false
    }
  }

  /** Остановить мониторинг и освободить ресурсы. */
  dispose(): void {
    if (this.healthTimer) clearInterval(this.healthTimer)
    this.healthTimer = null
    super.dispose()
  }

  private syncBar(): void {
    if (this.connected) {
      this.setText("$(check) Neural Tower")
      this.setColor(new vscode.ThemeColor("testing.iconPassed"))
      this.setTooltip("Neural Tower: подключено")
    } else if (this.checking) {
      this.setText("$(loading~spin) Neural Tower ...")
      this.setColor(new vscode.ThemeColor("editorWarning.foreground"))
      this.setTooltip("Neural Tower: проверка подключения...")
    } else {
      this.setText("$(error) Neural Tower")
      this.setColor(new vscode.ThemeColor("testing.iconErrored"))
      this.setTooltip("Neural Tower: недоступно\nНажмите для настроек")
    }
    this.show()
  }
}
