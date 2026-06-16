import type { ContextProvider, ContextItem } from "./providers/context/types"
import type { GitService } from "../services/git/GitService"
import type { RepoAnalyzer } from "../repo/RepoAnalyzer"
import type { FileIndex } from "../repo/FileIndex"
import type { AgentMemory } from "../agent/AgentMemory"

/**
 * Провайдер контекста: информация об окружении.
 */
export function makeEnvironmentProvider(
  workDir: () => string,
  model: () => Promise<string>,
  gitService?: GitService | null,
): ContextProvider {
  return {
    description: {
      name: "environment",
      displayTitle: "Environment",
      description: "Информация об окружении",
      type: "normal",
      priority: 100,
    },
    async resolve(_query: string): Promise<ContextItem[]> {
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
      return [{
        content: `<env>
  Модель: ${cfgModel}
  Рабочая директория: ${dir}
  Платформа: ${process.platform}
  Дата: ${new Date().toISOString()}
  Ветка: ${branch}
</env>`,
        name: "Environment",
        description: `${cfgModel} on ${branch}`,
      }]
    },
  }
}

/**
 * Провайдер контекста: анализ репозитория.
 */
export function makeRepoProvider(
  workDir: () => string,
  analyzer: RepoAnalyzer,
  ttlMs = 5_000,
): ContextProvider {
  let cached: Awaited<ReturnType<RepoAnalyzer["analyze"]>> | undefined
  let cachedAt = 0
  let prevContent = ""

  return {
    description: {
      name: "repository",
      displayTitle: "Repository",
      description: "Анализ репозитория",
      type: "normal",
      priority: 90,
    },
    async resolve(_query: string): Promise<ContextItem[]> {
      const now = Date.now()
      if (cached && now - cachedAt < ttlMs) {
        return formatRepoItems(cached)
      }
      cached = await analyzer.analyze(workDir())
      cachedAt = now
      return formatRepoItems(cached)
    },
    changed(_prev: string, curr: string): string {
      if (prevContent && curr !== prevContent) {
        prevContent = curr
        return "Репозиторий изменён"
      }
      prevContent = curr
      return ""
    },
  }
}

function formatRepoItems(
  v: Awaited<ReturnType<RepoAnalyzer["analyze"]>>,
): ContextItem[] {
  const langs = Object.entries(v.languages)
    .filter(([, count]) => count > 3)
    .map(([lang]) => lang)
    .join(", ")
  const parts: string[] = []
  parts.push(`Файлов: ${v.fileCount}, Директорий: ${v.dirCount}`)
  if (langs) parts.push(`Языки: ${langs}`)
  if (v.buildSystems.length) parts.push(`Системы сборки: ${v.buildSystems.join(", ")}`)
  if (v.notableFiles.length) parts.push(`Важные файлы: ${v.notableFiles.join(", ")}`)
  return [{
    content: `## Репозиторий\n${parts.join("\n")}`,
    name: "Repository",
    description: `${v.fileCount} files, ${v.dirCount} dirs`,
  }]
}

/**
 * Провайдер контекста: индекс файлов.
 */
export function makeFileIndexProvider(
  index: FileIndex,
): ContextProvider {
  return {
    description: {
      name: "fileindex",
      displayTitle: "File Index",
      description: "Индекс файлов проекта",
      type: "normal",
      priority: 80,
    },
    async resolve(_query: string): Promise<ContextItem[]> {
      const v = index.stats()
      return [{
        content: `## Индекс файлов\nВсего: ${v.totalFiles} файлов, ${v.languages} языков, ${(v.totalSize / 1024).toFixed(1)} КБ`,
        name: "File Index",
        description: `${v.totalFiles} files`,
      }]
    },
  }
}

/**
 * Провайдер контекста: память проекта.
 */
export function makeProjectMemoryProvider(
  memory: AgentMemory,
): ContextProvider {
  return {
    description: {
      name: "projectmemory",
      displayTitle: "Project Memory",
      description: "Контекст проекта из памяти",
      type: "normal",
      priority: 85,
    },
    async resolve(_query: string): Promise<ContextItem[]> {
      const v = memory.getProject()
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
      if (parts.length === 0) return []
      return [{
        content: `## Контекст проекта\n${parts.join("\n")}`,
        name: "Project Memory",
        description: `${v.notes.length} notes`,
      }]
    },
  }
}

/**
 * Провайдер контекста: git-различия.
 */
export function makeGitDiffProvider(
  workDir: () => string,
  gitService: GitService,
): ContextProvider {
  return {
    description: {
      name: "gitdiff",
      displayTitle: "Git Diff",
      description: "Текущие git-различия",
      type: "normal",
      priority: 70,
    },
    async resolve(_query: string): Promise<ContextItem[]> {
      const dir = workDir()
      const diff = await gitService.getDiff(dir).catch(() => null)
      if (!diff || diff.changed.length === 0) return []
      return [{
        content: `## Git-различия\n  Файлов: ${diff.changed.length}, +${diff.additions} -${diff.deletions}\n${diff.changed
          .map((f: string) => `  ${f}`)
          .join("\n")}`,
        name: "Git Diff",
        description: `${diff.changed.length} changed files`,
      }]
    },
  }
}
