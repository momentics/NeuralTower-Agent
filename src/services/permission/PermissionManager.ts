import * as vscode from "vscode"
import type { ITool } from "../../tools/ITool"
import type { PermissionLevel, ToolPermission, PermissionRequest, AutoApproveConfig } from "../../shared/PermissionTypes"

export class PermissionManager {
  private permissions: Map<string, PermissionLevel> = new Map()
  private autoApprove: AutoApproveConfig = {
    enabled: false,
    tools: [],
    maxCost: 0,
  }
  private pendingRequests: PermissionRequest[] = []
  private requestEmitter: vscode.EventEmitter<PermissionRequest> | null = null

  constructor() {}

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
  }

  getPermissionLevel(toolName: string): PermissionLevel {
    return this.permissions.get(toolName) ?? "ask"
  }

  setAutoApprove(config: Partial<AutoApproveConfig>): void {
    Object.assign(this.autoApprove, config)
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
  }

  // ── Приватные методы ────────────────────────────────────

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

      setTimeout(() => {
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
    if (always) {
      this.permissions.set(req.toolName, allowed ? "allow" : "deny")
    }
    this.pendingRequests = this.pendingRequests.filter((r) => r.id !== requestId)
    req.resolve(allowed)
    return true
  }

  dispose(): void {
    for (const req of this.pendingRequests) req.resolve(false)
    this.pendingRequests = []
    this.permissions.clear()
    if (this.requestEmitter) {
      this.requestEmitter.dispose()
      this.requestEmitter = null
    }
  }
}
