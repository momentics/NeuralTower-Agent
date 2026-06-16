import { describe, it, expect } from "vitest"
import { AgentMismatchError, AgentReplacementBlockedError } from "./ContextSource"

describe("AgentMismatchError", () => {
  it("creates error with expected message", () => {
    const err = new AgentMismatchError("expected", "actual")
    expect(err.message).toBe('Agent mismatch: expected "expected", got "actual"')
    expect(err.name).toBe("AgentMismatchError")
    expect(err.expectedAgent).toBe("expected")
    expect(err.actualAgent).toBe("actual")
  })
})

describe("AgentReplacementBlockedError", () => {
  it("creates error with expected message", () => {
    const err = new AgentReplacementBlockedError("sess1", "prev", "curr")
    expect(err.message).toBe('Agent replacement blocked in session sess1: "prev" -> "curr"')
    expect(err.name).toBe("AgentReplacementBlockedError")
    expect(err.sessionID).toBe("sess1")
    expect(err.previousAgent).toBe("prev")
    expect(err.currentAgent).toBe("curr")
  })
})
