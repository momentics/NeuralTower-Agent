import { describe, it, expect, vi, beforeEach } from "vitest"
import * as vscode from "vscode"

vi.mock("fs/promises", () => ({
  stat: vi.fn(),
  readFile: vi.fn(),
  readdir: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}))

import * as fs from "fs/promises"

describe("ContextSources.vscode", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(vscode.window as any).activeTextEditor = null
    ;(vscode.window as any).visibleTextEditors = []
    ;(vscode.window as any).terminals = []
    ;(vscode.window as any).activeTerminal = null
    ;(vscode.debug as any).activeDebugSession = null
    ;(vscode.languages as any).getDiagnostics = vi.fn().mockReturnValue(new Map())
    ;(vscode.workspace as any).asRelativePath = vi.fn().mockImplementation((p: string) => p)
    ;(vscode.env as any).clipboard = {
      readText: vi.fn().mockResolvedValue(""),
    }
  })

  describe("makeCurrentFileProvider", () => {
    it("returns provider with correct name and priority", async () => {
      const { makeCurrentFileProvider } = await import("./ContextSources.vscode")
      const provider = makeCurrentFileProvider()
      expect(provider.description.name).toBe("currentfile")
      expect(provider.description.priority).toBe(95)
    })

    it("returns empty when no active editor", async () => {
      const { makeCurrentFileProvider } = await import("./ContextSources.vscode")
      const provider = makeCurrentFileProvider()
      const items = await provider.resolve("")
      expect(items).toHaveLength(0)
    })

    it("returns file data for active editor", async () => {
      const mockDoc = {
        uri: { fsPath: "/work/test.ts", scheme: "file" },
        getText: vi.fn().mockReturnValue("const x = 1"),
        languageId: "typescript",
        lineCount: 5,
        isClosed: false,
      }
      const mockEditor = {
        document: mockDoc,
        selection: { isEmpty: true },
      }
      ;(vscode.window as any).activeTextEditor = mockEditor

      const { makeCurrentFileProvider } = await import("./ContextSources.vscode")
      const provider = makeCurrentFileProvider()
      const items = await provider.resolve("")

      expect(items).toHaveLength(1)
      expect(items[0].content).toContain("## Активный файл")
      expect(items[0].content).toContain("/work/test.ts")
      expect(items[0].content).toContain("typescript")
      expect(items[0].content).toContain("const x = 1")
    })

    it("captures non-empty selection", async () => {
      const mockDoc = {
        uri: { fsPath: "/work/test.ts", scheme: "file" },
        getText: vi.fn()
          .mockReturnValueOnce("const x = 1\nconst y = 2")
          .mockReturnValueOnce("x = 1"),
        languageId: "typescript",
        lineCount: 2,
        isClosed: false,
      }
      const mockEditor = {
        document: mockDoc,
        selection: { isEmpty: false },
      }
      ;(vscode.window as any).activeTextEditor = mockEditor

      const { makeCurrentFileProvider } = await import("./ContextSources.vscode")
      const provider = makeCurrentFileProvider()
      const items = await provider.resolve("")

      expect(items[0].content).toContain("Выделенный текст:")
      expect(items[0].content).toContain("x = 1")
    })

    it("returns empty for closed document", async () => {
      const mockDoc = {
        uri: { fsPath: "/work/test.ts", scheme: "file" },
        isClosed: true,
      }
      ;(vscode.window as any).activeTextEditor = { document: mockDoc }

      const { makeCurrentFileProvider } = await import("./ContextSources.vscode")
      const provider = makeCurrentFileProvider()
      const items = await provider.resolve("")
      expect(items).toHaveLength(0)
    })

    it("returns empty for non-file scheme", async () => {
      const mockDoc = {
        uri: { fsPath: "/work/test.ts", scheme: "output" },
        isClosed: false,
      }
      ;(vscode.window as any).activeTextEditor = { document: mockDoc }

      const { makeCurrentFileProvider } = await import("./ContextSources.vscode")
      const provider = makeCurrentFileProvider()
      const items = await provider.resolve("")
      expect(items).toHaveLength(0)
    })

    it("truncates long file content", async () => {
      const longContent = "line\n".repeat(400)
      const mockDoc = {
        uri: { fsPath: "/work/large.ts", scheme: "file" },
        getText: vi.fn()
          .mockReturnValueOnce(longContent)
          .mockReturnValueOnce(longContent.slice(0, 150 * 6))
          .mockReturnValueOnce(longContent.slice(200 * 6, 350 * 6)),
        languageId: "typescript",
        lineCount: 400,
        isClosed: false,
      }
      const mockEditor = {
        document: mockDoc,
        selection: { isEmpty: true },
      }
      ;(vscode.window as any).activeTextEditor = mockEditor

      const { makeCurrentFileProvider } = await import("./ContextSources.vscode")
      const provider = makeCurrentFileProvider()
      const items = await provider.resolve("")

      expect(items[0].content).toContain("...")
    })
  })

  describe("makeOpenFilesProvider", () => {
    it("returns provider with correct name and priority", async () => {
      const { makeOpenFilesProvider } = await import("./ContextSources.vscode")
      const provider = makeOpenFilesProvider()
      expect(provider.description.name).toBe("openfiles")
      expect(provider.description.priority).toBe(92)
    })

    it("returns empty when no visible editors", async () => {
      const { makeOpenFilesProvider } = await import("./ContextSources.vscode")
      const provider = makeOpenFilesProvider()
      const items = await provider.resolve("")
      expect(items).toHaveLength(0)
    })

    it("returns data for visible editors", async () => {
      const mockEditors = [
        {
          document: {
            uri: { fsPath: "/work/a.ts", scheme: "file" },
            languageId: "typescript",
            lineCount: 100,
          },
        },
        {
          document: {
            uri: { fsPath: "/work/b.js", scheme: "file" },
            languageId: "javascript",
            lineCount: 50,
          },
        },
      ]
      ;(vscode.window as any).visibleTextEditors = mockEditors

      const { makeOpenFilesProvider } = await import("./ContextSources.vscode")
      const provider = makeOpenFilesProvider()
      const items = await provider.resolve("")

      expect(items).toHaveLength(1)
      expect(items[0].content).toContain("/work/a.ts")
      expect(items[0].content).toContain("/work/b.js")
    })

    it("skips non-file scheme editors", async () => {
      const mockEditors = [
        {
          document: {
            uri: { fsPath: "/work/a.ts", scheme: "file" },
            languageId: "typescript",
            lineCount: 100,
          },
        },
        {
          document: {
            uri: { fsPath: "output:1", scheme: "output" },
            languageId: "log",
            lineCount: 50,
          },
        },
      ]
      ;(vscode.window as any).visibleTextEditors = mockEditors

      const { makeOpenFilesProvider } = await import("./ContextSources.vscode")
      const provider = makeOpenFilesProvider()
      const items = await provider.resolve("")

      expect(items).toHaveLength(1)
      expect(items[0].content).toContain("/work/a.ts")
      expect(items[0].content).not.toContain("output:1")
    })
  })

  describe("makeProblemsProvider", () => {
    it("returns provider with correct name and priority", async () => {
      const { makeProblemsProvider } = await import("./ContextSources.vscode")
      const provider = makeProblemsProvider(() => "/work")
      expect(provider.description.name).toBe("problems")
      expect(provider.description.priority).toBe(88)
    })

    it("returns empty when no diagnostics", async () => {
      const { makeProblemsProvider } = await import("./ContextSources.vscode")
      const provider = makeProblemsProvider(() => "/work")
      const items = await provider.resolve("")
      expect(items).toHaveLength(0)
    })

    it("collects error diagnostics", async () => {
      const mockUri = { fsPath: "/work/test.ts", scheme: "file" }
      const diagnostics = [
        {
          severity: 0,
          message: "Cannot find name 'x'",
          range: { start: { line: 5 } },
          code: "TS2304",
          source: "typescript",
        },
      ]
      ;(vscode.languages as any).getDiagnostics = vi.fn().mockReturnValue(
        new Map([[mockUri, diagnostics]])
      )

      const { makeProblemsProvider } = await import("./ContextSources.vscode")
      const provider = makeProblemsProvider(() => "/work")
      const items = await provider.resolve("")

      expect(items).toHaveLength(1)
      expect(items[0].content).toContain("Ошибок: 1")
      expect(items[0].content).toContain("[error]")
      expect(items[0].content).toContain("[TS2304]")
    })

    it("collects warning diagnostics", async () => {
      const mockUri = { fsPath: "/work/test.ts", scheme: "file" }
      const diagnostics = [
        {
          severity: 1,
          message: "Unused variable",
          range: { start: { line: 3 } },
        },
      ]
      ;(vscode.languages as any).getDiagnostics = vi.fn().mockReturnValue(
        new Map([[mockUri, diagnostics]])
      )

      const { makeProblemsProvider } = await import("./ContextSources.vscode")
      const provider = makeProblemsProvider(() => "/work")
      const items = await provider.resolve("")

      expect(items).toHaveLength(1)
      expect(items[0].content).toContain("[warning]")
    })

    it("skips non-file diagnostics", async () => {
      const mockUri = { fsPath: "output:1", scheme: "output" }
      const diagnostics = [{ severity: 0, message: "Error", range: { start: { line: 0 } } }]
      ;(vscode.languages as any).getDiagnostics = vi.fn().mockReturnValue(
        new Map([[mockUri, diagnostics]])
      )

      const { makeProblemsProvider } = await import("./ContextSources.vscode")
      const provider = makeProblemsProvider(() => "/work")
      const items = await provider.resolve("")

      expect(items).toHaveLength(0)
    })

    it("limits diagnostics per file to 10", async () => {
      const mockUri = { fsPath: "/work/test.ts", scheme: "file" }
      const diagnostics = Array.from({ length: 15 }, () => ({
        severity: 0,
        message: "Error",
        range: { start: { line: 0 } },
      }))
      ;(vscode.languages as any).getDiagnostics = vi.fn().mockReturnValue(
        new Map([[mockUri, diagnostics]])
      )

      const { makeProblemsProvider } = await import("./ContextSources.vscode")
      const provider = makeProblemsProvider(() => "/work")
      const items = await provider.resolve("")

      expect(items).toHaveLength(1)
      expect(items[0].content).toContain("Ошибок: 10")
    })
  })

  describe("makeClipboardProvider", () => {
    it("returns provider with correct name and priority", async () => {
      const { makeClipboardProvider } = await import("./ContextSources.vscode")
      const provider = makeClipboardProvider()
      expect(provider.description.name).toBe("clipboard")
      expect(provider.description.priority).toBe(60)
    })

    it("returns empty when clipboard is empty", async () => {
      ;(vscode.env as any).clipboard.readText = vi.fn().mockResolvedValue("")
      const { makeClipboardProvider } = await import("./ContextSources.vscode")
      const provider = makeClipboardProvider()
      const items = await provider.resolve("")
      expect(items).toHaveLength(0)
    })

    it("returns clipboard data", async () => {
      ;(vscode.env as any).clipboard.readText = vi.fn().mockResolvedValue("Hello World")
      const { makeClipboardProvider } = await import("./ContextSources.vscode")
      const provider = makeClipboardProvider()
      const items = await provider.resolve("")

      expect(items).toHaveLength(1)
      expect(items[0].content).toContain("Символов: 11")
      expect(items[0].content).toContain("Hello World")
    })

    it("truncates long clipboard content", async () => {
      ;(vscode.env as any).clipboard.readText = vi.fn().mockResolvedValue("A".repeat(200))
      const { makeClipboardProvider } = await import("./ContextSources.vscode")
      const provider = makeClipboardProvider()
      const items = await provider.resolve("")

      expect(items).toHaveLength(1)
      expect(items[0].content).toContain("Символов: 200")
    })

    it("handles clipboard read error gracefully", async () => {
      ;(vscode.env as any).clipboard.readText = vi.fn().mockRejectedValue(new Error("no access"))
      const { makeClipboardProvider } = await import("./ContextSources.vscode")
      const provider = makeClipboardProvider()
      const items = await provider.resolve("")
      expect(items).toHaveLength(0)
    })
  })

  describe("makeDebuggerProvider", () => {
    it("returns provider with correct name and priority", async () => {
      const { makeDebuggerProvider } = await import("./ContextSources.vscode")
      const provider = makeDebuggerProvider()
      expect(provider.description.name).toBe("debugger")
      expect(provider.description.priority).toBe(82)
    })

    it("returns empty when no debug session", async () => {
      const { makeDebuggerProvider } = await import("./ContextSources.vscode")
      const provider = makeDebuggerProvider()
      const items = await provider.resolve("")
      expect(items).toHaveLength(0)
    })

    it("returns debugger data with thread and stack", async () => {
      const mockSession = {
        name: "Chrome",
        customRequest: vi.fn()
          .mockResolvedValueOnce({ threads: [{ id: 1, name: "main" }] })
          .mockResolvedValueOnce({
            stackFrames: [
              { name: "main", line: 10, source: { name: "app.ts", path: "/work/app.ts" } },
              { name: "init", line: 5, source: { name: "index.ts", path: "/work/index.ts" } },
            ],
          }),
      }
      ;(vscode.debug as any).activeDebugSession = mockSession

      const { makeDebuggerProvider } = await import("./ContextSources.vscode")
      const provider = makeDebuggerProvider()
      const items = await provider.resolve("")

      expect(items).toHaveLength(1)
      expect(items[0].content).toContain("## Отладчик")
      expect(items[0].content).toContain("Сессия: Chrome")
      expect(items[0].content).toContain("Поток: main")
      expect(items[0].content).toContain("main at app.ts:10")
    })

    it("handles missing thread gracefully", async () => {
      const mockSession = {
        name: "Node",
        customRequest: vi.fn().mockResolvedValueOnce({ threads: [] }),
      }
      ;(vscode.debug as any).activeDebugSession = mockSession

      const { makeDebuggerProvider } = await import("./ContextSources.vscode")
      const provider = makeDebuggerProvider()
      const items = await provider.resolve("")

      expect(items).toHaveLength(1)
      expect(items[0].content).toContain("Поток: none")
    })

    it("handles customRequest error gracefully", async () => {
      const mockSession = {
        name: "Node",
        customRequest: vi.fn().mockRejectedValue(new Error("debug error")),
      }
      ;(vscode.debug as any).activeDebugSession = mockSession

      const { makeDebuggerProvider } = await import("./ContextSources.vscode")
      const provider = makeDebuggerProvider()
      const items = await provider.resolve("")

      expect(items).toHaveLength(1)
      expect(items[0].content).toContain("Поток: error")
    })

    it("handles stack frame without source", async () => {
      const mockSession = {
        name: "Node",
        customRequest: vi.fn()
          .mockResolvedValueOnce({ threads: [{ id: 1, name: "main" }] })
          .mockResolvedValueOnce({ stackFrames: [{ name: "anonymous", line: 42 }] }),
      }
      ;(vscode.debug as any).activeDebugSession = mockSession

      const { makeDebuggerProvider } = await import("./ContextSources.vscode")
      const provider = makeDebuggerProvider()
      const items = await provider.resolve("")

      expect(items[0].content).toContain("anonymous at line 42")
    })
  })

  describe("makeTerminalProvider", () => {
    it("returns provider with correct name and priority", async () => {
      const { makeTerminalProvider } = await import("./ContextSources.vscode")
      const provider = makeTerminalProvider()
      expect(provider.description.name).toBe("terminal")
      expect(provider.description.priority).toBe(65)
    })

    it("returns empty when no terminals", async () => {
      const { makeTerminalProvider } = await import("./ContextSources.vscode")
      const provider = makeTerminalProvider()
      const items = await provider.resolve("")
      expect(items).toHaveLength(0)
    })

    it("returns terminal data", async () => {
      ;(vscode.window as any).terminals = [
        { name: "Terminal 1" },
        { name: "Terminal 2" },
      ]
      ;(vscode.window as any).activeTerminal = { name: "Terminal 1" }

      const { makeTerminalProvider } = await import("./ContextSources.vscode")
      const provider = makeTerminalProvider()
      const items = await provider.resolve("")

      expect(items).toHaveLength(1)
      expect(items[0].content).toContain("Терминалов: 2")
      expect(items[0].content).toContain("Terminal 1")
      expect(items[0].content).toContain("active")
    })

    it("handles no active terminal", async () => {
      ;(vscode.window as any).terminals = [{ name: "Terminal 1" }]
      ;(vscode.window as any).activeTerminal = null

      const { makeTerminalProvider } = await import("./ContextSources.vscode")
      const provider = makeTerminalProvider()
      const items = await provider.resolve("")

      expect(items).toHaveLength(1)
      expect(items[0].content).toContain("none")
      expect(items[0].content).toContain("inactive")
    })
  })

  describe("makeOSProvider", () => {
    it("returns provider with correct name and priority", async () => {
      const { makeOSProvider } = await import("./ContextSources.vscode")
      const provider = makeOSProvider()
      expect(provider.description.name).toBe("os")
      expect(provider.description.priority).toBe(98)
    })

    it("resolves OS data", async () => {
      const { makeOSProvider } = await import("./ContextSources.vscode")
      const provider = makeOSProvider()
      const items = await provider.resolve("")

      expect(items).toHaveLength(1)
      expect(items[0].content).toContain("## Система")
      expect(items[0].content).toContain("Платформа:")
      expect(items[0].content).toContain("Релиз:")
      expect(items[0].content).toContain("Shell:")
      expect(items[0].content).toContain("Память:")
      expect(items[0].content).toContain("CPU:")
    })

    it("uses COMSPEC on Windows", async () => {
      const original = process.env.COMSPEC
      process.env.COMSPEC = "cmd.exe"
      delete process.env.SHELL

      const { makeOSProvider } = await import("./ContextSources.vscode")
      const provider = makeOSProvider()
      const items = await provider.resolve("")

      expect(items[0].content).toContain("Shell: cmd.exe")

      process.env.COMSPEC = original
    })

    it("uses SHELL when available", async () => {
      const original = process.env.SHELL
      process.env.SHELL = "/bin/bash"

      const { makeOSProvider } = await import("./ContextSources.vscode")
      const provider = makeOSProvider()
      const items = await provider.resolve("")

      expect(items[0].content).toContain("Shell: /bin/bash")

      process.env.SHELL = original
    })

    it("falls back to unknown shell", async () => {
      const originalShell = process.env.SHELL
      const originalComspec = process.env.COMSPEC
      delete process.env.SHELL
      delete process.env.COMSPEC

      const { makeOSProvider } = await import("./ContextSources.vscode")
      const provider = makeOSProvider()
      const items = await provider.resolve("")

      expect(items[0].content).toContain("Shell: unknown")

      process.env.SHELL = originalShell
      process.env.COMSPEC = originalComspec
    })
  })
})
