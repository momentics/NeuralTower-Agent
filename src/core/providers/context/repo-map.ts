import * as path from "path"
import type { IndexEntry } from "../../../repo/FileIndex"
import type { ContextProvider, ContextItem } from "./types"
import { RepoSummary } from "../../../repo/RepoAnalyzer"

export interface FileIndexStats {
  totalFiles: number
  languages: number
  totalSize: number
}

export function makeRepoMapProvider(
  getWorkDir: () => string,
  getFileIndex: () => { findByPattern(pattern: string): IndexEntry[]; findByLanguage(lang: string): IndexEntry[]; stats(): FileIndexStats },
  getRepoSummary: () => Promise<RepoSummary>,
): ContextProvider {
  return {
    description: {
      name: "repo-map",
      displayTitle: "Карта репозитория",
      description: "Карта архитектуры репозитория",
      type: "normal",
      priority: 87,
    },
    async resolve(_query: string): Promise<ContextItem[]> {
      const summary = await getRepoSummary()
      const stats = getFileIndex().stats()

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
          const rel = path.relative(getWorkDir(), d) || d
          parts.push(`  ${rel}/`)
        }
        parts.push("")
      }

      if (summary.notableFiles.length > 0) {
        parts.push("Заметные файлы:")
        for (const f of summary.notableFiles) {
          const rel = path.relative(getWorkDir(), f)
          parts.push(`  ${rel}`)
        }
        parts.push("")
      }

      const srcEntries = getFileIndex().findByPattern("src|lib|app|packages|modules|core")
      if (srcEntries.length > 0) {
        parts.push("Источники (ключевые директории):")
        const dirSet = new Set<string>()
        for (const e of srcEntries) {
          const rel = path.relative(getWorkDir(), e.path)
          const dir = rel.split(path.sep).slice(0, 2).join(path.sep)
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
