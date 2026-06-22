import * as vscode from "vscode"
import type { IBackend } from "../../core/IBackend"
import type { IPlugin } from "../../shared/Types"
import { createDomainLogger } from "../../core/Logger"
import { stripCodeFences } from "../../utils/StripCodeFences"
import { errorMessage } from "../../core/Errors"

const log = createDomainLogger("Autocomplete")

const AUTOCOMPLETE_DEBOUNCE_MS = 150
const AUTOCOMPLETE_MAX_PROMPT_TOKENS = 2048
const AUTOCOMPLETE_DIFF_TRUNCATE = 10000
const AUTOCOMPLETE_CONTEXT_BEFORE = 30
const AUTOCOMPLETE_CONTEXT_AFTER = 10
const AUTOCOMPLETE_CACHE_MAX_SIZE = 100

/**
 * Конфигурация автодополнения для конкретного языка.
 * Добавление нового языка не требует изменения AutocompleteService (OCP).
 */
export interface ILanguageCompletionConfig {
  keywords: string[]
  builtins: string[]
}

/**
 * Реестр конфигураций автодополнения по языкам.
 * Для добавления нового языка достаточно внести запись в этот объект.
 */
const JS_KEYWORDS = [
  "const", "let", "var", "function", "async", "await", "return",
  "import", "export", "default", "from", "class", "extends",
  "interface", "type", "enum", "implements", "public", "private",
  "protected", "static", "readonly", "if", "else", "while",
  "for", "do", "switch", "case", "break", "continue", "try",
  "catch", "finally", "throw", "new", "this", "super",
  "typeof", "instanceof", "void", "null", "undefined", "true",
  "false", "constructor", "get", "set", "declare", "abstract",
  "override", "namespace", "module", "as", "in", "of",
] as const

const JS_BUILTINS = [
  "toString", "valueOf", "hasOwnProperty", "constructor",
  "push", "pop", "shift", "unshift", "splice", "slice",
  "map", "filter", "reduce", "forEach", "find", "findIndex",
  "some", "every", "includes", "indexOf", "lastIndexOf",
  "concat", "join", "sort", "reverse", "flat", "flatMap",
  "entries", "keys", "values", "length",
  "trim", "trimStart", "trimEnd", "toUpperCase", "toLowerCase",
  "charAt", "charCodeAt", "startsWith", "endsWith", "repeat",
  "replace", "replaceAll", "split", "substr", "substring",
  "log", "error", "warn", "info", "debug",
  "then", "catch", "finally", "resolve", "reject",
  "querySelector", "querySelectorAll", "addEventListener",
  "removeEventListener", "appendChild", "removeChild",
  "createElement", "getElementById", "getElementsByClassName",
  "getElementsByName", "getElementsByTagName",
] as const

export const LANGUAGE_COMPLETIONS: Record<string, ILanguageCompletionConfig> = {
  javascript: {
    keywords: [...JS_KEYWORDS],
    builtins: [...JS_BUILTINS],
  },
  typescript: {
    keywords: [...JS_KEYWORDS],
    builtins: [...JS_BUILTINS],
  },
  python: {
    keywords: [
      "import", "from", "as", "def", "class", "return", "yield",
      "if", "elif", "else", "while", "for", "in", "not", "and",
      "or", "is", "True", "False", "None", "lambda", "with",
      "try", "except", "finally", "raise", "pass", "break",
      "continue", "del", "global", "nonlocal", "assert",
    ],
    builtins: [
      "print", "len", "range", "str", "int", "float", "list",
      "dict", "set", "tuple", "type", "isinstance", "hasattr",
      "getattr", "setattr", "map", "filter", "zip", "enumerate",
      "sorted", "reversed", "any", "all", "min", "max", "sum",
      "open", "input", "super", "property", "staticmethod",
      "classmethod", "append", "extend", "pop", "remove", "clear",
      "keys", "values", "items", "get", "update", "split",
      "join", "strip", "replace", "startswith", "endswith",
      "find", "index", "count", "format",
    ],
  },
}

/**
 * Сервис автодополнения кода (Inline Completion).
 * Подключается к бэкенду Neural Tower для генерации
 * контекстно-зависимых дополнений. Поддерживает:
 *
 * - Кэширование по (file, position) с LRU-эвикицией и инвалидацией при изменении файла
 * - Дебаунс запросов (150 мс) и отмена висящих запросов
 * - Быстрые локальные префиксные дополнения без вызова бэкенда
 * - Контекст уровня workspace (открытые файлы, проблемы)
 */
export class AutocompleteService implements IPlugin, vscode.InlineCompletionItemProvider {
  name = "autocomplete"

  private readonly cache: Map<string, vscode.InlineCompletionItem[]> = new Map()
  private readonly cacheOrder: string[] = []
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private pendingAbort: AbortController | null = null
  private isInitialized = false
  private disposables: vscode.Disposable[] = []

  // ── Настройки ───────────────────────────────────────────

  private get enabled(): boolean {
    return vscode.workspace.getConfiguration("neuralTowerAgent").get<boolean>("autocomplete.enabled", true)
  }

  private get debounceMs(): number {
    return vscode.workspace.getConfiguration("neuralTowerAgent").get<number>("autocomplete.debounceMs", AUTOCOMPLETE_DEBOUNCE_MS) ?? AUTOCOMPLETE_DEBOUNCE_MS
  }

  private get maxPromptTokens(): number {
    return vscode.workspace.getConfiguration("neuralTowerAgent").get<number>("autocomplete.maxPromptTokens", AUTOCOMPLETE_MAX_PROMPT_TOKENS) ?? AUTOCOMPLETE_MAX_PROMPT_TOKENS
  }

  // ── Жизненный цикл плагина ──────────────────────────────

  constructor(
    private readonly backend: IBackend,
  ) {}

  async init(): Promise<void> {
    this.isInitialized = true
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        this.invalidateCacheForFile(e.document.uri.fsPath)
      }),
    )
  }

  dispose(): void {
    this.cancelPending()
    this.cache.clear()
    this.cacheOrder.length = 0
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    for (const d of this.disposables) d.dispose()
    this.disposables = []
    this.isInitialized = false
  }

  // ── Инвалидация кэша при изменении файла ────────────────

  private invalidateCacheForFile(filePath: string): void {
    const prefix = `${filePath}:`
    for (const key of this.cacheOrder) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key)
      }
    }
    const idx = this.cacheOrder.findIndex((k) => k.startsWith(prefix))
    if (idx !== -1) {
      this.cacheOrder.splice(idx, this.cacheOrder.filter((k) => k.startsWith(prefix)).length)
    }
  }

  // ── Провайдер инлайн-дополнений ─────────────────────────

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    _token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    if (!this.isInitialized || !this.enabled) return undefined

    // ── Быстрые локальные префиксные дополнения ────────────
    const prefixCompletion = this.fastPrefixCompletion(document, position)
    if (prefixCompletion) {
      return prefixCompletion
    }

    // ── Кэш ────────────────────────────────────────────────
    const cacheKey = this.cacheKey(document, position)
    const cached = this.cache.get(cacheKey)
    if (cached) {
      this.touch(cacheKey)
      return cached
    }

    // ── Дебаунс + запрос к бэкенду ─────────────────────────
    return new Promise<vscode.InlineCompletionItem[] | undefined>((resolve) => {
      this.cancelPending()

      this.debounceTimer = setTimeout(async () => {
        this.debounceTimer = null

        try {
          const items = await this.fetchCompletion(document, position)
          if (items) {
            this.cachePut(cacheKey, items)
          }
          resolve(items)
        } catch (err: unknown) {
          const msg = errorMessage(err)
          log.error(`Автодополнение не выполнено: ${msg}`)
          resolve(undefined)
        }
      }, this.debounceMs)
    })
  }

  // ── Запрос к бэкенду ────────────────────────────────────

  private async fetchCompletion(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    const content = document.getText()
    const cursorOffset = document.offsetAt(position)
    const before = content.slice(0, cursorOffset)
    const after = content.slice(cursorOffset)

    const prompt = this.buildPrompt(before, after, document.languageId)

    const messages = [
      { role: "system" as const, content: this.systemPrompt, timestamp: Date.now() },
      { role: "user" as const, content: prompt, timestamp: Date.now() },
    ]

    this.pendingAbort = new AbortController()

    try {
      const result = await this.backend.chat(messages, () => {})

      if (!result.content || !result.content.trim()) {
        return undefined
      }

      const cleaned = this.cleanCompletion(result.content)

      if (!cleaned) {
        return undefined
      }

      const line = document.lineAt(position.line)

      // ── Вычислить диапазон замены ────────────────────────
      const range = new vscode.Range(
        position,
        new vscode.Position(position.line, line.text.length),
      )

      const item = new vscode.InlineCompletionItem(cleaned, range)
      return [item]
    } catch (err: unknown) {
      const msg = errorMessage(err)
      log.error(`Встроенное автодополнение не выполнено: ${msg}`)
      return undefined
    } finally {
      if (this.pendingAbort) {
        this.pendingAbort.abort()
        this.pendingAbort = null
      }
    }
  }

  // ── Системный промпт ────────────────────────────────────

  private readonly systemPrompt =
    "Ты — ассистент автодополнения кода. По контексту кода до и после курсора сгенерируй продолжение кода.\n" +
    "\n" +
    "Правила:\n" +
    "- Генерируй только код, без объяснений и комментариев\n" +
    "- Не дублируй уже существующий код до курсора\n" +
    "- Продолжай с того места, где остановился пользователь\n" +
    "- Если контекст неясен, верни пустую строку\n" +
    "- Не добавляй маркеры кода"

  // ── Построение промпта ─────────────────────────────────

  private buildPrompt(before: string, after: string, languageId: string): string {
    const lines = before.split("\n")
    const totalLines = lines.length
    const cursorLine = totalLines - 1
    const cursorCol = lines[cursorLine].length

    // ── Взять контекстные строки до и после курсора ────────
    const contextLinesBefore = AUTOCOMPLETE_CONTEXT_BEFORE
    const contextLinesAfter = AUTOCOMPLETE_CONTEXT_AFTER
    const startLine = Math.max(0, cursorLine - contextLinesBefore)
    const endLine = Math.min(totalLines, cursorLine + contextLinesAfter)

    const beforeLines = lines.slice(startLine, totalLines).join("\n")
    const afterLines = after.split("\n").slice(0, contextLinesAfter).join("\n")

    let prompt = `## Язык: ${languageId}\n\n`
    prompt += `## Код до курсора:\n\n${beforeLines}\n`

    if (afterLines.trim()) {
      prompt += `\n## Код после курсора:\n\n${afterLines}\n`
    }

    prompt += `\n## Курсор на строке ${cursorLine - startLine + 1}, символ ${cursorCol}\n\n`
    prompt += `Продолжи код с позиции курсора:`

    // ── Обрезать по лимиту токенов ────────────────────────
    const maxChars = this.maxPromptTokens * 4
    if (prompt.length > maxChars) {
      prompt = prompt.slice(0, maxChars) + "..."
    }

    return prompt
  }

  // ── Быстрые локальные префиксные дополнения ─────────────

  private fastPrefixCompletion(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.InlineCompletionItem[] | undefined {
    const line = document.lineAt(position.line)
    const textBefore = line.text.slice(0, position.character)

    // ── Найти префикс текущего слова ──────────────────────
    const match = textBefore.match(/([\w]+)$/)
    if (!match) return undefined

    const prefix = match[1]
    if (prefix.length < 2) return undefined

    // ── Конфигурация для языка ────────────────────────────
    const config = LANGUAGE_COMPLETIONS[document.languageId]
    if (!config) return undefined

    const allCandidates = [...config.keywords, ...config.builtins]

    const matches = allCandidates
      .filter((c) => c.startsWith(prefix) && c !== prefix)
      .slice(0, 1)

    if (matches.length === 0) return undefined

    const completion = matches[0]

    // ── Диапазон: от начала префикса до конца строки ──────
    const prefixStart = position.character - prefix.length
    const range = new vscode.Range(
      new vscode.Position(position.line, prefixStart),
      new vscode.Position(position.line, line.text.length),
    )

    const item = new vscode.InlineCompletionItem(completion, range)
    return [item]
  }

  // ── Очистка завершения ──────────────────────────────────

  private cleanCompletion(content: string): string {
    return stripCodeFences(content)
  }

  // ── Внутренние утилиты ──────────────────────────────────

  private cacheKey(document: vscode.TextDocument, position: vscode.Position): string {
    return `${document.uri.fsPath}:${position.line}:${position.character}`
  }

  private cancelPending(): void {
    if (this.pendingAbort) {
      this.pendingAbort.abort()
      this.pendingAbort = null
    }
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
  }

  // ── LRU-кэш ─────────────────────────────────────────────

  private touch(key: string): void {
    const idx = this.cacheOrder.indexOf(key)
    if (idx !== -1) {
      this.cacheOrder.splice(idx, 1)
    }
    this.cacheOrder.push(key)
  }

  private cachePut(key: string, value: vscode.InlineCompletionItem[]): void {
    if (this.cache.has(key)) {
      this.touch(key)
      this.cache.set(key, value)
    } else {
      if (this.cache.size >= AUTOCOMPLETE_CACHE_MAX_SIZE) {
        const oldest = this.cacheOrder.shift()
        if (oldest) {
          this.cache.delete(oldest)
        }
      }
      this.cache.set(key, value)
      this.cacheOrder.push(key)
    }
  }
}
