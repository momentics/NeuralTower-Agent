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
  /** Человекочитаемое описание вызова (из инструмента), если доступно. */
  description?: string
}

export interface IAutoApproveConfig {
  enabled: boolean
  tools: string[]
  maxCost: number
}
