import { describe, it, expect, vi, beforeEach } from "vitest"
import { DiffViewerProvider } from "./DiffViewerProvider"
import type { GitDiffOutcome } from "../services/git/GitService"

describe("DiffViewerProvider", () => {
  let provider: DiffViewerProvider

  beforeEach(() => {
    provider = new DiffViewerProvider({ fsPath: "/ext", scheme: "file", path: "/ext" } as any)
  })

  it("has correct static properties", () => {
    expect(DiffViewerProvider.viewType).toBe("neuralTowerAgent.diffViewer")
    expect(DiffViewerProvider.title).toBe("Изменения агента")
  })

  it("opens panel without diff", () => {
    expect(() => provider.openPanel()).not.toThrow()
  })

  it("opens panel with diff", () => {
    const diff: GitDiffOutcome = {
      ok: true,
      changed: ["file1.ts", "file2.ts"],
      additions: 10,
      deletions: 5,
    }
    expect(() => provider.openPanel(diff)).not.toThrow()
  })

  it("reveals existing panel on second open", () => {
    provider.openPanel()
    const diff: GitDiffOutcome = {
      ok: true,
      changed: ["file1.ts"],
      additions: 3,
      deletions: 1,
    }
    expect(() => provider.openPanel(diff)).not.toThrow()
  })

  it("closes panel", () => {
    provider.openPanel()
    expect(() => provider.close()).not.toThrow()
  })

  it("disposes without error", () => {
    expect(() => provider.dispose()).not.toThrow()
  })

  it("disposes after opening panel", () => {
    provider.openPanel()
    expect(() => provider.dispose()).not.toThrow()
  })
})
