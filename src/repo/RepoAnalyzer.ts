import * as fs from "fs/promises"
import * as path from "path"

/**
 * Анализатор репозитория. Строит карту структуры, определяет
 * языки, выявляет системы сборки и формирует краткую сводку
 * проекта для агента.
 *
 * Позволяет агенту понимать большие репозитории,
 * которые он ранее не встречал.
 */

export interface RepoSummary {
  /** Общее число файлов. */
  fileCount: number
  /** Число директорий. */
  dirCount: number
  /** Определённые языки с количеством файлов. */
  languages: Record<string, number>
  /** Определённые менеджеры пакетов и средства сборки. */
  buildSystems: string[]
  /** Структура директорий верхнего уровня. */
  topDirs: string[]
  /** Заметные файлы (конфигурация, точки входа, README). */
  notableFiles: string[]
}

export class RepoAnalyzer {
  private readonly languagePatterns: Record<string, RegExp> = {
    TypeScript: /\.(ts|tsx|mts|cts)$/,
    JavaScript: /\.(js|jsx|mjs|cjs)$/,
    Rust: /\.rs$/,
    Go: /\.go$/,
    Python: /\.py$/,
    Java: /\.java$/,
    Kotlin: /\.kt$/,
    Swift: /\.swift$/,
    C: /\.(c|h)$/,
    CPP: /\.(cpp|cxx|cc|hpp|hh)$/,
    HTML: /\.(html|htm)$/,
    CSS: /\.(css|scss|sass|less)$/,
    Markdown: /\.md$/,
    JSON: /\.json$/,
    TOML: /\.toml$/,
    YAML: /\.(yaml|yml)$/,
    Shell: /\.(sh|bash|zsh)$/,
    PowerShell: /\.(ps1|psm1)$/,
  }

  private readonly buildPatterns: Record<string, RegExp> = {
    npm: /package\.json/,
    bun: /bun\.lockb/,
    pnpm: /pnpm-lock\.yaml/,
    yarn: /yarn\.lock/,
    cargo: /Cargo\.toml/,
    maven: /pom\.xml/,
    gradle: /gradle\.wrapper/,
    make: /Makefile/,
    bazel: /BUILD\b|BUILD\.bazel/,
    go: /go\.mod/,
    poetry: /pyproject\.toml/,
    esbuild: /esbuild/,
    turborepo: /turbo\.json/,
  }

  /**
   * Проанализировать директорию. Вернуть сводку по репозиторию.
   * Использует поверхностное сканирование для скорости;
   * содержимое файлов не читается.
   */
  async analyze(dir: string): Promise<RepoSummary> {
    const files = await this.scanDir(dir)
    const languages = this.detectLanguages(files)
    const buildSystems = this.detectBuildSystems(files)
    const topDirs = this.topDirectories(files)
    const notable = this.findNotableFiles(files, dir)

    return {
      fileCount: files.length,
      dirCount: new Set(files.map((f) => f.split(path.sep)[0])).size,
      languages,
      buildSystems,
      topDirs,
      notableFiles: notable,
    }
  }

  /**
   * Глубокое сканирование: читает манифесты пакетов для понимания
   * структуры проекта. Полезно для монорепозиториев: определяет
   * корни рабочих областей и границы пакетов.
   */
  async deepScan(dir: string): Promise<{ packages: string[]; workspaces: boolean }> {
    const pkgPath = path.join(dir, "package.json")
    try {
      const content = await fs.readFile(pkgPath, "utf-8")
      const pkg = JSON.parse(content) as { workspaces?: string[] }
      return {
        packages: pkg.workspaces ?? [],
        workspaces: !!pkg.workspaces,
      }
    } catch {
      return { packages: [], workspaces: false }
    }
  }

  // ── Вспомогательные приватные методы ────────────────────

  private async scanDir(dir: string, maxFiles = 5000): Promise<string[]> {
    const files: string[] = []

    const list = async (current: string): Promise<void> => {
      if (files.length >= maxFiles) return
      const entries = await fs.readdir(current, { withFileTypes: true })
      for (const entry of entries) {
        if (files.length >= maxFiles) return
        const full = path.join(current, entry.name)
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue
        if (entry.isDirectory()) {
          await list(full)
        } else {
          files.push(full)
        }
      }
    }

    await list(dir)
    return files
  }

  private detectLanguages(files: string[]): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const f of files) {
      for (const [lang, re] of Object.entries(this.languagePatterns)) {
        if (re.test(f)) {
          counts[lang] = (counts[lang] ?? 0) + 1
          break
        }
      }
    }
    return counts
  }

  private detectBuildSystems(files: string[]): string[] {
    const found: string[] = []
    const basenameSet = new Set(files.map((f) => path.basename(f)))
    for (const [name, re] of Object.entries(this.buildPatterns)) {
      for (const b of basenameSet) {
        if (re.test(b)) {
          found.push(name)
          break
        }
      }
    }
    return found
  }

  private topDirectories(files: string[]): string[] {
    const dirs = new Set<string>()
    for (const f of files) {
      const parts = f.split(path.sep)
      if (parts.length > 1) dirs.add(parts[0])
    }
    return [...dirs]
  }

  private findNotableFiles(files: string[], root: string): string[] {
    const notablePatterns = [
      /README/i,
      /LICENSE/i,
      /CHANGELOG/i,
      /package\.json/i,
      /tsconfig\.json/i,
      /Cargo\.toml/i,
      /go\.mod/i,
      /pyproject\.toml/i,
      /Makefile/i,
      /\.gitignore/i,
    ]
    return files.filter((f) => notablePatterns.some((re) => re.test(path.basename(f))))
  }
}
