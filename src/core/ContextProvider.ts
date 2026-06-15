/**
 * On-demand контекстный провайдер.
 *
 * В отличие от ContextSource (автоматическая инъекция в системный
 * промпт), ContextProvider вызывается по запросу пользователя,
 * например через @mention в чате: @url https://example.com.
 *
 * Аналог continue.dev IContextProvider.
 */

// ── Типы ───────────────────────────────────────────────────

export interface ContextItem {
  /** Основной текст контекста. */
  readonly content: string

  /** Краткое имя для отображения. */
  readonly name: string

  /** Описание (опционально). */
  readonly description?: string
}

export type ProviderType = "normal" | "query" | "submenu"

export interface ProviderDescription {
  /** Уникальное имя (используется в @mention). */
  readonly name: string

  /** Отображаемое название. */
  readonly displayTitle: string

  /** Описание для подсказок. */
  readonly description: string

  /** Тип взаимодействия. */
  readonly type: ProviderType
}

export interface SubmenuItem {
  readonly id: string
  readonly label: string
  readonly description: string
}

export interface ContextProvider {
  readonly description: ProviderDescription

  resolve(query: string): Promise<ContextItem[]>

  loadSubmenuItems?(): Promise<SubmenuItem[]>
}

// ── Реестр провайдеров ─────────────────────────────────────

export class ContextProviderRegistry {
  private providers = new Map<string, ContextProvider>()

  register(provider: ContextProvider): void {
    this.providers.set(provider.description.name, provider)
  }

  unregister(name: string): void {
    this.providers.delete(name)
  }

  get(name: string): ContextProvider | undefined {
    return this.providers.get(name)
  }

  list(): ContextProvider[] {
    return [...this.providers.values()]
  }

  has(name: string): boolean {
    return this.providers.has(name)
  }
}

// ── URL провайдер ──────────────────────────────────────────

/**
 * Провайдер: содержимое веб-страницы по URL.
 * Тип: query (пользователь вводит URL).
 */
export function makeUrlProvider(): ContextProvider {
  return {
    description: {
      name: "url",
      displayTitle: "URL",
      description: "Содержимое веб-страницы по URL",
      type: "query",
    },
    async resolve(query: string): Promise<ContextItem[]> {
      const trimmed = query.trim()
      if (!trimmed) return []

      let url: URL
      try {
        url = new URL(trimmed)
      } catch {
        try {
          url = new URL(`https://${trimmed}`)
        } catch {
          return [{ content: `Некорректный URL: ${trimmed}`, name: "url", description: "error" }]
        }
      }

      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 15000)
        const response = await fetch(url.toString(), {
          signal: controller.signal,
          headers: { "User-Agent": "NeuralTower-Agent/0.1" },
        })
        clearTimeout(timer)

        if (!response.ok) {
          return [{ content: `HTTP ${response.status}: ${response.statusText}`, name: url.hostname, description: "error" }]
        }

        const html = await response.text()
        const text = htmlToText(html)
        const title = extractTitle(html) ?? url.pathname

        return [{
          content: `Источник: ${url.toString()}\n\n${text.slice(0, 12000)}`,
          name: title,
          description: url.toString(),
        }]
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return [{ content: `Ошибка загрузки: ${msg}`, name: url.hostname, description: "error" }]
      }
    },
  }
}

// ── Web Search провайдер ───────────────────────────────────

/**
 * Провайдер: поиск в интернете.
 * Тип: query (пользователь вводит поисковый запрос).
 *
 * Использует DuckDuckGo JSON API (без ключа).
 */
export function makeWebSearchProvider(): ContextProvider {
  return {
    description: {
      name: "web",
      displayTitle: "Web Search",
      description: "Поиск в интернете",
      type: "query",
    },
    async resolve(query: string): Promise<ContextItem[]> {
      const trimmed = query.trim()
      if (!trimmed) return []

      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 15000)
        const resp = await fetch(
          `https://api.duckduckgo.com/?q=${encodeURIComponent(trimmed)}&format=json`,
          { signal: controller.signal },
        )
        clearTimeout(timer)

        if (!resp.ok) {
          return [{ content: `Поиск недоступен: HTTP ${resp.status}`, name: "web", description: "error" }]
        }

        const data = await resp.json() as Record<string, unknown>
        const abstract = (data.Abstract as string) ?? "Результаты не найдены"
        const related = ((data.RelatedTopics as unknown[]) ?? [])
          .slice(0, 8)
          .map((t: unknown) => {
            if (typeof t === "string") return t
            if (typeof t === "object" && t !== null) {
              const obj = t as Record<string, unknown>
              return (obj.Text as string) ?? (obj.FirstURL as string) ?? ""
            }
            return ""
          })
          .filter(Boolean) as string[]

        const items: ContextItem[] = [{
          content: `Запрос: ${trimmed}\n\n${abstract}\n\nСвязанные:\n${related.map((r: string, i: number) => `${i + 1}. ${r}`).join("\n")}`,
          name: `Поиск: ${trimmed.slice(0, 40)}`,
          description: `${related.length} результатов`,
        }]

        return items
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return [{ content: `Ошибка поиска: ${msg}`, name: "web", description: "error" }]
      }
    },
  }
}

// ── Проблемы (on-demand) провайдер ─────────────────────────

/**
 * Провайдер: подробные проблемы из активного файла.
 * Тип: normal (без ввода, показывает проблемы текущего файла).
 */
export function makeActiveFileProblemsProvider(): ContextProvider {
  return {
    description: {
      name: "problems",
      displayTitle: "Problems",
      description: "Проблемы в активном файле",
      type: "normal",
    },
    async resolve(_query: string): Promise<ContextItem[]> {
      const vscode = await import("vscode")
      const editor = vscode.window.activeTextEditor
      if (!editor) return [{ content: "Нет активного редактора", name: "problems" }]

      const diagnostics = vscode.languages.getDiagnostics(editor.document.uri)
      if (diagnostics.length === 0) {
        return [{ content: `В файле ${editor.document.uri.fsPath} проблем нет`, name: "problems" }]
      }

      const severityMap: Record<number, string> = { 0: "error", 1: "warning", 2: "info", 3: "hint" }
      const lines: string[] = []
      for (const d of diagnostics) {
        const line = d.range.start.line + 1
        const sev = severityMap[d.severity] ?? "unknown"
        const snippet = editor.document.lineAt(d.range.start).text.trim().slice(0, 120)
        lines.push(`[${sev}] строка ${line}: ${d.message}`)
        lines.push(`  > ${snippet}`)
      }

      return [{
        content: `Проблемы в ${editor.document.uri.fsPath}:\n\n${lines.join("\n")}`,
        name: "problems",
        description: `${diagnostics.length} проблем`,
      }]
    },
  }
}

// ── File провайдер ─────────────────────────────────────────

/**
 * Провайдер: содержимое конкретного файла по пути.
 * Тип: query (пользователь вводит путь, абсолютный или относительный).
 */
export function makeFileProvider(
  getWorkDir: () => string,
): ContextProvider {
  return {
    description: {
      name: "file",
      displayTitle: "File",
      description: "Содержимое файла по пути",
      type: "query",
    },
    async resolve(query: string): Promise<ContextItem[]> {
      const fs = await import("fs/promises")
      const path = await import("path")
      const trimmed = query.trim()
      if (!trimmed) return []

      let filePath = trimmed
      if (!path.default.isAbsolute(trimmed)) {
        filePath = path.default.join(getWorkDir(), trimmed)
      }

      try {
        const stat = await fs.stat(filePath)
        if (stat.isDirectory()) {
          return [{ content: `Это директория, не файл: ${filePath}`, name: "file", description: "error" }]
        }
        if (stat.size > 200_000) {
          return [{ content: `Файл слишком большой (${(stat.size / 1024).toFixed(0)} КБ): ${filePath}`, name: "file", description: "error" }]
        }
        const content = await fs.readFile(filePath, "utf-8")
        const lang = detectLanguageFromPath(filePath)
        return [{
          content: `Файл: ${filePath}\n\n\`\`\`${lang}\n${content.slice(0, 100000)}\n\`\`\``,
          name: path.default.basename(filePath),
          description: `${(stat.size / 1024).toFixed(1)} КБ, ${lang}`,
        }]
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return [{ content: `Не удалось прочитать файл ${filePath}: ${msg}`, name: "file", description: "error" }]
      }
    },
  }
}

// ── Code провайдер ──────────────────────────────────────────

/**
 * Провайдер: поиск символов, функций, классов в коде.
 * Тип: query (пользователь вводит имя символа или паттерн).
 *
 * Использует FileIndex для фильтрации файлов по языку,
 * затем ищет совпадения в содержимом файлов.
 */
export interface CodeSearchEntry {
  path: string
  language: string
  size: number
}

const CODE_SEARCH_MAX_FILES = 50
const CODE_SEARCH_MAX_SIZE = 50_000
const CODE_LANGS = new Set(["ts", "tsx", "js", "jsx", "py", "rs", "go", "java", "kt", "rb", "c", "cpp", "cs", "swift", "php", "lua", "dart", "scala"])

export function makeCodeProvider(
  getWorkDir: () => string,
  getFileIndex: () => { findByPattern(pattern: string): CodeSearchEntry[]; findByLanguage(lang: string): CodeSearchEntry[] },
): ContextProvider {
  return {
    description: {
      name: "code",
      displayTitle: "Code",
      description: "Поиск функций, классов, символов в коде",
      type: "query",
    },
    async resolve(query: string): Promise<ContextItem[]> {
      const fs = await import("fs/promises")
      const trimmed = query.trim()
      if (!trimmed) return []

      const index = getFileIndex()
      const results: string[] = []

      const searchInEntries = async (entries: CodeSearchEntry[]) => {
        for (const entry of entries.slice(0, CODE_SEARCH_MAX_FILES)) {
          if (results.length >= 10) break
          try {
            const stat = await fs.stat(entry.path)
            if (stat.size > CODE_SEARCH_MAX_SIZE) continue
            const content = await fs.readFile(entry.path, "utf-8")
            const matches = extractSymbols(content, trimmed)
            if (matches.length > 0) {
              const lines = matches.slice(0, 5).map((m) => `  ${m}`)
              results.push(`${entry.path} (${entry.language})\n${lines.join("\n")}`)
            }
          } catch {
            // пропустить нечитаемые файлы
          }
        }
      }

      await searchInEntries(index.findByPattern(trimmed))

      if (results.length < 5) {
        for (const lang of CODE_LANGS) {
          if (results.length >= 10) break
          await searchInEntries(index.findByLanguage(lang))
        }
      }

      if (results.length === 0) {
        return [{ content: `Символы для "${trimmed}" не найдены`, name: "code", description: "not found" }]
      }

      return [{
        content: `Результаты поиска кода для "${trimmed}":\n\n${results.join("\n\n")}`,
        name: `Code: ${trimmed}`,
        description: `${results.length} файлов`,
      }]
    },
  }
}

// ── Tree провайдер ──────────────────────────────────────────

/**
 * Провайдер: дерево директорий проекта.
 * Тип: query (опционально путь к поддиректории).
 */
export function makeTreeProvider(
  getWorkDir: () => string,
): ContextProvider {
  return {
    description: {
      name: "tree",
      displayTitle: "Tree",
      description: "Дерево директорий проекта",
      type: "query",
    },
    async resolve(query: string): Promise<ContextItem[]> {
      const fs = await import("fs/promises")
      const path = await import("path")
      const targetDir = query.trim()
        ? (path.default.isAbsolute(query.trim()) ? query.trim() : path.default.join(getWorkDir(), query.trim()))
        : getWorkDir()

      try {
        const lines = await buildTree(targetDir, targetDir, "", true, 0)
        return [{
          content: `Дерево: ${targetDir}\n\n${lines}`,
          name: `Tree: ${path.default.basename(targetDir) || targetDir}`,
          description: `${lines.split("\n").length} строк`,
        }]
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return [{ content: `Не удалось построить дерево для ${targetDir}: ${msg}`, name: "tree", description: "error" }]
      }
    },
  }
}

async function buildTree(
  root: string,
  current: string,
  prefix: string,
  isLast: boolean,
  depth: number,
  maxDepth = 4,
): Promise<string> {
  const fs = await import("fs/promises")
  const path = await import("path")
  if (depth > maxDepth) return `${prefix}${isLast ? "" : ""}...\n`

  let result = ""
  const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => [])
  const dirs: { name: string; full: string }[] = []
  const files: { name: string; full: string }[] = []

  for (const e of entries) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue
    const full = path.default.join(current, e.name)
    if (e.isDirectory()) dirs.push({ name: e.name, full })
    else files.push({ name: e.name, full })
  }

  dirs.sort((a, b) => a.name.localeCompare(b.name))
  files.sort((a, b) => a.name.localeCompare(b.name))

  const all = [...dirs.map((d) => ({ ...d, isDir: true as const })), ...files.map((f) => ({ ...f, isDir: false as const }))]
  const skipThreshold = 20
  const showAll = all.length <= skipThreshold

  for (let i = 0; i < all.length; i++) {
    const item = all[i]
    const last = i === all.length - 1
    const connector = last ? "" : "   "
    const branch = last ? "\u2514\u2500\u2500 " : "\u251C\u2500\u2500 "
    const childPrefix = prefix + (last ? "     " : "    |")

    if (item.isDir) {
      result += `${prefix}${branch}${item.name}/\n`
      if (showAll || depth < maxDepth) {
        result += await buildTree(root, item.full, childPrefix, last, depth + 1, maxDepth)
      }
    } else {
      result += `${prefix}${branch}${item.name}\n`
    }
  }

  return result
}

// ── Repo-map провайдер ──────────────────────────────────────

/**
 * Провайдер: карта архитектуры репозитория.
 * Тип: normal (без ввода, показывает полную карту).
 *
 * Использует FileIndex для структуры и RepoAnalyzer для сводки.
 */
export function makeRepoMapProvider(
  getWorkDir: () => string,
  getFileIndex: () => { findByPattern(pattern: string): CodeSearchEntry[]; findByLanguage(lang: string): CodeSearchEntry[]; stats(): { totalFiles: number; languages: number; totalSize: number } },
  getRepoSummary: () => Promise<{ fileCount: number; dirCount: number; languages: Record<string, number>; buildSystems: string[]; topDirs: string[]; notableFiles: string[] }>,
): ContextProvider {
  return {
    description: {
      name: "repo-map",
      displayTitle: "Repo Map",
      description: "Карта архитектуры репозитория",
      type: "normal",
    },
    async resolve(_query: string): Promise<ContextItem[]> {
      const path = await import("path")
      const summary = await getRepoSummary()
      const stats = getFileIndex().stats()
      const workDir = getWorkDir()

      const parts: string[] = []
      parts.push("## Карта репозитория")
      parts.push(`Файлов: ${summary.fileCount}, Директорий: ${summary.dirCount}`)
      parts.push(`Размер: ${(stats.totalSize / 1024).toFixed(1)} КБ`)
      parts.push("")

      if (Object.keys(summary.languages).length > 0) {
        const langLines = Object.entries(summary.languages)
          .sort((a, b) => b[1] - a[1])
          .map(([lang, count]) => `  ${lang}: ${count}`)
        parts.push("Языки:")
        parts.push(...langLines)
        parts.push("")
      }

      if (summary.buildSystems.length > 0) {
        parts.push(`Системы сборки: ${summary.buildSystems.join(", ")}`)
        parts.push("")
      }

      if (summary.topDirs.length > 0) {
        parts.push("Директории верхнего уровня:")
        for (const d of summary.topDirs) {
          const rel = path.default.relative(workDir, d) || d
          parts.push(`  ${rel}/`)
        }
        parts.push("")
      }

      if (summary.notableFiles.length > 0) {
        parts.push("Заметные файлы:")
        for (const f of summary.notableFiles) {
          const rel = path.default.relative(workDir, f)
          parts.push(`  ${rel}`)
        }
        parts.push("")
      }

      const srcEntries = getFileIndex().findByPattern("src|lib|app|packages|modules|core")
      if (srcEntries.length > 0) {
        parts.push("Источники (ключевые директории):")
        const dirSet = new Set<string>()
        for (const e of srcEntries) {
          const rel = path.default.relative(workDir, e.path)
          const dir = rel.split(path.default.sep).slice(0, 2).join(path.default.sep)
          dirSet.add(dir)
        }
        for (const d of [...dirSet].sort().slice(0, 30)) {
          parts.push(`  ${d}/`)
        }
      }

      return [{
        content: parts.join("\n"),
        name: "Repo Map",
        description: `${summary.fileCount} файлов, ${Object.keys(summary.languages).length} языков`,
      }]
    },
  }
}

// ── Rules провайдер ─────────────────────────────────────────

/**
 * Провайдер: правила проекта из файлов правил.
 * Тип: normal (без ввода, показывает все правила).
 *
 * Использует общую функцию loadRulesFiles() для избежания
 * дублирования логики чтения с диска.
 */
export function makeRulesProvider(
  getWorkDir: () => string,
): ContextProvider {
  return {
    description: {
      name: "rules",
      displayTitle: "Rules",
      description: "Правила проекта",
      type: "normal",
    },
    async resolve(_query: string): Promise<ContextItem[]> {
      const rules = await loadRulesFiles(getWorkDir)

      if (rules.length === 0) {
        return [{ content: "Правила проекта не найдены. Создайте .neuraltower/rules/*.md или AGENTS.md", name: "rules", description: "empty" }]
      }

      const parts: string[] = []
      for (const r of rules) {
        parts.push(`## ${r.name}`)
        parts.push(r.content)
        parts.push("")
      }

      return [{
        content: parts.join("\n"),
        name: "Rules",
        description: `${rules.length} правил`,
      }]
    },
  }
}

// ── MCP провайдер ───────────────────────────────────────────

/**
 * Провайдер: MCP-инструменты как контекст.
 * Тип: submenu (показывает список серверов и инструментов).
 *
 * Использует MCPManager для перечисления доступных инструментов.
 */
export type MCPToolListFn = () => Promise<
  Array<{ server: string; tool: { name: string; description: string; schema: Record<string, unknown> } }>
>

export function makeMCPProvider(
  listMCPTools: MCPToolListFn,
): ContextProvider {
  return {
    description: {
      name: "mcp",
      displayTitle: "MCP",
      description: "MCP-инструменты как контекст",
      type: "submenu",
    },
    async resolve(query: string): Promise<ContextItem[]> {
      const trimmed = query.trim()
      const allTools = await listMCPTools()

      if (allTools.length === 0) {
        return [{ content: "MCP-серверы не подключены", name: "mcp", description: "empty" }]
      }

      const filtered = trimmed
        ? allTools.filter(
            (t) =>
              t.tool.name.toLowerCase().includes(trimmed.toLowerCase()) ||
              t.tool.description.toLowerCase().includes(trimmed.toLowerCase()) ||
              t.server.toLowerCase().includes(trimmed.toLowerCase()),
          )
        : allTools

      if (filtered.length === 0) {
        return [{ content: `MCP-инструменты для "${trimmed}" не найдены`, name: "mcp", description: "not found" }]
      }

      const grouped = new Map<string, typeof filtered>()
      for (const t of filtered) {
        const arr = grouped.get(t.server) ?? []
        arr.push(t)
        grouped.set(t.server, arr)
      }

      const lines: string[] = []
      for (const [server, tools] of grouped) {
        lines.push(`Сервер: ${server}`)
        for (const t of tools) {
          lines.push(`  ${t.tool.name}: ${t.tool.description}`)
        }
        lines.push("")
      }

      return [{
        content: `Доступные MCP-инструменты:\n\n${lines.join("\n")}`,
        name: "MCP Tools",
        description: `${filtered.length} инструментов`,
      }]
    },
    async loadSubmenuItems(): Promise<SubmenuItem[]> {
      const allTools = await listMCPTools()
      return allTools.map((t) => ({
        id: `${t.server}:${t.tool.name}`,
        label: t.tool.name,
        description: `[${t.server}] ${t.tool.description}`,
      }))
    },
  }
}

// ── Утилиты ────────────────────────────────────────────────

function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  return m ? m[1].trim() : null
}

function htmlToText(html: string): string {
  let t = html.replace(/<script[\s\S]*?<\/script>/gi, "")
  t = t.replace(/<style[\s\S]*?<\/style>/gi, "")
  t = t.replace(/<br\s*\/?>/gi, "\n")
  t = t.replace(/<\/?(p|div|li|tr|h[1-6])[^>]*>/gi, "\n")
  t = t.replace(/<[^>]+>/g, "")
  t = t.replace(/&nbsp;/g, " ")
  t = t.replace(/&amp;/g, "&")
  t = t.replace(/&lt;/g, "<")
  t = t.replace(/&gt;/g, ">")
  t = t.replace(/&quot;/g, '"')
  t = t.replace(/\u00a0/g, " ")
  t = t.replace(/\n{3,}/g, "\n\n")
  return t.trim()
}

/**
 * Общая функция чтения файлов правил.
 * Используется и RulesSource, и RulesProvider для избежания
 * дублирования логики чтения с диска.
 */
export async function loadRulesFiles(getWorkDir: () => string): Promise<Array<{ name: string; content: string }>> {
  const fs = await import("fs/promises")
  const path = await import("path")
  const workDir = getWorkDir()
  const rules: Array<{ name: string; content: string }> = []
  const ruleDirs = [
    path.default.join(workDir, ".neuraltower", "rules"),
    path.default.join(workDir, ".kilo", "rules"),
  ]

  for (const dir of ruleDirs) {
    try {
      const entries = await fs.readdir(dir)
      const mdFiles = entries.filter((e) => e.endsWith(".md")).sort()
      for (const fname of mdFiles) {
        const content = await fs.readFile(path.default.join(dir, fname), "utf-8")
        rules.push({ name: fname, content: content.trim() })
      }
    } catch {
      // директория может не существовать
    }
  }

  for (const fname of ["AGENTS.md", "CLAUDE.md"]) {
    try {
      const content = await fs.readFile(path.default.join(workDir, fname), "utf-8")
      rules.push({ name: fname, content: content.trim() })
    } catch {
      // файл может не существовать
    }
  }

  return rules
}

function detectLanguageFromPath(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? ""
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
    js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
    py: "python", rs: "rust", go: "go", java: "java", kt: "kotlin",
    rb: "ruby", cs: "csharp",
    c: "c", h: "c", cpp: "cpp", cxx: "cpp", cc: "cpp", hpp: "cpp",
    html: "html", htm: "html", css: "css", scss: "scss", sass: "sass",
    json: "json", toml: "toml", yaml: "yaml", yml: "yaml",
    md: "markdown", sh: "bash", bash: "bash", zsh: "zsh",
    sql: "sql", xml: "xml", svg: "xml",
    tf: "hcl", tfvars: "hcl",
    lua: "lua", php: "php", swift: "swift", dart: "dart",
  }
  return map[ext] ?? ext ?? "text"
}

function extractSymbols(content: string, query: string): string[] {
  const results: string[] = []
  const lines = content.split("\n")
  const qi = query.toLowerCase()
  const patterns = [
    new RegExp(`(?:export\\s+)?(?:declare\\s+)?(?:abstract\\s+)?(?:async\\s+)?(?:static\\s+)?class\\s+(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "i"),
    new RegExp(`(?:export\\s+)?(?:declare\\s+)?(?:abstract\\s+)?(?:async\\s+)?(?:static\\s+)?function\\s+(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "i"),
    new RegExp(`(?:export\\s+)?(?:const|let|var)\\s+(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})\\s*[:=]`, "i"),
    new RegExp(`(?:export\\s+)?(?:const|let|var)\\s+\\w+\\s*=\\s*(?:async\\s+)?\\(([^)]*)\\)\\s*(?:=>|\\{)`, "i"),
  ]

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.toLowerCase().includes(qi) && line.trim().length > 0 && !line.trim().startsWith("//") && !line.trim().startsWith("*")) {
      for (const p of patterns) {
        if (p.test(line)) {
          results.push(`строка ${i + 1}: ${line.trim().slice(0, 120)}`)
          break
        }
      }
    }
  }

  if (results.length === 0) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line.toLowerCase().includes(qi) && line.trim().length > 0 && !line.trim().startsWith("//")) {
        results.push(`строка ${i + 1}: ${line.trim().slice(0, 120)}`)
        if (results.length >= 5) break
      }
    }
  }

  return results.slice(0, 5)
}
