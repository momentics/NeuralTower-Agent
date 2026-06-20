import type { ContextProvider, ContextItem } from "./providers/context/types"
import type { GitService } from "../services/git/GitService"
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
