import * as vscode from "vscode"
import * as fs from "fs/promises"
import * as path from "path"
import type { ChatMessage } from "../core/IBackend"
import type {
  SessionData,
  PersistedSession,
  PersistedMessage,
} from "./SessionTypes"

const DEFAULT_DATA: SessionData = {
  sessions: [],
  messages: [],
  activeId: "",
}

export class PersistentSessionStore {
  private data: SessionData = { ...DEFAULT_DATA }
  private readonly storagePath: string
  private readonly maxSessions: number

  constructor(
    storageUri: vscode.Uri,
    maxSessions = 50,
  ) {
    this.storagePath = path.join(
      storageUri.fsPath,
      "neuralTowerAgent-sessions.json",
    )
    this.maxSessions = maxSessions
  }

  async init(): Promise<void> {
    try {
      const raw = await fs.readFile(this.storagePath, "utf-8")
      this.data = JSON.parse(raw) as SessionData
      if (!this.data.sessions.length && !this.data.activeId) {
        this.createDefault()
      }
    } catch {
      this.data = { ...DEFAULT_DATA }
      this.createDefault()
    }
  }

  async save(): Promise<void> {
    await fs.writeFile(this.storagePath, JSON.stringify(this.data, null, 2), "utf-8")
  }

  get activeId(): string {
    return this.data.activeId
  }

  setActive(id: string): void {
    if (this.data.sessions.find((s) => s.id === id)) {
      this.data.activeId = id
    }
  }

  getActiveMessages(): ChatMessage[] {
    return this.data.messages
      .filter((m) => m.sessionId === this.data.activeId)
      .map((m) => ({ role: m.role, content: m.content, timestamp: m.timestamp }))
  }

  async push(message: ChatMessage): Promise<void> {
    const pm: PersistedMessage = {
      sessionId: this.data.activeId,
      role: message.role,
      content: message.content,
      timestamp: message.timestamp ?? Date.now(),
    }
    this.data.messages.push(pm)
    const session = this.data.sessions.find((s) => s.id === this.data.activeId)
    if (session) {
      session.updatedAt = Date.now()
      session.messageCount++
      if (session.title === "Без названия" && message.role === "user") {
        session.title = message.content.slice(0, 60)
      }
    }
    if (this.data.sessions.length > this.maxSessions) {
      this.trimOldSessions()
    }
    await this.save()
  }

  async newSession(): Promise<string> {
    const id = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    this.data.sessions.push({
      id,
      title: "Без названия",
      pinned: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messageCount: 0,
    })
    this.data.activeId = id
    await this.save()
    return id
  }

  async deleteSession(id: string): Promise<boolean> {
    const idx = this.data.sessions.findIndex((s) => s.id === id)
    if (idx === -1) return false
    const session = this.data.sessions[idx]
    if (session.pinned) return false
    this.data.sessions.splice(idx, 1)
    this.data.messages = this.data.messages.filter((m) => m.sessionId !== id)
    if (this.data.activeId === id) {
      this.data.activeId = this.data.sessions[0]?.id ?? ""
      if (!this.data.activeId) this.createDefault()
    }
    await this.save()
    return true
  }

  async togglePin(id: string): Promise<void> {
    const session = this.data.sessions.find((s) => s.id === id)
    if (session) {
      session.pinned = !session.pinned
      await this.save()
    }
  }

  async rename(id: string, title: string): Promise<void> {
    const session = this.data.sessions.find((s) => s.id === id)
    if (session) {
      session.title = title
      await this.save()
    }
  }

  list(): PersistedSession[] {
    return [...this.data.sessions].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  getSession(id: string): PersistedSession | undefined {
    return this.data.sessions.find((s) => s.id === id)
  }

  getMessagesForSession(id: string): ChatMessage[] {
    return this.data.messages
      .filter((m) => m.sessionId === id)
      .map((m) => ({ role: m.role, content: m.content, timestamp: m.timestamp }))
  }

  async clearActive(): Promise<void> {
    this.data.messages = this.data.messages.filter(
      (m) => m.sessionId !== this.data.activeId,
    )
    const session = this.data.sessions.find((s) => s.id === this.data.activeId)
    if (session) session.messageCount = 0
    await this.save()
  }

  dispose(): void {
    this.data = { ...DEFAULT_DATA }
  }

  // ── Приватные методы ────────────────────────────────────

  private createDefault(): void {
    const id = "default"
    this.data.sessions = [{
      id,
      title: "Без названия",
      pinned: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messageCount: 0,
    }]
    this.data.activeId = id
    this.data.messages = []
  }

  private trimOldSessions(): void {
    const unpinned = this.data.sessions.filter((s) => !s.pinned)
    unpinned.sort((a, b) => a.updatedAt - b.updatedAt)
    while (this.data.sessions.length > this.maxSessions) {
      const oldest = unpinned.shift()
      if (!oldest) break
      this.data.sessions = this.data.sessions.filter((s) => s.id !== oldest.id)
      this.data.messages = this.data.messages.filter((m) => m.sessionId !== oldest.id)
    }
    if (!this.data.sessions.find((s) => s.id === this.data.activeId)) {
      this.data.activeId = this.data.sessions[0]?.id ?? ""
    }
  }
}
