/**
 * Разбиение кода на фрагменты (чанки). Два подхода:
 *
 * 1. Линейное разбиение — разбивает файл на блоки фиксированного размера
 *    с перекрытием. Универсально, но не учитывает структуру кода.
 * 2. Структурное разбиение (для TypeScript) — использует синтаксический
 *    анализ для выделения классов, функций, методов и типов.
 *
 * Структурное разбиение предпочтительнее, так как фрагменты
 * соответствуют смысловым единицам кода.
 */

import { detectLanguageShort } from "../utils/LanguageDetector"
import type {
  ChunkerConfig,
  CodeChunk,
  ChunkNodeKind,
  ChunkResult,
} from "./ChunkTypes"

const DEFAULT_CHUNK_SIZE = 4096
const DEFAULT_OVERLAP_LINES = 5
const DEFAULT_MAX_FILE_SIZE = 256_000
const DEFAULT_MIN_CHUNK_LINES = 3
const DEFAULT_CONTEXT_LINES = 2
const ESTIMATED_CHARS_PER_LINE = 50

/**
 * Интерфейс чанкера — разбиение файла на фрагменты.
 */
export interface IChunker {
  /**
   * Разбить содержимое файла на фрагменты.
   * @param filePath абсолютный путь к файлу
   * @param content содержимое файла
   * @returns результат разбиения
   */
  chunk(filePath: string, content: string): ChunkResult

  /**
   * Поддерживает ли чанкер указанный язык.
   */
  supportsLanguage(language: string): boolean
}

/**
 * Конфигурация по умолчанию для чанкера.
 */
export function createDefaultChunkerConfig(): ChunkerConfig {
 return {
    maxChunkSize: DEFAULT_CHUNK_SIZE,
    overlapLines: DEFAULT_OVERLAP_LINES,
    maxFileSize: DEFAULT_MAX_FILE_SIZE,
    minChunkLines: DEFAULT_MIN_CHUNK_LINES,
    contextLines: DEFAULT_CONTEXT_LINES,
  }
}

/**
 * Линейный чанкер — разбивает файл на блоки фиксированного размера
 * с перекрытием между соседними блоками.
 *
 * Подходит для всех языков, но не учитывает структуру кода.
 */
export class LineChunker implements IChunker {
  constructor(private readonly config: ChunkerConfig) {}

  chunk(filePath: string, content: string): ChunkResult {
    const lines = content.split("\n")
    const totalLines = lines.length
    const chunks: CodeChunk[] = []
    let chunkIndex = 0

    const chunkSize = this.config.maxChunkSize
    const overlap = this.config.overlapLines
    const ctxLines = this.config.contextLines

    // Оценка строк на чанк (примерно 50 символов в строке)
    const linesPerChunk = Math.max(
      this.config.minChunkLines,
      Math.floor(chunkSize / ESTIMATED_CHARS_PER_LINE)
    )

    let start = 0
    while (start < totalLines) {
      const end = Math.min(start + linesPerChunk, totalLines)
      const chunkLines = lines.slice(start, end)
      const chunkContent = chunkLines.join("\n")

      // Добавить контекст из предыдущих строк
      let contextBefore = ""
      if (start > 0) {
        const ctxStart = Math.max(0, start - ctxLines)
        contextBefore = lines.slice(ctxStart, start).join("\n")
      }

      // Добавить контекст из следующих строк
      let contextAfter = ""
      if (end < totalLines) {
        const ctxEnd = Math.min(end + ctxLines, totalLines)
        contextAfter = lines.slice(end, ctxEnd).join("\n")
      }

      let fullContent = chunkContent
      if (contextBefore) {
        fullContent = "```context\n" + contextBefore + "\n```\n" + chunkContent
      }
      if (contextAfter) {
        fullContent = fullContent + "\n```context\n" + contextAfter + "\n```"
      }

      chunks.push({
        id: filePath + "::" + chunkIndex,
        filePath,
        content: fullContent,
        startLine: start + 1,
        endLine: end,
        nodeKind: "block",
        language: detectLanguageShort(filePath),
        charLength: fullContent.length,
      })

      chunkIndex++
      start = end - overlap
      if (start <= 0) start = end
    }

    return { filePath, chunks, totalLines }
  }

  supportsLanguage(): boolean {
    return true
  }
}

/**
 * Структурный чанкер для TypeScript/JavaScript.
 *
 * Использует ручной синтаксический анализ для выделения:
 * - Классов (вместе с методами)
 * - Функций (top-level)
 * - Методов (внутри классов)
 * - Интерфейсов
 * - Типов
 * - Констант
 *
 * Каждый фрагмент — это целая смысловая единица кода.
 */
export class TypeScriptChunker implements IChunker {
  constructor(private readonly config: ChunkerConfig) {}

  chunk(filePath: string, content: string): ChunkResult {
    const lines = content.split("\n")
    const totalLines = lines.length
    const chunks: CodeChunk[] = []
    let chunkIndex = 0

    // Найти все определения в файле
    const definitions = this.findAllDefinitions(lines)

    for (const def of definitions) {
      // Извлечь JSDoc комментарий (если есть)
      const docComment = this.extractJSDoc(lines, def.startLine)

      // Извлечь подпись (signature) для функций/методов
      const signature = this.extractSignature(lines, def)

      // Получить содержимое с контекстом
      const startIdx = Math.max(0, def.startLine - this.config.contextLines)
      const endIdx = Math.min(totalLines, def.endLine + this.config.contextLines)
      const chunkLines = lines.slice(startIdx, endIdx)
      const chunkContent = chunkLines.join("\n")

      chunks.push({
        id: filePath + "::" + chunkIndex,
        filePath,
        content: chunkContent,
        startLine: def.startLine + 1,
        endLine: def.endLine,
        nodeKind: def.kind,
        symbolName: def.name,
        parentName: def.parentName,
        language: "ts",
        signature,
        docComment,
        charLength: chunkContent.length,
      })

      chunkIndex++
    }

    // Если не найдено определений, использовать линейный чанкер
    if (chunks.length === 0) {
      const lineChunker = new LineChunker(this.config)
      return lineChunker.chunk(filePath, content)
    }

    return { filePath, chunks, totalLines }
  }

  supportsLanguage(language: string): boolean {
    return language === "ts" || language === "js"
  }

  /**
   * Найти все определения в файле.
   * Использует эвристический синтаксический анализ.
   */
  private findAllDefinitions(
    lines: string[]
  ): Array<{
    kind: ChunkNodeKind
    name: string
    parentName?: string
    startLine: number
    endLine: number
  }> {
    const definitions: Array<{
      kind: ChunkNodeKind
      name: string
      parentName?: string
      startLine: number
      endLine: number
    }> = []

    let classDepth = 0
    let currentClassName = ""

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()

      // Классы
      const classMatch = line.match(
        /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/
      )
      if (classMatch) {
        classDepth++
        currentClassName = classMatch[1]

        // Найти конец класса (считая фигурные скобки)
        const endLine = this.findBlockEnd(lines, i)

        definitions.push({
          kind: "class",
          name: currentClassName,
          startLine: i,
          endLine: endLine,
        })

        // Найти методы внутри класса
        this.findMethodsInClass(
          lines,
          i,
          endLine,
          currentClassName,
          definitions
        )

        // Пропустить до конца класса
        i = endLine
        classDepth--
        if (classDepth === 0) currentClassName = ""
        continue
      }

      // Интерфейсы
      const interfaceMatch = line.match(
        /^(?:export\s+)?interface\s+(\w+)/
      )
      if (interfaceMatch) {
        const endLine = this.findBlockEnd(lines, i)
        definitions.push({
          kind: "interface",
          name: interfaceMatch[1],
          startLine: i,
          endLine: endLine,
        })
        i = endLine
        continue
      }

      // Типы
      const typeMatch = line.match(/^(?:export\s+)?type\s+(\w+)/)
      if (typeMatch) {
        let endLine = i
        if (lines[i].includes("{")) {
          endLine = this.findBlockEnd(lines, i)
        }
        definitions.push({
          kind: "type",
          name: typeMatch[1],
          startLine: i,
          endLine: endLine,
        })
        i = endLine
        continue
      }

      // Enum
      const enumMatch = line.match(/^(?:export\s+)?enum\s+(\w+)/)
      if (enumMatch) {
        const endLine = this.findBlockEnd(lines, i)
        definitions.push({
          kind: "enum",
          name: enumMatch[1],
          startLine: i,
          endLine: endLine,
        })
        i = endLine
        continue
      }

      // Топ-уровневые функции
      const funcMatch = line.match(
        /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/
      )
      if (funcMatch && classDepth === 0) {
        const endLine = this.findBlockEnd(lines, i)
        definitions.push({
          kind: "function",
          name: funcMatch[1],
          startLine: i,
          endLine: endLine,
        })
        i = endLine
        continue
      }

      // Arrow functions и константы (top-level)
      const constMatch = line.match(
        /^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?(?:\((([^)]*\)))|[^=])\s*=>/
      )
      if (constMatch && classDepth === 0) {
        let endLine = i
        if (lines[i].includes("{")) {
          endLine = this.findBlockEnd(lines, i)
        }
        definitions.push({
          kind: "const",
          name: constMatch[1],
          startLine: i,
          endLine: endLine,
        })
        i = endLine
        continue
      }
    }

    return definitions
  }

  /**
   * Найти методы внутри класса.
   */
  private findMethodsInClass(
    lines: string[],
    classStart: number,
    classEnd: number,
    className: string,
    definitions: Array<{
      kind: ChunkNodeKind
      name: string
      parentName?: string
      startLine: number
      endLine: number
    }>
  ): void {
    let braceDepth = 0
    let inClassBody = false

    for (let i = classStart; i <= classEnd; i++) {
      const line = lines[i].trim()

      // Считать скобки для определения тела класса
      for (const ch of lines[i]) {
        if (ch === "{") {
          braceDepth++
          if (braceDepth === 1) inClassBody = true
        } else if (ch === "}") {
          braceDepth--
        }
      }

      if (!inClassBody || braceDepth !== 1) continue

      // Методы класса
      const methodMatch = line.match(
        /^(?:public|private|protected|static|async|abstract|override)\s+(\w+)\s*\(/
      )
      if (methodMatch && !line.startsWith("//")) {
        const methodName = methodMatch[1]
        if (
          ["if", "for", "while", "switch", "catch", "return"].includes(
            methodName
          )
        ) {
          continue
        }

        const endLine = this.findBlockEnd(lines, i)
        definitions.push({
          kind: "method",
          name: methodName,
          parentName: className,
          startLine: i,
          endLine: endLine,
        })
        i = endLine
        continue
      }

      // Конструктор
      const ctorMatch = line.match(/^constructor\s*\(/)
      if (ctorMatch) {
        const endLine = this.findBlockEnd(lines, i)
        definitions.push({
          kind: "method",
          name: "constructor",
          parentName: className,
          startLine: i,
          endLine: endLine,
        })
        i = endLine
        continue
      }

      // Свойства класса (с аннотациями)
      const propMatch = line.match(
        /^(?:public|private|protected|readonly|static)\s+(\w+)\s*[:=]/
      )
      if (propMatch && !line.startsWith("//")) {
        definitions.push({
          kind: "const",
          name: propMatch[1],
          parentName: className,
          startLine: i,
          endLine: i,
        })
      }
    }
  }

  /**
   * Найти конец блока кода (считая фигурные скобки).
   * @param lines строки файла
   * @param startLine начальная строка (с открытием скобки)
   * @returns индекс последней строки блока
   */
  private findBlockEnd(lines: string[], startLine: number): number {
    let depth = 0
    let started = false

    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i]

      // Пропустить строки в комментариях
      const trimmed = line.trim()
      if (trimmed.startsWith("//")) continue
      if (trimmed.startsWith("/*") || trimmed.startsWith("*") || trimmed.endsWith("*/")) continue

      for (const ch of line) {
        if (ch === "{") {
          depth++
          started = true
        } else if (ch === "}") {
          depth--
        }
      }

      if (started && depth === 0) return i
    }

    return lines.length - 1
  }

  /**
   * Извлечь JSDoc комментарий перед определением.
   */
  private extractJSDoc(
    lines: string[],
    defStartLine: number
  ): string | undefined {
    let i = defStartLine - 1

    // Пропустить пустые строки перед определением
    while (i >= 0 && lines[i].trim() === "") i--

    if (i < 0) return undefined

    // Проверить, начинается ли с */
    if (!lines[i].trim().endsWith("*/")) return undefined

    const docLines: string[] = []
    while (i >= 0) {
      docLines.unshift(lines[i])
      if (lines[i].trim().startsWith("/**")) break
      i--
    }

    if (docLines.length === 0) return undefined
    return docLines.join("\n")
  }

  /**
   * Извлечь подпись функции/метода.
   */
  private extractSignature(
    lines: string[],
    def: { startLine: number; kind: ChunkNodeKind; name: string }
  ): string | undefined {
    if (def.kind !== "function" && def.kind !== "method") return undefined

    // Собрать строки подписи (может быть многострочной)
    const sigLines: string[] = []
    let i = def.startLine
    let parenDepth = 0
    let started = false

    while (i < lines.length && i < def.startLine + 10) {
      const line = lines[i]
      sigLines.push(line)

      for (const ch of line) {
        if (ch === "(") {
          parenDepth++
          started = true
        } else if (ch === ")") {
          parenDepth--
        }
      }

      if (started && parenDepth === 0) break
      i++
    }

    return sigLines.join(" ").trim()
  }
}


