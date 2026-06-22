import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { PersistentSessionStore, FileSessionPersister } from "./PersistentSessionStore"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

describe("PersistentSessionStore", () => {
  let tmpDir: string
  let store: PersistentSessionStore

  beforeAll(async () => {
    tmpDir = path.join(os.tmpdir(), `persistent-session-test-${Date.now()}`)
    await fs.mkdir(tmpDir, { recursive: true })
    const persister = new FileSessionPersister(path.join(tmpDir, "neuralTowerAgent-sessions.json"))
    store = new PersistentSessionStore(persister, 5)
  })

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it("creates a new session and persists it", async () => {
    await store.newSession()
    expect(store.activeId).toBeDefined()
    const sessions = store.list()
    expect(sessions.length).toBe(1)
  })

  it("pushes messages and persists them", async () => {
    await store.push({ role: "user", content: "Hello" })
    const messages = store.getActiveMessages()
    expect(messages.length).toBe(1)
    expect(messages[0].content).toBe("Hello")
  })

  it("renames a session", async () => {
    const id = store.activeId
    await store.rename(id, "My Session")
    const sessions = store.list()
    const session = sessions.find((s) => s.id === id)
    expect(session?.title).toBe("My Session")
  })

  it("toggles pin on a session", async () => {
    const id = store.activeId
    expect(store.list().find((s) => s.id === id)?.pinned).toBe(false)
    await store.togglePin(id)
    expect(store.list().find((s) => s.id === id)?.pinned).toBe(true)
  })

  it("deletes a session", async () => {
    await store.newSession()
    const id = store.activeId
    await store.deleteSession(id)
    const sessions = store.list()
    expect(sessions.find((s) => s.id === id)).toBeUndefined()
  })

  it("respects max sessions limit", async () => {
    const smallDir = path.join(tmpDir, "small")
    await fs.mkdir(smallDir, { recursive: true })
    const smallPersister = new FileSessionPersister(path.join(smallDir, "neuralTowerAgent-sessions.json"))
    const smallStore = new PersistentSessionStore(smallPersister, 2)
    await smallStore.init()
    await smallStore.newSession()
    await smallStore.newSession()
    await smallStore.newSession()
    expect(smallStore.list().length).toBe(2)
  })

  it("switches active session", async () => {
    await store.newSession()
    const id1 = store.activeId
    await store.newSession()
    const id2 = store.activeId
    expect(store.activeId).toBe(id2)
    store.setActive(id1)
    expect(store.activeId).toBe(id1)
  })
})
