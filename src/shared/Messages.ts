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

export type SettingsToExt =
  | { type: "settingsSave"; url: string; model: string; maxRetries?: number; timeoutMs?: number; autoApprove?: boolean }
  | { type: "settingsTest" }

export type ExtToSettings =
  | { type: "settingsData"; config: { url: string; model: string; maxRetries: number; timeoutMs: number; autoApprove: boolean }; models: string[] }
  | { type: "settingsSaved" }
  | { type: "settingsTestResult"; success: boolean; message: string }
