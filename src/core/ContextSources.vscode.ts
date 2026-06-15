import * as vscode from "vscode"
import type { ContextSource } from "./ContextSource"
import { loadRulesFiles } from "./ContextProvider"

const MAX_CONTENT_LINES = 300

interface CurrentFileData {
  path: string
  language: string
  content: string
  selection: string | null
  lineCount: number
}

interface OpenFileData {
  path: string
  language: string
  lineCount: number
}

interface ProblemEntry {
  file: string
  severity: string
  message: string
  line: number
}

interface ProblemsData {
  problems: ProblemEntry[]
}

interface ClipboardData {
  length: number
  preview: string
}

interface DebuggerData {
  active: boolean
  name: string
  thread: string
  stack: string
}

interface TerminalData {
  count: number
  activeName: string
  state: string
}

export function makeCurrentFileSource(): ContextSource<CurrentFileData> {
  return {
    key: "currentfile",
    priority: 95,
    async load(): Promise<CurrentFileData | undefined> {
      const editor = vscode.window.activeTextEditor
      if (!editor) return

      const doc = editor.document
      const isBinary = doc.isClosed || doc.uri.scheme !== "file"
      if (isBinary) return

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

      return {
        path: doc.uri.fsPath,
        language: doc.languageId,
        content,
        selection,
        lineCount: doc.lineCount,
      }
    },
    baseline(v) {
      const parts: string[] = [
        `## Активный файл`,
        `Путь: ${v.path}`,
        `Язык: ${v.language}`,
        `Строк: ${v.lineCount}`,
      ]
      if (v.selection) {
        parts.push(`Выделение:\n\`\`\`${v.language}\n${v.selection.slice(0, 2000)}\n\`\`\``)
      }
      parts.push(`Содержимое:\n\`\`\`${v.language}\n${v.content.slice(0, 8000)}\n\`\`\``)
      return parts.join("\n")
    },
    update(prev, cur) {
      if (prev.path !== cur.path) {
        return `Переключён файл: ${cur.path}`
      }
      if (prev.content !== cur.content) {
        return `Файл изменён: ${cur.path}`
      }
      return ""
    },
  }
}

export function makeOpenFilesSource(): ContextSource<OpenFileData[]> {
  return {
    key: "openfiles",
    priority: 92,
    async load(): Promise<OpenFileData[]> {
      const editors = vscode.window.visibleTextEditors
      const result: OpenFileData[] = []
      for (const editor of editors) {
        if (editor.document.uri.scheme !== "file") continue
        result.push({
          path: editor.document.uri.fsPath,
          language: editor.document.languageId,
          lineCount: editor.document.lineCount,
        })
      }
      return result
    },
    baseline(v) {
      if (v.length === 0) return ""
      const lines = v.map((f) => `  ${f.path} (${f.language}, ${f.lineCount} строк)`)
      return `## Открытые файлы\n${lines.join("\n")}`
    },
    update(prev: OpenFileData[], cur: OpenFileData[]) {
      if (prev.length !== cur.length) {
        return `Открытые файлы: ${cur.length} (было ${prev.length})`
      }
      const prevPaths = new Set(prev.map((f) => f.path))
      const curPaths = new Set(cur.map((f) => f.path))
      if (prevPaths.size !== curPaths.size || ![...prevPaths].every((p) => curPaths.has(p))) {
        return "Состав открытых файлов изменён"
      }
      return ""
    },
  }
}

export function makeProblemsSource(): ContextSource<ProblemsData> {
  const severityMap: Record<number, string> = {
    0: "error",
    1: "warning",
    2: "information",
    3: "hint",
  }

  return {
    key: "problems",
    priority: 88,
    async load(): Promise<ProblemsData> {
      const allDiagnostics = vscode.languages.getDiagnostics()
      const problems: ProblemEntry[] = []

      for (const [uri, diagnostics] of allDiagnostics) {
        if (diagnostics.length === 0 || uri.scheme !== "file") continue
        for (const d of diagnostics.slice(0, 10)) {
          problems.push({
            file: uri.fsPath,
            severity: severityMap[d.severity] ?? "unknown",
            message: d.message.slice(0, 300),
            line: d.range.start.line + 1,
          })
        }
      }

      return { problems }
    },
    baseline(v) {
      if (v.problems.length === 0) return ""
      const errors = v.problems.filter((p) => p.severity === "error")
      const warnings = v.problems.filter((p) => p.severity === "warning")
      const lines: string[] = []
      if (errors.length > 0) lines.push(`  Ошибок: ${errors.length}`)
      if (warnings.length > 0) lines.push(`  Предупреждений: ${warnings.length}`)
      lines.push("")
      for (const p of v.problems.slice(0, 15)) {
        lines.push(`  [${p.severity}] ${p.file}:${p.line} — ${p.message}`)
      }
      return `## Проблемы в коде\n${lines.join("\n")}`
    },
    update(prev, cur) {
      const pc = cur.problems.length
      const pp = prev.problems.length
      if (pc !== pp) return `Проблемы: ${pc} (было ${pp})`
      return ""
    },
  }
}

export function makeClipboardSource(): ContextSource<ClipboardData> {
  let lastLength = 0
  let lastPreview = ""

  return {
    key: "clipboard",
    priority: 60,
    async load(): Promise<ClipboardData> {
      try {
        const text = await vscode.env.clipboard.readText()
        if (text.length === 0) return { length: 0, preview: "" }
        const preview = text.slice(0, 120).replace(/\n/g, " ")
        return { length: text.length, preview }
      } catch {
        return { length: 0, preview: "" }
      }
    },
    baseline(v) {
      if (v.length === 0) return ""
      return `## Буфер обмена\n  Символов: ${v.length}\n  Начало: "${v.preview}"`
    },
    update() {
      return ""
    },
  }
}

export function makeDebuggerSource(): ContextSource<DebuggerData> {
  return {
    key: "debugger",
    priority: 82,
    async load(): Promise<DebuggerData | undefined> {
      const session = vscode.debug.activeDebugSession
      if (!session) return

      try {
        const threadsResp = await session.customRequest("threads", {}) as { threads: Array<{ id: number; name: string }> }
        const threads = threadsResp?.threads ?? []
        const mainThread = threads.find((t: { id: number }) => t.id === 1) ?? threads[0]

        if (!mainThread) {
          return { active: true, name: session.name, thread: "none", stack: "" }
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

        return {
          active: true,
          name: session.name,
          thread: mainThread.name,
          stack,
        }
      } catch {
        return { active: true, name: session.name, thread: "error", stack: "" }
      }
    },
    baseline(v) {
      return `## Отладчик\n  Сессия: ${v.name}\n  Поток: ${v.thread}\n  Стек:\n${v.stack}`
    },
    update() {
      return "Состояние отладчика обновлено"
    },
  }
}

export function makeTerminalSource(): ContextSource<TerminalData> {
  return {
    key: "terminal",
    priority: 65,
    async load(): Promise<TerminalData | undefined> {
      const terminals = vscode.window.terminals
      if (terminals.length === 0) return

      const active = vscode.window.activeTerminal
      return {
        count: terminals.length,
        activeName: active?.name ?? "none",
        state: active ? "active" : "inactive",
      }
    },
    baseline(v) {
      return `## Терминал\n  Терминалов: ${v.count}\n  Активный: ${v.activeName} (${v.state})`
    },
    update(prev, cur) {
      if (prev.count !== cur.count) {
        return `Терминалов: ${cur.count} (было ${prev.count})`
      }
      return ""
    },
  }
}

// ── OS источник ────────────────────────────────────────────

interface OSData {
  platform: string
  arch: string
  release: string
  shell: string
  memoryTotal: string
  cpuModel: string
}

export function makeOSSource(): ContextSource<OSData> {
  return {
    key: "os",
    priority: 98,
    async load(): Promise<OSData> {
      const os = await import("os")
      const shell = process.env.SHELL ?? process.env.COMSPEC ?? "unknown"
      return {
        platform: os.platform(),
        arch: os.arch(),
        release: os.release(),
        shell,
        memoryTotal: `${(os.totalmem() / 1024 / 1024 / 1024).toFixed(1)} ГБ`,
        cpuModel: os.cpus()[0]?.model ?? "unknown",
      }
    },
    baseline(v) {
      return `## Система\n  Платформа: ${v.platform} ${v.arch}\n  Релиз: ${v.release}\n  Shell: ${v.shell}\n  Память: ${v.memoryTotal}\n  CPU: ${v.cpuModel}`
    },
    update() {
      return ""
    },
  }
}

// ── Rules источник ─────────────────────────────────────────

interface RulesData {
  rules: Array<{ name: string; content: string }>
  totalChars: number
}

export function makeRulesSource(
  getWorkDir: () => string,
): ContextSource<RulesData> {
  let cached: RulesData | undefined
  let cachedAt = 0
  const TTL = 30_000

  return {
    key: "rules",
    priority: 99,
    async load(): Promise<RulesData | undefined> {
      const now = Date.now()
      if (cached && now - cachedAt < TTL) return cached

      const rules = await loadRulesFiles(getWorkDir)
      const totalChars = rules.reduce((s, r) => s + r.content.length, 0)
      cached = { rules, totalChars }
      cachedAt = now
      return cached
    },
    baseline(v) {
      if (v.rules.length === 0) return ""
      const parts: string[] = []
      for (const r of v.rules) {
        parts.push(`## Правила: ${r.name}`)
        parts.push(r.content)
        parts.push("")
      }
      return parts.join("\n")
    },
    update(prev, cur) {
      if (prev.rules.length !== cur.rules.length) {
        return `Правила изменены: ${cur.rules.length} файлов`
      }
      return ""
    },
  }
}

// ── Repo-map источник (автоматический) ──────────────────────

interface RepoMapData {
  fileCount: number
  dirCount: number
  languages: Record<string, number>
  buildSystems: string[]
  topDirs: string[]
  notableFiles: string[]
}

export function makeRepoMapSource(
  getWorkDir: () => string,
  getRepoSummary: () => Promise<RepoMapData>,
): ContextSource<RepoMapData> {
  let cached: RepoMapData | undefined
  let cachedAt = 0
  const TTL = 60_000

  return {
    key: "repomap",
    priority: 87,
    async load(): Promise<RepoMapData | undefined> {
      const now = Date.now()
      if (cached && now - cachedAt < TTL) return cached
      cached = await getRepoSummary()
      cachedAt = now
      return cached
    },
    baseline(v) {
      const pathMod = require("path") as typeof import("path")
      const parts: string[] = []
      parts.push("## Карта репозитория")
      parts.push(`Файлов: ${v.fileCount}, Директорий: ${v.dirCount}`)

      if (Object.keys(v.languages).length > 0) {
        const langLines = Object.entries(v.languages)
          .sort((a: [string, number], b: [string, number]) => b[1] - a[1])
          .map(([lang, count]) => `  ${lang}: ${count}`)
        parts.push("Языки:")
        parts.push(...langLines)
      }

      if (v.buildSystems.length > 0) {
        parts.push(`Системы сборки: ${v.buildSystems.join(", ")}`)
      }

      if (v.notableFiles.length > 0) {
        parts.push("Заметные файлы:")
        for (const f of v.notableFiles) {
          const rel = pathMod.relative(getWorkDir(), f)
          parts.push(`  ${rel}`)
        }
      }

      return parts.join("\n")
    },
    update(prev, cur) {
      const delta = cur.fileCount - prev.fileCount
      if (delta !== 0) return `Карта репозитория обновлена: ${delta > 0 ? "+" : ""}${delta} файлов`
      return ""
    },
  }
}
