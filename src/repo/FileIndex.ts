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
  build(dir: string, maxFiles?: number): Promise<void>
  clear(): void
}

export class FileIndex implements IFileIndex {
  private entries: IndexEntry[] = []
  private nameMap = new Map<string, string[]>()
  private langMap = new Map<string, string[]>()

  private readonly langPatterns: Record<string, RegExp> = {
    ts: /\.(ts|tsx|mts|cts)$/,
    js: /\.(js|jsx|mjs|cjs)$/,
    rs: /\.rs$/,
    go: /\.go$/,
    py: /\.py$/,
    java: /\.java$/,
    kt: /\.kt$/,
    rb: /\.rb$/,
    c: /\.(c|h)$/,
    cpp: /\.(cpp|cxx|cc|hpp)$/,
    html: /\.(html|htm)$/,
    css: /\.(css|scss|sass)$/,
    json: /\.json$/,
    toml: /\.toml$/,
    yaml: /\.(yaml|yml)$/,
    md: /\.md$/,
    sh: /\.(sh|bash)$/,
  }

  /**
   * Построить индекс для директории. Сканирует только имена
   * файлов и размеры, не читает содержимое.
   */
  async build(dir: string, maxFiles = 20000): Promise<void> {
    this.entries = []
    this.nameMap.clear()
    this.langMap.clear()

    const files = await this.collectFiles(dir, maxFiles)

    for (const f of files) {
      const lang = this.detectLanguage(f)
      let size = 0
      try {
        const stat = await fs.stat(f)
        size = stat.size
      } catch {
        // пропустить нечитаемые файлы
      }

      const entry: IndexEntry = { path: f, language: lang, size }
      this.entries.push(entry)

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
    const re = new RegExp(pattern, "i")
    return this.entries.filter((e) => re.test(e.path))
  }

  /** Найти файлы по языку. */
  findByLanguage(lang: string): IndexEntry[] {
    return this.entries.filter((e) => e.language === lang)
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
  }

  // ── Приватные методы ────────────────────────────────────

  private async collectFiles(dir: string, max: number): Promise<string[]> {
    const files: string[] = []
    const walk = async (current: string): Promise<void> => {
      if (files.length >= max) return
      const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        if (files.length >= max) return
        const full = path.join(current, entry.name)
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue
        if (entry.isDirectory()) {
          await walk(full)
        } else {
          files.push(full)
        }
      }
    }
    await walk(dir)
    return files
  }

  private detectLanguage(filepath: string): string {
    for (const [lang, re] of Object.entries(this.langPatterns)) {
      if (re.test(filepath)) return lang
    }
    return "unknown"
  }
}
