import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { AutocompleteService } from "./AutocompleteService"
import * as vscode from "vscode"
import { TEST_BACKEND_URL, makeTestBackendConfig } from "../../__tests__/fixtures"

const mockBackend = {
  chat: vi.fn(),
  chatJson: vi.fn(),
  listModels: vi.fn(),
  healthCheck: vi.fn(),
  getConfig: vi.fn().mockResolvedValue(makeTestBackendConfig()),
  currentUrl: vi.fn(() => TEST_BACKEND_URL),
  updateConfig: vi.fn(),
}

describe("AutocompleteService", () => {
  let service: AutocompleteService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new AutocompleteService(mockBackend as any)
  })

  afterEach(() => {
    service.dispose()
  })

  it("has correct name", () => {
    expect(service.name).toBe("autocomplete")
  })

  it("init sets isInitialized", async () => {
    await service.init()
    expect((service as any).isInitialized).toBe(true)
  })

  it("dispose clears state", async () => {
    await service.init()
    service.dispose()
    expect((service as any).isInitialized).toBe(false)
  })

  it("returns undefined when not initialized", async () => {
    const doc = createMockDocument("const x = 1")
    const pos = new vscode.Position(0, 0)
    const result = await service.provideInlineCompletionItems(
      doc as any,
      pos,
      { triggerKind: 1 } as any,
      { isCancellationRequested: false } as any,
    )
    expect(result).toBeUndefined()
  })

  it("returns undefined when disabled", async () => {
    await service.init()
    const getSpy = vi.fn().mockReturnValue(false)
    const origGet = vscode.workspace.getConfiguration
    ;(vscode.workspace.getConfiguration as any) = vi.fn().mockReturnValue({
      get: getSpy,
    })

    const doc = createMockDocument("const x = 1")
    const pos = new vscode.Position(0, 0)
    const result = await service.provideInlineCompletionItems(
      doc as any,
      pos,
      { triggerKind: 1 } as any,
      { isCancellationRequested: false } as any,
    )

    ;(vscode.workspace.getConfiguration as any) = origGet
    expect(result).toBeUndefined()
  })

  it("returns fast prefix completion for short prefixes", async () => {
    await service.init()

    const doc = createMockDocument("con")
    const pos = new vscode.Position(0, 3)

    const result = await service.provideInlineCompletionItems(
      doc as any,
      pos,
      { triggerKind: 1 } as any,
      { isCancellationRequested: false } as any,
    )

    expect(result).toBeDefined()
    expect(result).toHaveLength(1)
    expect(result![0].insertText).toBe("const")
  })

  it("returns fast prefix completion for method prefix", async () => {
    await service.init()

    const doc = createMockDocument("arr.ma")
    const pos = new vscode.Position(0, 6)

    const result = await service.provideInlineCompletionItems(
      doc as any,
      pos,
      { triggerKind: 1 } as any,
      { isCancellationRequested: false } as any,
    )

    expect(result).toBeDefined()
    expect(result).toHaveLength(1)
    expect(result![0].insertText).toBe("map")
  })

  it("returns undefined for single char prefix", async () => {
    await service.init()

    const doc = createMockDocument("c")
    const pos = new vscode.Position(0, 1)

    const result = await service.provideInlineCompletionItems(
      doc as any,
      pos,
      { triggerKind: 1 } as any,
      { isCancellationRequested: false } as any,
    )

    expect(result).toBeUndefined()
  })

  it("calls backend for non-prefix completions", async () => {
    await service.init()

    mockBackend.chat.mockResolvedValue({
      role: "assistant",
      content: "function hello() {\n  return 'world';\n}",
      timestamp: Date.now(),
    })

    const doc = createMockDocument("function h", 100, 20)
    const pos = new vscode.Position(0, 11)

    // Необходимо подождать debounce
    const result = await service.provideInlineCompletionItems(
      doc as any,
      pos,
      { triggerKind: 1 } as any,
      { isCancellationRequested: false } as any,
    )

    // Ждём срабатывания debounce
    await new Promise((r) => setTimeout(r, 200))

    expect(mockBackend.chat).toHaveBeenCalled()
    expect(result).toBeDefined()
    expect(result).toHaveLength(1)
    expect(result![0].insertText).toContain("function hello")
  })

  it("caches completion results", async () => {
    await service.init()

    mockBackend.chat.mockResolvedValue({
      role: "assistant",
      content: "cached result",
      timestamp: Date.now(),
    })

    const doc = createMockDocument("const x = ", 100, 20)
    const pos = new vscode.Position(0, 10)

    const result1 = await service.provideInlineCompletionItems(
      doc as any,
      pos,
      { triggerKind: 1 } as any,
      { isCancellationRequested: false } as any,
    )

    await new Promise((r) => setTimeout(r, 200))

    expect(mockBackend.chat).toHaveBeenCalledTimes(1)

    const result2 = await service.provideInlineCompletionItems(
      doc as any,
      pos,
      { triggerKind: 1 } as any,
      { isCancellationRequested: false } as any,
    )

    expect(mockBackend.chat).toHaveBeenCalledTimes(1)
    expect(result2).toBeDefined()
    expect(result2![0].insertText).toBe("cached result")
  })

  it("returns undefined when backend returns empty content", async () => {
    await service.init()

    mockBackend.chat.mockResolvedValue({
      role: "assistant",
      content: "",
      timestamp: Date.now(),
    })

    const doc = createMockDocument("const x = ", 100, 20)
    const pos = new vscode.Position(0, 10)

    const result = await service.provideInlineCompletionItems(
      doc as any,
      pos,
      { triggerKind: 1 } as any,
      { isCancellationRequested: false } as any,
    )

    await new Promise((r) => setTimeout(r, 200))

    expect(result).toBeUndefined()
  })

  it("returns undefined when backend throws", async () => {
    await service.init()

    mockBackend.chat.mockRejectedValue(new Error("backend error"))

    const doc = createMockDocument("const x = ", 100, 20)
    const pos = new vscode.Position(0, 10)

    const result = await service.provideInlineCompletionItems(
      doc as any,
      pos,
      { triggerKind: 1 } as any,
      { isCancellationRequested: false } as any,
    )

    await new Promise((r) => setTimeout(r, 200))

    expect(result).toBeUndefined()
  })

  it("cleans completion of code fences", async () => {
    await service.init()

    mockBackend.chat.mockResolvedValue({
      role: "assistant",
      content: "```typescript\nconst x = 1\n```",
      timestamp: Date.now(),
    })

    const doc = createMockDocument("const x = ", 100, 20)
    const pos = new vscode.Position(0, 10)

    const result = await service.provideInlineCompletionItems(
      doc as any,
      pos,
      { triggerKind: 1 } as any,
      { isCancellationRequested: false } as any,
    )

    await new Promise((r) => setTimeout(r, 200))

    expect(result).toBeDefined()
    expect(result![0].insertText).toBe("const x = 1")
  })

  it("builds prompt with before/after context", async () => {
    await service.init()

    mockBackend.chat.mockResolvedValue({
      role: "assistant",
      content: "x",
      timestamp: Date.now(),
    })

    const doc = createMockDocument("const x = 1\nconst y = 2", 100, 20)
    const pos = new vscode.Position(0, 11)

    await service.provideInlineCompletionItems(
      doc as any,
      pos,
      { triggerKind: 1 } as any,
      { isCancellationRequested: false } as any,
    )

    await new Promise((r) => setTimeout(r, 200))

    const callArgs = (mockBackend.chat as any).mock.calls[0][0]
    expect(callArgs).toHaveLength(2)
    expect(callArgs[0].role).toBe("system")
    expect(callArgs[1].role).toBe("user")
    expect(callArgs[1].content).toContain("const x = 1")
    expect(callArgs[1].content).toContain("const y = 2")
    expect(callArgs[1].content).toContain("typescript")
  })
})

// ── Helpers ───────────────────────────────────────────────

function createMockDocument(
  text: string,
  totalLines = 1,
  totalChars = 0,
): any {
  const lines = text.split("\n")

  return {
    uri: { fsPath: "/test/file.ts" },
    languageId: "typescript",
    getText: () => text,
    lineAt: (line: number) => ({
      text: lines[line] ?? "",
      lineNumber: line,
    }),
    offsetAt: (pos: vscode.Position) => {
      let offset = 0
      for (let i = 0; i < pos.line; i++) {
        offset += (lines[i] ?? "").length + 1
      }
      offset += pos.character
      return offset
    },
  }
}
