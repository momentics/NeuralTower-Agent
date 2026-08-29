import * as vscode from "vscode"
import type { IBackend } from "../../core/IBackend"
import type { IContextManager } from "../../core/ContextManager"
import type { IPlugin } from "../../shared/Types"
import { createDomainLogger } from "../../core/Logger"
import { StatusBarIndicator } from "../../services/StatusBarIndicator"
import { errorMessage } from "../../core/Errors"

const log = createDomainLogger("BackendHealth")

const HEALTH_CHECK_INTERVAL_MS = 15000
const MAX_CONSECUTIVE_FAILURES = 3

/** Монитор здоровья бэкенда: периодическая проверка подключения и отображение статуса в статус-баре.
 * Работает лениво — таймер запускается только при явном вызове init() (когда пользователь открыл sidebar).
 * После MAX_CONSECUTIVE_FAILURES неудачных проверок таймер останавливается, чтобы не спамить сетевыми
 * запросами к недоступному серверу. Вызов resume() перезапускает таймер (например, при повторном
 * открытии sidebar или изменении настроек). */
export class BackendHealthMonitor extends StatusBarIndicator implements IPlugin {
  name = "backend-health"

  private healthTimer: ReturnType<typeof setInterval> | null = null
  private connected = false
  private checking = false
  private consecutiveFailures = 0
  private initialized = false
  private statusListener: ((connected: boolean) => void) | null = null

  /** Подписаться на статус подключения (вызывается после каждой проверки). */
  onStatusChange(cb: (connected: boolean) => void): void {
    this.statusListener = cb
  }

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

  /** Инициализировать мониторинг: запустить периодический таймер. Первая проверка выполняется в фоне.
   * Идиempotent — повторные вызовы перезапускают таймер. */
  async init(): Promise<void> {
    if (this.initialized) {
      this.resume()
      return
    }
    this.initialized = true
    if (this.contextManager) {
      const providers = this.contextManager.list()
      if (providers.length === 0) {
        log.warn("ContextManager: провайдеры контекста не зарегистрированы. Агент будет работать без контекста проекта.")
      }
    }
    this.startTimer()
    // Первая проверка — в фоне, не блокируем активацию
    setImmediate(async () => {
      try {
        await this.check()
      } catch (err: unknown) {
        const msg = errorMessage(err)
        log.error(`Фоновая проверка здоровья не выполнена: ${msg}`)
      }
    })
  }

  /** Вернуть текущий статус подключения. */
  isConnected(): boolean {
    return this.connected
  }

  /** Перезапустить таймер после паузы (например, при повторном открытии sidebar). */
  resume(): void {
    if (!this.initialized) return
    if (this.healthTimer) return
    this.consecutiveFailures = 0
    this.startTimer()
  }

  /** Выполнить проверку здоровья бэкенда и обновить статус-бар. */
  async check(): Promise<boolean> {
    if (this.checking) return this.connected
    this.checking = true
    this.syncBar()
    try {
      const ok = await this.backend.healthCheck()
      if (ok) {
        this.consecutiveFailures = 0
      }
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
      this.consecutiveFailures++
      if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        this.pauseTimer()
      }
      return false
    }
  }

  /** Остановить мониторинг и освободить ресурсы. */
  dispose(): void {
    this.initialized = false
    this.stopTimer()
    super.dispose()
  }

  private startTimer(): void {
    this.stopTimer()
    this.healthTimer = setInterval(() => {
      this.check().catch((err: unknown) => {
        const msg = errorMessage(err)
        log.error(`Проверка здоровья бэкенда (таймер): ${msg}`)
      })
    }, HEALTH_CHECK_INTERVAL_MS)
    try {
      (this.healthTimer as NodeJS.Timer).unref()
    } catch {
      /* unref не поддерживается в окружении */
    }
  }

  private stopTimer(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer)
      this.healthTimer = null
    }
  }

  private pauseTimer(): void {
    this.stopTimer()
    log.info(`Мониторинг здоровья приостановлен после ${this.consecutiveFailures} неудачных проверок`)
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
    this.statusListener?.(this.connected)
  }
}
