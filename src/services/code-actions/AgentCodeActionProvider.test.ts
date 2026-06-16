import { describe, it, expect, vi, beforeEach } from "vitest"
import * as vscode from "vscode"
import { AgentCodeActionProvider } from "./AgentCodeActionProvider"

describe("AgentCodeActionProvider", () => {
  let provider: AgentCodeActionProvider

  beforeEach(() => {
    vi.clearAllMocks()
    provider = new AgentCodeActionProvider({} as any)
  })

  it("returns undefined for empty range", () => {
    const doc = { getText: vi.fn().mockReturnValue("code"), uri: { fsPath: "/test.ts" } } as any
    const range = { isEmpty: true } as vscode.Range
    const context = { diagnostics: [] } as vscode.CodeActionContext
    const result = provider.provideCodeActions(doc, range, context)
    expect(result).toBeUndefined()
  })

  it("returns fix action when diagnostics present", () => {
    const doc = { getText: vi.fn().mockReturnValue("code"), uri: { fsPath: "/test.ts" } } as any
    const range = { isEmpty: false } as vscode.Range
    const context = {
      diagnostics: [{ severity: 0, message: "error" }],
    } as vscode.CodeActionContext
    const result = provider.provideCodeActions(doc, range, context)
    expect(result).toBeDefined()
    expect(result!.length).toBeGreaterThan(0)
    const fix = result!.find((a) => a.title === "Исправить с помощью агента")
    expect(fix).toBeDefined()
    expect(fix!.isPreferred).toBe(true)
  })

  it("returns explain action", () => {
    const doc = { getText: vi.fn().mockReturnValue("code"), uri: { fsPath: "/test.ts" } } as any
    const range = { isEmpty: false } as vscode.Range
    const context = { diagnostics: [] } as vscode.CodeActionContext
    const result = provider.provideCodeActions(doc, range, context)
    expect(result).toBeDefined()
    const explain = result!.find((a) => a.title === "Объяснить код")
    expect(explain).toBeDefined()
  })

  it("returns improve action", () => {
    const doc = { getText: vi.fn().mockReturnValue("code"), uri: { fsPath: "/test.ts" } } as any
    const range = { isEmpty: false } as vscode.Range
    const context = { diagnostics: [] } as vscode.CodeActionContext
    const result = provider.provideCodeActions(doc, range, context)
    const improve = result!.find((a) => a.title === "Улучшить код")
    expect(improve).toBeDefined()
  })

  it("returns addToContext action", () => {
    const doc = { getText: vi.fn().mockReturnValue("code"), uri: { fsPath: "/test.ts" } } as any
    const range = { isEmpty: false } as vscode.Range
    const context = { diagnostics: [] } as vscode.CodeActionContext
    const result = provider.provideCodeActions(doc, range, context)
    const addToContext = result!.find((a) => a.title === "Добавить в контекст агента")
    expect(addToContext).toBeDefined()
  })

  it("fix action contains diagnostics text", () => {
    const doc = { getText: vi.fn().mockReturnValue("code"), uri: { fsPath: "/test.ts" } } as any
    const range = { isEmpty: false } as vscode.Range
    const context = {
      diagnostics: [
        { severity: 0, message: "err1" },
        { severity: 1, message: "warn1" },
      ],
    } as vscode.CodeActionContext
    const result = provider.provideCodeActions(doc, range, context)
    const fix = result!.find((a) => a.title === "Исправить с помощью агента")
    expect(fix!.command!.arguments[2]).toContain("err1")
    expect(fix!.command!.arguments[2]).toContain("warn1")
  })
})
