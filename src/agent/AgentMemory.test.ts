import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { AgentMemory } from "../../agent/AgentMemory"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

describe("AgentMemory", () => {
  let tmpDir: string
  let memory: AgentMemory

  beforeAll(async () => {
    tmpDir = path.join(os.tmpdir(), `agentmemory-test-${Date.now()}`)
    await fs.mkdir(tmpDir, { recursive: true })
    memory = new AgentMemory(tmpDir)
  })

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it("returns empty project on first load", async () => {
    const project = await memory.getProject()
    expect(project.repo).toBeUndefined()
    expect(project.languages).toEqual([])
    expect(project.commands).toEqual({})
    expect(project.notes).toEqual([])
  })

  it("saves and loads project memory", async () => {
    await memory.saveProject({
      repo: "test-repo",
      languages: ["TypeScript"],
      commands: { test: "npm test" },
      notes: ["Note 1"],
    })
    const project = await memory.getProject()
    expect(project.repo).toBe("test-repo")
    expect(project.languages).toContain("TypeScript")
    expect(project.commands["test"]).toBe("npm test")
    expect(project.notes).toContain("Note 1")
  })

  it("saves and loads session memory", async () => {
    await memory.saveSession("sess-1", {
      task: "Test task",
      progress: 50,
      context: "Test context",
      lastAction: "edit",
    })
    const session = await memory.getSession("sess-1")
    expect(session).toBeDefined()
    expect(session!.task).toBe("Test task")
    expect(session!.progress).toBe(50)
  })

  it("returns undefined for unknown session", async () => {
    const session = await memory.getSession("nonexistent")
    expect(session).toBeUndefined()
  })

  it("removes session", async () => {
    await memory.saveSession("sess-del", { task: "Delete me", progress: 0, context: "", lastAction: "" })
    await memory.removeSession("sess-del")
    const session = await memory.getSession("sess-del")
    expect(session).toBeUndefined()
  })

  it("saves and loads project notes", async () => {
    await memory.saveProjectNote("Important note")
    const project = await memory.getProject()
    expect(project.notes).toContain("Important note")
  })

  it("saves and loads project command", async () => {
    await memory.saveProjectCommand("build", "npm run build")
    const project = await memory.getProject()
    expect(project.commands["build"]).toBe("npm run build")
  })

  it("removes project command", async () => {
    await memory.removeProjectCommand("build")
    const project = await memory.getProject()
    expect(project.commands["build"]).toBeUndefined()
  })

  it("clears all memory", async () => {
    await memory.clear()
    const project = await memory.getProject()
    expect(project.repo).toBeUndefined()
    expect(project.notes).toEqual([])
  })
})
