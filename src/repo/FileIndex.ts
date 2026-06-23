/**
 * Файловый индекс для быстрого поиска в больших репозиториях.
 * Предоставляет:
 * - Отображение имени файла на путь
 * - Отображение языка на список файлов
 * - Поиск содержимого (на базе grep, не в памяти)
 *
 * Рассчитан на репозитории с 10 тыс. и более файлов,
 * когда загрузка всего содержимого в контекст невозможна.
 */

import * as fs from "fs/promises"
import * as path from "path"
import { detectLanguageShort } from "../utils/LanguageDetector"
import { walkDirectory } from "../utils/FileSystem"
import { errorMessage } from "../core/Errors"
import { createDomainLogger } from "../core/Logger"
import { LRUCache } from "../shared/LRUCache"

const log = createDomainLogger("FileIndex")

import { INDEX_DEFAULT_MAX_FILES } from "../core/Config"

export interface IIndexEntry {
  path: string
  language: string
  size: number
}

/**
 * Интерфейс FileIndex — методы, используемые через IAgentDependencies.
 */
export interface IFileIndex {
  stats(): { totalFiles: number; languages: number; totalSize: number }
  findByPattern(pattern: string): IIndexEntry[]
  findByLanguage(lang: string): IIndexEntry[]
  findByName(name: string): string[]
  build(dir: string, maxFiles?: number, signal?: AbortSignal): Promise<void>
  clear(): void
}

export class FileIndex implements IFileIndex {
  private entries: IIndexEntry[] = []
  private nameMap = new Map<string, string[]>()
  private langMap = new Map<string, string[]>()
  private pathToEntry = new Map<string, IIndexEntry>()
  private regexCache = new LRUCache<string, RegExp>(50)
  private prefixIndex = new Map<string, IIndexEntry[]>()

  /**
   * Построить индекс для директории. Сканирует только имена
   * файлов и размеры, не читает содержимое.
   */
  async build(dir: string, maxFiles = INDEX_DEFAULT_MAX_FILES, signal?: AbortSignal): Promise<void> {
    this.entries = []
    this.nameMap.clear()
    this.langMap.clear()
    this.regexCache.clear()
    this.prefixIndex.clear()

    const files = await walkDirectory(dir, { maxFiles, signal })

    for (const f of files) {
      const lang = detectLanguageShort(f)
      let size = 0
      try {
        const stat = await fs.stat(f)
        size = stat.size
      } catch (err: unknown) {
        const msg = errorMessage(err)
        log.error(`Не удалось получить размер файла ${f}: ${msg}`)
      }

      const entry: IIndexEntry = { path: f, language: lang, size }
      this.entries.push(entry)
      this.pathToEntry.set(f, entry)

      const name = path.basename(f)
      const names = this.nameMap.get(name) ?? []
      names.push(f)
      this.nameMap.set(name, names)

      const langs = this.langMap.get(lang) ?? []
      langs.push(f)
      this.langMap.set(lang, langs)

      // Построение префиксного индекса для быстрого поиска по префиксу пути
      const lower = f.toLowerCase()
      for (let i = 1; i <= lower.length; i++) {
        const prefix = lower.slice(0, i)
        const bucket = this.prefixIndex.get(prefix) ?? []
        bucket.push(entry)
        this.prefixIndex.set(prefix, bucket)
      }
    }
  }

  /** Найти файлы по имени (частичное совпадение). */
  findByPattern(pattern: string): IIndexEntry[] {
    // Быстрый путь: если паттерн не содержит спецсимволов regex, используем префиксный индекс
    const lowerPattern = pattern.toLowerCase()
    if (!this.hasRegexSpecialChars(lowerPattern)) {
      const prefixMatches = this.prefixIndex.get(lowerPattern)
      if (prefixMatches) {
        return prefixMatches
      }
      // Попробовать найти по префиксу паттерна
      for (let i = lowerPattern.length; i > 0; i--) {
        const prefix = lowerPattern.slice(0, i)
        const candidates = this.prefixIndex.get(prefix)
        if (candidates) {
          return candidates.filter((e) => e.path.toLowerCase().includes(lowerPattern))
        }
      }
    }

    let re = this.regexCache.get(pattern)
    if (!re) {
      re = new RegExp(pattern, "i")
      this.regexCache.set(pattern, re)
    }
    return this.entries.filter((e) => re.test(e.path))
  }

  /** Проверить, содержит ли строка спецсимволы regex. */
  private hasRegexSpecialChars(s: string): boolean {
    return /[.*+?^${}()|[\]\\]/.test(s)
  }

  /** Найти файлы по языку. */
  findByLanguage(lang: string): IIndexEntry[] {
    const paths = this.langMap.get(lang)
    if (!paths) return []
    const result: IIndexEntry[] = []
    for (const p of paths) {
      const entry = this.pathToEntry.get(p)
      if (entry) result.push(entry)
    }
    return result
  }

  /** Найти файлы по точному имени файла. */
  findByName(name: string): string[] {
    return this.nameMap.get(name) ?? []
  }

  /** Вернуть статистику. */
  stats(): { totalFiles: number; languages: number; totalSize: number } {
    return {
      totalFiles: this.entries.length,
      languages: this.langMap.size,
      totalSize: this.entries.reduce((s, e) => s + e.size, 0),
    }
  }

  /** Очистить индекс. */
  clear(): void {
    this.entries = []
    this.nameMap.clear()
    this.langMap.clear()
    this.pathToEntry.clear()
    this.regexCache.clear()
  }

}
