import type { IToolSchema } from "../ITool"
import type { IToolResult } from "../../agent/AgentTypes"
import type { IGitRunner } from "../../services/git/GitRunner"
import { GitOperations } from "../../services/git/GitOperations"
import {
  GIT_OPERATIONS,
  SAFE_GIT_OPERATIONS,
  GIT_READ_TIMEOUT_MS,
} from "../../services/git/GitTypes"
import { BaseTool } from "./BaseTool"
import { strOpt } from "../ToolArgs"

/**
 * Инструмент git: структурированные git-операции для агента.
 * Один инструмент, enum операций — минимизирует расход токенов
 * системного промпта. Read-only операции проходят без запроса
 * (isSafeForArgs), изменяющие и опасные — с подтверждением.
 */
export class GitTool extends BaseTool {
  name = "git"
  description =
    "Git-операции: статус, diff, лог, коммиты, ветки, stash, fetch/push/pull. Используйте этот инструмент, а не bash, для всех git-задач."
  category = "git"
  isSafe = false

  isSafeForArgs = (args: Record<string, unknown>): boolean =>
    SAFE_GIT_OPERATIONS.has(String(args.operation))

  describeCall = (args: Record<string, unknown>): string =>
    this.ops.describeOperation(String(args.operation), args)

  schema: IToolSchema = {
    name: "git",
    description:
      "Git-операции (status, diff, log, show, add, commit, checkout, branch_create, switch, stash, fetch, push, pull, reset, clean)",
    parameters: {
      operation: {
        type: "string",
        description: `Операция: ${GIT_OPERATIONS.join(", ")}`,
        enum: [...GIT_OPERATIONS],
      },
      staged: { type: "boolean", description: "diff: staged-изменения (index)" },
      file: { type: "string", description: "diff: конкретный файл (относительно корня репо)" },
      stat: { type: "boolean", description: "diff/show: включить --stat (default true)" },
      limit: { type: "number", description: "log: число коммитов (default 10, max 100)" },
      ref: { type: "string", description: "show/reset: референс (default HEAD)" },
      remote: { type: "string", description: "fetch/push/pull/branch_list: имя remote" },
      files: {
        type: "array",
        items: { type: "string" },
        description: "add/checkout: файлы (пусто в add = всё)",
      },
      from: { type: "string", description: "checkout файлов: референс-источник (default HEAD)" },
      message: { type: "string", description: "commit/stash_push: сообщение" },
      all: { type: "boolean", description: "commit: сначала добавить все изменения" },
      branch: {
        type: "string",
        description: "checkout/switch/branch_create/push/pull: имя ветки",
      },
      name: { type: "string", description: "branch_create: имя новой ветки" },
      checkout: { type: "boolean", description: "branch_create: переключиться на новую ветку" },
      index: { type: "number", description: "stash_pop: индекс stash-записи (default 0)" },
      force: { type: "boolean", description: "push: force (default false, перезаписывает remote)" },
      rebase: { type: "boolean", description: "pull: rebase вместо merge (default false)" },
      mode: {
        type: "string",
        description: "reset: soft|mixed|hard (default soft)",
        enum: ["soft", "mixed", "hard"],
      },
      dryRun: { type: "boolean", description: "clean: только показать, что будет удалено (default true)" },
      dirs: { type: "boolean", description: "clean: включать неотслеживаемые директории (default false)" },
    },
    required: ["operation"],
  }

  private readonly ops: GitOperations
  /** Кэш корня репозитория: undefined — ещё не определяли, null — не репозиторий. */
  private rootCache: string | null | undefined = undefined

  constructor(
    private readonly workspaceRoot: string,
    private readonly runner: IGitRunner,
  ) {
    super()
    this.ops = new GitOperations(runner, () => this.resolveRoot())
  }

  /**
   * Определить корень git-репозитория и закэшировать результат.
   * null — рабочая область не является git-репозиторием.
   */
  private async resolveRoot(): Promise<string | null> {
    if (this.rootCache !== undefined) return this.rootCache
    try {
      const r = await this.runner.run(["rev-parse", "--show-toplevel"], {
        workTree: this.workspaceRoot,
        timeout: GIT_READ_TIMEOUT_MS,
      })
      this.rootCache = r.code === 0 ? r.stdout.trim() : null
    } catch {
      this.rootCache = null
    }
    return this.rootCache
  }

  protected async doExecute(args: Record<string, unknown>): Promise<IToolResult> {
    const operation = strOpt(args, "operation")
    if (!operation) {
      return { output: "Не указана операция", success: false }
    }
    const result = await this.ops.execute(operation, args)
    return { output: result.output, success: result.success }
  }
}
