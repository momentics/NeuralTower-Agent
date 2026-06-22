export type PermissionLevel = "deny" | "ask" | "allow"

export interface IToolPermission {
  toolName: string
  level: PermissionLevel
}

export interface IPermissionRequest {
  toolName: string
  args: Record<string, unknown>
  resolve: (allowed: boolean) => void
  id?: string
  timer?: ReturnType<typeof setTimeout>
}

export interface IAutoApproveConfig {
  enabled: boolean
  tools: string[]
  maxCost: number
}
