export interface IPersistedSession {
  id: string
  title: string
  pinned: boolean
  createdAt: number
  updatedAt: number
  messageCount: number
}

export interface IPersistedMessage {
  sessionId: string
  role: "system" | "user" | "assistant" | "tool"
  content: string
  timestamp: number
  toolCalls?: Array<{ id: string; toolName: string; arguments: string }>
  toolCallId?: string
  name?: string
}

export interface ISessionData {
  sessions: IPersistedSession[]
  messages: IPersistedMessage[]
  activeId: string
}
