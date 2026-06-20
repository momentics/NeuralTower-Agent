import * as fs from "fs/promises"
import * as path from "path"
import { detectLanguageFull } from "../utils/LanguageDetector"
import { walkDirectory } from "../utils/FileSystem"

/**
 * Анализатор репозитория. Строит карту структуры, определяет
 * языки, выявляет системы сборки и формирует краткую сводку
 * проекта для агента.
 *
 * Позволяет агенту понимать большие репозитории,
 * которые он ранее не встречал.
 */

export interface RepoSummary {
  fileCount: number
  dirCount: number
  languages: Record<string, number>
  buildSystems: string[]
  topDirs: string[]
  notableFiles: string[]
}

export class RepoAnalyzer {
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
    const files = await walkDirectory(dir, { maxFiles: 5000 })
    const languages = this.detectLanguages(files)
    const buildSystems = this.detectBuildSystems(files)
    const topDirs = this.topDirectories(files)
    const notable = this.findNotableFiles(files, dir)

    return {
      fileCount: files.length,
      dirCount: this.countAllDirectories(files),
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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`Не удалось прочитать package.json: ${msg}`)
      return { packages: [], workspaces: false }
    }
  }

  // ── Вспомогательные приватные методы ────────────────────

  private detectLanguages(files: string[]): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const f of files) {
      const lang = detectLanguageFull(f)
      if (lang !== "Unknown") {
        counts[lang] = (counts[lang] ?? 0) + 1
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

  private countAllDirectories(files: string[]): number {
    const dirs = new Set<string>()
    for (const f of files) {
      const parts = f.split(path.sep)
      for (let i = 0; i < parts.length - 1; i++) {
        dirs.add(parts.slice(0, i + 1).join(path.sep))
      }
    }
    return dirs.size
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
