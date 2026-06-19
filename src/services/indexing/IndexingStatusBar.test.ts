import { describe, it, expect, vi, beforeEach } from "vitest"
import * as vscode from "vscode"
import { IndexingStatusBar } from "./IndexingStatusBar"
import type { CodebaseIndexer, IndexingState } from "./CodebaseIndexer"

describe("IndexingStatusBar", () => {
  let statusBar: any
  let statusBarInstance: IndexingStatusBar
  let stateEmitter: vscode.EventEmitter<IndexingState>

  function createMockIndexer(state: IndexingState = "idle"): CodebaseIndexer {
    stateEmitter = new vscode.EventEmitter()
    return {
      getState: vi.fn().mockReturnValue(state),
      getStats: vi.fn().mockReturnValue({
        vectorChunks: 100,
        ftsChunks: 150,
        embeddingAvailable: true,
      }),
      onDidChangeState: stateEmitter.event,
      reindex: vi.fn().mockResolvedValue(undefined),
      start: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn(),
    } as unknown as CodebaseIndexer
  }

  beforeEach(() => {
    vi.clearAllMocks()

    statusBar = {
      text: "",
      color: undefined,
      tooltip: "",
      command: undefined,
      show: vi.fn(),
      dispose: vi.fn(),
    }
    vi.spyOn(vscode.window, "createStatusBarItem").mockReturnValue(statusBar)
  })

  it("creates status bar item", () => {
    const mockIndexer = createMockIndexer()
    statusBarInstance = new IndexingStatusBar(mockIndexer)
    expect(vscode.window.createStatusBarItem).toHaveBeenCalledWith(
      vscode.StatusBarAlignment.Right,
      98,
    )
  })

  it("sets command to reindex", () => {
    const mockIndexer = createMockIndexer()
    statusBarInstance = new IndexingStatusBar(mockIndexer)
    expect(statusBar.command).toBe("neuralTowerAgent.reindex")
  })

  it("init shows idle state with stats", async () => {
    const mockIndexer = createMockIndexer("idle")
    statusBarInstance = new IndexingStatusBar(mockIndexer)
    await statusBarInstance.init()
    expect(statusBar.text).toBe("$(check) Индекс: 150")
    expect(statusBar.tooltip).toContain("Индекс кодовой базы: готов")
    expect(statusBar.tooltip).toContain("FTS-чанков: 150")
    expect(statusBar.tooltip).toContain("Векторных чанков: 100")
    expect(statusBar.tooltip).toContain("Эмбеддинги: доступны")
    expect(statusBar.show).toHaveBeenCalled()
  })

  it("shows indexing state when state changes", async () => {
    const mockIndexer = createMockIndexer("idle")
    statusBarInstance = new IndexingStatusBar(mockIndexer)
    await statusBarInstance.init()

    stateEmitter.fire("indexing")

    expect(statusBar.text).toBe("$(loading~spin) Индексация...")
    expect(statusBar.tooltip).toBe("Индексация кодовой базы...")
  })

  it("shows error state when state changes", async () => {
    const mockIndexer = createMockIndexer("idle")
    statusBarInstance = new IndexingStatusBar(mockIndexer)
    await statusBarInstance.init()

    stateEmitter.fire("error")

    expect(statusBar.text).toBe("$(error) Индекс: ошибка")
    expect(statusBar.tooltip).toContain("ошибка")
  })

  it("dispose disposes status bar", () => {
    const mockIndexer = createMockIndexer()
    statusBarInstance = new IndexingStatusBar(mockIndexer)
    statusBarInstance.dispose()
    expect(statusBar.dispose).toHaveBeenCalled()
  })
})
