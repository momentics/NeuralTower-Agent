import { runProcess } from "../../utils/ProcessRunner"
import { createDomainLogger } from "../../core/Logger"

const log = createDomainLogger("GitRunner")

/** Дефолтный лимит вывода git-процесса. */
export const GIT_MAX_BUFFER = 4 * 1024 * 1024
/** Таймаут проверки доступности git. */
const GIT_VERSION_TIMEOUT_MS = 5_000
const GIT_VERSION_MAX_BUFFER = 4096

/**
 * Ошибка: git не найден в PATH (spawn завершился с ENOENT).
 */
export class GitUnavailableError extends Error {
  constructor(message = "git не найден в PATH") {
    super(message)
    this.name = "GitUnavailableError"
  }
}

export interface IGitRunOptions {
  /** Зеркальная git-директория (--git-dir). Не задано — собственный .git репозитория. */
  gitDir?: string
  /** Рабочее дерево (--work-tree) и cwd процесса. */
  workTree: string
  /** Таймаут, мс. */
  timeout: number
  /** Лимит буфера вывода. */
  maxBuffer?: number
  /** Дополнительные переменные окружения (сливаются с process.env). */
  env?: Record<string, string>
  /** Данные для stdin (например, NUL-разделённые пути для --pathspec-from-file=-). */
  stdin?: string
  /** Отмена. */
  signal?: AbortSignal
}

export interface IGitRunResult {
  stdout: string
  stderr: string
  /** Код выхода. Не-ноль — НЕ исключение: решение принимает вызывающий. */
  code: number
}

/**
 * Интерфейс git-раннера — абстрагирует запуск процессов
 * для тестирования и будущих альтернативных реализаций.
 */
export interface IGitRunner {
  run(args: string[], options: IGitRunOptions): Promise<IGitRunResult>
  isAvailable(): Promise<boolean>
}

/**
 * Проверить, является ли ошибка отсутствием исполняемого файла (ENOENT).
 */
function isEnoent(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err as NodeJS.ErrnoException).code === "ENOENT"
  )
}

/**
 * Слить process.env с дополнительными переменными
 * (spawn требует полный набор окружения).
 */
function mergeEnv(extra: Record<string, string>): Record<string, string> {
  const merged: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) merged[key] = value
  }
  Object.assign(merged, extra)
  return merged
}

/**
 * Единая точка запуска git-процессов для всего расширения:
 * spawn без оболочки, аргументы — массив (защита от инъекций),
 * опциональные --git-dir/--work-tree, stdin, таймауты, лимиты буфера.
 *
 * Бесконечное состояние (кроме кэша isAvailable): сериализация
 * операций — за потребителем (Mutex на стороне сервиса).
 */
export class GitRunner implements IGitRunner {
  private available: boolean | null = null

  /**
   * Выполнить git-команду.
   * Не-ноль код выхода возвращает результат без исключения;
   * отсутствие git бросает GitUnavailableError; таймаут/буфер — Error.
   */
  async run(args: string[], options: IGitRunOptions): Promise<IGitRunResult> {
    const {
      gitDir,
      workTree,
      timeout,
      maxBuffer = GIT_MAX_BUFFER,
      env,
      stdin,
      signal,
    } = options

    const fullArgs = gitDir
      ? ["--git-dir", gitDir, "--work-tree", workTree, ...args]
      : args

    try {
      const result = await runProcess("git", fullArgs, {
        cwd: workTree,
        timeout,
        maxBuffer,
        env: env ? mergeEnv(env) : undefined,
        stdin,
        signal,
      })
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        code: result.code ?? 1,
      }
    } catch (err: unknown) {
      if (isEnoent(err)) {
        throw new GitUnavailableError()
      }
      throw err
    }
  }

  /**
   * Доступен ли git в PATH. Результат кэшируется на сессию:
   * одна проверка `git --version`.
   */
  async isAvailable(): Promise<boolean> {
    if (this.available !== null) return this.available
    try {
      const result = await runProcess("git", ["--version"], {
        timeout: GIT_VERSION_TIMEOUT_MS,
        maxBuffer: GIT_VERSION_MAX_BUFFER,
      })
      this.available = result.code === 0
    } catch {
      this.available = false
    }
    if (!this.available) {
      log.info("git не найден в PATH — git-операции недоступны")
    }
    return this.available
  }
}

/**
 * Неинтерактивное окружение для сетевых git-операций
 * (fetch/push/pull): без запроса пароля, без редактора и пейджера.
 * Возвращает копию окружения — process.env не изменяется.
 */
export function makeNonInteractiveEnv(
  base: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) continue
    if (
      key === "EDITOR" ||
      key === "GIT_EDITOR" ||
      key === "PAGER" ||
      key === "GIT_PAGER"
    ) {
      continue
    }
    env[key] = value
  }
  env.GIT_TERMINAL_PROMPT = "0"
  if (!env.GIT_SSH_COMMAND) {
    env.GIT_SSH_COMMAND = "ssh -o BatchMode=yes"
  }
  return env
}
