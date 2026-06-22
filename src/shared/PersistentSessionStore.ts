import * as vscode from "vscode"
import * as fs from "fs/promises"
import * as path from "path"
import type { IChatMessage } from "../core/IBackend"
import type {
  ISessionData,
  IPersistedSession,
  IPersistedMessage,
} from "./SessionTypes"
import type { IPlugin } from "./Types"
import { createDomainLogger } from "../core/Logger"
import { Mutex } from "./Mutex"
import { errorMessage } from "../core/Errors"

const log = createDomainLogger("SessionStore")

const SESSION_TITLE_TRUNCATE = 60
const DEFAULT_SESSION_TITLE = "Без названия"
const DEFAULT_MAX_SESSIONS = 50

export interface ISessionStore {
  push(message: IChatMessage): Promise<void>
  newSession(): Promise<string>
  deleteSession(id: string): Promise<boolean>
  togglePin(id: string): Promise<void>
  rename(id: string, title: string): Promise<void>
 list(): IPersistedSession[]
  setActive(id: string): void
  getActiveMessages(): IChatMessage[]
  get activeId(): string
 getSession(id: string): IPersistedSession | undefined
  getMessagesForSession(id: string): IChatMessage[]
  clearActive(): Promise<void>
  dispose(): void
}

const DEFAULT_DATA: ISessionData = {
  sessions: [],
  messages: [],
  activeId: "",
}

export class PersistentSessionStore implements IPlugin, ISessionStore {
  name = "session-store"
  private data: ISessionData = { ...DEFAULT_DATA }
  private readonly storagePath: string
  private readonly maxSessions: number
  private readonly mutex = new Mutex()
  private disposed = false

  constructor(
    storageUri: vscode.Uri,
    maxSessions = DEFAULT_MAX_SESSIONS,
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
        this.data = JSON.parse(raw) as ISessionData
        if (!this.data.sessions.length && !this.data.activeId) {
          this.createDefault()
        }
      } catch (err: unknown) {
        const msg = errorMessage(err)
        log.error(`Не удалось загрузить хранилище сессий: ${msg}`)
        this.data = { ...DEFAULT_DATA }
        this.createDefault()
      }
    })
  }

  async save(): Promise<void> {
    await this.mutex.withLock(async () => {
      await this._save()
    })
  }

  /** Сохранение без мьютекса — для вызова изнутри withLock. */
  private async _save(): Promise<void> {
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

  getActiveMessages(): IChatMessage[] {
    return this.data.messages
      .filter((m) => m.sessionId === this.data.activeId)
      .map((m) => ({ role: m.role, content: m.content, timestamp: m.timestamp }))
  }

  async push(message: IChatMessage): Promise<void> {
    await this.mutex.withLock(async () => {
      const pm: IPersistedMessage = {
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
      await this._save()
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
      await this._save()
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
      await this._save()
      return true
    })
  }

  async togglePin(id: string): Promise<void> {
    await this.mutex.withLock(async () => {
      const session = this.data.sessions.find((s) => s.id === id)
      if (session) {
        session.pinned = !session.pinned
        await this._save()
      }
    })
  }

  async rename(id: string, title: string): Promise<void> {
    await this.mutex.withLock(async () => {
      const session = this.data.sessions.find((s) => s.id === id)
      if (session) {
        session.title = title
        await this._save()
      }
    })
  }

  list(): IPersistedSession[] {
    return [...this.data.sessions].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  getSession(id: string): IPersistedSession | undefined {
    return this.data.sessions.find((s) => s.id === id)
  }

  getMessagesForSession(id: string): IChatMessage[] {
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
      await this._save()
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
