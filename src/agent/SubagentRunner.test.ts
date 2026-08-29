import { describe, it, expect, vi, beforeEach } from "vitest"
import type { IBackend, IChatMessage } from "../core/IBackend"

const MockOrchestrator = {
  run: vi.fn().mockImplementation(() => {
    return new Promise((resolve) => {
      setTimeout(() => resolve({ role: "assistant", content: "done" }), 0)
    })
  }),
  dispose: vi.fn(),
}

vi.mock("./AgentOrchestrator", () => ({
  AgentOrchestrator: vi.fn().mockImplementation(() => ({ ...MockOrchestrator })),
}))

import { SubagentRunner, SubagentHandle } from "./SubagentRunner"

describe("SubagentHandle", () => {
  it("creates handle with correct id and config", () => {
    const config = { name: "test", task: "do", mode: "build" as const, workDir: "/work" }
    const ac = new AbortController()
    const handle = new SubagentHandle("id-1", config, {} as any, ac)
    expect(handle.id).toBe("id-1")
    expect(handle.config).toBe(config)
    expect(handle.isCancelled()).toBe(false)
  })

  it("cancel sets abort", () => {
    const ac = new AbortController()
    const handle = new SubagentHandle("id-1", { name: "t", task: "t", mode: "build" as const, workDir: "/w" }, {} as any, ac)
    handle.cancel()
    expect(handle.isCancelled()).toBe(true)
  })

  it("wait returns result", async () => {
    const result = Promise.resolve({ id: "id-1", name: "t", task: "t", mode: "build" as const, status: "completed" as const, output: "ok", durationMs: 0 })
    const ac = new AbortController()
    const handle = new SubagentHandle("id-1", { name: "t", task: "t", mode: "build" as const, workDir: "/w" }, {} as any, ac)
    handle._result = result
    const r = await handle.wait()
    expect(r.id).toBe("id-1")
  })
})

describe("SubagentRunner", () => {
  let backend: IBackend
  let runner: SubagentRunner

  beforeEach(() => {
    vi.clearAllMocks()
    backend = {
      listModels: vi.fn().mockResolvedValue(["model"]),
      healthCheck: vi.fn().mockResolvedValue(true),
      chat: vi.fn(),
      chatJson: vi.fn(),
      getConfig: vi.fn().mockResolvedValue({ url: "", model: "", maxRetries: 0, timeoutMs: 0 }),
      currentUrl: vi.fn(() => ""),
      updateConfig: vi.fn().mockResolvedValue(undefined),
    }

    runner = new SubagentRunner(
      backend,
      {} as any,
      {} as any,
      {} as any,
      vi.fn().mockReturnValue(MockOrchestrator),
    )
  })

  it("spawn creates handle and returns it", async () => {
    const handle = await runner.spawn({
      name: "test",
      task: "do something",
      mode: "build",
      workDir: "/work",
    })
    expect(handle.id).toMatch(/^subagent-/)
    expect(runner.listRunning()).toContain(handle)
    await handle.wait()
  })

  it("spawn calls onChunk and onDone", async () => {
    const onChunk = vi.fn()
    const onDone = vi.fn()
    const handle = await runner.spawn(
      { name: "test", task: "do", mode: "build", workDir: "/work" },
      onChunk,
      onDone,
    )
    const result = await handle.wait()
    expect(onDone).toHaveBeenCalledWith(result)
  })

  it("spawnAll runs all in parallel", async () => {
    const results = await runner.spawnAll([
      { name: "a", task: "t1", mode: "build", workDir: "/work" },
      { name: "b", task: "t2", mode: "build", workDir: "/work" },
    ])
    expect(results).toHaveLength(2)
  })

  it("listRunning returns running handles", async () => {
    const handle = await runner.spawn({
      name: "test",
      task: "do",
      mode: "build",
      workDir: "/work",
    })
    expect(runner.listRunning()).toContain(handle)
  })

  it("cancel cancels by id", () => {
    expect(runner.cancel("nonexistent")).toBe(false)
  })

  it("cancelAll cancels all", async () => {
    await runner.spawn({ name: "a", task: "t", mode: "build", workDir: "/w" })
    runner.cancelAll()
  })

  it("waitForAll waits for all", async () => {
    await runner.spawn({ name: "a", task: "t", mode: "build", workDir: "/w" })
    const results = await runner.waitForAll()
    expect(results).toHaveLength(1)
  })
})
