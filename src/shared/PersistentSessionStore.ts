import * as vscode from "vscode"
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

/**
 * Интерфейс персистентности сессий — абстрагирует файловый I/O
 * от бизнес-логики хранилища (DIP, SRP).
 */
export interface ISessionPersister {
  /** Загрузить данные из хранилища. */
  load(): Promise<ISessionData | null>
  /** Сохранить данные в хранилище. */
  save(data: ISessionData): Promise<void>
}

/**
 * Реализация ISessionPersister через JSON-файл на диске.
 */
export class FileSessionPersister implements ISessionPersister {
  constructor(private readonly filePath: string) {}

  async load(): Promise<ISessionData | null> {
    const { readFile } = await import("fs/promises")
    try {
      const raw = await readFile(this.filePath, "utf-8")
      return JSON.parse(raw) as ISessionData
    } catch {
      return null
    }
  }

  async save(data: ISessionData): Promise<void> {
    const { writeFile } = await import("fs/promises")
    await writeFile(this.filePath, JSON.stringify(data, null, 2), "utf-8")
  }
}

export interface ISessionStore {
  init(): Promise<void>
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
  /** Оставить только первые count сообщений сессии (остальные удалить). */
  truncateMessages(sessionId: string, count: number): Promise<void>
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
  private readonly maxSessions: number
  private readonly mutex = new Mutex()
  private disposed = false

  constructor(
    private readonly persister: ISessionPersister,
    maxSessions = DEFAULT_MAX_SESSIONS,
  ) {
    this.maxSessions = maxSessions
  }

  /**
   * Создать хранилище с файловой персистентностью (удобный конструктор).
   */
  static withFileStorage(
    storageUri: vscode.Uri,
    maxSessions = DEFAULT_MAX_SESSIONS,
  ): PersistentSessionStore {
    const filePath = path.join(
      storageUri.fsPath,
      "neuralTowerAgent-sessions.json",
    )
    const persister = new FileSessionPersister(filePath)
    return new PersistentSessionStore(persister, maxSessions)
  }

  async init(): Promise<void> {
    await this.mutex.withLock(async () => {
      const loaded = await this.persister.load()
      if (loaded && loaded.sessions.length && loaded.activeId) {
        this.data = loaded
      } else {
        this.data = { ...DEFAULT_DATA }
        this.createDefault()
      }
    })
  }

  async save(): Promise<void> {
    try {
      await this.persister.save(this.data)
    } catch (err: unknown) {
      log.error(`Ошибка сохранения сессий: ${errorMessage(err)}`)
    }
  }

  /**
   * Внутреннее сохранение с защитой mutex.
   * Вызывается только из методов, которые уже владеют mutex.
   * Публичный save() не использует mutex, чтобы избежать deadlock.
   */
  private async saveLocked(): Promise<void> {
    try {
      await this.persister.save(this.data)
    } catch (err: unknown) {
      log.error(`Ошибка сохранения сессий: ${errorMessage(err)}`)
    }
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
      await this.saveLocked()
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
      await this.saveLocked()
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
      await this.saveLocked()
      return true
    })
  }

  async togglePin(id: string): Promise<void> {
    await this.mutex.withLock(async () => {
      const session = this.data.sessions.find((s) => s.id === id)
      if (session) {
        session.pinned = !session.pinned
        await this.saveLocked()
      }
    })
  }

  async rename(id: string, title: string): Promise<void> {
    await this.mutex.withLock(async () => {
      const session = this.data.sessions.find((s) => s.id === id)
      if (session) {
        session.title = title
        await this.saveLocked()
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
      await this.saveLocked()
    })
  }

  async truncateMessages(sessionId: string, count: number): Promise<void> {
    await this.mutex.withLock(async () => {
      let seen = 0
      this.data.messages = this.data.messages.filter((m) => {
        if (m.sessionId !== sessionId) return true
        seen++
        return seen <= count
      })
      const session = this.data.sessions.find((s) => s.id === sessionId)
      if (session) session.messageCount = Math.min(session.messageCount, count)
      await this.saveLocked()
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
