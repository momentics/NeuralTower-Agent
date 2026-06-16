import { describe, it, expect, vi } from "vitest"
import { SessionStore } from "./SessionStore"

describe("SessionStore", () => {
  it("starts with default active session", () => {
    const store = new SessionStore()
    expect(store.active).toEqual([])
  })

  it("pushes messages to active session", () => {
    const store = new SessionStore()
    store.push({ role: "user", content: "Hello" })
    store.push({ role: "assistant", content: "Hi there" })
    expect(store.active.length).toBe(2)
    expect(store.active[0].role).toBe("user")
    expect(store.active[1].role).toBe("assistant")
  })

  it("creates a new session", () => {
    const store = new SessionStore()
    store.push({ role: "user", content: "Default" })
    const id = store.newSession()
    expect(id).toMatch(/^session-/)
    expect(store.active).toEqual([])
  })

  it("newSession returns unique IDs", () => {
    const store = new SessionStore()
    store.newSession()
    const id1 = store.newSession()
    vi.useFakeTimers()
    vi.advanceTimersByTime(1)
    const id2 = store.newSession()
    vi.useRealTimers()
    expect(id1).not.toBe(id2)
  })

  it("clear resets to default", () => {
    const store = new SessionStore()
    store.push({ role: "user", content: "Msg" })
    store.newSession()
    store.clear()
    expect(store.active).toEqual([])
  })

  it("dispose clears all data", () => {
    const store = new SessionStore()
    store.push({ role: "user", content: "Msg" })
    store.dispose()
    expect(store.active).toEqual([])
  })
})
