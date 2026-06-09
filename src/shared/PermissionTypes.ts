export type PermissionLevel = "deny" | "ask" | "allow"

export interface ToolPermission {
  toolName: string
  level: PermissionLevel
}

export interface PermissionRequest {
  toolName: string
  args: Record<string, unknown>
  resolve: (allowed: boolean) => void
}

export interface AutoApproveConfig {
  enabled: boolean
  tools: string[]
  maxCost: number
}
