import type { IBackend } from "../core/IBackend"
import type { ChatMessage } from "../core/IBackend"

/**
 * Хранилище сессий в памяти. Может быть заменено на файловое
 * или базовое хранилище.
 */
export class SessionStore {
  private sessions: Map<string, ChatMessage[]> = new Map()
  private activeId = "default"

  get active(): ChatMessage[] {
    return this.sessions.get(this.activeId) ?? []
  }

  push(msg: ChatMessage): void {
    const msgs = this.sessions.get(this.activeId) ?? []
    msgs.push(msg)
    this.sessions.set(this.activeId, msgs)
  }

  newSession(): string {
    const id = `session-${Date.now()}`
    this.sessions.set(id, [])
    this.activeId = id
    return id
  }

  clear(): void {
    this.sessions.clear()
    this.sessions.set("default", [])
    this.activeId = "default"
  }

  dispose(): void {
    this.sessions.clear()
  }
}
