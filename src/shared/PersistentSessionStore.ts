import * as vscode from "vscode"
import * as fs from "fs/promises"
import * as path from "path"
import type { ChatMessage } from "../core/IBackend"
import type {
  SessionData,
  PersistedSession,
  PersistedMessage,
} from "./SessionTypes"
import { createDomainLogger } from "../core/logger"

const log = createDomainLogger("SessionStore")

const SESSION_TITLE_TRUNCATE = 60
const DEFAULT_SESSION_TITLE = "Без названия"

export interface ISessionStore {
  init(): Promise<void>
  push(message: ChatMessage): Promise<void>
  newSession(): Promise<string>
  deleteSession(id: string): Promise<boolean>
  togglePin(id: string): Promise<void>
  rename(id: string, title: string): Promise<void>
  list(): PersistedSession[]
  setActive(id: string): void
  getActiveMessages(): ChatMessage[]
  get activeId(): string
  dispose(): void
  save(): Promise<void>
  getSession(id: string): PersistedSession | undefined
  getMessagesForSession(id: string): ChatMessage[]
  clearActive(): Promise<void>
}

const DEFAULT_DATA: SessionData = {
  sessions: [],
  messages: [],
  activeId: "",
}

/**
 * Асинхронный мютекс для предотвращения параллельных гонок чтения-модификации-записи.
 */
class Mutex {
  private promise: Promise<void> = Promise.resolve()

  acquire(): Promise<() => void> {
    let releaseResolve: () => void
    const prev = this.promise
    this.promise = new Promise((resolve) => { releaseResolve = resolve })
    return prev.then(() => () => { releaseResolve!() })
  }

  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire()
    try {
      return await fn()
    } finally {
      release()
    }
  }
}

export class PersistentSessionStore implements ISessionStore {
  private data: SessionData = { ...DEFAULT_DATA }
  private readonly storagePath: string
  private readonly maxSessions: number
  private readonly mutex = new Mutex()
  private disposed = false

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
    await this.mutex.withLock(async () => {
      try {
        const raw = await fs.readFile(this.storagePath, "utf-8")
        this.data = JSON.parse(raw) as SessionData
        if (!this.data.sessions.length && !this.data.activeId) {
          this.createDefault()
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        log.error(`Не удалось загрузить хранилище сессий: ${msg}`)
        this.data = { ...DEFAULT_DATA }
        this.createDefault()
      }
    })
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
    await this.mutex.withLock(async () => {
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
        if (session.title === DEFAULT_SESSION_TITLE && message.role === "user") {
          session.title = message.content.slice(0, SESSION_TITLE_TRUNCATE)
        }
      }
      if (this.data.sessions.length > this.maxSessions) {
        this.trimOldSessions()
      }
      await this.save()
    })
  }

  async newSession(): Promise<string> {
    return await this.mutex.withLock(async () => {
      const id = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      this.data.sessions.push({
        id,
        title: DEFAULT_SESSION_TITLE,
        pinned: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messageCount: 0,
      })
      while (this.data.sessions.length > this.maxSessions) {
        const oldest = this.data.sessions.find((s) => !s.pinned)
        if (oldest) {
          this.data.sessions = this.data.sessions.filter((s) => s.id !== oldest.id)
          this.data.messages = this.data.messages.filter((m) => m.sessionId !== oldest.id)
        } else {
          break
        }
      }
      this.data.activeId = id
      await this.save()
      return id
    })
  }

  async deleteSession(id: string): Promise<boolean> {
    return await this.mutex.withLock(async () => {
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
    })
  }

  async togglePin(id: string): Promise<void> {
    await this.mutex.withLock(async () => {
      const session = this.data.sessions.find((s) => s.id === id)
      if (session) {
        session.pinned = !session.pinned
        await this.save()
      }
    })
  }

  async rename(id: string, title: string): Promise<void> {
    await this.mutex.withLock(async () => {
      const session = this.data.sessions.find((s) => s.id === id)
      if (session) {
        session.title = title
        await this.save()
      }
    })
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
    await this.mutex.withLock(async () => {
      this.data.messages = this.data.messages.filter(
        (m) => m.sessionId !== this.data.activeId,
      )
      const session = this.data.sessions.find((s) => s.id === this.data.activeId)
      if (session) session.messageCount = 0
      await this.save()
    })
  }

  dispose(): void {
    this.disposed = true
  }

  // ── Приватные методы ────────────────────────────────────

  private createDefault(): void {
    const id = "default"
    this.data.sessions = [{
      id,
      title: DEFAULT_SESSION_TITLE,
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
