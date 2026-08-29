import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as vscode from "vscode"
import { DiffViewerProvider } from "./DiffViewerProvider"
import type { GitDiffOutcome } from "../services/git/GitService"

const EMPTY_DIFF: GitDiffOutcome = { ok: true, changed: [], additions: 0, deletions: 0 }

describe("DiffViewerProvider", () => {
  let provider: DiffViewerProvider

  beforeEach(() => {
    provider = new DiffViewerProvider({ fsPath: "/ext", scheme: "file", path: "/ext" } as any)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("has correct static properties", () => {
    expect(DiffViewerProvider.viewType).toBe("neuralTowerAgent.diffViewer")
    expect(DiffViewerProvider.title).toBe("Изменения агента")
  })

  it("opens panel without diff", () => {
    expect(() => provider.openPanel({ type: "workspace", diff: EMPTY_DIFF })).not.toThrow()
  })

  it("opens panel with diff", () => {
    const diff: GitDiffOutcome = {
      ok: true,
      changed: ["file1.ts", "file2.ts"],
      additions: 10,
      deletions: 5,
    }
    expect(() => provider.openPanel({ type: "workspace", diff })).not.toThrow()
  })

  it("opens panel in request mode", () => {
    expect(() =>
      provider.openPanel({
        type: "request",
        runId: "run-1",
        files: [{ path: "/w/a.ts", status: "modified", diff: "", userTouched: false }],
      }),
    ).not.toThrow()
  })

  it("reveals existing panel on second open", () => {
    provider.openPanel({ type: "workspace", diff: EMPTY_DIFF })
    const diff: GitDiffOutcome = {
      ok: true,
      changed: ["file1.ts"],
      additions: 3,
      deletions: 1,
    }
    expect(() => provider.openPanel({ type: "workspace", diff })).not.toThrow()
  })

  it("closes panel", () => {
    provider.openPanel({ type: "workspace", diff: EMPTY_DIFF })
    expect(() => provider.close()).not.toThrow()
  })

  it("disposes without error", () => {
    expect(() => provider.dispose()).not.toThrow()
  })

  it("disposes after opening panel", () => {
    provider.openPanel({ type: "workspace", diff: EMPTY_DIFF })
    expect(() => provider.dispose()).not.toThrow()
  })

  it("revertSelected message calls the registered handler", () => {
    const handler = vi.fn()
    provider.setRevertSelectedHandler(handler)
    const createSpy = vi.spyOn(vscode.window, "createWebviewPanel")
    provider.openPanel({ type: "workspace", diff: EMPTY_DIFF })
    const panel = createSpy.mock.results[0].value as { fireMessage: (msg: unknown) => void }
    panel.fireMessage({ type: "revertSelected", runId: "r", files: ["/a"] })
    expect(handler).toHaveBeenCalledWith("r", ["/a"])
  })

  it("revertSelected with malformed files is ignored", () => {
    const handler = vi.fn()
    provider.setRevertSelectedHandler(handler)
    const createSpy = vi.spyOn(vscode.window, "createWebviewPanel")
    provider.openPanel({ type: "workspace", diff: EMPTY_DIFF })
    const panel = createSpy.mock.results[0].value as { fireMessage: (msg: unknown) => void }
    panel.fireMessage({ type: "revertSelected", runId: "r", files: "not-an-array" })
    expect(handler).toHaveBeenCalledWith("r", [])
    panel.fireMessage({ type: "other" })
    expect(handler).toHaveBeenCalledTimes(1)
  })
})
