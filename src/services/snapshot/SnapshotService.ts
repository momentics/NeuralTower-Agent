import * as fs from "fs/promises"
import * as path from "path"
import type { IService } from "../../shared/Types"
import { Mutex } from "../../shared/Mutex"
import { createDomainLogger } from "../../core/Logger"
import { errorMessage } from "../../core/Errors"
import { isInsideWorkspace } from "../../utils/WorkspaceGuard"
import type { IGitRunner, IGitRunOptions, IGitRunResult } from "../git/GitRunner"
import { toPosix, pathKey } from "./PathUtils"
import { removeFileWithRetry } from "./FileOps"
import {
  SNAPSHOT_GIT_TIMEOUT_MS,
  SNAPSHOT_REVERT_TIMEOUT_MS,
  SNAPSHOT_GC_TIMEOUT_MS,
  SNAPSHOT_MAX_BUFFER,
  SNAPSHOT_REVERT_BATCH_SIZE,
  SNAPSHOT_STAT_CONCURRENCY,
  SnapshotError,
  type ISnapshotConfig,
  type ISnapshotPatch,
  type ISnapshotRecord,
  type IRevertResult,
  type ISnapshotService,
} from "./SnapshotTypes"

const log = createDomainLogger("Snapshot")

/** Разобрать NUL-разделённый вывод git. */
function splitNul(s: string): string[] {
  return s.split("\0").filter(Boolean)
}

/** Разобрать построчный вывод git. */
function splitLines(s: string): string[] {
  return s
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
}

/** Литеральные pathspec (защита от pathspec-magic в именах файлов). */
function literalPathspecs(files: string[]): string {
  return files.map((f) => `:(top,literal)${f}`).join("\0") + "\0"
}

interface IRevertOp {
  /** Абсолютный путь файла. */
  file: string
  /** Путь относительно корня workspace (прямые слэши). */
  rel: string
}

/**
 * Сервис чекпоинтов рабочей директории.
 *
 * Все операции выполняются в скрытом зеркальном git-репозитории
 * (отдельный --git-dir в глобальном хранилище); главный .git проекта
 * не читается (кроме check-ignore/info-exclude в режиме только-чтение)
 * и не пишется.
 *
 * Все публичные методы сериализованы единым Mutex. Ошибки track/patch
 * никогда не прерывают цикл агента: возвращаются null/пустой патч.
 */
export class SnapshotService implements IService, ISnapshotService {
  name = "snapshot"

  private readonly mutex = new Mutex()
  private mirrorReady = false
  private rootStaged = false
  private enabledState: boolean | null = null
  private disabledReasonLogged = false
  private cleanupDone = false
  private disposed = false

  private repoRoot: string | null = null
  private sourceGitDir: string | null = null
  private sourceExcludeText = ""
  private readonly blockedPaths = new Set<string>()

  constructor(
    /** Корень рабочей области (work-tree зеркала). */
    private readonly workTree: string,
    /** Директория зеркального git-репозитория. */
    private readonly gitDir: string,
    private readonly git: IGitRunner,
    private readonly config: ISnapshotConfig,
    /** Определение корня git-репозитория workspace (кэшируется вызывающим). */
    private readonly findRoot: () => Promise<string | null>,
  ) {}

  // ── Доступность ─────────────────────────────────────────

  isEnabled(): boolean {
    return this.enabledState === true
  }

  /**
   * Проверить доступность снапшотов и закэшировать результат на сессию:
   * включено в конфиге + git в PATH + workspace является git-репозиторием.
   */
  private async ensureEnabled(): Promise<boolean> {
    if (this.enabledState !== null) return this.enabledState
    if (!this.config.enabled) {
      this.disable("отключено в конфигурации")
      return false
    }
    if (!(await this.git.isAvailable())) {
      this.disable("git не найден в PATH")
      return false
    }
    let root: string | null = null
    try {
      root = await this.findRoot()
    } catch {
      root = null
    }
    if (!root) {
      this.disable("workspace не является git-репозиторием")
      return false
    }
    this.repoRoot = root
    this.sourceGitDir = await this.resolveSourceGitDir(root)
    this.sourceExcludeText = await this.readSourceExclude(this.sourceGitDir)
    this.enabledState = true
    return true
  }

  private disable(reason: string): void {
    this.enabledState = false
    if (!this.disabledReasonLogged) {
      this.disabledReasonLogged = true
      log.info(`Снапшоты отключены: ${reason}`)
    }
  }

  /**
   * Разрешить git-директорию исходного репозитория.
   * Поддерживает связанный worktree, где .git — файл-указатель.
   */
  private async resolveSourceGitDir(repoRoot: string): Promise<string | null> {
    const gitPath = path.join(repoRoot, ".git")
    try {
      const stat = await fs.stat(gitPath)
      if (stat.isDirectory()) return gitPath
      const content = (await fs.readFile(gitPath, "utf-8")).trim()
      const match = content.match(/^gitdir:\s*(.+)$/m)
      if (match) {
        const dir = match[1].trim()
        return path.isAbsolute(dir) ? dir : path.resolve(repoRoot, dir)
      }
    } catch {
      // .git отсутствует
    }
    return null
  }

  private async readSourceExclude(gitDir: string | null): Promise<string> {
    if (!gitDir) return ""
    try {
      return (await fs.readFile(path.join(gitDir, "info", "exclude"), "utf-8")).trimEnd()
    } catch {
      return ""
    }
  }

  // ── Инициализация зеркала ───────────────────────────────

  /**
   * Ленивая инициализация зеркального git-репозитория:
   * init + конфиг (без EOL-конверсии — критично на Windows) + exclude.
   */
  private async initMirror(): Promise<void> {
    await fs.mkdir(this.gitDir, { recursive: true })

    const init = await this.git.run(["init", "-q"], {
      workTree: this.workTree,
      timeout: SNAPSHOT_GIT_TIMEOUT_MS,
      env: { GIT_DIR: this.gitDir, GIT_WORK_TREE: this.workTree },
    })
    if (init.code !== 0) {
      throw new SnapshotError(`Не удалось инициализировать зеркало: ${init.stderr.trim()}`)
    }

    const settings: Array<[string, string]> = [
      // Без конверсии EOL — иначе restore исказит CRLF/LF на Windows
      ["core.autocrlf", "false"],
      ["core.longpaths", "true"],
      ["core.symlinks", "true"],
      ["core.fsmonitor", "false"],
      // Читаемые пути в выводе git
      ["core.quotepath", "false"],
      // Кэш неотслеживаемых файлов: ускорение ls-files в больших репозиториях
      ["core.untrackedCache", "true"],
      // Детерминированная обработка регистра (по умолчанию git решает сам по платформе)
      ["core.ignorecase", process.platform === "linux" ? "false" : "true"],
      // Идентичность для коммитов зеркального репозитория (нужно с Фазы 1)
      ["user.name", "NeuralTower Agent"],
      ["user.email", "agent@neuraltower.local"],
      ["commit.gpgsign", "false"],
    ]
    for (const [key, value] of settings) {
      const res = await this.git.run(["config", key, value], this.gitOpts())
      if (res.code !== 0) {
        throw new SnapshotError(`Не удалось настроить зеркало: ${res.stderr.trim()}`)
      }
    }

    await this.syncExclude()
    log.info(`Зеркальный репозиторий снапшотов инициализирован: ${this.gitDir}`)
  }

  /**
   * Синхронизировать info/exclude зеркала: паттерны исходного репозитория
   * + /.git (никогда не индексировать сам .git) + заблокированные
   * файлы (превышающие лимит размера).
   */
  private async syncExclude(): Promise<void> {
    const infoDir = path.join(this.gitDir, "info")
    await fs.mkdir(infoDir, { recursive: true })
    const lines = [
      this.sourceExcludeText,
      "/.git",
      ...[...this.blockedPaths].map((p) => `/${p}`),
    ].filter(Boolean)
    const text = lines.length > 0 ? lines.join("\n") + "\n" : ""
    await fs.writeFile(path.join(infoDir, "exclude"), text, "utf-8")
  }

  // ── Сбор кандидатов и стейджинг ─────────────────────────

  /**
   * Собрать изменённые/новые файлы и обновить индекс зеркала.
   * Первый успешный стейджинг покрывает всё рабочее дерево;
   * последующие — только кандидатов (быстро в больших репозиториях).
   */
  private async addCandidates(): Promise<void> {
    const [diffRes, otherRes] = await Promise.all([
      this.git.run(["diff-files", "--name-only", "-z", "--", "."], this.gitOpts()),
      this.git.run(
        ["ls-files", "--full-name", "--others", "--exclude-standard", "-z", "--", "."],
        this.gitOpts(),
      ),
    ])
    if (diffRes.code !== 0 || otherRes.code !== 0) {
      log.warn(`Не удалось перечислить изменённые файлы: ${diffRes.stderr || otherRes.stderr}`)
      return
    }

    const tracked = splitNul(diffRes.stdout).map(toPosix)
    const untracked = splitNul(otherRes.stdout).map(toPosix)
    const all = [...new Set([...tracked, ...untracked])]
    if (all.length === 0) return

    // Игнорируемые файлы: паттерны исходного репозитория, без учёта индекса
    const ignored = await this.checkIgnored(all)
    if (ignored.size > 0) {
      // Файлы, ставшие игнорируемыми, удаляются из индекса зеркала
      await this.dropFromIndex([...ignored])
    }

    const allow = all.filter((f) => !ignored.has(f))
    if (allow.length === 0) return

    // Лимит размера: большие неотслеживаемые файлы не индексируем
    const large = await this.findLargeFiles(allow)
    const untrackedSet = new Set(untracked)
    const block = allow.filter((f) => large.has(f) && untrackedSet.has(f))
    if (block.length > 0) {
      for (const f of block) this.blockedPaths.add(f)
      await this.syncExclude()
    }

    const blockedSet = new Set(block)
    const stage = allow.filter((f) => !blockedSet.has(f))
    if (stage.length === 0) return
    await this.stageFiles(stage)
  }

  /**
   * Проверить, какие файлы игнорируются исходным репозиторием.
   * Кандидаты (относительные к workspace) транслируются в пути,
   * относительные к корню репозитория.
   */
  private async checkIgnored(files: string[]): Promise<Set<string>> {
    if (files.length === 0 || !this.sourceGitDir || !this.repoRoot) {
      return new Set<string>()
    }

    const byRel = new Map<string, string>()
    const relToRoot: string[] = []
    for (const file of files) {
      const rel = toPosix(path.relative(this.repoRoot, path.join(this.workTree, file)))
      if (rel.startsWith("..")) continue
      relToRoot.push(rel)
      byRel.set(pathKey(rel), file)
    }
    if (relToRoot.length === 0) return new Set<string>()

    // Префикс ./ защищает имена, начинающиеся с ":" (pathspec-magic)
    const stdin = relToRoot.map((r) => (r.startsWith(":") ? `./${r}` : r)).join("\0") + "\0"
    const res = await this.git.run(
      ["check-ignore", "--no-index", "--stdin", "-z"],
      {
        gitDir: this.sourceGitDir,
        workTree: this.repoRoot,
        timeout: SNAPSHOT_GIT_TIMEOUT_MS,
        maxBuffer: SNAPSHOT_MAX_BUFFER,
        stdin,
      },
    )
    // Код 1 означает «ничего не игнорировалось»
    if (res.code !== 0 && res.code !== 1) return new Set<string>()

    const ignored = new Set<string>()
    for (const raw of splitNul(res.stdout)) {
      const rel = raw.startsWith("./:") ? raw.slice(2) : raw
      const file = byRel.get(pathKey(rel))
      if (file) ignored.add(file)
    }
    return ignored
  }

  /** Удалить файлы из индекса зеркала (содержимое на диске не трогается). */
  private async dropFromIndex(files: string[]): Promise<void> {
    if (files.length === 0) return
    const res = await this.git.run(
      ["rm", "--cached", "-f", "--ignore-unmatch", "--pathspec-from-file=-", "--pathspec-file-nul"],
      { ...this.gitOpts(), stdin: literalPathspecs(files) },
    )
    if (res.code !== 0) {
      log.warn(`Не удалось удалить игнорируемые файлы из индекса: ${res.stderr}`)
    }
  }

  /** Найти файлы, превышающие лимит размера (параллельно, concurrency 8). */
  private async findLargeFiles(files: string[]): Promise<Set<string>> {
    const large = new Set<string>()
    let next = 0
    const workers = Array.from(
      { length: Math.min(SNAPSHOT_STAT_CONCURRENCY, files.length) },
      async () => {
        while (next < files.length) {
          const file = files[next++]
          try {
            const stat = await fs.stat(path.join(this.workTree, file))
            if (stat.isFile() && stat.size > this.config.maxFileSizeBytes) {
              large.add(file)
            }
          } catch {
            // Файл исчез между перечислением и проверкой
          }
        }
      },
    )
    await Promise.all(workers)
    return large
  }

  /**
   * Стейджинг кандидатов в индекс зеркала.
   * Корневой (первый) снимок — один pathspec на всё дерево,
   * чтобы избежать квадратичного сопоставления в больших репозиториях.
   */
  private async stageFiles(files: string[]): Promise<void> {
    let res: IGitRunResult
    if (!this.rootStaged) {
      res = await this.git.run(["add", "--all", "--sparse", "--", "."], this.gitOpts())
    } else {
      res = await this.git.run(
        ["add", "--all", "--sparse", "--pathspec-from-file=-", "--pathspec-file-nul"],
        { ...this.gitOpts(), stdin: literalPathspecs(files) },
      )
    }
    if (res.code === 0) {
      this.rootStaged = true
    } else {
      log.warn(`Не удалось застейджировать файлы снапшота: ${res.stderr}`)
    }
  }

  // ── Публичные операции ──────────────────────────────────

  async track(): Promise<string | null> {
    if (this.disposed) return null
    if (!(await this.ensureEnabled())) return null
    try {
      return await this.mutex.withLock(async () => {
        if (!this.mirrorReady) {
          await this.initMirror()
          this.mirrorReady = true
        }
        await this.addCandidates()
        const res = await this.git.run(["write-tree"], this.gitOpts())
        const hash = res.stdout.trim()
        if (res.code !== 0 || !hash) {
          log.warn(`Не удалось вычислить снимок: ${res.stderr}`)
          return null
        }
        log.info(`Снимок состояния: ${hash.slice(0, 12)}`)
        return hash
      })
    } catch (err: unknown) {
      if (!this.mirrorReady) {
        // Сбой инициализации зеркала — повторных попыток в сессии нет
        this.disable(`не удалось инициализировать зеркало: ${errorMessage(err)}`)
        log.error(`Не удалось инициализировать зеркальный репозиторий: ${errorMessage(err)}`)
      } else {
        log.warn(`Сбой снимка состояния: ${errorMessage(err)}`)
      }
      return null
    }
  }

  async patch(hash: string): Promise<ISnapshotPatch> {
    if (this.disposed) return { hash, files: [] }
    if (!(await this.ensureEnabled())) return { hash, files: [] }
    try {
      return await this.mutex.withLock(async () => {
        if (!this.mirrorReady) return { hash, files: [] }
        await this.addCandidates()
        const res = await this.git.run(
          ["diff", "--cached", "--no-ext-diff", "--no-renames", "--name-only", hash, "--", "."],
          this.gitOpts(),
        )
        if (res.code !== 0) {
          log.warn(`Не удалось вычислить diff против снимка: ${res.stderr}`)
          return { hash, files: [] }
        }
        const files = splitLines(res.stdout).map(toPosix)
        const ignored = await this.checkIgnored(files)
        const changed = files
          .filter((f) => !ignored.has(f))
          .map((f) => toPosix(path.join(this.workTree, f)))
        return { hash, files: changed }
      })
    } catch (err: unknown) {
      log.warn(`Не удалось вычислить изменения: ${errorMessage(err)}`)
      return { hash, files: [] }
    }
  }

  async revert(record: ISnapshotRecord): Promise<IRevertResult> {
    if (this.disposed || !(await this.ensureEnabled())) {
      return {
        ok: false,
        restored: [],
        deleted: [],
        failed: [{ file: "*", error: "Снапшоты недоступны" }],
      }
    }
    try {
      return await this.mutex.withLock(async () => {
        if (!this.mirrorReady) {
          return {
            ok: false,
            restored: [],
            deleted: [],
            failed: [{ file: "*", error: "Снимок не создан" }],
          }
        }
        const result: IRevertResult = { ok: true, restored: [], deleted: [], failed: [] }

        // Валидация ДО изменений: дерево снимка должно существовать
        const check = await this.git.run(
          ["cat-file", "-e", `${record.hash}^{tree}`],
          this.gitOpts(SNAPSHOT_REVERT_TIMEOUT_MS),
        )
        if (check.code !== 0) {
          return {
            ok: false,
            restored: [],
            deleted: [],
            failed: [
              {
                file: "*",
                error: `Чекпоинт ${record.hash.slice(0, 7)} недоступен (возможно, очищен)`,
              },
            ],
          }
        }

        // Уникальные операции с валидацией вложенности в workspace
        const ops: IRevertOp[] = []
        const seen = new Set<string>()
        for (const file of record.files) {
          if (seen.has(pathKey(file))) continue
          seen.add(pathKey(file))
          const rel = toPosix(path.relative(this.workTree, file))
          if (
            !rel ||
            rel.startsWith("..") ||
            path.isAbsolute(rel) ||
            !isInsideWorkspace(path.join(this.workTree, rel), this.workTree)
          ) {
            result.failed.push({ file, error: "Путь вне рабочей области" })
            continue
          }
          ops.push({ file, rel })
        }

        // Батчи до 100 соседних файлов с непересекающимися путями
        let i = 0
        while (i < ops.length) {
          const batch: IRevertOp[] = [ops[i]]
          let j = i + 1
          while (
            j < ops.length &&
            batch.length < SNAPSHOT_REVERT_BATCH_SIZE &&
            !this.pathsClash(batch.map((o) => o.rel), ops[j].rel)
          ) {
            batch.push(ops[j])
            j++
          }
          if (batch.length === 1) {
            await this.revertSingle(batch[0], record.hash, result)
          } else {
            await this.revertBatch(batch, record.hash, result)
          }
          i = j
        }

        // Честный отчёт: успех только без единого провала
        result.ok = result.failed.length === 0
        log.info(
          `Откат: ${result.restored.length} восстановлено, ${result.deleted.length} удалено, ${result.failed.length} ошибок`,
        )
        return result
      })
    } catch (err: unknown) {
      log.error(`Сбой отката: ${errorMessage(err)}`)
      return {
        ok: false,
        restored: [],
        deleted: [],
        failed: [{ file: "*", error: errorMessage(err) }],
      }
    }
  }

  async restore(hash: string): Promise<void> {
    if (this.disposed) throw new SnapshotError("Сервис снапшотов закрыт")
    if (!(await this.ensureEnabled())) throw new SnapshotError("Снапшоты недоступны")
    await this.mutex.withLock(async () => {
      if (!this.mirrorReady) throw new SnapshotError("Снимок не создан")
      const check = await this.git.run(
        ["cat-file", "-e", `${hash}^{tree}`],
        this.gitOpts(SNAPSHOT_REVERT_TIMEOUT_MS),
      )
      if (check.code !== 0) {
        throw new SnapshotError(`Чекпоинт ${hash.slice(0, 7)} недоступен`)
      }
      const readTree = await this.git.run(["read-tree", hash], this.gitOpts(SNAPSHOT_REVERT_TIMEOUT_MS))
      if (readTree.code !== 0) {
        throw new SnapshotError(`Не удалось восстановить снимок: ${readTree.stderr.trim()}`)
      }
      const checkout = await this.git.run(
        ["checkout-index", "-a", "-f"],
        this.gitOpts(SNAPSHOT_REVERT_TIMEOUT_MS),
      )
      if (checkout.code !== 0) {
        throw new SnapshotError(`Не удалось восстановить снимок: ${checkout.stderr.trim()}`)
      }
      log.info(`Рабочее дерево полностью восстановлено к снимку: ${hash.slice(0, 12)}`)
    })
  }

  async cleanup(): Promise<void> {
    if (this.disposed || this.cleanupDone) return
    if (!(await this.ensureEnabled())) return
    try {
      await this.mutex.withLock(async () => {
        if (!this.mirrorReady) return
        const res = await this.git.run(
          ["gc", `--prune=${this.config.retentionDays}.days`],
          this.gitOpts(SNAPSHOT_GC_TIMEOUT_MS),
        )
        if (res.code !== 0) {
          log.warn(`Не удалось очистить снапшоты: ${res.stderr}`)
        } else {
          log.info(`Очистка снапшотов завершена (prune=${this.config.retentionDays}.days)`)
        }
      })
      this.cleanupDone = true
    } catch (err: unknown) {
      log.warn(`Не удалось очистить снапшоты: ${errorMessage(err)}`)
    }
  }

  dispose(): void {
    this.disposed = true
  }

  // ── Приватные помощники отката ──────────────────────────

  /** Пересекаются ли пути (один вложен в другой). */
  private pathsClash(paths: string[], candidate: string): boolean {
    return paths.some(
      (p) =>
        pathKey(p) === pathKey(candidate) ||
        pathKey(p).startsWith(pathKey(candidate) + "/") ||
        pathKey(candidate).startsWith(pathKey(p) + "/"),
    )
  }

  /** Откат одного файла: checkout или удаление (файла не было в снимке). */
  private async revertSingle(op: IRevertOp, hash: string, result: IRevertResult): Promise<void> {
    const opts = this.gitOpts(SNAPSHOT_REVERT_TIMEOUT_MS)
    const res = await this.git.run(["checkout", hash, "--", op.rel], opts)
    if (res.code === 0) {
      result.restored.push(op.file)
      return
    }
    const tree = await this.git.run(["ls-tree", hash, "--", op.rel], opts)
    if (tree.code !== 0) {
      result.failed.push({ file: op.file, error: `Чекпоинт недоступен: ${tree.stderr.trim()}` })
      return
    }
    if (tree.stdout.trim()) {
      // Файл есть в снимке, но git не смог его восстановить
      result.failed.push({
        file: op.file,
        error: `Не удалось восстановить файл: ${res.stderr.trim() || "ошибка git checkout"}`,
      })
      return
    }
    await this.deleteFile(op, result)
  }

  /**
   * Откат батча: единый ls-tree определяет, какие файлы были в снимке;
   * единый checkout восстанавливает их; отсутствующие удаляются.
   * При сбое батча — пофайловый фолбэк.
   */
  private async revertBatch(batch: IRevertOp[], hash: string, result: IRevertResult): Promise<void> {
    const opts = this.gitOpts(SNAPSHOT_REVERT_TIMEOUT_MS)
    const tree = await this.git.run(
      ["ls-tree", "--name-only", hash, "--", ...batch.map((o) => o.rel)],
      opts,
    )
    if (tree.code !== 0) {
      for (const op of batch) await this.revertSingle(op, hash, result)
      return
    }

    const have = new Set(splitLines(tree.stdout))
    const present = batch.filter((o) => have.has(o.rel))
    if (present.length > 0) {
      const res = await this.git.run(
        ["checkout", hash, "--", ...present.map((o) => o.rel)],
        opts,
      )
      if (res.code !== 0) {
        for (const op of batch) await this.revertSingle(op, hash, result)
        return
      }
      result.restored.push(...present.map((o) => o.file))
    }

    for (const op of batch) {
      if (have.has(op.rel)) continue
      await this.deleteFile(op, result)
    }
  }

  /** Удалить файл, которого не было в снимке. */
  private async deleteFile(op: IRevertOp, result: IRevertResult): Promise<void> {
    try {
      await removeFileWithRetry(op.file)
      result.deleted.push(op.file)
    } catch (err: unknown) {
      result.failed.push({ file: op.file, error: `Не удалось удалить файл: ${errorMessage(err)}` })
    }
  }

  private gitOpts(timeout: number = SNAPSHOT_GIT_TIMEOUT_MS): IGitRunOptions {
    return {
      gitDir: this.gitDir,
      workTree: this.workTree,
      timeout,
      maxBuffer: SNAPSHOT_MAX_BUFFER,
    }
  }
}
