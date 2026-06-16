import * as vscode from "vscode"
import type { ContextProvider, ContextItem } from "./providers/context/types"

const MAX_CONTENT_LINES = 300

/**
 * Провайдер контекста: активный файл.
 */
export function makeCurrentFileProvider(): ContextProvider {
  return {
    description: {
      name: "currentfile",
      displayTitle: "Current File",
      description: "Содержимое активного файла",
      type: "normal",
      priority: 95,
    },
    async resolve(_query: string): Promise<ContextItem[]> {
      const editor = vscode.window.activeTextEditor
      if (!editor) return []

      const doc = editor.document
      const isBinary = doc.isClosed || doc.uri.scheme !== "file"
      if (isBinary) return []

      let content = doc.getText()
      if (doc.lineCount > MAX_CONTENT_LINES) {
        const mid = Math.floor(doc.lineCount / 2)
        const top = doc.getText(new vscode.Range(mid - 150, 0, mid, 0))
        const bot = doc.getText(new vscode.Range(mid, 0, mid + 150, 0))
        content = `${top}\n...\n${bot}`
      }

      let selection: string | null = null
      if (!editor.selection.isEmpty) {
        selection = doc.getText(editor.selection)
      }

      const parts: string[] = [
        `## Активный файл`,
        `Путь: ${doc.uri.fsPath}`,
        `Язык: ${doc.languageId}`,
        `Строк: ${doc.lineCount}`,
      ]
      if (selection) {
        parts.push(`Выделенный текст:\n\`\`\`${doc.languageId}\n${selection.slice(0, 2000)}\n\`\`\``)
      }
      parts.push(`Содержимое:\n\`\`\`${doc.languageId}\n${content.slice(0, 8000)}\n\`\`\``)

      return [{
        content: parts.join("\n"),
        name: vscode.workspace.asRelativePath(doc.uri.fsPath),
        description: `${doc.languageId}, ${doc.lineCount} lines`,
      }]
    },
  }
}

/**
 * Провайдер контекста: открытые файлы.
 */
export function makeOpenFilesProvider(): ContextProvider {
  return {
    description: {
      name: "openfiles",
      displayTitle: "Open Files",
      description: "Список открытых файлов",
      type: "normal",
      priority: 92,
    },
    async resolve(_query: string): Promise<ContextItem[]> {
      const editors = vscode.window.visibleTextEditors
      const result: string[] = []
      for (const editor of editors) {
        if (editor.document.uri.scheme !== "file") continue
        result.push(`  ${editor.document.uri.fsPath} (${editor.document.languageId}, ${editor.document.lineCount} строк)`)
      }
      if (result.length === 0) return []
      return [{
        content: `## Открытые файлы\n${result.join("\n")}`,
        name: "Open Files",
        description: `${result.length} files`,
      }]
    },
  }
}

/**
 * Провайдер контекста: проблемы в коде (все файлы).
 */
export function makeProblemsProvider(
  getWorkDir: () => string,
): ContextProvider {
  const severityMap: Record<number, string> = {
    0: "error",
    1: "warning",
    2: "information",
    3: "hint",
  }

  const pathMod = require("path") as typeof import("path")

  return {
    description: {
      name: "problems",
      displayTitle: "Problems",
      description: "Проблемы в коде проекта",
      type: "normal",
      priority: 88,
    },
    async resolve(_query: string): Promise<ContextItem[]> {
      const allDiagnostics = vscode.languages.getDiagnostics()
      const problems: Array<{
        file: string
        severity: string
        message: string
        line: number
        code?: string | number
        source?: string
        relatedInfo?: string
      }> = []
      const affectedFiles = new Set<string>()

      for (const [uri, diagnostics] of allDiagnostics) {
        if (diagnostics.length === 0 || uri.scheme !== "file") continue
        affectedFiles.add(uri.fsPath)
        for (const d of diagnostics.slice(0, 10)) {
          const entry: (typeof problems)[number] = {
            file: uri.fsPath,
            severity: severityMap[d.severity] ?? "unknown",
            message: d.message.slice(0, 300),
            line: d.range.start.line + 1,
          }

          if (d.code != null) {
            entry.code = typeof d.code === "string" ? d.code : String(d.code)
          }

          if (d.source) {
            entry.source = d.source
          }

          if (d.relatedInformation && d.relatedInformation.length > 0) {
            const related = d.relatedInformation.slice(0, 3).map((ri) => {
              const relPath = pathMod.relative(getWorkDir(), ri.location.uri.fsPath)
              return `${relPath}:${ri.location.range.start.line + 1} ${ri.message.slice(0, 120)}`
            })
            entry.relatedInfo = related.join("; ")
          }

          problems.push(entry)
        }
      }

      if (problems.length === 0) return []

      const errors = problems.filter((p) => p.severity === "error")
      const warnings = problems.filter((p) => p.severity === "warning")

      const lines: string[] = []
      lines.push(`  Файлов с проблемами: ${affectedFiles.size}, Ошибок: ${errors.length}, Предупреждений: ${warnings.length}`)
      lines.push("")

      const grouped = new Map<string, (typeof problems)[number][]>()
      for (const p of problems) {
        const arr = grouped.get(p.file) ?? []
        arr.push(p)
        grouped.set(p.file, arr)
      }

      let shown = 0
      const maxShown = 25
      for (const [file, entries] of grouped) {
        if (shown >= maxShown) break
        const relPath = pathMod.relative(getWorkDir(), file)
        for (const p of entries) {
          if (shown >= maxShown) break
          const codePart = p.code != null ? ` [${p.code}]` : ""
          const sourcePart = p.source ? ` (${p.source})` : ""
          lines.push(`  [${p.severity}] ${relPath}:${p.line}${codePart}${sourcePart} — ${p.message}`)
          if (p.relatedInfo) {
            lines.push(`    Связано: ${p.relatedInfo}`)
          }
          shown++
        }
      }

      return [{
        content: `## Проблемы в коде\n${lines.join("\n")}`,
        name: "Problems",
        description: `${errors.length} errors, ${warnings.length} warnings`,
      }]
    },
  }
}

/**
 * Провайдер контекста: буфер обмена.
 */
export function makeClipboardProvider(): ContextProvider {
  return {
    description: {
      name: "clipboard",
      displayTitle: "Clipboard",
      description: "Содержимое буфера обмена",
      type: "normal",
      priority: 60,
    },
    async resolve(_query: string): Promise<ContextItem[]> {
      try {
        const text = await vscode.env.clipboard.readText()
        if (text.length === 0) return []
        const preview = text.slice(0, 120).replace(/\n/g, " ")
        return [{
          content: `## Буфер обмена\n  Символов: ${text.length}\n  Начало: "${preview}"`,
          name: "Clipboard",
          description: `${text.length} chars`,
        }]
      } catch {
        return []
      }
    },
  }
}

/**
 * Провайдер контекста: отладчик.
 */
export function makeDebuggerProvider(): ContextProvider {
  return {
    description: {
      name: "debugger",
      displayTitle: "Debugger",
      description: "Состояние отладчика",
      type: "normal",
      priority: 82,
    },
    async resolve(_query: string): Promise<ContextItem[]> {
      const session = vscode.debug.activeDebugSession
      if (!session) return []

      try {
        const threadsResp = await session.customRequest("threads", {}) as { threads: Array<{ id: number; name: string }> }
        const threads = threadsResp?.threads ?? []
        const mainThread = threads.find((t: { id: number }) => t.id === 1) ?? threads[0]

        if (!mainThread) {
          return [{
            content: `## Отладчик\n  Сессия: ${session.name}\n  Поток: none`,
            name: "Debugger",
            description: session.name,
          }]
        }

        const stackResp = await session.customRequest("stackTrace", {
          threadId: mainThread.id,
          levels: 8,
        }) as { stackFrames: Array<{ name: string; line: number; source?: { name: string; path: string } }> }
        const frames = stackResp?.stackFrames ?? []
        const stack = frames.slice(0, 8).map((f: { name: string; line: number; source?: { name: string; path: string } }) => {
          const loc = f.source ? `${f.source.name}:${f.line}` : `line ${f.line}`
          return `  ${f.name} at ${loc}`
        }).join("\n")

        return [{
          content: `## Отладчик\n  Сессия: ${session.name}\n  Поток: ${mainThread.name}\n  Стек:\n${stack}`,
          name: "Debugger",
          description: `${session.name}: ${mainThread.name}`,
        }]
      } catch {
        return [{
          content: `## Отладчик\n  Сессия: ${session.name}\n  Поток: error`,
          name: "Debugger",
          description: session.name,
        }]
      }
    },
  }
}

/**
 * Провайдер контекста: терминал.
 */
export function makeTerminalProvider(): ContextProvider {
  return {
    description: {
      name: "terminal",
      displayTitle: "Terminal",
      description: "Состояние терминалов",
      type: "normal",
      priority: 65,
    },
    async resolve(_query: string): Promise<ContextItem[]> {
      const terminals = vscode.window.terminals
      if (terminals.length === 0) return []

      const active = vscode.window.activeTerminal
      return [{
        content: `## Терминал\n  Терминалов: ${terminals.length}\n  Активный: ${active?.name ?? "none"} (${active ? "active" : "inactive"})`,
        name: "Terminal",
        description: `${terminals.length} terminals`,
      }]
    },
  }
}

/**
 * Провайдер контекста: информация о системе.
 */
export function makeOSProvider(): ContextProvider {
  return {
    description: {
      name: "os",
      displayTitle: "OS",
      description: "Информация об операционной системе",
      type: "normal",
      priority: 98,
    },
    async resolve(_query: string): Promise<ContextItem[]> {
      const os = await import("os")
      const shell = process.env.SHELL ?? process.env.COMSPEC ?? "unknown"
      return [{
        content: `## Система\n  Платформа: ${os.platform()} ${os.arch()}\n  Релиз: ${os.release()}\n  Shell: ${shell}\n  Память: ${(os.totalmem() / 1024 / 1024 / 1024).toFixed(1)} ГБ\n  CPU: ${os.cpus()[0]?.model ?? "unknown"}`,
        name: "OS",
        description: `${os.platform()} ${os.arch()}`,
      }]
    },
  }
}
