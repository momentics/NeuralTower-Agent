export interface PersistedSession {
  id: string
  title: string
  pinned: boolean
  createdAt: number
  updatedAt: number
  messageCount: number
}

export interface PersistedMessage {
  sessionId: string
  role: "system" | "user" | "assistant"
  content: string
  timestamp: number
}

export interface SessionData {
  sessions: PersistedSession[]
  messages: PersistedMessage[]
  activeId: string
}
