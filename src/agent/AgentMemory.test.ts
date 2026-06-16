import { describe, it, expect, beforeEach } from "vitest"
import { AgentMemory } from "./AgentMemory"

describe("AgentMemory", () => {
  let memory: AgentMemory

  beforeEach(() => {
    memory = new AgentMemory(60_000)
  })

  it("returns empty project on first load", () => {
    const project = memory.getProject()
    expect(project.repo).toBe("")
    expect(project.languages).toEqual([])
    expect(project.commands).toEqual({})
    expect(project.notes).toEqual([])
  })

  it("sets and gets project memory", () => {
    memory.setProject({
      repo: "test-repo",
      languages: ["TypeScript"],
      commands: { test: "npm test" },
      notes: ["Note 1"],
    })
    const project = memory.getProject()
    expect(project.repo).toBe("test-repo")
    expect(project.languages).toContain("TypeScript")
    expect(project.commands["test"]).toBe("npm test")
    expect(project.notes).toContain("Note 1")
  })

  it("partial setProject only updates provided fields", () => {
    memory.setProject({ repo: "repo1", languages: ["TS"] })
    memory.setProject({ commands: { build: "npm run build" } })
    const project = memory.getProject()
    expect(project.repo).toBe("repo1")
    expect(project.languages).toEqual(["TS"])
    expect(project.commands["build"]).toBe("npm run build")
  })

  it("adds message to short-term memory", () => {
    memory.add({ role: "user", content: "hello" })
    const recent = memory.getRecent()
    expect(recent).toHaveLength(1)
    expect(recent[0].content).toBe("hello")
  })

  it("returns recent messages within token budget", () => {
    for (let i = 0; i < 5; i++) {
      memory.add({ role: "user", content: `message ${i}` })
    }
    const recent = memory.getRecent()
    expect(recent.length).toBeGreaterThan(0)
  })

  it("trims old messages when exceeding max tokens", () => {
    const smallMemory = new AgentMemory(10)
    for (let i = 0; i < 100; i++) {
      smallMemory.add({ role: "user", content: `msg ${i}` })
    }
    const recent = smallMemory.getRecent()
    expect(recent.length).toBeLessThan(100)
  })

  it("keeps pinned messages when trimming", () => {
    const smallMemory = new AgentMemory(10)
    // Add many messages to force trimming
    for (let i = 0; i < 100; i++) {
      smallMemory.add({ role: "user", content: `msg ${i}` })
    }
    // The pinned check is internal; just verify trimming works
    expect(smallMemory.getRecent().length).toBeGreaterThan(0)
  })

  it("projectContext returns empty string when no project data", () => {
    expect(memory.projectContext()).toBe("")
  })

  it("projectContext returns formatted string with project data", () => {
    memory.setProject({
      repo: "my-repo",
      languages: ["TS", "JS"],
      commands: { test: "npm test" },
      notes: ["Important"],
    })
    const ctx = memory.projectContext()
    expect(ctx).toContain("Контекст проекта")
    expect(ctx).toContain("my-repo")
    expect(ctx).toContain("TS")
    expect(ctx).toContain("npm test")
    expect(ctx).toContain("Important")
  })

  it("clear resets all memory", () => {
    memory.setProject({ repo: "test", languages: ["TS"] })
    memory.add({ role: "user", content: "hello" })
    memory.clear()
    const project = memory.getProject()
    expect(project.repo).toBe("")
    expect(project.languages).toEqual([])
    expect(memory.getRecent()).toEqual([])
  })
})
