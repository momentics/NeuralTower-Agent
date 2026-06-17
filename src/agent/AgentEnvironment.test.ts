import { describe, it, expect } from "vitest"
import type { AgentDependencies } from "./AgentDependencies"
import { ContextManager } from "../core/ContextManager"
import { ContextProviderRegistry } from "../core/providers/context/registry"
import { FileIndex } from "../repo/FileIndex"
import { loadDefaultAgentConfig, loadDefaultCompactorConfig, loadDefaultContextConfig, loadDefaultSessionConfig } from "../core/config"

const createDeps = (workDir = "/test"): AgentDependencies => {
  const contextManager = new ContextManager()
  const registry = new ContextProviderRegistry()
  const fileIndex = new FileIndex()
  return {
    getWorkDir: () => workDir,
    config: {
      backend: { url: "http://localhost:30000", model: "test", maxRetries: 3, timeoutMs: 60000 },
      agent: loadDefaultAgentConfig(),
      context: loadDefaultContextConfig(),
      compactor: loadDefaultCompactorConfig(),
      session: loadDefaultSessionConfig(),
    },
    contextProviderRegistry: registry,
    contextManager,
    fileIndex,
    gitService: null,
    permissionManager: null,
    mcpManager: null,
  }
}

describe("AgentDependencies", () => {
  it("creates with defaults", () => {
    const deps = createDeps()
    expect(deps.getWorkDir()).toBe("/test")
    expect(deps.gitService).toBeNull()
    expect(deps.permissionManager).toBeNull()
    expect(deps.mcpManager).toBeNull()
  })

  it("getWorkDir returns work directory", () => {
    const deps = createDeps("/custom/path")
    expect(deps.getWorkDir()).toBe("/custom/path")
  })

  it("config is accessible", () => {
    const deps = createDeps()
    expect(deps.config.agent.maxIterations).toBe(20)
  })

  it("contextManager is accessible", () => {
    const deps = createDeps()
    expect(deps.contextManager).toBeDefined()
  })

  it("contextProviderRegistry is accessible", () => {
    const deps = createDeps()
    expect(deps.contextProviderRegistry).toBeDefined()
  })

  it("fileIndex is accessible", () => {
    const deps = createDeps()
    expect(deps.fileIndex).toBeDefined()
  })
})
