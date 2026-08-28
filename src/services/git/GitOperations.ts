import * as path from "path"
import type { IGitRunner, IGitRunResult, IGitRunOptions } from "./GitRunner"
import { GitUnavailableError, makeNonInteractiveEnv } from "./GitRunner"
import type { IGitOpResult, GitOperationClass, GitOperation } from "./GitTypes"
import {
  GIT_OPERATIONS,
  SAFE_GIT_OPERATIONS,
  DANGEROUS_GIT_OPERATIONS,
  NETWORK_GIT_OPERATIONS,
  GIT_READ_TIMEOUT_MS,
  GIT_WRITE_TIMEOUT_MS,
  GIT_NETWORK_TIMEOUT_MS,
  GIT_DIFF_MAX_OUTPUT_CHARS,
  GIT_MAX_OUTPUT_CHARS,
  GIT_LOG_LIMIT_MAX,
  GIT_MESSAGE_MAX_LENGTH,
  GIT_NAME_MAX_LENGTH,
} from "./GitTypes"
import { isInsideWorkspace } from "../../utils/WorkspaceGuard"
import { createDomainLogger } from "../../core/Logger"
import { errorMessage } from "../../core/Errors"

const log = createDomainLogger("GitOps")

// ── Извлечение аргументов (локальные хелперы, без внешних зависимостей) ──

function argStr(args: Record<string, unknown>, key: string): string {
  const v = args[key]
  return typeof v === "string" ? v : v === null || v === undefined ? "" : String(v)
}

function argStrOpt(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key]
  if (typeof v === "string") return v
  if (v === null || v === undefined) return undefined
  return String(v)
}

function argNum(args: Record<string, unknown>, key: string, def: number): number {
  const v = args[key]
  return typeof v === "number" && isFinite(v) ? v : def
}

function argBool(args: Record<string, unknown>, key: string, def: boolean): boolean {
  const v = args[key]
  return typeof v === "boolean" ? v : def
}

function argArr(args: Record<string, unknown>, key: string): string[] {
  const v = args[key]
  return Array.isArray(v) ? v.map(String) : []
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

// ── Форматирование вывода ─────────────────────────────────

/** Обрезать текст с маркером (защита контекстного окна LLM). */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n…обрезано`
}

/** Строка ветки из `status --porcelain --branch`: «main», «main...origin/main [ahead 1, behind 0]». */
function formatBranchLine(line: string): string {
  if (line.startsWith("HEAD (no branch)")) return "(отключённый HEAD)"
  const idx = line.indexOf("...")
  if (idx === -1) return line
  const name = line.slice(0, idx)
  const tracking = line.slice(idx + 3).match(/\[([^\]]+)\]$/)
  return tracking ? `${name} (${tracking[1]})` : name
}

/** Полный вывод status: строка ветки + XY-статусы. */
function formatStatus(stdout: string): string {
  const changes: string[] = []
  let branch: string | null = null
  for (const line of stdout.split(/\r?\n/)) {
    if (!line) continue
    if (line.startsWith("## ")) {
      branch = formatBranchLine(line.slice(3))
      continue
    }
    changes.push(`  ${line}`)
  }
  const out: string[] = []
  if (branch) out.push(`Ветка: ${branch}`)
  if (changes.length > 0) {
    out.push("Изменения:")
    out.push(...changes)
  } else if (branch) {
    out.push("Нет изменений")
  }
  return out.length > 0 ? out.join("\n") : "Нет изменений"
}

/**
 * Git-операции: пороси-семантика поверх GitRunner — валидация аргументов,
 * формирование команд, форматирование вывода, типовые ошибки.
 *
 * Без импортов vscode (MCP-ready): зависимости — GitRunner, path,
 * WorkspaceGuard, константы.
 */
export class GitOperations {
  /** Символы, запрещённые в именах веток/refs/remote (защита от инъекций). */
  private static readonly NAME_FORBIDDEN = /[;|&`$]|\r|\n|\.\./

  constructor(
    private readonly runner: IGitRunner,
    private readonly getRepoRoot: () => Promise<string | null>,
  ) {}

  /** Класс операции (safe/ask/dangerous). */
  classify(operation: string): GitOperationClass {
    if (SAFE_GIT_OPERATIONS.has(operation)) return "safe"
    if (DANGEROUS_GIT_OPERATIONS.has(operation)) return "dangerous"
    return "ask"
  }

  /** Человекочитаемое описание операции для запроса разрешения. */
  describeOperation(operation: string, args: Record<string, unknown>): string {
    switch (operation) {
      case "status":
        return "Статус репозитория"
      case "diff": {
        const staged = argBool(args, "staged", false)
        const file = argStrOpt(args, "file")
        return `Различия (${staged ? "staged" : "рабочее дерево"}${file ? `: ${file}` : ""})`
      }
      case "log":
        return `История коммитов (последние ${clamp(Math.round(argNum(args, "limit", 10)), 1, GIT_LOG_LIMIT_MAX)})`
      case "show":
        return `Коммит ${argStrOpt(args, "ref") ?? "HEAD"}`
      case "branch_list":
        return argBool(args, "remote", false) ? "Список веток (включая remote)" : "Список веток"
      case "remote_list":
        return "Список remote"
      case "stash_list":
        return "Список stash-записей"
      case "add": {
        const files = argArr(args, "files")
        return files.length > 0 ? `Добавить в index: ${files.join(", ")}` : "Добавить все изменения в index"
      }
      case "commit": {
        const first = argStr(args, "message").trim().split("\n")[0] ?? ""
        return `Коммит: ${first.slice(0, 100)}`
      }
      case "checkout": {
        const branch = argStrOpt(args, "branch")?.trim()
        if (branch) return `Переключиться на ветку: ${branch}`
        const from = argStrOpt(args, "from") ?? "HEAD"
        return `Восстановить файлы из ${from}: ${argArr(args, "files").join(", ")}`
      }
      case "branch_create": {
        const name = argStr(args, "name").trim()
        return argBool(args, "checkout", false)
          ? `Создать ветку ${name} и переключиться`
          : `Создать ветку: ${name}`
      }
      case "switch":
        return `Переключиться на ветку: ${argStr(args, "branch").trim()}`
      case "stash_push": {
        const msg = argStrOpt(args, "message")?.trim()
        return msg ? `Сохранить изменения в stash: ${msg}` : "Сохранить изменения в stash"
      }
      case "stash_pop":
        return `Применить и удалить stash-запись ${argNum(args, "index", 0)}`
      case "fetch": {
        const remote = argStrOpt(args, "remote")?.trim()
        return remote ? `Обновить remote: ${remote}` : "Обновить все remote"
      }
      case "push": {
        const remote = argStrOpt(args, "remote")?.trim() ?? "origin"
        const branch = argStrOpt(args, "branch")?.trim() ?? "текущая"
        return argBool(args, "force", false)
          ? `Force push в ${remote}/${branch} (перезапишет историю remote)`
          : `Push в ${remote}/${branch}`
      }
      case "pull": {
        const remote = argStrOpt(args, "remote")?.trim() ?? "origin"
        const branch = argStrOpt(args, "branch")?.trim() ?? "текущая"
        return argBool(args, "rebase", false)
          ? `Pull (rebase) из ${remote}/${branch}`
          : `Pull из ${remote}/${branch} (merge, возможны конфликты)`
      }
      case "reset": {
        const mode = argStr(args, "mode") || "soft"
        const ref = argStrOpt(args, "ref")?.trim() ?? "HEAD"
        return mode === "hard"
          ? `Hard reset к ${ref} (безвозвратно отменит незакоммиченные изменения)`
          : `Reset (${mode}) к ${ref}`
      }
      case "clean":
        return argBool(args, "dryRun", true)
          ? "Показать неотслеживаемые файлы (без удаления)"
          : `Удаление неотслеживаемых файлов${argBool(args, "dirs", false) ? " и директорий" : ""}`
      default:
        return `Git-операция: ${operation}`
    }
  }

  /** Выполнить операцию по имени и аргументам. Не бросает исключений. */
  async execute(operation: string, args: Record<string, unknown>): Promise<IGitOpResult> {
    const start = Date.now()
    if (!(GIT_OPERATIONS as readonly string[]).includes(operation)) {
      return this.fail(`Неизвестная операция: ${operation}. Доступно: ${GIT_OPERATIONS.join(", ")}`)
    }
    const op = operation as GitOperation

    let root: string | null
    try {
      root = await this.getRepoRoot()
    } catch {
      root = null
    }
    if (!root) return this.fail("Не git-репозиторий")

    let result: IGitOpResult
    try {
      result = await this.dispatch(op, root, args)
    } catch (err: unknown) {
      if (err instanceof GitUnavailableError) {
        result = this.fail("git не найден в PATH")
      } else if (err instanceof Error && /таймаут/i.test(err.message)) {
        const ms = err.message.match(/(\d+)\s*мс/)
        const hint = NETWORK_GIT_OPERATIONS.has(op) ? " Проверьте доступность remote." : ""
        result = this.fail(
          `Операция git не завершилась за ${ms ? `${ms[1]} мс` : "отведённое время"}.${hint}`,
        )
      } else {
        result = this.fail(`Ошибка git: ${errorMessage(err)}`)
      }
    }
    log.info(`${op} → ${result.success ? "успех" : "ошибка"} за ${Date.now() - start} мс`)
    return result
  }

  // ── Диспетчер ───────────────────────────────────────────

  private async dispatch(op: GitOperation, root: string, args: Record<string, unknown>): Promise<IGitOpResult> {
    switch (op) {
      case "status":
        return this.status(root)
      case "diff":
        return this.diff(root, args)
      case "log":
        return this.log(root, args)
      case "show":
        return this.show(root, args)
      case "branch_list":
        return this.branchList(root, args)
      case "remote_list":
        return this.remoteList(root)
      case "stash_list":
        return this.stashList(root)
      case "add":
        return this.add(root, args)
      case "commit":
        return this.commit(root, args)
      case "checkout":
        return this.checkout(root, args)
      case "branch_create":
        return this.branchCreate(root, args)
      case "switch":
        return this.switchBranch(root, args)
      case "stash_push":
        return this.stashPush(root, args)
      case "stash_pop":
        return this.stashPop(root, args)
      case "fetch":
        return this.fetch(root, args)
      case "push":
        return this.push(root, args)
      case "pull":
        return this.pull(root, args)
      case "reset":
        return this.reset(root, args)
      case "clean":
        return this.clean(root, args)
    }
  }

  // ── safe-операции ───────────────────────────────────────

  private async status(root: string): Promise<IGitOpResult> {
    // git status не имеет флага --color: цвет управляется color.status
    // и автоматически отключается без TTY
    const r = await this.run(root, ["status", "--porcelain", "--branch"], {
      timeout: GIT_READ_TIMEOUT_MS,
    })
    if (r.code !== 0) return this.gitError("status", r)
    return this.ok(truncate(formatStatus(r.stdout), GIT_MAX_OUTPUT_CHARS))
  }

  private async diff(root: string, args: Record<string, unknown>): Promise<IGitOpResult> {
    const staged = argBool(args, "staged", false)
    const stat = argBool(args, "stat", true)
    const file = argStrOpt(args, "file")
    const base: string[] = ["diff", "--no-color"]
    if (staged) base.push("--cached")
    if (file) {
      const err = this.fileError(root, file, "file")
      if (err) return this.fail(err)
      base.push("--", this.normalizeFile(file))
    }
    let output = ""
    if (stat) {
      const s = await this.run(root, [...base, "--stat"], { timeout: GIT_READ_TIMEOUT_MS })
      if (s.code !== 0) return this.gitError("diff", s)
      output = s.stdout.trim()
    }
    const d = await this.run(root, base, { timeout: GIT_READ_TIMEOUT_MS })
    if (d.code !== 0) return this.gitError("diff", d)
    const patch = d.stdout.trimEnd()
    if (patch) output = output ? `${output}\n\n${patch}` : patch
    if (!output) return this.ok("Нет изменений")
    return this.ok(truncate(output, GIT_DIFF_MAX_OUTPUT_CHARS))
  }

  private async log(root: string, args: Record<string, unknown>): Promise<IGitOpResult> {
    const limit = clamp(Math.round(argNum(args, "limit", 10)), 1, GIT_LOG_LIMIT_MAX)
    const r = await this.run(
      root,
      ["log", "--oneline", "--decorate", "--no-color", "-n", String(limit)],
      { timeout: GIT_READ_TIMEOUT_MS },
    )
    if (r.code !== 0) return this.gitError("log", r)
    const text = r.stdout.trim()
    return this.ok(text ? truncate(text, GIT_MAX_OUTPUT_CHARS) : "Нет коммитов")
  }

  private async show(root: string, args: Record<string, unknown>): Promise<IGitOpResult> {
    const ref = argStrOpt(args, "ref")?.trim() || "HEAD"
    const err = this.nameError(ref, "ref")
    if (err) return this.fail(err)
    if (await this.invalidRef(root, ref)) {
      return this.fail(`Некорректный аргумент ref: "${ref}" не найден в репозитории`)
    }
    const base: string[] = ["show", "--no-color"]
    if (argBool(args, "stat", true)) base.push("--stat")
    base.push(ref)
    const r = await this.run(root, base, { timeout: GIT_READ_TIMEOUT_MS })
    if (r.code !== 0) return this.gitError("show", r)
    return this.ok(truncate(r.stdout.trimEnd(), GIT_DIFF_MAX_OUTPUT_CHARS))
  }

  private async branchList(root: string, args: Record<string, unknown>): Promise<IGitOpResult> {
    const base: string[] = ["branch", "-v", "--no-color"]
    if (argBool(args, "remote", false)) base.push("--remotes")
    const r = await this.run(root, base, { timeout: GIT_READ_TIMEOUT_MS })
    if (r.code !== 0) return this.gitError("branch_list", r)
    const text = r.stdout.trim()
    return this.ok(text ? truncate(text, GIT_MAX_OUTPUT_CHARS) : "Нет веток")
  }

  private async remoteList(root: string): Promise<IGitOpResult> {
    const r = await this.run(root, ["remote", "-v"], { timeout: GIT_READ_TIMEOUT_MS })
    if (r.code !== 0) return this.gitError("remote_list", r)
    const text = r.stdout.trim()
    return this.ok(text ? truncate(text, GIT_MAX_OUTPUT_CHARS) : "Remote не настроены")
  }

  private async stashList(root: string): Promise<IGitOpResult> {
    const r = await this.run(root, ["stash", "list"], { timeout: GIT_READ_TIMEOUT_MS })
    if (r.code !== 0) return this.gitError("stash_list", r)
    const text = r.stdout.trim()
    return this.ok(text ? truncate(text, GIT_MAX_OUTPUT_CHARS) : "Stash пуст")
  }

  // ── ask-операции ────────────────────────────────────────

  private async add(root: string, args: Record<string, unknown>): Promise<IGitOpResult> {
    const files = argArr(args, "files")
    const norm: string[] = []
    for (const f of files) {
      const err = this.fileError(root, f, "files")
      if (err) return this.fail(err)
      norm.push(this.normalizeFile(f))
    }
    const base = norm.length > 0 ? ["add", "--", ...norm] : ["add", "-A"]
    const r = await this.run(root, base, { timeout: GIT_WRITE_TIMEOUT_MS })
    if (r.code !== 0) return this.gitError("add", r)
    return this.ok(
      norm.length > 0 ? `Добавлено в index: ${norm.join(", ")}` : "Все изменения добавлены в index",
    )
  }

  private async commit(root: string, args: Record<string, unknown>): Promise<IGitOpResult> {
    const message = argStr(args, "message").trim()
    if (!message) return this.fail("Некорректный аргумент message: сообщение не может быть пустым")
    if (message.length > GIT_MESSAGE_MAX_LENGTH) {
      return this.fail(`Некорректный аргумент message: длиннее ${GIT_MESSAGE_MAX_LENGTH} символов`)
    }
    if (argBool(args, "all", false)) {
      const a = await this.run(root, ["add", "-A"], { timeout: GIT_WRITE_TIMEOUT_MS })
      if (a.code !== 0) return this.gitError("commit", a)
    }
    const r = await this.run(root, ["commit", "-m", message], { timeout: GIT_WRITE_TIMEOUT_MS })
    if (r.code !== 0) {
      if (/nothing to commit/i.test(r.stdout + r.stderr)) return this.fail("Нет изменений для коммита")
      return this.gitError("commit", r)
    }
    const hash = r.stdout.match(/\[[^\s]+ ([0-9a-fA-F]+)\]/)?.[1]
    return this.ok(hash ? `Коммит создан: ${hash}` : `Коммит создан\n${r.stdout.trim()}`)
  }

  private async checkout(root: string, args: Record<string, unknown>): Promise<IGitOpResult> {
    const branch = argStrOpt(args, "branch")?.trim()
    const files = argArr(args, "files")
    const hasBranch = branch !== undefined && branch !== ""
    if (hasBranch === (files.length > 0)) {
      return this.fail("Некорректный аргумент: укажите ровно одно из branch или files")
    }
    if (hasBranch) {
      const err = this.nameError(branch!, "branch")
      if (err) return this.fail(err)
      if (await this.invalidBranchName(root, branch!)) {
        return this.fail(`Некорректный аргумент branch: "${branch}" не является допустимым именем ветки`)
      }
      const r = await this.run(root, ["checkout", branch!], { timeout: GIT_WRITE_TIMEOUT_MS })
      if (r.code !== 0) return this.gitError("checkout", r)
      return this.ok(`Переключено на ветку: ${branch}`)
    }
    const from = argStrOpt(args, "from")?.trim() || "HEAD"
    const err = this.nameError(from, "from")
    if (err) return this.fail(err)
    if (await this.invalidRef(root, from)) {
      return this.fail(`Некорректный аргумент from: "${from}" не найден в репозитории`)
    }
    const norm: string[] = []
    for (const f of files) {
      const fErr = this.fileError(root, f, "files")
      if (fErr) return this.fail(fErr)
      norm.push(this.normalizeFile(f))
    }
    const r = await this.run(root, ["checkout", from, "--", ...norm], { timeout: GIT_WRITE_TIMEOUT_MS })
    if (r.code !== 0) return this.gitError("checkout", r)
    return this.ok(`Файлы восстановлены из ${from}: ${norm.join(", ")}`)
  }

  private async branchCreate(root: string, args: Record<string, unknown>): Promise<IGitOpResult> {
    const name = argStr(args, "name").trim()
    const err = this.nameError(name, "name")
    if (err) return this.fail(err)
    if (await this.invalidBranchName(root, name)) {
      return this.fail(`Некорректный аргумент name: "${name}" не является допустимым именем ветки`)
    }
    const r = await this.run(root, ["branch", name], { timeout: GIT_WRITE_TIMEOUT_MS })
    if (r.code !== 0) return this.gitError("branch_create", r)
    if (argBool(args, "checkout", false)) {
      const c = await this.run(root, ["checkout", name], { timeout: GIT_WRITE_TIMEOUT_MS })
      if (c.code !== 0) return this.gitError("branch_create", c)
      return this.ok(`Ветка создана и активна: ${name}`)
    }
    return this.ok(`Ветка создана: ${name}`)
  }

  private async switchBranch(root: string, args: Record<string, unknown>): Promise<IGitOpResult> {
    const branch = argStr(args, "branch").trim()
    const err = this.nameError(branch, "branch")
    if (err) return this.fail(err)
    if (await this.invalidBranchName(root, branch)) {
      return this.fail(`Некорректный аргумент branch: "${branch}" не является допустимым именем ветки`)
    }
    const r = await this.run(root, ["switch", branch], { timeout: GIT_WRITE_TIMEOUT_MS })
    if (r.code !== 0) return this.gitError("switch", r)
    return this.ok(`Переключено на ветку: ${branch}`)
  }

  private async stashPush(root: string, args: Record<string, unknown>): Promise<IGitOpResult> {
    const message = argStrOpt(args, "message")?.trim()
    if (message && message.length > GIT_MESSAGE_MAX_LENGTH) {
      return this.fail(`Некорректный аргумент message: длиннее ${GIT_MESSAGE_MAX_LENGTH} символов`)
    }
    const base: string[] = ["stash", "push"]
    if (message) base.push("-m", message)
    const r = await this.run(root, base, { timeout: GIT_WRITE_TIMEOUT_MS })
    if (r.code !== 0) {
      if (/no local changes to save/i.test(r.stdout + r.stderr)) {
        return this.fail("Нет изменений для сохранения в stash")
      }
      return this.gitError("stash_push", r)
    }
    return this.ok(message ? `Изменения сохранены в stash: ${message}` : "Изменения сохранены в stash")
  }

  private async stashPop(root: string, args: Record<string, unknown>): Promise<IGitOpResult> {
    const index = argNum(args, "index", 0)
    if (!Number.isInteger(index) || index < 0) {
      return this.fail("Некорректный аргумент index: целое число >= 0")
    }
    const base: string[] = ["stash", "pop"]
    if (index > 0) base.push(`stash@{${index}}`)
    const r = await this.run(root, base, { timeout: GIT_WRITE_TIMEOUT_MS })
    if (r.code !== 0) {
      if (/no stash entries found|did not find any stash/i.test(r.stdout + r.stderr)) {
        return this.fail("Stash пуст")
      }
      return this.gitError("stash_pop", r)
    }
    return this.ok(`Stash-запись ${index} применена и удалена`)
  }

  // ── dangerous-операции ──────────────────────────────────

  private async fetch(root: string, args: Record<string, unknown>): Promise<IGitOpResult> {
    const remote = argStrOpt(args, "remote")?.trim()
    if (remote) {
      const err = this.nameError(remote, "remote")
      if (err) return this.fail(err)
    }
    const base = remote ? ["fetch", remote] : ["fetch"]
    const r = await this.run(root, base, {
      timeout: GIT_NETWORK_TIMEOUT_MS,
      env: makeNonInteractiveEnv(),
    })
    if (r.code !== 0) return this.gitError("fetch", r)
    const text = (r.stdout + r.stderr).trim()
    return this.ok(text ? truncate(text, GIT_MAX_OUTPUT_CHARS) : "Remote обновлён")
  }

  private async push(root: string, args: Record<string, unknown>): Promise<IGitOpResult> {
    const remote = argStrOpt(args, "remote")?.trim()
    const branch = argStrOpt(args, "branch")?.trim()
    const force = argBool(args, "force", false)
    if (remote) {
      const err = this.nameError(remote, "remote")
      if (err) return this.fail(err)
    }
    if (branch) {
      const err = this.nameError(branch, "branch")
      if (err) return this.fail(err)
      if (await this.invalidBranchName(root, branch)) {
        return this.fail(`Некорректный аргумент branch: "${branch}" не является допустимым именем ветки`)
      }
    }
    const base: string[] = ["push"]
    if (remote) base.push(remote)
    if (branch) base.push(branch)
    if (force) base.push("--force")
    const r = await this.run(root, base, {
      timeout: GIT_NETWORK_TIMEOUT_MS,
      env: makeNonInteractiveEnv(),
    })
    if (r.code !== 0) return this.gitError("push", r)
    return this.ok("Push выполнен")
  }

  private async pull(root: string, args: Record<string, unknown>): Promise<IGitOpResult> {
    const rebase = argBool(args, "rebase", false)
    const remote = argStrOpt(args, "remote")?.trim()
    const branch = argStrOpt(args, "branch")?.trim()
    if (remote) {
      const err = this.nameError(remote, "remote")
      if (err) return this.fail(err)
    }
    if (branch) {
      const err = this.nameError(branch, "branch")
      if (err) return this.fail(err)
      if (await this.invalidBranchName(root, branch)) {
        return this.fail(`Некорректный аргумент branch: "${branch}" не является допустимым именем ветки`)
      }
    }
    const base: string[] = ["pull"]
    if (rebase) base.push("--rebase")
    if (remote) base.push(remote)
    if (branch) base.push(branch)
    const r = await this.run(root, base, {
      timeout: GIT_NETWORK_TIMEOUT_MS,
      env: makeNonInteractiveEnv(),
    })
    if (r.code !== 0) return this.gitError("pull", r)
    const text = (r.stdout + r.stderr).trim()
    return this.ok(text ? truncate(text, GIT_MAX_OUTPUT_CHARS) : "Pull выполнен")
  }

  private async reset(root: string, args: Record<string, unknown>): Promise<IGitOpResult> {
    const mode = argStr(args, "mode") || "soft"
    if (mode !== "soft" && mode !== "mixed" && mode !== "hard") {
      return this.fail("Некорректный аргумент mode: допустимо soft, mixed или hard")
    }
    const ref = argStrOpt(args, "ref")?.trim()
    if (ref) {
      const err = this.nameError(ref, "ref")
      if (err) return this.fail(err)
      if (await this.invalidRef(root, ref)) {
        return this.fail(`Некорректный аргумент ref: "${ref}" не найден в репозитории`)
      }
    }
    const base: string[] = ["reset", `--${mode}`]
    if (ref) base.push(ref)
    const r = await this.run(root, base, { timeout: GIT_WRITE_TIMEOUT_MS })
    if (r.code !== 0) return this.gitError("reset", r)
    return this.ok(`Reset (${mode}) выполнен${ref ? ` к ${ref}` : ""}`)
  }

  private async clean(root: string, args: Record<string, unknown>): Promise<IGitOpResult> {
    const dryRun = argBool(args, "dryRun", true)
    const dirs = argBool(args, "dirs", false)
    const base: string[] = ["clean", dryRun ? "-n" : "-f"]
    if (dirs) base.push("-d")
    const r = await this.run(root, base, { timeout: GIT_WRITE_TIMEOUT_MS })
    if (r.code !== 0) return this.gitError("clean", r)
    const text = r.stdout.trim()
    if (dryRun) {
      return this.ok(text ? `Будут удалены:\n${truncate(text, GIT_MAX_OUTPUT_CHARS)}` : "Неотслеживаемых файлов нет")
    }
    return this.ok(text ? `Удалено:\n${truncate(text, GIT_MAX_OUTPUT_CHARS)}` : "Неотслеживаемых файлов нет")
  }

  // ── Инфраструктура ───────────────────────────────────────

  private run(
    root: string,
    args: string[],
    opts: Pick<IGitRunOptions, "timeout"> & { env?: Record<string, string> },
  ): Promise<IGitRunResult> {
    return this.runner.run(args, { workTree: root, timeout: opts.timeout, env: opts.env })
  }

  /** Базовая валидация имени ветки/ref/remote. */
  private nameError(value: string, label: string): string | null {
    if (!value) return `Некорректный аргумент ${label}: имя не может быть пустым`
    if (value.length > GIT_NAME_MAX_LENGTH) {
      return `Некорректный аргумент ${label}: имя длиннее ${GIT_NAME_MAX_LENGTH} символов`
    }
    if (value.startsWith("-")) {
      return `Некорректный аргумент ${label}: имя не может начинаться с "-"`
    }
    if (GitOperations.NAME_FORBIDDEN.test(value)) {
      return `Некорректный аргумент ${label}: недопустимые символы в имени`
    }
    return null
  }

  /**
   * Проверка имени ветки через git check-ref-format --branch
   * (отклоняет составные имена, недопустимые символы, ".." и т.д.).
   */
  private async invalidBranchName(root: string, name: string): Promise<boolean> {
    try {
      const r = await this.run(root, ["check-ref-format", "--branch", name], { timeout: GIT_READ_TIMEOUT_MS })
      return r.code !== 0
    } catch {
      return true
    }
  }

  /**
   * Проверка ref: резолв в коммит (rev-parse --verify --quiet <ref>^{commit}).
   * Одновременно валидирует формат и существование ref в репозитории.
   */
  private async invalidRef(root: string, ref: string): Promise<boolean> {
    try {
      const r = await this.run(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], {
        timeout: GIT_READ_TIMEOUT_MS,
      })
      return r.code !== 0
    } catch {
      return true
    }
  }

  /** Валидация пути файла: только относительные пути внутри репозитория. */
  private fileError(root: string, value: string, label: string): string | null {
    if (!value) return `Некорректный аргумент ${label}: путь не может быть пустым`
    if (path.isAbsolute(value)) {
      return `Некорректный аргумент ${label}: путь должен быть относительным от корня репозитория`
    }
    const norm = this.normalizeFile(value)
    if (norm.split("/").some((seg) => seg === "..")) {
      return `Некорректный аргумент ${label}: путь не может выходить за пределы репозитория`
    }
    if (!isInsideWorkspace(path.resolve(root, norm), root)) {
      return `Некорректный аргумент ${label}: путь вне репозитория`
    }
    return null
  }

  /** Нормализация пути в прямые слэши. */
  private normalizeFile(value: string): string {
    return value.replace(/\\/g, "/")
  }

  /** Распознать типовую ошибку git и вернуть понятное сообщение. */
  private recognizeError(raw: string): string | null {
    if (/non-fast-forward|fetch first/i.test(raw)) {
      return "Push отклонён: remote содержит новые коммиты. Сначала выполните pull."
    }
    if (/Authentication failed|could not read Username|invalid username or password/i.test(raw)) {
      return "Ошибка аутентификации remote."
    }
    if (/Automatic merge failed|CONFLICT \(content\)/i.test(raw)) {
      const files = [...raw.matchAll(/^CONFLICT \(content\): Merge conflict in (.+)$/gm)].map((m) => m[1])
      const list = files.length > 0 ? `\nКонфликтующие файлы:\n${files.map((f) => `  ${f}`).join("\n")}\n` : ""
      return `Конфликты слияния.${list}Разрешите конфликты и выполните commit.`
    }
    if (/does not have any commits yet/i.test(raw)) return "В репозитории нет коммитов"
    if (/not a git repository/i.test(raw)) return "Не git-репозиторий"
    return null
  }

  /** Не-ноль код git: stderr (обрезанный) + типовое сообщение, если распознано. */
  private gitError(op: string, r: IGitRunResult): IGitOpResult {
    const raw = r.stderr.trim() || r.stdout.trim() || "неизвестная ошибка"
    const typical = this.recognizeError(raw)
    const body = truncate(raw, GIT_MAX_OUTPUT_CHARS)
    return this.fail(typical ? `${typical}\n${body}` : `Ошибка git ${op}: ${body}`)
  }

  private ok(output: string): IGitOpResult {
    return { output, success: true }
  }

  private fail(output: string): IGitOpResult {
    return { output, success: false }
  }
}
