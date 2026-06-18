import * as vscode from "vscode"
import type { ITool } from "../../tools/ITool"
import type { PermissionLevel, ToolPermission, PermissionRequest, AutoApproveConfig } from "../../shared/PermissionTypes"

/**
 * Интерфейс PermissionManager — только методы, используемые через AgentDependencies.
 */
export interface IPermissionManager {
  checkPermission(tool: ITool, args: Record<string, unknown>, timeoutMs?: number): Promise<boolean>
}

export class PermissionManager implements IPermissionManager {
  private static readonly KEY_PERMISSIONS = "neuralTowerAgent.permissions"
  private static readonly KEY_AUTO_APPROVE = "neuralTowerAgent.autoApprove"

  private permissions: Map<string, PermissionLevel> = new Map()
  private autoApprove: AutoApproveConfig = {
    enabled: false,
    tools: [],
    maxCost: 0,
  }
  private pendingRequests: PermissionRequest[] = []
  private requestEmitter: vscode.EventEmitter<PermissionRequest> | null = null
  private memento: vscode.Memento | null = null

  constructor(memento?: vscode.Memento) {
    this.memento = memento ?? null
  }

  /**
   * Инициализировать менеджер разрешений — загрузить сохранённые данные из Memento.
   */
  init(): void {
    if (!this.memento) return

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

    const storedAuto = this.memento.get<AutoApproveConfig | undefined>(
      PermissionManager.KEY_AUTO_APPROVE,
      undefined,
    )
    if (storedAuto) {
      this.autoApprove = { ...this.autoApprove, ...storedAuto }
    }
  }

  onDidRequestPermission(handler: (req: PermissionRequest) => void): vscode.Disposable {
    if (!this.requestEmitter) {
      this.requestEmitter = new vscode.EventEmitter<PermissionRequest>()
    }
    return this.requestEmitter.event(handler)
  }

  async checkPermission(
    tool: ITool,
    args: Record<string, unknown>,
    timeoutMs = 30000,
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

  setAutoApprove(config: Partial<AutoApproveConfig>): void {
    Object.assign(this.autoApprove, config)
    this.persistAutoApprove()
  }

  getAutoApprove(): AutoApproveConfig {
    return { ...this.autoApprove }
  }

  listPermissions(): ToolPermission[] {
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
      const req: PermissionRequest = { toolName, args, resolve, id }
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
