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

const FILE_INDEX_DEFAULT_MAX_FILES = 20000

export interface IndexEntry {
  path: string
  language: string
  size: number
}

/**
 * Интерфейс FileIndex — методы, используемые через AgentDependencies.
 */
export interface IFileIndex {
  stats(): { totalFiles: number; languages: number; totalSize: number }
  findByPattern(pattern: string): IndexEntry[]
  findByLanguage(lang: string): IndexEntry[]
  findByName(name: string): string[]
  build(dir: string, maxFiles?: number, signal?: AbortSignal): Promise<void>
  clear(): void
}

export class FileIndex implements IFileIndex {
  private entries: IndexEntry[] = []
  private nameMap = new Map<string, string[]>()
  private langMap = new Map<string, string[]>()
  private pathToEntry = new Map<string, IndexEntry>()
  private regexCache = new LRUCache<string, RegExp>(50)

  /**
   * Построить индекс для директории. Сканирует только имена
   * файлов и размеры, не читает содержимое.
   */
  async build(dir: string, maxFiles = FILE_INDEX_DEFAULT_MAX_FILES, signal?: AbortSignal): Promise<void> {
    this.entries = []
    this.nameMap.clear()
    this.langMap.clear()
    this.regexCache.clear()

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

      const entry: IndexEntry = { path: f, language: lang, size }
      this.entries.push(entry)
      this.pathToEntry.set(f, entry)

      const name = path.basename(f)
      const names = this.nameMap.get(name) ?? []
      names.push(f)
      this.nameMap.set(name, names)

      const langs = this.langMap.get(lang) ?? []
      langs.push(f)
      this.langMap.set(lang, langs)
    }
  }

  /** Найти файлы по имени (частичное совпадение). */
  findByPattern(pattern: string): IndexEntry[] {
    let re = this.regexCache.get(pattern)
    if (!re) {
      re = new RegExp(pattern, "i")
      this.regexCache.set(pattern, re)
    }
    return this.entries.filter((e) => re.test(e.path))
  }

  /** Найти файлы по языку. */
  findByLanguage(lang: string): IndexEntry[] {
    const paths = this.langMap.get(lang)
    if (!paths) return []
    const result: IndexEntry[] = []
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
