import type { AgentModeName } from "../agent/AgentMode"

export type WebviewToExt =
  | { type: "sendMessage"; content: string }
  | { type: "switchSession"; sessionId: string }
  | { type: "createSession" }
  | { type: "deleteSession"; sessionId: string }
  | { type: "pinSession"; sessionId: string }
  | { type: "renameSession"; sessionId: string; title: string }
  | { type: "sessionList" }
  | { type: "permissionResponse"; requestId: string; allowed: boolean; always: boolean }
  | { type: "stopAgent" }
  | { type: "settings" }
  | { type: "switchMode"; mode: string }
  | { type: "revertSnapshot"; runId: string }
  | { type: "undoRevertSnapshot"; runId: string }
  | { type: "listCheckpoints" }
  | { type: "restoreCheckpoint"; runId: string }
  | { type: "openRequestDiff"; runId: string }
  | { type: "restoreSessionCheckpoint"; runId: string }

export type ExtToWebview =
  | { type: "messageConfirmed"; content: string }
  | { type: "streamChunk"; text: string }
  | { type: "streamDone" }
  | { type: "streamError"; error: string }
  | { type: "newChat" }
  | { type: "toolUse"; toolName: string; args: string }
  | { type: "toolResult"; toolName: string; output: string; success: boolean }
  | { type: "sessionList"; sessions: Array<{ id: string; title: string; pinned: boolean; updatedAt: number; messageCount: number; active: boolean }> }
  | { type: "switchSession"; sessionId: string }
  | { type: "agentDone" }
  | { type: "permissionRequest"; requestId: string; toolName: string; description: string }
  | { type: "modeChanged"; mode: AgentModeName; allowed: AgentModeName[] }
  | { type: "modeSwitchError"; message: string }
  | { type: "backendStatus"; connected: boolean }
  | { type: "snapshotInfo"; runId: string; hash: string; fileCount: number }
  | { type: "snapshotReverted"; runId: string; ok: boolean; error?: string; skippedCount?: number; undoAvailable?: boolean }
  | { type: "undoReverted"; runId: string; ok: boolean; error?: string }
  | { type: "checkpointList"; checkpoints: Array<{ runId: string; createdAt: number; fileCount: number }> }
  | { type: "sessionCheckpointRestored"; runId: string; ok: boolean; error?: string }

export type SettingsToExt =
  | { type: "settingsSave"; url: string; model: string; maxRetries?: number; timeoutMs?: number; autoApprove?: boolean; maxIterations?: number; maxSessions?: number; notificationsEnabled?: boolean; notifyAgentDone?: boolean; notifyPermissions?: boolean }
  | { type: "settingsTest"; url?: string }

export type ExtToSettings =
  | { type: "settingsData"; config: { url: string; model: string; maxRetries: number; timeoutMs: number; autoApprove: boolean; maxIterations?: number; maxSessions?: number; notificationsEnabled?: boolean; notifyAgentDone?: boolean; notifyPermissions?: boolean }; models: string[] }
  | { type: "settingsSaved" }
  | { type: "settingsTestResult"; success: boolean; message: string }
