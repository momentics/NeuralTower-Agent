import * as os from "os"
import * as path from "path"
import * as vscode from "vscode"
import type { ContextProvider, ContextItem } from "./providers/context/types"
import { createDomainLogger } from "./logger"

const log = createDomainLogger("VSCodeContext")

const MAX_CONTENT_LINES = 300
const SELECTION_TEXT_LIMIT = 2000
const CONTENT_TEXT_LIMIT = 8000
const MAX_DIAGNOSTICS_PER_FILE = 10
const DIAGNOSTIC_MSG_MAX = 300
const MAX_RELATED_INFO = 3
const RELATED_INFO_MSG_MAX = 120
const MAX_PROBLEMS_SHOWN = 25
const CLIPBOARD_PREVIEW_LENGTH = 120
const STACK_TRACE_LEVELS = 8

/**
 * Провайдер контекста: активный файл.
 */
export function makeCurrentFileProvider(): ContextProvider {
  return {
    description: {
      name: "currentfile",
      displayTitle: "Текущий файл",
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
      const top = doc.getText(new vscode.Range(mid - MAX_CONTENT_LINES / 2, 0, mid, 0))
         const bot = doc.getText(new vscode.Range(mid, 0, mid + MAX_CONTENT_LINES / 2, 0))
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
        parts.push(`Выделенный текст:\n\`\`\`${doc.languageId}\n${selection.slice(0, SELECTION_TEXT_LIMIT)}\n\`\`\``)
      }
      parts.push(`Содержимое:\n\`\`\`${doc.languageId}\n${content.slice(0, CONTENT_TEXT_LIMIT)}\n\`\`\``)

      return [{
        content: parts.join("\n"),
        name: vscode.workspace.asRelativePath(doc.uri.fsPath),
        description: `${doc.languageId}, ${doc.lineCount} строк`,
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
      displayTitle: "Открытые файлы",
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
        name: "Открытые файлы",
        description: `${result.length} файлов`,
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

  const pathMod = path

  return {
    description: {
      name: "problems",
      displayTitle: "Проблемы",
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
        for (const d of diagnostics.slice(0, MAX_DIAGNOSTICS_PER_FILE)) {
          const entry: (typeof problems)[number] = {
            file: uri.fsPath,
            severity: severityMap[d.severity] ?? "unknown",
            message: d.message.slice(0, DIAGNOSTIC_MSG_MAX),
            line: d.range.start.line + 1,
          }

          if (d.code != null) {
            entry.code = typeof d.code === "string" ? d.code : String(d.code)
          }

          if (d.source) {
            entry.source = d.source
          }

          if (d.relatedInformation && d.relatedInformation.length > 0) {
        const related = d.relatedInformation.slice(0, MAX_RELATED_INFO).map((ri) => {
               const relPath = pathMod.relative(getWorkDir(), ri.location.uri.fsPath)
               return `${relPath}:${ri.location.range.start.line + 1} ${ri.message.slice(0, RELATED_INFO_MSG_MAX)}`
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
      const maxShown = MAX_PROBLEMS_SHOWN
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
        name: "Проблемы",
        description: `${errors.length} ошибок, ${warnings.length} предупреждений`,
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
      displayTitle: "Буфер обмена",
      description: "Содержимое буфера обмена",
      type: "normal",
      priority: 60,
    },
    async resolve(_query: string): Promise<ContextItem[]> {
      try {
        const text = await vscode.env.clipboard.readText()
        if (text.length === 0) return []
        const preview = text.slice(0, CLIPBOARD_PREVIEW_LENGTH).replace(/\n/g, " ")
        return [{
          content: `## Буфер обмена\n  Символов: ${text.length}\n  Начало: "${preview}"`,
          name: "Буфер обмена",
          description: `${text.length} символов`,
        }]
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        log.error(`Не удалось прочитать буфер обмена: ${msg}`)
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
      displayTitle: "Отладчик",
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
            content: `## Отладчик\n  Сессия: ${session.name}\n  Поток: нет`,
            name: "Отладчик",
            description: session.name,
          }]
        }

        const stackResp = await session.customRequest("stackTrace", {
          threadId: mainThread.id,
          levels: STACK_TRACE_LEVELS,
        }) as { stackFrames: Array<{ name: string; line: number; source?: { name: string; path: string } }> }
        const frames = stackResp?.stackFrames ?? []
        const stack = frames.slice(0, STACK_TRACE_LEVELS).map((f: { name: string; line: number; source?: { name: string; path: string } }) => {
          const loc = f.source ? `${f.source.name}:${f.line}` : `line ${f.line}`
          return `  ${f.name} at ${loc}`
        }).join("\n")

        return [{
          content: `## Отладчик\n  Сессия: ${session.name}\n  Поток: ${mainThread.name}\n  Стек:\n${stack}`,
          name: "Отладчик",
          description: `${session.name}: ${mainThread.name}`,
        }]
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        log.error(`Не удалось получить стек отладки: ${msg}`)
        return [{
          content: `## Отладчик\n  Сессия: ${session.name}\n  Поток: error`,
          name: "Отладчик",
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
      displayTitle: "Терминал",
      description: "Состояние терминалов",
      type: "normal",
      priority: 65,
    },
    async resolve(_query: string): Promise<ContextItem[]> {
      const terminals = vscode.window.terminals
      if (terminals.length === 0) return []

      const active = vscode.window.activeTerminal
      return [{
        content: `## Терминал\n  Терминалов: ${terminals.length}\n  Активный: ${active?.name ?? "нет"} (${active ? "активен" : "неактивен"})`,
        name: "Терминал",
        description: `${terminals.length} терминалов`,
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
      displayTitle: "ОС",
      description: "Информация об операционной системе",
      type: "normal",
      priority: 98,
    },
    async resolve(_query: string): Promise<ContextItem[]> {
      const shell = process.env.SHELL ?? process.env.COMSPEC ?? "unknown"
      return [{
        content: `## Система\n  Платформа: ${os.platform()} ${os.arch()}\n  Релиз: ${os.release()}\n  Shell: ${shell}\n  Память: ${(os.totalmem() / 1024 / 1024 / 1024).toFixed(1)} ГБ\n  CPU: ${os.cpus()[0]?.model ?? "unknown"}`,
        name: "ОС",
        description: `${os.platform()} ${os.arch()}`,
      }]
    },
  }
}
