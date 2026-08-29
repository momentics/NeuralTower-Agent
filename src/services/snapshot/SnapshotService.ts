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
  SNAPSHOT_DIFF_MAX_CHARS,
  SNAPSHOT_STAT_CONCURRENCY,
  SNAPSHOT_COMMIT_REF,
  SnapshotError,
  type ISnapshotConfig,
  type ISnapshotPatch,
  type ISnapshotRecord,
  type IRevertResult,
  type IRevertOptions,
  type ISnapshotService,
  type IFileDiff,
  type IRequestDiff,
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

/**
 * Бюджет длины аргументов-путей в одной git-команде.
 * Командная строка Windows ограничена ~32k символов; 8k — безопасный запас
 * с учётом --git-dir/--work-tree и остальных аргументов.
 */
const PATHSPEC_ARG_BUDGET = 8_000

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
 * Через `objects/info/alternates` зеркало использует объекты репозитория
 * пользователя (разогрев, `snapshots.seed`). Заимствованные объекты живут
 * в репозитории пользователя: если пользователь удалит репозиторий, часть
 * старых снимков может стать недоступной — это допустимое ограничение.
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
  /** Хэш последнего зафиксированного коммитом дерева (оптимизация commitTree). */
  private lastTreeHash: string | null = null

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
    await this.seedMirror()
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

  /**
   * Разогреть зеркало объектами репозитория пользователя:
   * alternates на его objects + копия индекса (stat-кэш).
   * Best-effort: сбой не отключает снапшоты.
   */
  private async seedMirror(): Promise<void> {
    if (!this.config.seed || !this.sourceGitDir) return
    try {
      // Объекты лежат в общем каталоге: для связанного worktree
      // это .git основного репозитория (файл commondir)
      const commonDir = await this.resolveCommonDir(this.sourceGitDir)
      const objectsDir = path.join(commonDir, "objects")
      let objectsExist = true
      try {
        await fs.access(objectsDir)
      } catch {
        objectsExist = false
      }
      if (!objectsExist) {
        log.warn("Разогрев зеркала пропущен: нет каталога objects в репозитории пользователя")
        return
      }
      const altPath = path.join(this.gitDir, "objects", "info", "alternates")
      await fs.mkdir(path.dirname(altPath), { recursive: true })
      await fs.writeFile(altPath, toPosix(objectsDir) + "\n", "utf-8")
      // Копия индекса пользователя: stat-кэш позволит git не пере-хэшировать
      // неизменённые файлы при первом add.
      // Только когда workspace — корень репозитория: пути индекса
      // относительны корню, а work-tree зеркала — это workspace.
      if (this.repoRoot && pathKey(this.workTree) === pathKey(this.repoRoot)) {
        try {
          await fs.copyFile(path.join(this.sourceGitDir, "index"), path.join(this.gitDir, "index"))
          const refresh = await this.git.run(["update-index", "--really-refresh"], this.gitOpts())
          if (refresh.code !== 0) {
            log.warn(`Не удалось обновить stat-кэш после разогрева: ${refresh.stderr}`)
          }
        } catch {
          // Индекса в репозитории пользователя нет (коммитов не было) — не критично
        }
      }
      log.info("Зеркальный репозиторий разогрет объектами репозитория пользователя")
    } catch (err: unknown) {
      log.warn(`Не удалось разогреть зеркальный репозиторий: ${errorMessage(err)}`)
    }
  }

  /**
   * Общий git-каталог: для связанного worktree — .git основного
   * репозитория (файл `commondir`), для обычного — сам каталог.
   */
  private async resolveCommonDir(gitDir: string): Promise<string> {
    try {
      const content = (await fs.readFile(path.join(gitDir, "commondir"), "utf-8")).trim()
      if (content) {
        return path.isAbsolute(content) ? content : path.resolve(gitDir, content)
      }
    } catch {
      // Нет commondir — обычный репозиторий
    }
    return gitDir
  }

  // ── Сбор кандидатов и стейджинг ─────────────────────────

  /**
   * Собрать изменённые/новые файлы и обновить индекс зеркала.
   * Возвращает список застейдированных файлов (пустой массив,
   * если кандидатов не было). Первый успешный стейджинг покрывает
   * всё рабочее дерево; последующие — только кандидатов
   * (быстро в больших репозиториях).
   */
  private async collectAndStage(): Promise<string[]> {
    const [diffRes, otherRes] = await Promise.all([
      this.git.run(["diff-files", "--name-only", "-z", "--", "."], this.gitOpts()),
      this.git.run(
        ["ls-files", "--full-name", "--others", "--exclude-standard", "-z", "--", "."],
        this.gitOpts(),
      ),
    ])
    if (diffRes.code !== 0 || otherRes.code !== 0) {
      log.warn(`Не удалось перечислить изменённые файлы: ${diffRes.stderr || otherRes.stderr}`)
      return []
    }

    const tracked = splitNul(diffRes.stdout).map(toPosix)
    const untracked = splitNul(otherRes.stdout).map(toPosix)
    const all = [...new Set([...tracked, ...untracked])]
    if (all.length === 0) return []

    // Игнорируемые файлы: паттерны исходного репозитория, без учёта индекса
    const ignored = await this.checkIgnored(all)
    if (ignored.size > 0) {
      // Файлы, ставшие игнорируемыми, удаляются из индекса зеркала
      await this.dropFromIndex([...ignored])
    }

    const allow = all.filter((f) => !ignored.has(f))
    if (allow.length === 0) return []

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
    if (stage.length === 0) return []
    await this.stageFiles(stage)
    return stage
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
        await this.collectAndStage()
        const res = await this.git.run(["write-tree"], this.gitOpts())
        const hash = res.stdout.trim()
        if (res.code !== 0 || !hash) {
          log.warn(`Не удалось вычислить снимок: ${res.stderr}`)
          return null
        }
        await this.commitTree(hash)
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

  /**
   * Зафиксировать дерево коммитом на refs/nt/snapshots.
   * Дерево становится достижимым — git gc не удалит его.
   * Ошибка не роняет track: хэш валиден и так.
   */
  private async commitTree(treeHash: string): Promise<void> {
    try {
      if (this.lastTreeHash === treeHash) return // дерево не изменилось — коммит не нужен
      this.lastTreeHash = treeHash
      const parentRes = await this.git.run(
        ["rev-parse", "-q", "--verify", `${SNAPSHOT_COMMIT_REF}^{commit}`],
        this.gitOpts(),
      )
      const args = ["commit-tree", treeHash]
      if (parentRes.code === 0 && parentRes.stdout.trim()) {
        args.push("-p", parentRes.stdout.trim())
      }
      args.push("-m", `snapshot ${new Date().toISOString()}`)
      const commitRes = await this.git.run(args, this.gitOpts())
      if (commitRes.code !== 0 || !commitRes.stdout.trim()) {
        log.warn(`Не удалось закоммитить снимок: ${commitRes.stderr.trim()}`)
        return
      }
      const refRes = await this.git.run(
        ["update-ref", SNAPSHOT_COMMIT_REF, commitRes.stdout.trim()],
        this.gitOpts(),
      )
      if (refRes.code !== 0) {
        log.warn(`Не удалось обновить ref снимков: ${refRes.stderr.trim()}`)
      }
    } catch (err: unknown) {
      log.warn(`Не удалось зафиксировать снимок: ${errorMessage(err)}`)
    }
  }

  async patch(hash: string): Promise<ISnapshotPatch> {
    if (this.disposed) return { hash, endHash: hash, files: [] }
    if (!(await this.ensureEnabled())) return { hash, endHash: hash, files: [] }
    try {
      return await this.mutex.withLock(async () => {
        if (!this.mirrorReady) return { hash, endHash: hash, files: [] }
        const staged = await this.collectAndStage()
        if (staged.length === 0) {
          // Быстрый путь: с момента снимка ничего не изменилось — дерево то же самое,
          // write-tree не нужен.
          return { hash, endHash: hash, files: [] }
        }
        const res = await this.git.run(["write-tree"], this.gitOpts())
        const endHash = res.stdout.trim()
        if (res.code !== 0 || !endHash) {
          log.warn(`Не удалось вычислить итоговое дерево: ${res.stderr}`)
          return { hash, endHash: hash, files: [] }
        }
        await this.commitTree(endHash)
        const diffRes = await this.git.run(
          ["diff", "--cached", "--no-ext-diff", "--no-renames", "--name-only", hash, "--", "."],
          this.gitOpts(),
        )
        if (diffRes.code !== 0) {
          log.warn(`Не удалось вычислить diff против снимка: ${diffRes.stderr}`)
          return { hash, endHash, files: [] }
        }
        const files = splitLines(diffRes.stdout).map(toPosix)
        const ignored = await this.checkIgnored(files)
        const changed = files
          .filter((f) => !ignored.has(f))
          .map((f) => toPosix(path.join(this.workTree, f)))
        return { hash, endHash, files: changed }
      })
    } catch (err: unknown) {
      log.warn(`Не удалось вычислить изменения: ${errorMessage(err)}`)
      return { hash, endHash: hash, files: [] }
    }
  }

  /**
   * Предпросмотр изменений запроса: пофайловый diff между деревьями
   * «до» и «после», статусы и пометки пользовательских правок.
   * Рабочее дерево не изменяется. null — снимки недоступны.
   */
  async requestDiff(record: ISnapshotRecord): Promise<IRequestDiff | null> {
    if (this.disposed) return null
    if (!(await this.ensureEnabled())) return null
    try {
      return await this.mutex.withLock(async () => {
        if (!this.mirrorReady) return null
        // Оба дерева снимка должны существовать
        for (const h of [record.hash, record.endHash]) {
          const check = await this.git.run(["cat-file", "-e", `${h}^{tree}`], this.gitOpts())
          if (check.code !== 0) return null
        }
        const probe: IRevertResult = { ok: true, restored: [], deleted: [], skipped: [], failed: [] }
        const ops = this.buildOps(record.files, probe)
        if (ops.length === 0) return { runId: record.runId, files: [] }
        const rels = ops.map((o) => o.rel)
        // Наличие файлов в обоих деревьях и пользовательские правки
        // вычисляются один раз для всех путей
        const [startRes, endRes, touchedRes] = await Promise.all([
          this.runWithPathArgs(
            ["ls-tree", "--name-only", record.hash],
            rels,
            SNAPSHOT_REVERT_TIMEOUT_MS,
          ),
          this.runWithPathArgs(
            ["ls-tree", "--name-only", record.endHash],
            rels,
            SNAPSHOT_REVERT_TIMEOUT_MS,
          ),
          this.runWithPathArgs(
            ["diff", "--name-only", "--no-ext-diff", record.endHash],
            rels,
            SNAPSHOT_REVERT_TIMEOUT_MS,
          ),
        ])
        const haveStart = new Set(startRes.code === 0 ? splitLines(startRes.stdout).map(pathKey) : [])
        const haveEnd = new Set(endRes.code === 0 ? splitLines(endRes.stdout).map(pathKey) : [])
        const touched = new Set(touchedRes.code === 0 ? splitLines(touchedRes.stdout).map(pathKey) : [])
        const files: IFileDiff[] = []
        for (const op of ops) {
          const key = pathKey(op.rel)
          const inStart = haveStart.has(key)
          const inEnd = haveEnd.has(key)
          const status: IFileDiff["status"] = inStart && inEnd ? "modified" : inStart ? "deleted" : "added"
          let userTouched = touched.has(key)
          if (!inEnd) {
            // Файла нет в состоянии «после»: если он появился на диске
            // — пользователь воссоздал удалённый запросом файл
            try {
              await fs.access(op.file)
              userTouched = true
            } catch {
              // Файла нет — как и в снимке
            }
          }
          const diffRes = await this.git.run(
            ["diff", "--no-ext-diff", "--no-color", record.hash, record.endHash, "--", op.rel],
            this.gitOpts(),
          )
          let diff = diffRes.code === 0 ? diffRes.stdout : ""
          if (diff.length > SNAPSHOT_DIFF_MAX_CHARS) {
            diff = diff.slice(0, SNAPSHOT_DIFF_MAX_CHARS) + "\n… (diff урезан)"
          }
          files.push({ path: op.file, status, diff, userTouched })
        }
        return { runId: record.runId, files }
      })
    } catch (err: unknown) {
      log.warn(`Не удалось построить предпросмотр: ${errorMessage(err)}`)
      return null
    }
  }

  async revert(record: ISnapshotRecord, opts?: IRevertOptions): Promise<IRevertResult> {
    if (this.disposed || !(await this.ensureEnabled())) {
      return {
        ok: false,
        restored: [],
        deleted: [],
        skipped: [],
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
            skipped: [],
            failed: [{ file: "*", error: "Снимок не создан" }],
          }
        }
        const result: IRevertResult = {
          ok: true,
          restored: [],
          deleted: [],
          skipped: [],
          failed: [],
        }

        // Валидация ДО изменений: оба дерева снимка должны существовать
        for (const h of [record.hash, record.endHash]) {
          const check = await this.git.run(
            ["cat-file", "-e", `${h}^{tree}`],
            this.gitOpts(SNAPSHOT_REVERT_TIMEOUT_MS),
          )
          if (check.code !== 0) {
            return {
              ok: false,
              restored: [],
              deleted: [],
              skipped: [],
              failed: [
                {
                  file: "*",
                  error: `Чекпоинт ${h.slice(0, 7)} недоступен (возможно, очищен)`,
                },
              ],
            }
          }
        }

        // Уникальные операции с валидацией вложенности в workspace
        const ops = this.buildOps(record.files, result)

        // Наличие файлов в обоих деревьях и пользовательские правки
        // вычисляются один раз для всех путей
        let haveStart = new Set<string>()
        let haveEnd = new Set<string>()
        let touched = new Set<string>()
        if (ops.length > 0) {
          const rels = ops.map((o) => o.rel)
          const [startRes, endRes] = await Promise.all([
            this.runWithPathArgs(
              ["ls-tree", "--name-only", record.hash],
              rels,
              SNAPSHOT_REVERT_TIMEOUT_MS,
            ),
            this.runWithPathArgs(
              ["ls-tree", "--name-only", record.endHash],
              rels,
              SNAPSHOT_REVERT_TIMEOUT_MS,
            ),
          ])
          haveStart = new Set(startRes.code === 0 ? splitLines(startRes.stdout).map(pathKey) : [])
          haveEnd = new Set(endRes.code === 0 ? splitLines(endRes.stdout).map(pathKey) : [])
          touched = await this.findUserTouched(record.endHash, rels)
          // Файла нет в состоянии «после», но он появился на диске:
          // пользователь воссоздал удалённый запросом файл
          for (const op of ops) {
            const key = pathKey(op.rel)
            if (haveEnd.has(key)) continue
            try {
              await fs.access(op.file)
              touched.add(key)
            } catch {
              // Файла нет — как и в снимке
            }
          }
        }
        const force = new Set([...(opts?.forceFiles ?? [])].map(pathKey))

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
          for (const op of batch) {
            const key = pathKey(op.rel)
            if (touched.has(key) && !force.has(pathKey(op.file)) && !force.has(key)) {
              result.skipped.push({ file: op.file, reason: "Файл изменялся после запроса" })
              continue
            }
            if (haveStart.has(key)) {
              await this.checkoutFile(op, record.hash, result)
            } else {
              await this.deleteFile(op, result)
            }
          }
          i = j
        }

        // Честный отчёт: успех только без единого провала
        // (пропущенные правки пользователя не делают результат неудачным)
        result.ok = result.failed.length === 0
        log.info(
          `Откат: ${result.restored.length} восстановлено, ${result.deleted.length} удалено, ` +
            `${result.skipped.length} пропущено (правки пользователя), ${result.failed.length} ошибок`,
        )
        return result
      })
    } catch (err: unknown) {
      log.error(`Сбой отката: ${errorMessage(err)}`)
      return {
        ok: false,
        restored: [],
        deleted: [],
        skipped: [],
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
        await this.pruneSnapshotRef()
        // git gc знает об alternates: заимствованные объекты остаются в
        // репозитории пользователя и не копируются в зеркало, локальные
        // недостижимые объекты удаляются
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

  /**
   * Обрезать цепочку снимков до retention: более старые коммиты становятся
   * недостижимыми и удаляются gc. Для этого цепочка перерезается: самый старый
   * сохраняемый коммит заменяется корневым (без родителя) с тем же деревом
   * и датой — иначе ссылка на родителя удерживала бы старые коммиты.
   */
  private async pruneSnapshotRef(): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - this.config.retentionDays * 86_400_000).toISOString()
      const res = await this.git.run(
        ["rev-list", SNAPSHOT_COMMIT_REF, `--since=${cutoff}`],
        this.gitOpts(),
      )
      if (res.code !== 0) return // ref ещё не создан
      const commits = splitLines(res.stdout)
      if (commits.length === 0) {
        await this.git.run(["update-ref", "-d", SNAPSHOT_COMMIT_REF], this.gitOpts())
        return
      }
      // rev-list выводит от новых к старым — последний = самый старый сохраняемый
      const oldest = commits[commits.length - 1]
      const parentRes = await this.git.run(
        ["rev-parse", "-q", "--verify", `${oldest}^`],
        this.gitOpts(),
      )
      if (parentRes.code !== 0) return // уже корневой — цепочка обрезана
      const meta = await this.git.run(["log", "-1", "--format=%ct%x00%s", oldest], this.gitOpts())
      if (meta.code !== 0) return
      const [date, subject] = meta.stdout.split("\0")
      const treeRes = await this.git.run(["rev-parse", `${oldest}^{tree}`], this.gitOpts())
      if (treeRes.code !== 0) return
      const newCommit = await this.git.run(
        ["commit-tree", treeRes.stdout.trim(), "-m", subject || "snapshot"],
        { ...this.gitOpts(), env: { GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date } },
      )
      if (newCommit.code !== 0 || !newCommit.stdout.trim()) {
        log.warn(`Не удалось перерезать цепочку снимков: ${newCommit.stderr.trim()}`)
        return
      }
      const refRes = await this.git.run(
        ["update-ref", SNAPSHOT_COMMIT_REF, newCommit.stdout.trim()],
        this.gitOpts(),
      )
      if (refRes.code !== 0) {
        log.warn(`Не удалось обновить ref снимков: ${refRes.stderr.trim()}`)
      }
    } catch (err: unknown) {
      log.warn(`Не удалось обрезать цепочку снимков: ${errorMessage(err)}`)
    }
  }

  dispose(): void {
    this.disposed = true
  }

  // ── Приватные помощники отката ──────────────────────────

  /**
   * Выполнить git-команду с путями как прямыми аргументами после "--",
   * разбивая их на батчи по бюджету длины (лимит командной строки Windows).
   * Пути, начинающиеся с ":", получают префикс "./" (защита от pathspec-magic).
   * Возвращает объединённый stdout; при ошибке — результат первого провального батча.
   */
  private async runWithPathArgs(
    baseArgs: string[],
    rels: string[],
    timeout: number,
  ): Promise<IGitRunResult> {
    const head = [...baseArgs, "--"]
    let stdout = ""
    for (let i = 0; i < rels.length; ) {
      const batch: string[] = []
      let size = head.length
      while (i < rels.length) {
        const p = rels[i].startsWith(":") ? `./${rels[i]}` : rels[i]
        if (batch.length > 0 && size + p.length + 1 > PATHSPEC_ARG_BUDGET) break
        batch.push(p)
        size += p.length + 1
        i++
      }
      const res = await this.git.run([...head, ...batch], this.gitOpts(timeout))
      if (res.code !== 0) return res
      stdout += res.stdout
    }
    return { stdout, stderr: "", code: 0 }
  }

  /** Пересекаются ли пути (один вложен в другой). */
  private pathsClash(paths: string[], candidate: string): boolean {
    return paths.some(
      (p) =>
        pathKey(p) === pathKey(candidate) ||
        pathKey(p).startsWith(pathKey(candidate) + "/") ||
        pathKey(candidate).startsWith(pathKey(p) + "/"),
    )
  }

  /**
   * Уникальные операции отката с валидацией путей.
   * Дедупликация по pathKey; пути вне workspace — в result.failed.
   */
  private buildOps(files: string[], result: IRevertResult): IRevertOp[] {
    const ops: IRevertOp[] = []
    const seen = new Set<string>()
    for (const file of files) {
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
    return ops
  }

  /**
   * Файлы, чьё текущее содержимое отличается от состояния endHash
   * (пользователь поменял их после запроса). Возвращает множество pathKey.
   * При ошибке git — вернёт все пути (безопасный режим: ничего не затираем).
   */
  private async findUserTouched(endHash: string, rels: string[]): Promise<Set<string>> {
    if (rels.length === 0) return new Set<string>()
    const res = await this.runWithPathArgs(
      ["diff", "--name-only", "--no-ext-diff", endHash],
      rels,
      SNAPSHOT_REVERT_TIMEOUT_MS,
    )
    if (res.code !== 0) {
      log.warn(`Не удалось проверить пользовательские правки: ${res.stderr}`)
      return new Set(rels.map((r) => pathKey(r)))
    }
    return new Set(splitLines(res.stdout).map(pathKey))
  }

  /** Восстановить файл из дерева «до запроса» (checkout). */
  private async checkoutFile(op: IRevertOp, hash: string, result: IRevertResult): Promise<void> {
    const opts = this.gitOpts(SNAPSHOT_REVERT_TIMEOUT_MS)
    const res = await this.git.run(["checkout", hash, "--", op.rel], opts)
    if (res.code === 0) {
      result.restored.push(op.file)
      return
    }
    result.failed.push({
      file: op.file,
      error: `Не удалось восстановить файл: ${res.stderr.trim() || "ошибка git checkout"}`,
    })
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
