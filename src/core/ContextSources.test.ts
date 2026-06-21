import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  makeEnvironmentProvider,
  makeProjectMemoryProvider,
  makeGitDiffProvider,
} from "./ContextSources"
import type { GitService } from "../services/git/GitService"
import type { AgentMemory } from "../agent/AgentMemory"

describe("ContextSources", () => {
  describe("makeEnvironmentProvider", () => {
    it("returns provider with correct name and priority", () => {
      const provider = makeEnvironmentProvider(() => "/test", async () => "model-1", undefined)
      expect(provider.description.name).toBe("environment")
      expect(provider.description.priority).toBe(100)
    })

    it("resolves environment data", async () => {
      const provider = makeEnvironmentProvider(() => "/test", async () => "model-1", undefined)
      const items = await provider.resolve("")
      expect(items).toHaveLength(1)
      expect(items[0].content).toContain("Модель: model-1")
      expect(items[0].content).toContain("Рабочая директория: /test")
      expect(items[0].content).toContain("Платформа: win32")
      expect(items[0].content).toContain("Ветка: unknown")
    })

    it("includes branch from git service", async () => {
      const mockGit: GitService = {
        getBranchInfo: vi.fn(async () => ({ name: "main" })),
        getDiff: vi.fn(async () => ({ changed: [], additions: 0, deletions: 0 })),
        getDiffContext: vi.fn(async () => ""),
      } as unknown as GitService
      const provider = makeEnvironmentProvider(() => "/test", async () => "model-1", mockGit)
      const items = await provider.resolve("")
      expect(items[0].content).toContain("Ветка: main")
    })

    it("handles git service error gracefully", async () => {
      const mockGit: GitService = {
        getBranchInfo: vi.fn(async () => { throw new Error("git error") }),
      } as unknown as GitService
      const provider = makeEnvironmentProvider(() => "/test", async () => "model-1", mockGit)
      const items = await provider.resolve("")
      expect(items[0].content).toContain("Ветка: unknown")
    })
  })

  describe("makeProjectMemoryProvider", () => {
    let mockMemory: AgentMemory

    beforeEach(() => {
      mockMemory = {
        getProject: vi.fn(() => ({
          repo: "test-repo",
          languages: ["TypeScript"],
          commands: { build: "npm run build" },
          notes: ["Note 1"],
        })),
        add: vi.fn(),
        getRecent: vi.fn(() => []),
        clear: vi.fn(),
        setProject: vi.fn(),
        projectContext: vi.fn(() => ""),
      } as unknown as AgentMemory
    })

    it("returns provider with correct name and priority", () => {
      const provider = makeProjectMemoryProvider(mockMemory)
      expect(provider.description.name).toBe("projectmemory")
      expect(provider.description.priority).toBe(85)
    })

    it("resolves project data", async () => {
      const provider = makeProjectMemoryProvider(mockMemory)
      const items = await provider.resolve("")
      expect(items).toHaveLength(1)
      expect(items[0].content).toContain("Проект: test-repo")
      expect(items[0].content).toContain("TypeScript")
      expect(items[0].content).toContain("npm run build")
    })

    it("returns empty for empty project", async () => {
      mockMemory.getProject = vi.fn(() => ({ repo: "", languages: [], commands: {}, notes: [] }))
      const provider = makeProjectMemoryProvider(mockMemory)
      const items = await provider.resolve("")
      expect(items).toHaveLength(0)
    })
  })

  describe("makeGitDiffProvider", () => {
    let mockGit: GitService

    beforeEach(() => {
      mockGit = {
        getDiff: vi.fn(async () => ({
          ok: true,
          changed: ["file1.ts", "file2.ts"],
          additions: 10,
          deletions: 5,
        })),
        getBranchInfo: vi.fn(async () => ({ name: "main" })),
        getDiffContext: vi.fn(async () => ""),
      } as unknown as GitService
    })

    it("returns provider with correct name and priority", () => {
      const provider = makeGitDiffProvider(() => "/test", mockGit)
      expect(provider.description.name).toBe("gitdiff")
      expect(provider.description.priority).toBe(70)
    })

    it("resolves git diff data", async () => {
      const provider = makeGitDiffProvider(() => "/test", mockGit)
      const items = await provider.resolve("")
      expect(items).toHaveLength(1)
      expect(items[0].content).toContain("Файлов: 2")
      expect(items[0].content).toContain("+10")
      expect(items[0].content).toContain("-5")
    })

    it("handles git errors gracefully", async () => {
      mockGit.getDiff = vi.fn(async () => { throw new Error("git error") })
      const provider = makeGitDiffProvider(() => "/test", mockGit)
      const items = await provider.resolve("")
      expect(items).toHaveLength(0)
    })

    it("returns empty for no changes", async () => {
      mockGit.getDiff = vi.fn(async () => ({ ok: true, changed: [], additions: 0, deletions: 0 }))
      const provider = makeGitDiffProvider(() => "/test", mockGit)
      const items = await provider.resolve("")
      expect(items).toHaveLength(0)
    })
  })
})
