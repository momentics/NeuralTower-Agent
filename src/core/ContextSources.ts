import * as path from "path"
import type { ContextSource } from "../core/ContextSource"
import type { GitService } from "../services/git/GitService"
import type { RepoAnalyzer } from "../repo/RepoAnalyzer"
import type { FileIndex } from "../repo/FileIndex"
import type { AgentMemory } from "../agent/AgentMemory"

interface EnvData {
  model: string
  workDir: string
  platform: string
  date: string
  branch: string
}

interface GitDiffData {
  diff: Awaited<ReturnType<GitService["getDiff"]>> | null
  status: Awaited<ReturnType<GitService["getStatus"]>> | null
  dir: string
}

/**
 * Создать источник контекста: информация об окружении.
 */
export function makeEnvironmentSource(
  workDir: () => string,
  model: () => Promise<string>,
  gitService?: GitService | null,
): ContextSource<EnvData> {
  return {
    key: "environment",
    priority: 100,
    async load(): Promise<EnvData> {
      const dir = workDir()
      const cfgModel = await model()
      let branch = "unknown"
      if (gitService) {
        try {
          const info = await gitService.getBranchInfo(dir)
          branch = info?.name ?? "unknown"
        } catch {
          // ignore
        }
      }
      return {
        model: cfgModel,
        workDir: dir,
        platform: process.platform,
        date: new Date().toISOString(),
        branch,
      }
    },
    baseline(v: EnvData): string {
      return `<env>
  Модель: ${v.model}
  Рабочая директория: ${v.workDir}
  Платформа: ${v.platform}
  Дата: ${v.date}
  Ветка: ${v.branch}
</env>`
    },
    update(_prev: EnvData, cur: EnvData): string {
      return `Окружение обновлено: ветка ${cur.branch}, модель ${cur.model}`
    },
  }
}

/**
 * Создать источник контекста: анализ репозитория.
 */
export function makeRepoSource(
  workDir: () => string,
  analyzer: RepoAnalyzer,
  ttlMs = 5_000,
): ContextSource<Awaited<ReturnType<RepoAnalyzer["analyze"]>>> {
  let cached: Awaited<ReturnType<RepoAnalyzer["analyze"]>> | undefined
  let cachedAt = 0

  return {
    key: "repository",
    priority: 90,
    async load() {
      const now = Date.now()
      if (cached && now - cachedAt < ttlMs) return cached
      cached = await analyzer.analyze(workDir())
      cachedAt = now
      return cached
    },
    baseline(v) {
      const langs = Object.entries(v.languages)
        .filter(([, count]) => count > 3)
        .map(([lang]) => lang)
        .join(", ")
      const parts: string[] = []
      parts.push(`Файлов: ${v.fileCount}, Директорий: ${v.dirCount}`)
      if (langs) parts.push(`Языки: ${langs}`)
      if (v.buildSystems.length) parts.push(`Системы сборки: ${v.buildSystems.join(", ")}`)
      if (v.notableFiles.length) parts.push(`Важные файлы: ${v.notableFiles.join(", ")}`)
      return `## Репозиторий\n${parts.join("\n")}`
    },
    update(prev, cur) {
      const delta = cur.fileCount - prev.fileCount
      const sign = delta >= 0 ? "+" : ""
      return `Репозиторий изменён: ${sign}${delta} файлов`
    },
  }
}

/**
 * Создать источник контекста: индекс файлов.
 */
export function makeFileIndexSource(
  index: FileIndex,
): ContextSource<Awaited<ReturnType<FileIndex["stats"]>>> {
  return {
    key: "fileindex",
    priority: 80,
    async load() {
      return index.stats()
    },
    baseline(v) {
      return `## Индекс файлов\nВсего: ${v.totalFiles} файлов, ${v.languages} языков, ${(v.totalSize / 1024).toFixed(1)} КБ`
    },
    update(prev, cur) {
      return `Индекс обновлён: ${cur.totalFiles} файлов (было ${prev.totalFiles})`
    },
  }
}

/**
 * Создать источник контекста: память проекта.
 */
export function makeProjectMemorySource(
  memory: AgentMemory,
): ContextSource<Awaited<ReturnType<AgentMemory["getProject"]>>> {
  return {
    key: "projectmemory",
    priority: 85,
    async load() {
      return memory.getProject()
    },
    baseline(v) {
      const parts: string[] = []
      if (v.repo) parts.push(`Проект: ${v.repo}`)
      if (v.languages.length) parts.push(`Языки: ${v.languages.join(", ")}`)
      if (Object.keys(v.commands).length) {
        parts.push(
          `Команды:\n${Object.entries(v.commands)
            .map(([k, cmd]) => `  ${k}: ${cmd}`)
            .join("\n")}`,
        )
      }
      if (v.notes.length) {
        parts.push(
          `Заметки:\n${v.notes.map((n: string) => `  - ${n}`).join("\n")}`,
        )
      }
      return parts.length > 0 ? `## Контекст проекта\n${parts.join("\n")}` : ""
    },
    update(prev, cur) {
      const newNotes = cur.notes.length - prev.notes.length
      if (newNotes > 0) return `Добавлено ${newNotes} заметок о проекте`
      return ""
    },
  }
}

/**
 * Создать источник контекста: git-различия.
 */
export function makeGitDiffSource(
  workDir: () => string,
  gitService: GitService,
): ContextSource<GitDiffData> {
  return {
    key: "gitdiff",
    priority: 70,
    async load(): Promise<GitDiffData> {
      const dir = workDir()
      const [diff, status] = await Promise.all([
        gitService.getDiff(dir).catch(() => null),
        gitService.getStatus(dir).catch(() => null),
      ])
      return { diff, status, dir }
    },
    baseline(v) {
      if (!v.diff || v.diff.changed.length === 0) return ""
      return `## Git-различия\n  Файлов: ${v.diff.changed.length}, +${v.diff.additions} -${v.diff.deletions}\n${v.diff.changed
        .map((f: string) => `  ${f}`)
        .join("\n")}`
    },
    update(prev, cur) {
      if (!cur.diff) return ""
      const changed = cur.diff.changed.length
      const prevChanged = prev.diff?.changed.length ?? 0
      if (changed !== prevChanged) {
        return `Git-различия: ${changed} изменённых файлов (было ${prevChanged})`
      }
      return ""
    },
  }
}
