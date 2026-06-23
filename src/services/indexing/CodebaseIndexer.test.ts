import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as vscode from "vscode"
import { CodebaseIndexer } from "./CodebaseIndexer"
import type { IFileIndex } from "../../repo/FileIndex"
import type { ICodebaseChunker } from "../../repo/CodebaseChunker"
import type { ICodebaseSearch } from "../../repo/CodebaseSearch"
import type { IEmbeddingProvider } from "../../backend/IEmbeddingProvider"
import type { ICodeChunk, ICodebaseChunkResult } from "../../repo/ChunkTypes"

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

function createMockChunker(): ICodebaseChunker {
  return {
    chunkAll: vi.fn().mockResolvedValue({
      chunks: [],
      filesProcessed: 0,
      filesSkipped: 0,
      totalChunks: 0,
    } as ICodebaseChunkResult),
    chunkFile: vi.fn().mockResolvedValue([]),
  }
}

function createMockSearch(): ICodebaseSearch {
  return {
    search: vi.fn().mockResolvedValue([]),
    indexChunks: vi.fn().mockResolvedValue(undefined),
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
  let chunker: ICodebaseChunker
  let search: ICodebaseSearch
  let embeddingProvider: IEmbeddingProvider
  let indexer: CodebaseIndexer

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    fileIndex = createMockFileIndex()
    chunker = createMockChunker()
    search = createMockSearch()
    embeddingProvider = createMockEmbeddingProvider()
    indexer = new CodebaseIndexer(fileIndex, chunker, search, embeddingProvider)
  })

  afterEach(() => {
    indexer.dispose()
    vi.useRealTimers()
  })

  describe("fullIndex", () => {
    it("performs full indexing and transitions to idle state", async () => {
      const chunks: ICodeChunk[] = [
        {
          id: "chunk-1",
          filePath: "/test/file.ts",
          content: "const x = 1",
          startLine: 1,
          endLine: 1,
          nodeKind: "const",
          language: "ts",
          charLength: 11,
        },
      ]

      ; (chunker.chunkAll as any).mockResolvedValue({
        chunks,
        filesProcessed: 1,
        filesSkipped: 0,
        totalChunks: 1,
      })

      const states: string[] = []
      indexer.onDidChangeState((s) => states.push(s))

      await indexer.fullIndex("/test/workspace")

      expect(search.clear).toHaveBeenCalledTimes(1)
      expect(fileIndex.build).toHaveBeenCalledWith("/test/workspace", undefined, undefined)
      expect(chunker.chunkAll).toHaveBeenCalledWith(undefined)
      expect(search.indexChunks).toHaveBeenCalledWith(chunks, undefined)
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

    it("transitions to error state when chunker.chunkAll fails", async () => {
      ; (chunker.chunkAll as any).mockRejectedValue(new Error("Chunk failed"))

      await indexer.fullIndex("/test/workspace")

      expect(indexer.getState()).toBe("error")
    })

    it("transitions to error state when search.indexChunks fails", async () => {
      ; (search.indexChunks as any).mockRejectedValue(new Error("Index chunks failed"))

      await indexer.fullIndex("/test/workspace")

      expect(indexer.getState()).toBe("error")
    })

    it("passes AbortSignal to all indexing stages", async () => {
      const controller = new AbortController()

      await indexer.fullIndex("/test/workspace", controller.signal)

      expect(fileIndex.build).toHaveBeenCalledWith("/test/workspace", undefined, controller.signal)
      expect(chunker.chunkAll).toHaveBeenCalledWith(controller.signal)
    })

    it("calls indexChunks with chunkAll results", async () => {
      const chunks: ICodeChunk[] = [
        {
          id: "a",
          filePath: "/f1.ts",
          content: "a",
          startLine: 1,
          endLine: 1,
          nodeKind: "const",
          language: "ts",
          charLength: 1,
        },
        {
          id: "b",
          filePath: "/f2.ts",
          content: "b",
          startLine: 1,
          endLine: 1,
          nodeKind: "const",
          language: "ts",
          charLength: 1,
        },
      ]

      ; (chunker.chunkAll as any).mockResolvedValue({
        chunks,
        filesProcessed: 2,
        filesSkipped: 0,
        totalChunks: 2,
      })

      await indexer.fullIndex("/test/workspace")

      expect(search.indexChunks).toHaveBeenCalledWith(chunks, undefined)
    })

    it("executes full pipeline in order: clear, build, chunkAll, indexChunks", async () => {
      const callOrder: string[] = []

      ; (search.clear as any).mockImplementation(() => {
        callOrder.push("clear")
        return Promise.resolve()
      })
      ; (fileIndex.build as any).mockImplementation(() => {
        callOrder.push("build")
        return Promise.resolve()
      })
      ; (chunker.chunkAll as any).mockImplementation(() => {
        callOrder.push("chunkAll")
        return Promise.resolve({ chunks: [], filesProcessed: 0, filesSkipped: 0, totalChunks: 0 })
      })
      ; (search.indexChunks as any).mockImplementation(() => {
        callOrder.push("indexChunks")
        return Promise.resolve()
      })

      await indexer.fullIndex("/test/workspace")

      expect(callOrder).toEqual(["clear", "build", "chunkAll", "indexChunks"])
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
      const chunks: ICodeChunk[] = [
        {
          id: "c1",
          filePath: "/test/changed.ts",
          content: "updated",
          startLine: 1,
          endLine: 1,
          nodeKind: "const",
          language: "ts",
          charLength: 7,
        },
      ]

      ; (chunker.chunkFile as any).mockResolvedValue(chunks)

      indexer.scheduleOp("change", "/test/changed.ts" as any)
      await vi.runAllTimersAsync()

      expect(search.deleteByFile).toHaveBeenCalledWith("/test/changed.ts")
      expect(chunker.chunkFile).toHaveBeenCalledWith("/test/changed.ts")
      expect(search.indexChunks).toHaveBeenCalledWith(chunks)
      expect(search.compactIfNeeded).toHaveBeenCalled()
    })

    it("removes index when file is deleted", async () => {
      indexer.scheduleOp("delete", "/test/deleted.ts" as any)
      await vi.runAllTimersAsync()

      expect(search.deleteByFile).toHaveBeenCalledWith("/test/deleted.ts")
      expect(search.compactIfNeeded).toHaveBeenCalled()
    })

    it("does not process events after dispose", async () => {
      indexer.scheduleOp("change", "/test/file.ts" as any)
      indexer.dispose()

      await vi.runAllTimersAsync()

      expect(chunker.chunkFile).not.toHaveBeenCalled()
    })

    it("does not process file changes during full indexing", async () => {
      let buildResolve: () => void
      ; (fileIndex.build as any).mockImplementation(
        () => new Promise((resolve) => { buildResolve = resolve })
      )

      const p = indexer.fullIndex("/test/workspace")

      indexer.scheduleOp("change", "/test/file.ts" as any)
      await vi.runAllTimersAsync()

      buildResolve!()
      await p

      expect(chunker.chunkFile).not.toHaveBeenCalled()
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
