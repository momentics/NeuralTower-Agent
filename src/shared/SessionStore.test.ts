import { describe, it, expect } from "vitest"
import { SessionStore } from "../../shared/SessionStore"

describe("SessionStore", () => {
  it("creates a new session", () => {
    const store = new SessionStore()
    store.newSession()
    expect(store.activeId).toBeDefined()
    expect(store.list().length).toBe(1)
  })

  it("pushes messages to active session", () => {
    const store = new SessionStore()
    store.newSession()
    store.push({ role: "user", content: "Hello" })
    store.push({ role: "assistant", content: "Hi there" })
    const messages = store.getActiveMessages()
    expect(messages.length).toBe(2)
    expect(messages[0].role).toBe("user")
    expect(messages[1].role).toBe("assistant")
  })

  it("switches active session", () => {
    const store = new SessionStore()
    store.newSession()
    store.push({ role: "user", content: "Session 1" })
    store.newSession()
    store.push({ role: "user", content: "Session 2" })
    const sessions = store.list()
    store.setActive(sessions[0].id)
    const messages = store.getActiveMessages()
    expect(messages[0].content).toBe("Session 1")
  })

  it("deletes a session", () => {
    const store = new SessionStore()
    store.newSession()
    const id = store.activeId
    store.newSession()
    store.deleteSession(id)
    expect(store.list().length).toBe(1)
  })

  it("returns empty messages for unknown session", () => {
    const store = new SessionStore()
    expect(store.getActiveMessages()).toEqual([])
  })

  it("respects max sessions limit", () => {
    const store = new SessionStore(3)
    store.newSession()
    store.newSession()
    store.newSession()
    store.newSession()
    expect(store.list().length).toBe(3)
  })

  it("generates unique session IDs", () => {
    const store = new SessionStore()
    store.newSession()
    const id1 = store.activeId
    store.newSession()
    const id2 = store.activeId
    expect(id1).not.toBe(id2)
  })
})
