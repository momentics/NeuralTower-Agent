import { describe, it, expect, vi, beforeEach } from "vitest"
import { ContextProviderRegistry } from "./Registry"

describe("ContextProviderRegistry", () => {
  let reg: ContextProviderRegistry

  beforeEach(() => {
    reg = new ContextProviderRegistry()
  })

  it("registers and retrieves provider", () => {
    const provider = {
      description: { name: "test", displayTitle: "Test", description: "desc", type: "normal" as const },
      resolve: vi.fn().mockResolvedValue([]),
    }
    reg.register(provider)
    expect(reg.get("test")).toBe(provider)
    expect(reg.has("test")).toBe(true)
  })

  it("unregisters provider", () => {
    const provider = {
      description: { name: "test", displayTitle: "Test", description: "desc", type: "normal" as const },
      resolve: vi.fn().mockResolvedValue([]),
    }
    reg.register(provider)
    reg.unregister("test")
    expect(reg.get("test")).toBeUndefined()
    expect(reg.has("test")).toBe(false)
  })

  it("lists providers", () => {
    const p1 = {
      description: { name: "a", displayTitle: "A", description: "a", type: "normal" as const },
      resolve: vi.fn().mockResolvedValue([]),
    }
    const p2 = {
      description: { name: "b", displayTitle: "B", description: "b", type: "normal" as const },
      resolve: vi.fn().mockResolvedValue([]),
    }
    reg.register(p1)
    reg.register(p2)
    expect(reg.list()).toHaveLength(2)
  })

  it("returns undefined for missing provider", () => {
    expect(reg.get("missing")).toBeUndefined()
    expect(reg.has("missing")).toBe(false)
  })
})
