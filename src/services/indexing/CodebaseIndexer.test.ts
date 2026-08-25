import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as vscode from "vscode"
import { CodebaseIndexer } from "./CodebaseIndexer"
import type { IFileIndex } from "../../repo/FileIndex"
import type { ICodebaseSearch } from "../../repo/CodebaseSearch"
import type { IEmbeddingProvider } from "../../backend/IEmbeddingProvider"
import type { ExtractionOrchestrator } from "../../repo/extraction/Orchestrator"
import type { NtGraphDb } from "../../repo/ntgraph"
import type { INode } from "../../repo/ntgraph/Types"

vi.mock("../../core/Logger", () => ({
  createDomainLogger: vi.fn(() => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  })),
}))

vi.mock("../../core/Config", () => ({
  INDEX_FILE_EVENT_DEBOUNCE_MS: 0,
}))

function createMockFileIndex(): IFileIndex {
  return {
    build: vi.fn().mockResolvedValue(undefined),
    findByPattern: vi.fn().mockReturnValue([]),
    findByLanguage: vi.fn().mockReturnValue([]),
    findByName: vi.fn().mockReturnValue([]),
    stats: vi.fn().mockReturnValue({ totalFiles: 0, languages: 0, totalSize: 0 }),
    clear: vi.fn(),
  }
}

function createMockOrchestrator(): ExtractionOrchestrator {
  return {
    indexAndResolve: vi.fn().mockResolvedValue({
      indexing: { indexed: 0, updated: 0, removed: 0, errors: [], durationMs: 0 },
      resolution: { resolved: [], unresolved: [], durationMs: 0 },
      durationMs: 0,
    }),
    indexFile: vi.fn().mockResolvedValue({
      nodes: [],
      edges: [],
      unresolvedReferences: [],
      errors: [],
      durationMs: 0,
    }),
  } as unknown as ExtractionOrchestrator
}

function createMockGraphDb(): NtGraphDb {
  return {
    getAllNodes: vi.fn().mockReturnValue([]),
    getNodesByFile: vi.fn().mockReturnValue([]),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
  } as unknown as NtGraphDb
}

function createMockSearch(): ICodebaseSearch {
  return {
    search: vi.fn().mockResolvedValue([]),
    indexChunks: vi.fn().mockResolvedValue(undefined),
    indexVectorChunks: vi.fn().mockResolvedValue(undefined),
    deleteByFile: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
    compactIfNeeded: vi.fn(),
    stats: vi.fn().mockReturnValue({
      vectorChunks: 0,
      ftsChunks: 0,
      embeddingAvailable: false,
    }),
  }
}

function createMockEmbeddingProvider(): IEmbeddingProvider {
  return {
    embed: vi.fn().mockResolvedValue([]),
    isAvailable: vi.fn().mockReturnValue(true),
    dimension: vi.fn().mockReturnValue(768),
    modelName: vi.fn().mockReturnValue("test-model"),
  }
}

describe("CodebaseIndexer", () => {
  let fileIndex: IFileIndex
  let orchestrator: ExtractionOrchestrator
  let graphDb: NtGraphDb
  let search: ICodebaseSearch
  let embeddingProvider: IEmbeddingProvider
  let indexer: CodebaseIndexer

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    fileIndex = createMockFileIndex()
    orchestrator = createMockOrchestrator()
    graphDb = createMockGraphDb()
    search = createMockSearch()
    embeddingProvider = createMockEmbeddingProvider()
    indexer = new CodebaseIndexer(fileIndex, search, embeddingProvider, orchestrator, graphDb)
  })

  afterEach(() => {
    indexer.dispose()
    vi.useRealTimers()
  })

  describe("fullIndex", () => {
    it("performs full indexing and transitions to idle state", async () => {
      const states: string[] = []
      indexer.onDidChangeState((s) => states.push(s))

      await indexer.fullIndex("/test/workspace")

      expect(search.clear).toHaveBeenCalledTimes(1)
      expect(fileIndex.build).toHaveBeenCalledWith("/test/workspace", undefined, undefined)
      expect(orchestrator.indexAndResolve).toHaveBeenCalledWith({ signal: undefined })
      expect(states).toContain("indexing")
      expect(indexer.getState()).toBe("idle")
    })

    it("does not start indexing if already indexing", async () => {
      ; (indexer as any).setState("indexing")

      await indexer.fullIndex("/test/workspace")

      expect(fileIndex.build).not.toHaveBeenCalled()
      expect(indexer.getState()).toBe("indexing")
    })

    it("does not start indexing if signal is already aborted", async () => {
      const signal = AbortSignal.abort()

      await indexer.fullIndex("/test/workspace", signal)

      expect(search.clear).not.toHaveBeenCalled()
      expect(fileIndex.build).not.toHaveBeenCalled()
    })

    it("transitions to error state when search.clear fails", async () => {
      ; (search.clear as any).mockRejectedValue(new Error("Index clear failed"))

      await indexer.fullIndex("/test/workspace")

      expect(indexer.getState()).toBe("error")
    })

    it("transitions to error state when fileIndex.build fails", async () => {
      ; (fileIndex.build as any).mockRejectedValue(new Error("Build failed"))

      await indexer.fullIndex("/test/workspace")

      expect(indexer.getState()).toBe("error")
    })

    it("transitions to error state when orchestrator.indexAndResolve fails", async () => {
      ; (orchestrator.indexAndResolve as any).mockRejectedValue(new Error("Extraction failed"))

      await indexer.fullIndex("/test/workspace")

      expect(indexer.getState()).toBe("error")
    })

    it("fills vector store from graph nodes, filtering non-symbol kinds", async () => {
      const nodes: INode[] = [
        {
          id: "n1",
          kind: "function",
          name: "foo",
          qualifiedName: "foo",
          filePath: "a.ts",
          language: "typescript",
          startLine: 1,
          endLine: 5,
          startColumn: 0,
          endColumn: 0,
          signature: "function foo()",
          updatedAt: 0,
        },
        {
          id: "n2",
          kind: "file",
          name: "a.ts",
          qualifiedName: "a.ts",
          filePath: "a.ts",
          language: "typescript",
          startLine: 1,
          endLine: 5,
          startColumn: 0,
          endColumn: 0,
          updatedAt: 0,
        },
      ]
      ; (graphDb.getAllNodes as any).mockReturnValue(nodes)

      await indexer.fullIndex("/test/workspace")

      expect(search.indexVectorChunks).toHaveBeenCalledTimes(1)
      const chunks = (search.indexVectorChunks as any).mock.calls[0][0]
      expect(chunks).toHaveLength(1)
      expect(chunks[0].id).toBe("n1")
      expect(chunks[0].content).toBe("function foo()")
      expect(chunks[0].nodeKind).toBe("function")
    })

    it("passes AbortSignal to all indexing stages", async () => {
      const controller = new AbortController()

      await indexer.fullIndex("/test/workspace", controller.signal)

      expect(fileIndex.build).toHaveBeenCalledWith("/test/workspace", undefined, controller.signal)
      expect(orchestrator.indexAndResolve).toHaveBeenCalledWith({ signal: controller.signal })
    })

    it("executes full pipeline in order: clear, build, indexAndResolve, indexVectorChunks", async () => {
      const callOrder: string[] = []

      ; (search.clear as any).mockImplementation(() => {
        callOrder.push("clear")
        return Promise.resolve()
      })
      ; (fileIndex.build as any).mockImplementation(() => {
        callOrder.push("build")
        return Promise.resolve()
      })
      ; (orchestrator.indexAndResolve as any).mockImplementation(() => {
        callOrder.push("indexAndResolve")
        return Promise.resolve({
          indexing: { indexed: 0, updated: 0, removed: 0, errors: [], durationMs: 0 },
          resolution: { resolved: [], unresolved: [], durationMs: 0 },
          durationMs: 0,
        })
      })
      ; (search.indexVectorChunks as any).mockImplementation(() => {
        callOrder.push("indexVectorChunks")
        return Promise.resolve()
      })

      await indexer.fullIndex("/test/workspace")

      expect(callOrder).toEqual(["clear", "build", "indexAndResolve", "indexVectorChunks"])
    })
  })

  describe("reindex", () => {
    it("calls fullIndex", async () => {
      await indexer.reindex("/test/workspace")

      expect(fileIndex.build).toHaveBeenCalled()
    })

    it("passes AbortSignal to fullIndex", async () => {
      const controller = new AbortController()

      await indexer.reindex("/test/workspace", controller.signal)

      expect(fileIndex.build).toHaveBeenCalledWith("/test/workspace", undefined, controller.signal)
    })
  })

  describe("getState", () => {
    it("returns idle by default", () => {
      expect(indexer.getState()).toBe("idle")
    })

    it("returns current state after indexing", async () => {
      await indexer.fullIndex("/test/workspace")
      expect(indexer.getState()).toBe("idle")
    })
  })

  describe("stats", () => {
    it("returns stats from search", () => {
      ; (search.stats as any).mockReturnValue({
        vectorChunks: 100,
        ftsChunks: 150,
        embeddingAvailable: true,
      })

      const stats = indexer.stats()

      expect(stats).toEqual({
        vectorChunks: 100,
        ftsChunks: 150,
        embeddingAvailable: true,
      })
    })
  })

  describe("onDidChangeState", () => {
    it("emits event when state changes", async () => {
      const states: string[] = []
      indexer.onDidChangeState((s) => states.push(s))

      await indexer.fullIndex("/test/workspace")

      expect(states).toContain("indexing")
    })
  })

  describe("scheduleOp and file events", () => {
    it("indexes changed file via onFileChanged", async () => {
      await indexer.fullIndex("/test/workspace")
      vi.clearAllMocks()

      const nodes: INode[] = [
        {
          id: "c1",
          kind: "function",
          name: "changed",
          qualifiedName: "changed",
          filePath: "changed.ts",
          language: "typescript",
          startLine: 1,
          endLine: 1,
          startColumn: 0,
          endColumn: 0,
          signature: "function changed()",
          updatedAt: 0,
        },
      ]
      ; (graphDb.getNodesByFile as any).mockReturnValue(nodes)

      indexer.scheduleOp("change", "/test/workspace/changed.ts" as any)
      await vi.runAllTimersAsync()

      expect(search.deleteByFile).toHaveBeenCalledWith("changed.ts")
      expect(orchestrator.indexFile).toHaveBeenCalledWith("changed.ts")
      expect(search.indexVectorChunks).toHaveBeenCalledWith([
        expect.objectContaining({ id: "c1", filePath: "changed.ts" }),
      ])
      expect(search.compactIfNeeded).toHaveBeenCalled()
    })

    it("removes index when file is deleted", async () => {
      await indexer.fullIndex("/test/workspace")
      vi.clearAllMocks()

      indexer.scheduleOp("delete", "/test/workspace/deleted.ts" as any)
      await vi.runAllTimersAsync()

      expect(graphDb.deleteFile).toHaveBeenCalledWith("deleted.ts")
      expect(search.deleteByFile).toHaveBeenCalledWith("deleted.ts")
      expect(search.compactIfNeeded).toHaveBeenCalled()
    })

    it("ignores files outside the workspace", async () => {
      await indexer.fullIndex("/test/workspace")
      vi.clearAllMocks()

      indexer.scheduleOp("change", "/other/place/file.ts" as any)
      await vi.runAllTimersAsync()

      expect(orchestrator.indexFile).not.toHaveBeenCalled()
      expect(search.deleteByFile).not.toHaveBeenCalled()
    })

    it("does not process events after dispose", async () => {
      await indexer.fullIndex("/test/workspace")
      vi.clearAllMocks()

      indexer.scheduleOp("change", "/test/workspace/file.ts" as any)
      indexer.dispose()

      await vi.runAllTimersAsync()

      expect(orchestrator.indexFile).not.toHaveBeenCalled()
    })

    it("does not process file changes during full indexing", async () => {
      let buildResolve: () => void
      ; (fileIndex.build as any).mockImplementation(
        () => new Promise((resolve) => { buildResolve = resolve })
      )

      const p = indexer.fullIndex("/test/workspace")

      indexer.scheduleOp("change", "/test/workspace/file.ts" as any)
      await vi.runAllTimersAsync()

      buildResolve!()
      await p

      expect(orchestrator.indexFile).not.toHaveBeenCalled()
    })
  })

  describe("dispose", () => {
    it("sets isDisposed and clears timers", () => {
      indexer.scheduleOp("change", "/test/file.ts" as any)
      indexer.dispose()

      expect(() => vi.runAllTimersAsync()).not.toThrow()
    })
  })
})
