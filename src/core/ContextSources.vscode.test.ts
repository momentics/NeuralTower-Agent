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
    ;(vscode.env as any).clipboard = {
      readText: vi.fn().mockResolvedValue(""),
    }
  })

  describe("makeCurrentFileSource", () => {
    it("returns source with correct key and priority", async () => {
      const { makeCurrentFileSource } = await import("./ContextSources.vscode")
      const source = makeCurrentFileSource()
      expect(source.key).toBe("currentfile")
      expect(source.priority).toBe(95)
    })

    it("returns undefined when no active editor", async () => {
      const { makeCurrentFileSource } = await import("./ContextSources.vscode")
      const source = makeCurrentFileSource()
      const data = await source.load()
      expect(data).toBeUndefined()
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

      const { makeCurrentFileSource } = await import("./ContextSources.vscode")
      const source = makeCurrentFileSource()
      const data = await source.load()

      expect(data).toBeDefined()
      expect(data!.path).toBe("/work/test.ts")
      expect(data!.language).toBe("typescript")
      expect(data!.content).toBe("const x = 1")
      expect(data!.selection).toBeNull()
      expect(data!.lineCount).toBe(5)
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

      const { makeCurrentFileSource } = await import("./ContextSources.vscode")
      const source = makeCurrentFileSource()
      const data = await source.load()

      expect(data!.selection).toBe("x = 1")
    })

    it("returns undefined for closed document", async () => {
      const mockDoc = {
        uri: { fsPath: "/work/test.ts", scheme: "file" },
        isClosed: true,
      }
      ;(vscode.window as any).activeTextEditor = { document: mockDoc }

      const { makeCurrentFileSource } = await import("./ContextSources.vscode")
      const source = makeCurrentFileSource()
      const data = await source.load()
      expect(data).toBeUndefined()
    })

    it("returns undefined for non-file scheme", async () => {
      const mockDoc = {
        uri: { fsPath: "/work/test.ts", scheme: "output" },
        isClosed: false,
      }
      ;(vscode.window as any).activeTextEditor = { document: mockDoc }

      const { makeCurrentFileSource } = await import("./ContextSources.vscode")
      const source = makeCurrentFileSource()
      const data = await source.load()
      expect(data).toBeUndefined()
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

      const { makeCurrentFileSource } = await import("./ContextSources.vscode")
      const source = makeCurrentFileSource()
      const data = await source.load()

      expect(data!.content).toContain("...")
    })

    it("generates baseline with file info", async () => {
      const mockDoc = {
        uri: { fsPath: "/work/test.ts", scheme: "file" },
        getText: vi.fn().mockReturnValue("const x = 1"),
        languageId: "typescript",
        lineCount: 5,
        isClosed: false,
      }
      ;(vscode.window as any).activeTextEditor = {
        document: mockDoc,
        selection: { isEmpty: true },
      }

      const { makeCurrentFileSource } = await import("./ContextSources.vscode")
      const source = makeCurrentFileSource()
      const data = await source.load()
      const baseline = source.baseline(data!)

      expect(baseline).toContain("## Активный файл")
      expect(baseline).toContain("Путь: /work/test.ts")
      expect(baseline).toContain("Язык: typescript")
      expect(baseline).toContain("Строк: 5")
      expect(baseline).toContain("const x = 1")
    })

    it("generates baseline with selection", async () => {
      const mockDoc = {
        uri: { fsPath: "/work/test.ts", scheme: "file" },
        getText: vi.fn()
          .mockReturnValueOnce("const x = 1\nconst y = 2")
          .mockReturnValueOnce("x = 1"),
        languageId: "typescript",
        lineCount: 2,
        isClosed: false,
      }
      ;(vscode.window as any).activeTextEditor = {
        document: mockDoc,
        selection: { isEmpty: false },
      }

      const { makeCurrentFileSource } = await import("./ContextSources.vscode")
      const source = makeCurrentFileSource()
      const data = await source.load()
      const baseline = source.baseline(data!)

      expect(baseline).toContain("Выделенный текст:")
      expect(baseline).toContain("x = 1")
    })

    it("update detects file switch", async () => {
      const { makeCurrentFileSource } = await import("./ContextSources.vscode")
      const source = makeCurrentFileSource()
      const prev = { path: "/work/a.ts", language: "typescript", content: "x", selection: null, lineCount: 1 }
      const cur = { path: "/work/b.ts", language: "typescript", content: "x", selection: null, lineCount: 1 }
      const update = source.update(prev, cur)
      expect(update).toContain("Переключён файл")
      expect(update).toContain("b.ts")
    })

    it("update detects content change", async () => {
      const { makeCurrentFileSource } = await import("./ContextSources.vscode")
      const source = makeCurrentFileSource()
      const prev = { path: "/work/a.ts", language: "typescript", content: "x", selection: null, lineCount: 1 }
      const cur = { path: "/work/a.ts", language: "typescript", content: "y", selection: null, lineCount: 1 }
      const update = source.update(prev, cur)
      expect(update).toContain("Файл изменён")
      expect(update).toContain("a.ts")
    })

    it("update returns empty for no changes", async () => {
      const { makeCurrentFileSource } = await import("./ContextSources.vscode")
      const source = makeCurrentFileSource()
      const data = { path: "/work/a.ts", language: "typescript", content: "x", selection: null, lineCount: 1 }
      const update = source.update(data, data)
      expect(update).toBe("")
    })
  })

  describe("makeOpenFilesSource", () => {
    it("returns source with correct key and priority", async () => {
      const { makeOpenFilesSource } = await import("./ContextSources.vscode")
      const source = makeOpenFilesSource()
      expect(source.key).toBe("openfiles")
      expect(source.priority).toBe(92)
    })

    it("returns empty array when no visible editors", async () => {
      const { makeOpenFilesSource } = await import("./ContextSources.vscode")
      const source = makeOpenFilesSource()
      const data = await source.load()
      expect(data).toEqual([])
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

      const { makeOpenFilesSource } = await import("./ContextSources.vscode")
      const source = makeOpenFilesSource()
      const data = await source.load()

      expect(data).toHaveLength(2)
      expect(data[0].path).toBe("/work/a.ts")
      expect(data[1].path).toBe("/work/b.js")
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

      const { makeOpenFilesSource } = await import("./ContextSources.vscode")
      const source = makeOpenFilesSource()
      const data = await source.load()

      expect(data).toHaveLength(1)
      expect(data[0].path).toBe("/work/a.ts")
    })

    it("generates baseline with file list", async () => {
      ;(vscode.window as any).visibleTextEditors = [
        {
          document: {
            uri: { fsPath: "/work/a.ts", scheme: "file" },
            languageId: "typescript",
            lineCount: 100,
          },
        },
      ]

      const { makeOpenFilesSource } = await import("./ContextSources.vscode")
      const source = makeOpenFilesSource()
      const data = await source.load()
      const baseline = source.baseline(data)

      expect(baseline).toContain("## Открытые файлы")
      expect(baseline).toContain("/work/a.ts")
      expect(baseline).toContain("typescript")
      expect(baseline).toContain("100 строк")
    })

    it("generates empty baseline for no files", async () => {
      const { makeOpenFilesSource } = await import("./ContextSources.vscode")
      const source = makeOpenFilesSource()
      const baseline = source.baseline([])
      expect(baseline).toBe("")
    })

    it("update detects count change", async () => {
      const { makeOpenFilesSource } = await import("./ContextSources.vscode")
      const source = makeOpenFilesSource()
      const prev = [{ path: "/a.ts", language: "ts", lineCount: 1 }]
      const cur = [{ path: "/a.ts", language: "ts", lineCount: 1 }, { path: "/b.ts", language: "ts", lineCount: 2 }]
      const update = source.update(prev, cur)
      expect(update).toContain("Открытых файлов: 2")
      expect(update).toContain("было 1")
    })

    it("update detects file composition change", async () => {
      const { makeOpenFilesSource } = await import("./ContextSources.vscode")
      const source = makeOpenFilesSource()
      const prev = [{ path: "/a.ts", language: "ts", lineCount: 1 }]
      const cur = [{ path: "/b.ts", language: "ts", lineCount: 2 }]
      const update = source.update(prev, cur)
      expect(update).toContain("Состав открытых файлов изменён")
    })

    it("update returns empty for no changes", async () => {
      const { makeOpenFilesSource } = await import("./ContextSources.vscode")
      const source = makeOpenFilesSource()
      const data = [{ path: "/a.ts", language: "ts", lineCount: 1 }]
      const update = source.update(data, data)
      expect(update).toBe("")
    })
  })

  describe("makeProblemsSource", () => {
    it("returns source with correct key and priority", async () => {
      const { makeProblemsSource } = await import("./ContextSources.vscode")
      const source = makeProblemsSource(() => "/work")
      expect(source.key).toBe("problems")
      expect(source.priority).toBe(88)
    })

    it("returns empty data when no diagnostics", async () => {
      const { makeProblemsSource } = await import("./ContextSources.vscode")
      const source = makeProblemsSource(() => "/work")
      const data = await source.load()

      expect(data.problems).toEqual([])
      expect(data.errorCount).toBe(0)
      expect(data.warningCount).toBe(0)
      expect(data.totalFiles).toBe(0)
    })

    it("collects error diagnostics", async () => {
      const mockUri = { fsPath: "/work/test.ts", scheme: "file" }
      const diagnostics = [
        {
          severity: 0, // Error
          message: "Cannot find name 'x'",
          range: { start: { line: 5 } },
          code: "TS2304",
          source: "typescript",
        },
      ]
      ;(vscode.languages as any).getDiagnostics = vi.fn().mockReturnValue(
        new Map([[mockUri, diagnostics]])
      )

      const { makeProblemsSource } = await import("./ContextSources.vscode")
      const source = makeProblemsSource(() => "/work")
      const data = await source.load()

      expect(data.errorCount).toBe(1)
      expect(data.problems).toHaveLength(1)
      expect(data.problems[0].severity).toBe("error")
      expect(data.problems[0].code).toBe("TS2304")
      expect(data.problems[0].source).toBe("typescript")
      expect(data.problems[0].line).toBe(6)
    })

    it("collects warning diagnostics", async () => {
      const mockUri = { fsPath: "/work/test.ts", scheme: "file" }
      const diagnostics = [
        {
          severity: 1, // Warning
          message: "Unused variable",
          range: { start: { line: 3 } },
        },
      ]
      ;(vscode.languages as any).getDiagnostics = vi.fn().mockReturnValue(
        new Map([[mockUri, diagnostics]])
      )

      const { makeProblemsSource } = await import("./ContextSources.vscode")
      const source = makeProblemsSource(() => "/work")
      const data = await source.load()

      expect(data.warningCount).toBe(1)
      expect(data.problems[0].severity).toBe("warning")
    })

    it("skips non-file diagnostics", async () => {
      const mockUri = { fsPath: "output:1", scheme: "output" }
      const diagnostics = [{ severity: 0, message: "Error", range: { start: { line: 0 } } }]
      ;(vscode.languages as any).getDiagnostics = vi.fn().mockReturnValue(
        new Map([[mockUri, diagnostics]])
      )

      const { makeProblemsSource } = await import("./ContextSources.vscode")
      const source = makeProblemsSource(() => "/work")
      const data = await source.load()

      expect(data.problems).toEqual([])
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

      const { makeProblemsSource } = await import("./ContextSources.vscode")
      const source = makeProblemsSource(() => "/work")
      const data = await source.load()

      expect(data.problems).toHaveLength(10)
    })

    it("generates baseline with problems grouped by file", async () => {
      const mockUri = { fsPath: "/work/test.ts", scheme: "file" }
      const diagnostics = [
        {
          severity: 0,
          message: "Error msg",
          range: { start: { line: 0 } },
          code: "E001",
        },
      ]
      ;(vscode.languages as any).getDiagnostics = vi.fn().mockReturnValue(
        new Map([[mockUri, diagnostics]])
      )

      const { makeProblemsSource } = await import("./ContextSources.vscode")
      const source = makeProblemsSource(() => "/work")
      const data = await source.load()
      const baseline = source.baseline(data)

      expect(baseline).toContain("## Проблемы в коде")
      expect(baseline).toContain("Ошибок: 1")
      expect(baseline).toContain("[error]")
      expect(baseline).toContain("[E001]")
    })

    it("generates empty baseline when no problems", async () => {
      const { makeProblemsSource } = await import("./ContextSources.vscode")
      const source = makeProblemsSource(() => "/work")
      const baseline = source.baseline({ problems: [], errorCount: 0, warningCount: 0, totalFiles: 0 })
      expect(baseline).toBe("")
    })

    it("update detects error count change", async () => {
      const { makeProblemsSource } = await import("./ContextSources.vscode")
      const source = makeProblemsSource(() => "/work")
      const prev = { problems: [], errorCount: 0, warningCount: 0, totalFiles: 0 }
      const cur = { problems: [{ severity: "error", message: "e", file: "f", line: 1 }], errorCount: 1, warningCount: 0, totalFiles: 1 }
      const update = source.update(prev, cur)
      expect(update).toContain("Ошибки: 1")
      expect(update).toContain("было 0")
    })

    it("update detects total problems change", async () => {
      const { makeProblemsSource } = await import("./ContextSources.vscode")
      const source = makeProblemsSource(() => "/work")
      const prev = { problems: [], errorCount: 0, warningCount: 0, totalFiles: 0 }
      const cur = { problems: [{ severity: "warning", message: "w", file: "f", line: 1 }], errorCount: 0, warningCount: 1, totalFiles: 1 }
      const update = source.update(prev, cur)
      expect(update).toContain("Проблемы: 1")
      expect(update).toContain("было 0")
    })

    it("update returns empty for no changes", async () => {
      const { makeProblemsSource } = await import("./ContextSources.vscode")
      const source = makeProblemsSource(() => "/work")
      const data = { problems: [], errorCount: 0, warningCount: 0, totalFiles: 0 }
      const update = source.update(data, data)
      expect(update).toBe("")
    })

    it("handles numeric code", async () => {
      const mockUri = { fsPath: "/work/test.ts", scheme: "file" }
      const diagnostics = [
        {
          severity: 0,
          message: "Error",
          range: { start: { line: 0 } },
          code: 123,
        },
      ]
      ;(vscode.languages as any).getDiagnostics = vi.fn().mockReturnValue(
        new Map([[mockUri, diagnostics]])
      )

      const { makeProblemsSource } = await import("./ContextSources.vscode")
      const source = makeProblemsSource(() => "/work")
      const data = await source.load()

      expect(data.problems[0].code).toBe("123")
    })
  })

  describe("makeClipboardSource", () => {
    it("returns source with correct key and priority", async () => {
      const { makeClipboardSource } = await import("./ContextSources.vscode")
      const source = makeClipboardSource()
      expect(source.key).toBe("clipboard")
      expect(source.priority).toBe(60)
    })

    it("returns empty data when clipboard is empty", async () => {
      ;(vscode.env as any).clipboard.readText = vi.fn().mockResolvedValue("")
      const { makeClipboardSource } = await import("./ContextSources.vscode")
      const source = makeClipboardSource()
      const data = await source.load()

      expect(data.length).toBe(0)
      expect(data.preview).toBe("")
    })

    it("returns clipboard data", async () => {
      ;(vscode.env as any).clipboard.readText = vi.fn().mockResolvedValue("Hello World")
      const { makeClipboardSource } = await import("./ContextSources.vscode")
      const source = makeClipboardSource()
      const data = await source.load()

      expect(data.length).toBe(11)
      expect(data.preview).toBe("Hello World")
    })

    it("truncates long clipboard content", async () => {
      ;(vscode.env as any).clipboard.readText = vi.fn().mockResolvedValue("A".repeat(200))
      const { makeClipboardSource } = await import("./ContextSources.vscode")
      const source = makeClipboardSource()
      const data = await source.load()

      expect(data.length).toBe(200)
      expect(data.preview).toHaveLength(120)
    })

    it("replaces newlines in preview", async () => {
      ;(vscode.env as any).clipboard.readText = vi.fn().mockResolvedValue("line1\nline2")
      const { makeClipboardSource } = await import("./ContextSources.vscode")
      const source = makeClipboardSource()
      const data = await source.load()

      expect(data.preview).toBe("line1 line2")
    })

    it("handles clipboard read error gracefully", async () => {
      ;(vscode.env as any).clipboard.readText = vi.fn().mockRejectedValue(new Error("no access"))
      const { makeClipboardSource } = await import("./ContextSources.vscode")
      const source = makeClipboardSource()
      const data = await source.load()

      expect(data.length).toBe(0)
      expect(data.preview).toBe("")
    })

    it("generates baseline with clipboard info", async () => {
      ;(vscode.env as any).clipboard.readText = vi.fn().mockResolvedValue("Hello World")
      const { makeClipboardSource } = await import("./ContextSources.vscode")
      const source = makeClipboardSource()
      const data = await source.load()
      const baseline = source.baseline(data)

      expect(baseline).toContain("## Буфер обмена")
      expect(baseline).toContain("Символов: 11")
      expect(baseline).toContain("Hello World")
    })

    it("generates empty baseline for empty clipboard", async () => {
      const { makeClipboardSource } = await import("./ContextSources.vscode")
      const source = makeClipboardSource()
      const baseline = source.baseline({ length: 0, preview: "" })
      expect(baseline).toBe("")
    })

    it("update always returns empty", async () => {
      const { makeClipboardSource } = await import("./ContextSources.vscode")
      const source = makeClipboardSource()
      const update = source.update({ length: 0, preview: "" }, { length: 10, preview: "x" })
      expect(update).toBe("")
    })
  })

  describe("makeDebuggerSource", () => {
    it("returns source with correct key and priority", async () => {
      const { makeDebuggerSource } = await import("./ContextSources.vscode")
      const source = makeDebuggerSource()
      expect(source.key).toBe("debugger")
      expect(source.priority).toBe(82)
    })

    it("returns undefined when no debug session", async () => {
      const { makeDebuggerSource } = await import("./ContextSources.vscode")
      const source = makeDebuggerSource()
      const data = await source.load()
      expect(data).toBeUndefined()
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

      const { makeDebuggerSource } = await import("./ContextSources.vscode")
      const source = makeDebuggerSource()
      const data = await source.load()

      expect(data).toBeDefined()
      expect(data!.active).toBe(true)
      expect(data!.name).toBe("Chrome")
      expect(data!.thread).toBe("main")
      expect(data!.stack).toContain("main at app.ts:10")
      expect(data!.stack).toContain("init at index.ts:5")
    })

    it("handles missing thread gracefully", async () => {
      const mockSession = {
        name: "Node",
        customRequest: vi.fn().mockResolvedValueOnce({ threads: [] }),
      }
      ;(vscode.debug as any).activeDebugSession = mockSession

      const { makeDebuggerSource } = await import("./ContextSources.vscode")
      const source = makeDebuggerSource()
      const data = await source.load()

      expect(data).toBeDefined()
      expect(data!.thread).toBe("none")
      expect(data!.stack).toBe("")
    })

    it("handles customRequest error gracefully", async () => {
      const mockSession = {
        name: "Node",
        customRequest: vi.fn().mockRejectedValue(new Error("debug error")),
      }
      ;(vscode.debug as any).activeDebugSession = mockSession

      const { makeDebuggerSource } = await import("./ContextSources.vscode")
      const source = makeDebuggerSource()
      const data = await source.load()

      expect(data).toBeDefined()
      expect(data!.thread).toBe("error")
    })

    it("generates baseline with debugger info", async () => {
      const mockSession = {
        name: "Chrome",
        customRequest: vi.fn()
          .mockResolvedValueOnce({ threads: [{ id: 1, name: "main" }] })
          .mockResolvedValueOnce({ stackFrames: [{ name: "main", line: 10, source: { name: "app.ts", path: "/work/app.ts" } }] }),
      }
      ;(vscode.debug as any).activeDebugSession = mockSession

      const { makeDebuggerSource } = await import("./ContextSources.vscode")
      const source = makeDebuggerSource()
      const data = await source.load()
      const baseline = source.baseline(data!)

      expect(baseline).toContain("## Отладчик")
      expect(baseline).toContain("Сессия: Chrome")
      expect(baseline).toContain("Поток: main")
      expect(baseline).toContain("main at app.ts:10")
    })

    it("update always returns update message", async () => {
      const { makeDebuggerSource } = await import("./ContextSources.vscode")
      const source = makeDebuggerSource()
      const update = source.update(
        { active: true, name: "Chrome", thread: "main", stack: "" },
        { active: true, name: "Chrome", thread: "main", stack: "" }
      )
      expect(update).toBe("Состояние отладчика обновлено")
    })

    it("handles stack frame without source", async () => {
      const mockSession = {
        name: "Node",
        customRequest: vi.fn()
          .mockResolvedValueOnce({ threads: [{ id: 1, name: "main" }] })
          .mockResolvedValueOnce({ stackFrames: [{ name: "anonymous", line: 42 }] }),
      }
      ;(vscode.debug as any).activeDebugSession = mockSession

      const { makeDebuggerSource } = await import("./ContextSources.vscode")
      const source = makeDebuggerSource()
      const data = await source.load()

      expect(data!.stack).toContain("anonymous at line 42")
    })
  })

  describe("makeTerminalSource", () => {
    it("returns source with correct key and priority", async () => {
      const { makeTerminalSource } = await import("./ContextSources.vscode")
      const source = makeTerminalSource()
      expect(source.key).toBe("terminal")
      expect(source.priority).toBe(65)
    })

    it("returns undefined when no terminals", async () => {
      const { makeTerminalSource } = await import("./ContextSources.vscode")
      const source = makeTerminalSource()
      const data = await source.load()
      expect(data).toBeUndefined()
    })

    it("returns terminal data", async () => {
      ;(vscode.window as any).terminals = [
        { name: "Terminal 1" },
        { name: "Terminal 2" },
      ]
      ;(vscode.window as any).activeTerminal = { name: "Terminal 1" }

      const { makeTerminalSource } = await import("./ContextSources.vscode")
      const source = makeTerminalSource()
      const data = await source.load()

      expect(data).toBeDefined()
      expect(data!.count).toBe(2)
      expect(data!.activeName).toBe("Terminal 1")
      expect(data!.state).toBe("active")
    })

    it("handles no active terminal", async () => {
      ;(vscode.window as any).terminals = [{ name: "Terminal 1" }]
      ;(vscode.window as any).activeTerminal = null

      const { makeTerminalSource } = await import("./ContextSources.vscode")
      const source = makeTerminalSource()
      const data = await source.load()

      expect(data!.activeName).toBe("none")
      expect(data!.state).toBe("inactive")
    })

    it("generates baseline with terminal info", async () => {
      ;(vscode.window as any).terminals = [{ name: "Terminal 1" }]
      ;(vscode.window as any).activeTerminal = { name: "Terminal 1" }

      const { makeTerminalSource } = await import("./ContextSources.vscode")
      const source = makeTerminalSource()
      const data = await source.load()
      const baseline = source.baseline(data!)

      expect(baseline).toContain("## Терминал")
      expect(baseline).toContain("Терминалов: 1")
      expect(baseline).toContain("Terminal 1")
      expect(baseline).toContain("active")
    })

    it("update detects terminal count change", async () => {
      const { makeTerminalSource } = await import("./ContextSources.vscode")
      const source = makeTerminalSource()
      const prev = { count: 1, activeName: "T1", state: "active" }
      const cur = { count: 2, activeName: "T2", state: "active" }
      const update = source.update(prev, cur)
      expect(update).toContain("Терминалов: 2")
      expect(update).toContain("было 1")
    })

    it("update returns empty for no changes", async () => {
      const { makeTerminalSource } = await import("./ContextSources.vscode")
      const source = makeTerminalSource()
      const data = { count: 1, activeName: "T1", state: "active" }
      const update = source.update(data, data)
      expect(update).toBe("")
    })
  })

  describe("makeOSSource", () => {
    it("returns source with correct key and priority", async () => {
      const { makeOSSource } = await import("./ContextSources.vscode")
      const source = makeOSSource()
      expect(source.key).toBe("os")
      expect(source.priority).toBe(98)
    })

    it("loads OS data", async () => {
      const { makeOSSource } = await import("./ContextSources.vscode")
      const source = makeOSSource()
      const data = await source.load()

      expect(data.platform).toBe(process.platform)
      expect(data.arch).toBe(process.arch)
      expect(data.release).toBeDefined()
      expect(data.shell).toBeDefined()
      expect(data.memoryTotal).toContain("ГБ")
      expect(data.cpuModel).toBeDefined()
    })

    it("uses COMSPEC on Windows", async () => {
      const original = process.env.COMSPEC
      process.env.COMSPEC = "cmd.exe"
      delete process.env.SHELL

      const { makeOSSource } = await import("./ContextSources.vscode")
      const source = makeOSSource()
      const data = await source.load()

      expect(data.shell).toBe("cmd.exe")

      process.env.COMSPEC = original
    })

    it("uses SHELL when available", async () => {
      const original = process.env.SHELL
      process.env.SHELL = "/bin/bash"

      const { makeOSSource } = await import("./ContextSources.vscode")
      const source = makeOSSource()
      const data = await source.load()

      expect(data.shell).toBe("/bin/bash")

      process.env.SHELL = original
    })

    it("falls back to unknown shell", async () => {
      const originalShell = process.env.SHELL
      const originalComspec = process.env.COMSPEC
      delete process.env.SHELL
      delete process.env.COMSPEC

      const { makeOSSource } = await import("./ContextSources.vscode")
      const source = makeOSSource()
      const data = await source.load()

      expect(data.shell).toBe("unknown")

      process.env.SHELL = originalShell
      process.env.COMSPEC = originalComspec
    })

    it("generates baseline with OS info", async () => {
      const { makeOSSource } = await import("./ContextSources.vscode")
      const source = makeOSSource()
      const data = await source.load()
      const baseline = source.baseline(data)

      expect(baseline).toContain("## Система")
      expect(baseline).toContain("Платформа:")
      expect(baseline).toContain("Релиз:")
      expect(baseline).toContain("Shell:")
      expect(baseline).toContain("Память:")
      expect(baseline).toContain("CPU:")
    })

    it("update always returns empty", async () => {
      const { makeOSSource } = await import("./ContextSources.vscode")
      const source = makeOSSource()
      const data = { platform: "win32", arch: "x64", release: "10", shell: "cmd", memoryTotal: "16 ГБ", cpuModel: "CPU" }
      const update = source.update(data, data)
      expect(update).toBe("")
    })
  })

  describe("makeRulesSource", () => {
    it("returns source with correct key and priority", async () => {
      const { makeRulesSource } = await import("./ContextSources.vscode")
      const source = makeRulesSource(() => "/work")
      expect(source.key).toBe("rules")
      expect(source.priority).toBe(99)
    })

    it("returns undefined when no rules exist", async () => {
      vi.mocked(fs.readdir).mockRejectedValue(new Error("ENOENT"))
      vi.mocked(fs.readFile).mockRejectedValue(new Error("ENOENT"))

      const { makeRulesSource } = await import("./ContextSources.vscode")
      const source = makeRulesSource(() => "/work")
      const data = await source.load()

      expect(data).toBeDefined()
      expect(data!.rules).toEqual([])
      expect(data!.totalChars).toBe(0)
    })

    it("loads rules from .neuraltower/rules", async () => {
      vi.mocked(fs.readdir).mockResolvedValueOnce(["rule1.md", "rule2.md"])
      vi.mocked(fs.readFile)
        .mockResolvedValueOnce("# Rule 1 content")
        .mockResolvedValueOnce("# Rule 2 content")
        .mockRejectedValue(new Error("ENOENT"))
        .mockRejectedValue(new Error("ENOENT"))
        .mockRejectedValue(new Error("ENOENT"))

      const { makeRulesSource } = await import("./ContextSources.vscode")
      const source = makeRulesSource(() => "/work")
      const data = await source.load()

      expect(data!.rules).toHaveLength(2)
      expect(data!.rules[0].name).toBe("rule1.md")
      expect(data!.rules[0].content).toBe("# Rule 1 content")
      expect(data!.totalChars).toBe("# Rule 1 content".length + "# Rule 2 content".length)
    })

    it("caches results within TTL", async () => {
      vi.useFakeTimers()

      vi.mocked(fs.readdir).mockResolvedValueOnce(["rule1.md"])
      vi.mocked(fs.readFile)
        .mockResolvedValueOnce("# Rule 1")
        .mockRejectedValue(new Error("ENOENT"))
        .mockRejectedValue(new Error("ENOENT"))
        .mockRejectedValue(new Error("ENOENT"))

      const { makeRulesSource } = await import("./ContextSources.vscode")
      const source = makeRulesSource(() => "/work")
      await source.load()

      // Second load should use cache (within TTL)
      await source.load()

      expect(fs.readdir).toHaveBeenCalledTimes(2)
      vi.useRealTimers()
    })

    it("refreshes cache after TTL", async () => {
      vi.useFakeTimers()

      vi.mocked(fs.readdir).mockResolvedValue(["rule1.md"])
      vi.mocked(fs.readFile)
        .mockResolvedValueOnce("# Rule 1")
        .mockRejectedValue(new Error("ENOENT"))
        .mockRejectedValue(new Error("ENOENT"))
        .mockRejectedValue(new Error("ENOENT"))
        .mockResolvedValueOnce("# Rule 1 updated")
        .mockRejectedValue(new Error("ENOENT"))
        .mockRejectedValue(new Error("ENOENT"))
        .mockRejectedValue(new Error("ENOENT"))

      const { makeRulesSource } = await import("./ContextSources.vscode")
      const source = makeRulesSource(() => "/work")
      await source.load()

      // Advance time past TTL (30s)
      vi.advanceTimersByTime(31000)

      await source.load()
      expect(fs.readdir).toHaveBeenCalledTimes(4)

      vi.useRealTimers()
    })

    it("generates baseline with rules", async () => {
      vi.mocked(fs.readdir).mockResolvedValueOnce(["rule1.md"])
      vi.mocked(fs.readFile)
        .mockResolvedValueOnce("# Rule 1")
        .mockRejectedValue(new Error("ENOENT"))
        .mockRejectedValue(new Error("ENOENT"))
        .mockRejectedValue(new Error("ENOENT"))

      const { makeRulesSource } = await import("./ContextSources.vscode")
      const source = makeRulesSource(() => "/work")
      const data = await source.load()
      const baseline = source.baseline(data!)

      expect(baseline).toContain("## Правила: rule1.md")
      expect(baseline).toContain("# Rule 1")
    })

    it("generates empty baseline for no rules", async () => {
      const { makeRulesSource } = await import("./ContextSources.vscode")
      const source = makeRulesSource(() => "/work")
      const baseline = source.baseline({ rules: [], totalChars: 0 })
      expect(baseline).toBe("")
    })

    it("update detects rules count change", async () => {
      const { makeRulesSource } = await import("./ContextSources.vscode")
      const source = makeRulesSource(() => "/work")
      const prev = { rules: [], totalChars: 0 }
      const cur = { rules: [{ name: "r1", content: "c1" }], totalChars: 2 }
      const update = source.update(prev, cur)
      expect(update).toContain("Правила изменены")
      expect(update).toContain("1 файлов")
    })

    it("update returns empty for no changes", async () => {
      const { makeRulesSource } = await import("./ContextSources.vscode")
      const source = makeRulesSource(() => "/work")
      const data = { rules: [{ name: "r1", content: "c1" }], totalChars: 2 }
      const update = source.update(data, data)
      expect(update).toBe("")
    })
  })

  describe("makeRepoMapSource", () => {
    it("returns source with correct key and priority", async () => {
      const { makeRepoMapSource } = await import("./ContextSources.vscode")
      const source = makeRepoMapSource(
        () => "/work",
        async () => ({ fileCount: 10, dirCount: 2, languages: {}, buildSystems: [], topDirs: [], notableFiles: [] })
      )
      expect(source.key).toBe("repomap")
      expect(source.priority).toBe(87)
    })

    it("loads repo map data", async () => {
      const mockSummary = {
        fileCount: 100,
        dirCount: 20,
        languages: { typescript: 80, json: 20 },
        buildSystems: ["npm"],
        topDirs: ["/work/src"],
        notableFiles: ["/work/package.json"],
      }

      const { makeRepoMapSource } = await import("./ContextSources.vscode")
      const source = makeRepoMapSource(
        () => "/work",
        async () => mockSummary
      )
      const data = await source.load()

      expect(data).toEqual(mockSummary)
    })

    it("caches results within TTL", async () => {
      const mockFn = vi.fn().mockResolvedValue({
        fileCount: 10,
        dirCount: 2,
        languages: {},
        buildSystems: [],
        topDirs: [],
        notableFiles: [],
      })

      const { makeRepoMapSource } = await import("./ContextSources.vscode")
      const source = makeRepoMapSource(() => "/work", mockFn)
      await source.load()
      await source.load()

      expect(mockFn).toHaveBeenCalledTimes(1)
    })

    it("refreshes cache after TTL", async () => {
      vi.useFakeTimers()

      const mockFn = vi.fn().mockResolvedValue({
        fileCount: 10,
        dirCount: 2,
        languages: {},
        buildSystems: [],
        topDirs: [],
        notableFiles: [],
      })

      const { makeRepoMapSource } = await import("./ContextSources.vscode")
      const source = makeRepoMapSource(() => "/work", mockFn)
      await source.load()

      // Advance time past TTL (60s)
      vi.advanceTimersByTime(61000)

      await source.load()
      expect(mockFn).toHaveBeenCalledTimes(2)

      vi.useRealTimers()
    })

    it("generates baseline with full repo info", async () => {
      const mockSummary = {
        fileCount: 100,
        dirCount: 20,
        languages: { typescript: 80, json: 20 },
        buildSystems: ["npm", "webpack"],
        topDirs: ["/work/src"],
        notableFiles: ["/work/package.json"],
      }

      const { makeRepoMapSource } = await import("./ContextSources.vscode")
      const source = makeRepoMapSource(() => "/work", async () => mockSummary)
      const data = await source.load()
      const baseline = source.baseline(data!)

      expect(baseline).toContain("## Карта репозитория")
      expect(baseline).toContain("Файлов: 100")
      expect(baseline).toContain("Директорий: 20")
      expect(baseline).toContain("typescript: 80")
      expect(baseline).toContain("json: 20")
      expect(baseline).toContain("Системы сборки: npm, webpack")
      expect(baseline).toContain("Заметные файлы:")
      expect(baseline).toContain("package.json")
    })

    it("generates baseline without languages section when empty", async () => {
      const mockSummary = {
        fileCount: 10,
        dirCount: 2,
        languages: {},
        buildSystems: [],
        topDirs: [],
        notableFiles: [],
      }

      const { makeRepoMapSource } = await import("./ContextSources.vscode")
      const source = makeRepoMapSource(() => "/work", async () => mockSummary)
      const data = await source.load()
      const baseline = source.baseline(data!)

      expect(baseline).not.toContain("Языки:")
      expect(baseline).not.toContain("Системы сборки:")
      expect(baseline).not.toContain("Заметные файлы:")
    })

    it("update detects file count change", async () => {
      const { makeRepoMapSource } = await import("./ContextSources.vscode")
      const source = makeRepoMapSource(
        () => "/work",
        async () => ({ fileCount: 10, dirCount: 2, languages: {}, buildSystems: [], topDirs: [], notableFiles: [] })
      )
      const prev = { fileCount: 10, dirCount: 2, languages: {}, buildSystems: [], topDirs: [], notableFiles: [] }
      const cur = { fileCount: 15, dirCount: 2, languages: {}, buildSystems: [], topDirs: [], notableFiles: [] }
      const update = source.update(prev, cur)
      expect(update).toContain("+5 файлов")
    })

    it("update detects file count decrease", async () => {
      const { makeRepoMapSource } = await import("./ContextSources.vscode")
      const source = makeRepoMapSource(
        () => "/work",
        async () => ({ fileCount: 10, dirCount: 2, languages: {}, buildSystems: [], topDirs: [], notableFiles: [] })
      )
      const prev = { fileCount: 20, dirCount: 2, languages: {}, buildSystems: [], topDirs: [], notableFiles: [] }
      const cur = { fileCount: 15, dirCount: 2, languages: {}, buildSystems: [], topDirs: [], notableFiles: [] }
      const update = source.update(prev, cur)
      expect(update).toContain("-5 файлов")
    })

    it("update returns empty for no changes", async () => {
      const { makeRepoMapSource } = await import("./ContextSources.vscode")
      const source = makeRepoMapSource(
        () => "/work",
        async () => ({ fileCount: 10, dirCount: 2, languages: {}, buildSystems: [], topDirs: [], notableFiles: [] })
      )
      const data = { fileCount: 10, dirCount: 2, languages: {}, buildSystems: [], topDirs: [], notableFiles: [] }
      const update = source.update(data, data)
      expect(update).toBe("")
    })
  })
})
