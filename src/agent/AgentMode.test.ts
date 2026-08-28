import { describe, it, expect, beforeEach } from "vitest"
import {
  toolMatchesRule,
  resolveToolPermission,
  BUILT_IN_MODES,
  AgentModeManager,
} from "./AgentMode"

describe("toolMatchesRule", () => {
  it("matches exact tool name", () => {
    expect(toolMatchesRule("read", { tool: "read", level: "allow" })).toBe(true)
    expect(toolMatchesRule("edit", { tool: "read", level: "allow" })).toBe(false)
  })

  it("matches wildcard *", () => {
    expect(toolMatchesRule("anything", { tool: "*", level: "ask" })).toBe(true)
  })

  it("matches prefix wildcard", () => {
    expect(toolMatchesRule("mcp_server:tool1", { tool: "mcp_*", level: "ask" })).toBe(true)
    expect(toolMatchesRule("mcp_server:tool1", { tool: "read", level: "allow" })).toBe(false)
  })

  it("matches suffix wildcard", () => {
    expect(toolMatchesRule("server_tool1", { tool: "*_tool1", level: "ask" })).toBe(true)
  })

  it("matches middle wildcard", () => {
    expect(toolMatchesRule("a_b_c", { tool: "a*_c", level: "ask" })).toBe(true)
  })

  it("escapes special regex chars in tool name", () => {
    expect(toolMatchesRule("test.tool", { tool: "test.tool", level: "allow" })).toBe(true)
    expect(toolMatchesRule("testXtool", { tool: "test.tool", level: "allow" })).toBe(false)
  })
})

describe("resolveToolPermission", () => {
  it("returns first matching rule level", () => {
    const mode = {
      name: "build" as const,
      displayName: "Build",
      description: "test",
      transitions: [] as const,
      toolRules: [
        { tool: "read", level: "allow" as const },
        { tool: "*", level: "ask" as const },
      ],
      systemPromptAddon: "",
      priority: 10,
    }
    expect(resolveToolPermission(mode, "read")).toBe("allow")
    expect(resolveToolPermission(mode, "bash")).toBe("ask")
  })

  it("returns ask for unmatched tools", () => {
    const mode = {
      name: "build" as const,
      displayName: "Build",
      description: "test",
      transitions: [] as const,
      toolRules: [],
      systemPromptAddon: "",
      priority: 10,
    }
    expect(resolveToolPermission(mode, "unknown")).toBe("ask")
  })
})

describe("BUILT_IN_MODES", () => {
  it("has all three modes", () => {
    expect(BUILT_IN_MODES).toHaveProperty("build")
    expect(BUILT_IN_MODES).toHaveProperty("plan")
    expect(BUILT_IN_MODES).toHaveProperty("explore")
  })

  it("build mode allows read and asks for edit", () => {
    expect(resolveToolPermission(BUILT_IN_MODES.build, "read")).toBe("allow")
    expect(resolveToolPermission(BUILT_IN_MODES.build, "edit")).toBe("ask")
    expect(resolveToolPermission(BUILT_IN_MODES.build, "bash")).toBe("ask")
  })

  it("plan mode denies edit, write, bash", () => {
    expect(resolveToolPermission(BUILT_IN_MODES.plan, "edit")).toBe("deny")
    expect(resolveToolPermission(BUILT_IN_MODES.plan, "write")).toBe("deny")
    expect(resolveToolPermission(BUILT_IN_MODES.plan, "bash")).toBe("deny")
  })

  it("explore mode denies edit and todo_write", () => {
    expect(resolveToolPermission(BUILT_IN_MODES.explore, "edit")).toBe("deny")
    expect(resolveToolPermission(BUILT_IN_MODES.explore, "todo_write")).toBe("deny")
  })

  it("build has correct transitions", () => {
    expect(BUILT_IN_MODES.build.transitions).toContain("plan")
    expect(BUILT_IN_MODES.build.transitions).toContain("explore")
  })

  it("plan only transitions to build", () => {
    expect(BUILT_IN_MODES.plan.transitions).toEqual(["build"])
  })
})

describe("AgentModeManager", () => {
  let mgr: AgentModeManager

  beforeEach(() => {
    mgr = new AgentModeManager()
  })

  it("starts in build mode", () => {
    expect(mgr.getModeName()).toBe("build")
  })

  it("returns current mode", () => {
    expect(mgr.getMode().name).toBe("build")
  })

  it("switches to allowed transition", () => {
    expect(mgr.switchMode("plan")).toBe(true)
    expect(mgr.getModeName()).toBe("plan")
  })

  it("allows build -> explore transition", () => {
    expect(mgr.switchMode("explore")).toBe(true)
    expect(mgr.getModeName()).toBe("explore")
  })

  it("rejects disallowed transition", () => {
    mgr.switchMode("plan")
    expect(mgr.switchMode("explore")).toBe(false)
    expect(mgr.getModeName()).toBe("plan")
  })

  it("checks tool permission in current mode", () => {
    expect(mgr.checkToolPermission("read")).toBe("allow")
    mgr.switchMode("plan")
    expect(mgr.checkToolPermission("edit")).toBe("deny")
  })

  it("returns system prompt addon", () => {
    expect(mgr.getSystemPromptAddon()).toContain("Построение")
  })

  it("lists modes sorted by priority", () => {
    const modes = mgr.listModes()
    expect(modes).toHaveLength(3)
    expect(modes[0].name).toBe("build")
    expect(modes[1].name).toBe("plan")
    expect(modes[2].name).toBe("explore")
  })

  it("registers custom mode", () => {
    mgr.registerMode({
      name: "build",
      displayName: "Custom Build",
      description: "custom",
      transitions: ["plan"] as const,
      toolRules: [],
      systemPromptAddon: "custom addon",
      priority: 10,
    })
    expect(mgr.getMode().displayName).toBe("Custom Build")
  })
})

describe("AgentModeManager events", () => {
  let mgr: AgentModeManager

  beforeEach(() => {
    mgr = new AgentModeManager()
  })

  it("fires onModeChanged on successful switch", () => {
    const events: string[] = []
    mgr.onModeChanged((mode) => events.push(mode))
    mgr.switchMode("plan")
    expect(events).toEqual(["plan"])
  })

  it("does not fire on rejected switch", () => {
    const events: string[] = []
    mgr.onModeChanged((mode) => events.push(mode))
    mgr.switchMode("plan")
    events.length = 0
    expect(mgr.switchMode("explore")).toBe(false)
    expect(events).toEqual([])
  })

  it("same-mode switch is a no-op returning true without event", () => {
    const events: string[] = []
    mgr.onModeChanged((mode) => events.push(mode))
    expect(mgr.switchMode("build")).toBe(true)
    expect(mgr.getModeName()).toBe("build")
    expect(events).toEqual([])
  })

  it("unsubscribe stops events", () => {
    const events: string[] = []
    const sub = mgr.onModeChanged((mode) => events.push(mode))
    sub.dispose()
    mgr.switchMode("plan")
    expect(events).toEqual([])
  })

  it("resetMode returns to build and fires event", () => {
    const events: string[] = []
    mgr.onModeChanged((mode) => events.push(mode))
    mgr.switchMode("plan")
    events.length = 0
    mgr.resetMode()
    expect(mgr.getModeName()).toBe("build")
    expect(events).toEqual(["build"])
  })

  it("resetMode does not fire when already in build", () => {
    const events: string[] = []
    mgr.onModeChanged((mode) => events.push(mode))
    mgr.resetMode()
    expect(events).toEqual([])
  })
})
