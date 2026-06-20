import type { ContextProvider, ContextItem } from "./providers/context/types"
import type { IGitService } from "../services/git/GitService"
import type { AgentMemory } from "../agent/AgentMemory"
import { createDomainLogger } from "./logger"

const log = createDomainLogger("ContextSources")

/**
 * Провайдер контекста: информация об окружении.
 */
export function makeEnvironmentProvider(
  workDir: () => string,
  model: () => Promise<string>,
  gitService?: IGitService | null,
): ContextProvider {
  return {
    description: {
      name: "environment",
      displayTitle: "Окружение",
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
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          log.error(`Не удалось получить информацию о ветке: ${msg}`)
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
        name: "Окружение",
        description: `${cfgModel} на ${branch}`,
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
      displayTitle: "Память проекта",
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
        name: "Память проекта",
        description: `${v.notes.length} заметок`,
      }]
    },
  }
}

/**
 * Провайдер контекста: git-различия.
 */
export function makeGitDiffProvider(
  workDir: () => string,
  gitService: IGitService,
): ContextProvider {
  return {
    description: {
      name: "gitdiff",
      displayTitle: "Изменения Git",
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
        name: "Изменения Git",
        description: `${diff.changed.length} изменённых файлов`,
      }]
    },
  }
}
