import { describe, it, expect } from "vitest"
import { AgentEnvironment } from "./AgentEnvironment"
import { ContextManager } from "../core/ContextManager"
import { ContextProviderRegistry } from "../core/providers/context/registry"
import { FileIndex } from "../repo/FileIndex"
import { loadDefaultAgentConfig, loadDefaultCompactorConfig, loadDefaultContextConfig, loadDefaultSessionConfig } from "../core/config"

const createEnvironment = (workDir = "/test"): AgentEnvironment => {
  const contextManager = new ContextManager()
  const registry = new ContextProviderRegistry()
  const fileIndex = new FileIndex()
  return new AgentEnvironment(
    workDir,
    {
      backend: { url: "http://localhost:30000", model: "test", maxRetries: 3, timeoutMs: 60000 },
      agent: loadDefaultAgentConfig(),
      context: loadDefaultContextConfig(),
      compactor: loadDefaultCompactorConfig(),
      session: loadDefaultSessionConfig(),
    },
    registry,
    contextManager,
    fileIndex,
  )
}

describe("AgentEnvironment", () => {
  it("creates with defaults", () => {
    const env = createEnvironment()
    expect(env.workDir).toBe("/test")
    expect(env.gitService).toBeNull()
    expect(env.permissionManager).toBeNull()
    expect(env.mcpManager).toBeNull()
  })

  it("mutable properties can be set", () => {
    const env = createEnvironment()
    env.workDir = "/new/path"
    expect(env.workDir).toBe("/new/path")
  })

  it("resolveContextProvider returns empty for unknown", async () => {
    const env = createEnvironment()
    const result = await env.resolveContextProvider("nonexistent", "query")
    expect(result).toEqual([])
  })

  it("config is accessible", () => {
    const env = createEnvironment()
    expect(env.config.agent.maxIterations).toBe(20)
  })
})
