import * as vscode from "vscode"
import type { ITool } from "../../tools/ITool"
import type { PermissionLevel, IToolPermission, IPermissionRequest, IAutoApproveConfig } from "../../shared/PermissionTypes"
import type { IPlugin } from "../../shared/Types"
import { PERMISSION_TIMEOUT_MS } from "../../core/Config"

/**
 * Интерфейс PermissionManager — публичный API.
 */
export interface IPermissionManager {
  checkPermission(tool: ITool, args: Record<string, unknown>, timeoutMs?: number): Promise<boolean>
 onDidRequestPermission(handler: (req: IPermissionRequest) => void): vscode.Disposable
  resolveRequest(requestId: string, allowed: boolean, always: boolean): boolean
  dispose(): void
}

export class PermissionManager implements IPlugin, IPermissionManager {
  name = "permission-manager"
  private static readonly KEY_PERMISSIONS = "neuralTowerAgent.permissions"
  private static readonly KEY_AUTO_APPROVE = "neuralTowerAgent.autoApprove"

  private permissions: Map<string, PermissionLevel> = new Map()
  private autoApprove: IAutoApproveConfig = {
    enabled: false,
    tools: [],
    maxCost: 0,
  }
  private pendingRequests: IPermissionRequest[] = []
  private requestEmitter: vscode.EventEmitter<IPermissionRequest> | null = null
  private memento: vscode.Memento | null = null

  constructor(memento?: vscode.Memento) {
    this.memento = memento ?? null
  }

 /**
   * Инициализировать менеджер разрешений — загрузить сохранённые данные из Memento.
   */
  async init(): Promise<void> {
    if (!this.memento) return

    this.permissions.clear()
    this.autoApprove = {
      enabled: false,
      tools: [],
      maxCost: 0,
    }

    const stored = this.memento.get<Record<string, PermissionLevel>>(
      PermissionManager.KEY_PERMISSIONS,
      {},
    )
    if (stored) {
      for (const [toolName, level] of Object.entries(stored)) {
        if (level === "allow" || level === "deny" || level === "ask") {
          this.permissions.set(toolName, level)
        }
      }
    }

    const storedAuto = this.memento.get<IAutoApproveConfig | undefined>(
      PermissionManager.KEY_AUTO_APPROVE,
      undefined,
    )
    if (storedAuto) {
      this.autoApprove = { ...this.autoApprove, ...storedAuto }
    }
  }

  onDidRequestPermission(handler: (req: IPermissionRequest) => void): vscode.Disposable {
    if (!this.requestEmitter) {
      this.requestEmitter = new vscode.EventEmitter<IPermissionRequest>()
    }
    return this.requestEmitter.event(handler)
  }

  async checkPermission(
    tool: ITool,
    args: Record<string, unknown>,
    timeoutMs = PERMISSION_TIMEOUT_MS,
  ): Promise<boolean> {
    const level = this.getPermissionLevel(tool.name)

    if (level === "allow") return true
    if (level === "deny") return false

    if (tool.isSafe) return true

    if (this.autoApprove.enabled && this.autoApprove.tools.includes(tool.name)) return true

    return this.askPermission(tool.name, args, timeoutMs)
  }

  setPermission(toolName: string, level: PermissionLevel): void {
    this.permissions.set(toolName, level)
    this.persist()
  }

  getPermissionLevel(toolName: string): PermissionLevel {
    return this.permissions.get(toolName) ?? "ask"
  }

  setAutoApprove(config: Partial<IAutoApproveConfig>): void {
    Object.assign(this.autoApprove, config)
    this.persistAutoApprove()
  }

  getAutoApprove(): IAutoApproveConfig {
    return { ...this.autoApprove }
  }

  listPermissions(): IToolPermission[] {
    return [...this.permissions.entries()].map(([toolName, level]) => ({
      toolName,
      level,
    }))
  }

  clear(): void {
    this.permissions.clear()
    this.pendingRequests = []
    this.persist()
  }

  // ── Приватные методы ────────────────────────────────────

  /**
   * Сохранить текущие разрешения в Memento.
   */
  private persist(): void {
    if (!this.memento) return
    const entries: Record<string, PermissionLevel> = {}
    for (const [toolName, level] of this.permissions.entries()) {
      entries[toolName] = level
    }
    this.memento.update(PermissionManager.KEY_PERMISSIONS, entries)
  }

  /**
   * Сохранить конфигурацию автоодобрения в Memento.
   */
  private persistAutoApprove(): void {
    if (!this.memento) return
    this.memento.update(PermissionManager.KEY_AUTO_APPROVE, { ...this.autoApprove })
  }

  private askPermission(
    toolName: string,
    args: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const req: IPermissionRequest = { toolName, args, resolve, id }
      this.pendingRequests.push(req)
      if (this.requestEmitter) {
        this.requestEmitter.fire(req)
      }

      req.timer = setTimeout(() => {
        const idx = this.pendingRequests.indexOf(req)
        if (idx !== -1) {
          this.pendingRequests.splice(idx, 1)
          resolve(false)
        }
      }, timeoutMs)
    })
  }

  /**
   * Решить запрос разрешения по ID.
   * Если `always` — установить постоянный уровень разрешения для этого инструмента.
   */
  resolveRequest(requestId: string, allowed: boolean, always: boolean): boolean {
    const req = this.pendingRequests.find((r) => r.id === requestId)
    if (!req) return false
    if (req.timer) {
      clearTimeout(req.timer)
    }
    if (always) {
      this.permissions.set(req.toolName, allowed ? "allow" : "deny")
      this.persist()
    }
    this.pendingRequests = this.pendingRequests.filter((r) => r.id !== requestId)
    req.resolve(allowed)
    return true
  }

  /** Освободить ресурсы: отменить все ожидающие запросы и остановить эмиттер. */
  dispose(): void {
    for (const req of this.pendingRequests) {
      if (req.timer) {
        clearTimeout(req.timer)
      }
      req.resolve(false)
    }
    this.pendingRequests = []
    this.permissions.clear()
    if (this.requestEmitter) {
      this.requestEmitter.dispose()
      this.requestEmitter = null
    }
  }
}
