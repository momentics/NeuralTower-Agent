import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  makeEnvironmentSource,
  makeRepoSource,
  makeFileIndexSource,
  makeProjectMemorySource,
  makeGitDiffSource,
} from "../core/ContextSources"
import type { GitService } from "../services/git/GitService"
import type { RepoAnalyzer } from "../repo/RepoAnalyzer"
import type { FileIndex } from "../repo/FileIndex"
import type { AgentMemory } from "../agent/AgentMemory"

describe("ContextSources", () => {
  describe("makeEnvironmentSource", () => {
    it("returns source with correct key and priority", () => {
      const source = makeEnvironmentSource(() => "/test", async () => "model-1", undefined)
      expect(source.key).toBe("environment")
      expect(source.priority).toBe(100)
    })

    it("loads environment data", async () => {
      const source = makeEnvironmentSource(() => "/test", async () => "model-1", undefined)
      const data = await source.load()
      expect(data.model).toBe("model-1")
      expect(data.workDir).toBe("/test")
      expect(data.platform).toBe(process.platform)
      expect(data.branch).toBe("unknown")
    })

    it("includes branch from git service", async () => {
      const mockGit: GitService = {
        getBranchInfo: vi.fn(async () => ({ name: "main" })),
        getDiff: vi.fn(async () => ({ changed: [], additions: 0, deletions: 0 })),
        getStatus: vi.fn(async () => ({})),
        getDiffContext: vi.fn(async () => ""),
      } as unknown as GitService
      const source = makeEnvironmentSource(() => "/test", async () => "model-1", mockGit)
      const data = await source.load()
      expect(data.branch).toBe("main")
    })

    it("handles git service error gracefully", async () => {
      const mockGit: GitService = {
        getBranchInfo: vi.fn(async () => { throw new Error("git error") }),
      } as unknown as GitService
      const source = makeEnvironmentSource(() => "/test", async () => "model-1", mockGit)
      const data = await source.load()
      expect(data.branch).toBe("unknown")
    })

    it("generates baseline string", async () => {
      const source = makeEnvironmentSource(() => "/test", async () => "model-1", undefined)
      const data = await source.load()
      const baseline = source.baseline(data)
      expect(baseline).toContain("Модель: model-1")
      expect(baseline).toContain("Рабочая директория: /test")
      expect(baseline).toContain("<env>")
      expect(baseline).toContain("</env>")
    })

    it("generates update string", async () => {
      const source = makeEnvironmentSource(() => "/test", async () => "model-1", undefined)
      const data = await source.load()
      const update = source.update(data, { ...data, branch: "develop" })
      expect(update).toContain("develop")
    })
  })

  describe("makeRepoSource", () => {
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

    it("returns source with correct key and priority", () => {
      const source = makeRepoSource(() => "/test", mockAnalyzer)
      expect(source.key).toBe("repository")
      expect(source.priority).toBe(90)
    })

    it("loads repo data", async () => {
      const source = makeRepoSource(() => "/test", mockAnalyzer)
      const data = await source.load()
      expect(data.fileCount).toBe(100)
      expect(data.dirCount).toBe(10)
    })

    it("caches results within TTL", async () => {
      const source = makeRepoSource(() => "/test", mockAnalyzer)
      await source.load()
      await source.load()
      expect(mockAnalyzer.analyze).toHaveBeenCalledTimes(1)
    })

    it("refreshes cache after TTL", async () => {
      const source = makeRepoSource(() => "/test", mockAnalyzer, 0)
      await source.load()
      await source.load()
      expect(mockAnalyzer.analyze).toHaveBeenCalledTimes(2)
    })

    it("generates baseline with languages", async () => {
      const source = makeRepoSource(() => "/test", mockAnalyzer)
      const data = await source.load()
      const baseline = source.baseline(data)
      expect(baseline).toContain("Файлов: 100")
      expect(baseline).toContain("TypeScript, JavaScript")
      expect(baseline).not.toContain("Markdown")
    })

    it("generates update with file delta", async () => {
      const source = makeRepoSource(() => "/test", mockAnalyzer)
      const data = await source.load()
      const update = source.update(data, { ...data, fileCount: 110 })
      expect(update).toContain("+10")
    })
  })

  describe("makeFileIndexSource", () => {
    let mockIndex: FileIndex

    beforeEach(() => {
      mockIndex = {
        stats: vi.fn(() => ({ totalFiles: 50, languages: 3, totalSize: 10240 })),
        build: vi.fn(async () => {}),
        clear: vi.fn(),
      } as unknown as FileIndex
    })

    it("returns source with correct key and priority", () => {
      const source = makeFileIndexSource(mockIndex)
      expect(source.key).toBe("fileindex")
      expect(source.priority).toBe(80)
    })

    it("loads index stats", async () => {
      const source = makeFileIndexSource(mockIndex)
      const data = await source.load()
      expect(data.totalFiles).toBe(50)
    })

    it("generates baseline with stats", async () => {
      const source = makeFileIndexSource(mockIndex)
      const data = await source.load()
      const baseline = source.baseline(data)
      expect(baseline).toContain("Всего: 50 файлов")
      expect(baseline).toContain("3 языков")
      expect(baseline).toContain("10.0 КБ")
    })

    it("generates update with file count change", async () => {
      const source = makeFileIndexSource(mockIndex)
      const data = await source.load()
      const update = source.update(data, { totalFiles: 60, languages: 3, totalSize: 10240 })
      expect(update).toContain("60 файлов")
      expect(update).toContain("было 50")
    })
  })

  describe("makeProjectMemorySource", () => {
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

    it("returns source with correct key and priority", () => {
      const source = makeProjectMemorySource(mockMemory)
      expect(source.key).toBe("projectmemory")
      expect(source.priority).toBe(85)
    })

    it("loads project data", async () => {
      const source = makeProjectMemorySource(mockMemory)
      const data = await source.load()
      expect(data.repo).toBe("test-repo")
    })

    it("generates baseline with project info", async () => {
      const source = makeProjectMemorySource(mockMemory)
      const data = await source.load()
      const baseline = source.baseline(data)
      expect(baseline).toContain("Проект: test-repo")
      expect(baseline).toContain("TypeScript")
      expect(baseline).toContain("npm run build")
    })

    it("generates empty baseline for empty project", async () => {
      mockMemory.getProject = vi.fn(() => ({ repo: "", languages: [], commands: {}, notes: [] }))
      const source = makeProjectMemorySource(mockMemory)
      const data = await source.load()
      const baseline = source.baseline(data)
      expect(baseline).toBe("")
    })

    it("generates update for new notes", async () => {
      const source = makeProjectMemorySource(mockMemory)
      const data = await source.load()
      const update = source.update(data, { ...data, notes: ["Note 1", "Note 2"] })
      expect(update).toContain("1 заметок")
    })

    it("generates empty update for no changes", async () => {
      const source = makeProjectMemorySource(mockMemory)
      const data = await source.load()
      const update = source.update(data, data)
      expect(update).toBe("")
    })
  })

  describe("makeGitDiffSource", () => {
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

    it("returns source with correct key and priority", () => {
      const source = makeGitDiffSource(() => "/test", mockGit)
      expect(source.key).toBe("gitdiff")
      expect(source.priority).toBe(70)
    })

    it("loads git diff data", async () => {
      const source = makeGitDiffSource(() => "/test", mockGit)
      const data = await source.load()
      expect(data.diff).toBeDefined()
      expect(data.diff!.changed.length).toBe(2)
    })

    it("handles git errors gracefully", async () => {
      mockGit.getDiff = vi.fn(async () => { throw new Error("git error") })
      mockGit.getStatus = vi.fn(async () => { throw new Error("git error") })
      const source = makeGitDiffSource(() => "/test", mockGit)
      const data = await source.load()
      expect(data.diff).toBeNull()
      expect(data.status).toBeNull()
    })

    it("generates baseline with diff info", async () => {
      const source = makeGitDiffSource(() => "/test", mockGit)
      const data = await source.load()
      const baseline = source.baseline(data)
      expect(baseline).toContain("Файлов: 2")
      expect(baseline).toContain("+10")
      expect(baseline).toContain("-5")
    })

    it("generates empty baseline for no changes", async () => {
      mockGit.getDiff = vi.fn(async () => ({ changed: [], additions: 0, deletions: 0 }))
      const source = makeGitDiffSource(() => "/test", mockGit)
      const data = await source.load()
      const baseline = source.baseline(data)
      expect(baseline).toBe("")
    })

    it("generates update for changed file count", async () => {
      const source = makeGitDiffSource(() => "/test", mockGit)
      const data = await source.load()
      const update = source.update(data, {
        diff: { changed: ["f1", "f2", "f3"], additions: 15, deletions: 3 },
        status: null,
        dir: "/test",
      })
      expect(update).toContain("3 изменённых")
      expect(update).toContain("было 2")
    })

    it("generates empty update for no changes", async () => {
      const source = makeGitDiffSource(() => "/test", mockGit)
      const data = await source.load()
      const update = source.update(data, data)
      expect(update).toBe("")
    })

    it("generates empty update when diff is null", async () => {
      const source = makeGitDiffSource(() => "/test", mockGit)
      const data = await source.load()
      const update = source.update(data, { diff: null, status: null, dir: "/test" })
      expect(update).toBe("")
    })
  })
})
