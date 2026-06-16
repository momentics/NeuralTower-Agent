import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  makeEnvironmentProvider,
  makeRepoProvider,
  makeFileIndexProvider,
  makeProjectMemoryProvider,
  makeGitDiffProvider,
} from "./ContextSources"
import type { GitService } from "../services/git/GitService"
import type { RepoAnalyzer } from "../repo/RepoAnalyzer"
import type { FileIndex } from "../repo/FileIndex"
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
        getStatus: vi.fn(async () => ({})),
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

  describe("makeRepoProvider", () => {
    let mockAnalyzer: RepoAnalyzer

    beforeEach(() => {
      mockAnalyzer = {
        analyze: vi.fn(async () => ({
          fileCount: 100,
          dirCount: 10,
          languages: { TypeScript: 50, JavaScript: 30, Markdown: 2 },
          buildSystems: ["npm"],
          notableFiles: ["package.json", "tsconfig.json"],
        })),
      } as unknown as RepoAnalyzer
    })

    it("returns provider with correct name and priority", () => {
      const provider = makeRepoProvider(() => "/test", mockAnalyzer)
      expect(provider.description.name).toBe("repository")
      expect(provider.description.priority).toBe(90)
    })

    it("resolves repo data", async () => {
      const provider = makeRepoProvider(() => "/test", mockAnalyzer)
      const items = await provider.resolve("")
      expect(items).toHaveLength(1)
      expect(items[0].content).toContain("Файлов: 100")
      expect(items[0].content).toContain("Директорий: 10")
    })

    it("caches results within TTL", async () => {
      const provider = makeRepoProvider(() => "/test", mockAnalyzer)
      await provider.resolve("")
      await provider.resolve("")
      expect(mockAnalyzer.analyze).toHaveBeenCalledTimes(1)
    })

    it("refreshes cache after TTL", async () => {
      const provider = makeRepoProvider(() => "/test", mockAnalyzer, 0)
      await provider.resolve("")
      await provider.resolve("")
      expect(mockAnalyzer.analyze).toHaveBeenCalledTimes(2)
    })

    it("resolves with languages", async () => {
      const provider = makeRepoProvider(() => "/test", mockAnalyzer)
      const items = await provider.resolve("")
      expect(items[0].content).toContain("TypeScript")
      expect(items[0].content).toContain("JavaScript")
      expect(items[0].content).not.toContain("Markdown")
    })

    it("returns empty when no significant data", async () => {
      const mockEmpty = {
        analyze: vi.fn(async () => ({
          fileCount: 0,
          dirCount: 0,
          languages: {},
          buildSystems: [],
          notableFiles: [],
        })),
      } as unknown as RepoAnalyzer
      const provider = makeRepoProvider(() => "/test", mockEmpty)
      const items = await provider.resolve("")
      expect(items).toHaveLength(1)
      expect(items[0].content).toContain("Файлов: 0")
    })
  })

  describe("makeFileIndexProvider", () => {
    let mockIndex: FileIndex

    beforeEach(() => {
      mockIndex = {
        stats: vi.fn(() => ({ totalFiles: 50, languages: 3, totalSize: 10240 })),
        build: vi.fn(async () => {}),
        clear: vi.fn(),
      } as unknown as FileIndex
    })

    it("returns provider with correct name and priority", () => {
      const provider = makeFileIndexProvider(mockIndex)
      expect(provider.description.name).toBe("fileindex")
      expect(provider.description.priority).toBe(80)
    })

    it("resolves index stats", async () => {
      const provider = makeFileIndexProvider(mockIndex)
      const items = await provider.resolve("")
      expect(items).toHaveLength(1)
      expect(items[0].content).toContain("Всего: 50 файлов")
      expect(items[0].content).toContain("3 языков")
      expect(items[0].content).toContain("10.0 КБ")
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
          changed: ["file1.ts", "file2.ts"],
          additions: 10,
          deletions: 5,
        })),
        getStatus: vi.fn(async () => ({
          staged: ["file1.ts"],
          modified: ["file2.ts"],
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
      mockGit.getStatus = vi.fn(async () => { throw new Error("git error") })
      const provider = makeGitDiffProvider(() => "/test", mockGit)
      const items = await provider.resolve("")
      expect(items).toHaveLength(0)
    })

    it("returns empty for no changes", async () => {
      mockGit.getDiff = vi.fn(async () => ({ changed: [], additions: 0, deletions: 0 }))
      const provider = makeGitDiffProvider(() => "/test", mockGit)
      const items = await provider.resolve("")
      expect(items).toHaveLength(0)
    })
  })
})
