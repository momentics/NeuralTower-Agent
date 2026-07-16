/**
 * Файловый наблюдатель
 *
 * Наблюдает за изменениями файлов в директории проекта и запускает
 * синхронизацию с задержкой для поддержания актуальности графа кода.
 *
 * Использует встроенный `fs.watch` Node.js напрямую (без сторонних
 * наблюдателей, без нативных дополнений) со стратегией для каждой
 * платформы, выбранной для того, чтобы стоимость открытых дескрипторов /
 * ядра наблюдения была ОГРАНИЧЕНА, а не росла с числом файлов:
 *
 *   - macOS / Windows: ОДИН рекурсивный `fs.watch(root, {recursive:true})`.
 *     libuv сопоставляет это с одним потоком FSEvents (macOS) / одним
 *     дескриптором ReadDirectoryChangesW (Windows), так что это стоит O(1)
 *     дескрипторов независимо от размера дерева. Это исправление для
 *     исчерпания таблицы файлов на macOS (#644 / #496 / #555 / #628):
 *     предыдущий наблюдатель удерживал один открытый fd НА КАЖДЫЙ
 *     НАБЛЮДАЕМЫЙ ФАЙЛ на macOS (десятки тысяч REG fds), что исчерпывало
 *     `kern.maxfiles` и вызывало сбои других процессов во всей системе.
 *
 *   - Linux: рекурсивный `fs.watch` не поддерживается, поэтому мы наблюдаем
 *     каждую (не игнорируемую) ДИРЕКТОРИЮ с одним inotify-наблюдением —
 *     O(директорий), НЕ O(файлов). Новые директории подбираются динамически,
 *     а общий лимит наблюдений ограничивает использование inotify на
 *     патологических monorepo (#579). Одно inotify-наблюдение за директорией
 *     уже сообщает о create/modify/delete для её дочерних элементов, так что
 *     наблюдения за отдельными файлами никогда не нужны.
 *
 * Исключённые деревья (node_modules/, dist/, .git/, …) фильтруются через
 * `ScopeIgnore` (встроенные директории по умолчанию + .gitignore проекта) —
 * на Linux они никогда не обходятся (так что они не стоят наблюдения),
 * а на macOS/Windows единственный рекурсивный поток покрывает их, но их
 * события отбрасываются до планирования любой синхронизации.
 */

import * as fs from 'fs';
import * as path from 'path';
import { isSourceFile, loadExtensionOverrides } from '../extraction';
import { ScopeIgnore } from '../ntgraph/Types';
import { normalizePath } from '../ntgraph/Utils';
import { watchDisabledReason } from './WatchPolicy';
import { classifyGitDir } from '../extraction';

/**
 * Максимальное число повторных попыток при конфликте блокировки, которые
 * наблюдатель переносит, прежде чем откажется и деградирует авто-синхронизацию.
 */
const MAX_LOCK_RETRIES = 5;
/**
 * Максимальное число повторных попыток при общих (не блокировочных)
 * ошибках синхронизации, которые наблюдатель переносит, прежде чем
 * деградирует авто-синхронизацию.
 */
const MAX_SYNC_FAILURE_RETRIES = 5;
/** Верхний предел экспоненциальной отсрочки повторных попыток. */
const MAX_RETRY_BACKOFF_MS = 30_000;

/**
 * Сообщение о деградации; оба пути исчерпания используют его буквально.
 */
const EXHAUSTION_REASON =
  'Лимит наблюдений/файлов ОС исчерпан; авто-синхронизация отключена. ' +
  'Запустите `ntgraph sync` (или установите git-хуки синхронизации) для обновления графа после изменений.';

/**
 * Сообщение о достижении лимита inotify на Linux. Не фатально — наблюдения
 * уже установленные продолжают работать, поэтому указывает точный параметр ядра.
 */
const INOTIFY_LIMIT_REASON =
  'Достигнут лимит наблюдений Linux inotify (fs.inotify.max_user_watches); живое ' +
  'наблюдение теперь покрывает только часть проекта, поэтому изменения в ненаблюдаемых ' +
  'директориях не будут автоматически синхронизироваться. Увеличьте лимит (например, ' +
  '`sudo sysctl fs.inotify.max_user_watches=1048576`, сохраните в /etc/sysctl.d) и ' +
  'перезапустите, или запустите `ntgraph sync` (или установите git-хуки синхронизации) для обновления.';

/**
 * Верно, если ошибка означает исчерпание ресурсов наблюдения ОС (EMFILE/ENFILE).
 */
function isWatchResourceExhaustion(err: unknown): boolean {
  const e = err as NodeJS.ErrnoException | undefined;
  if (e?.code === 'EMFILE' || e?.code === 'ENFILE') return true;
  if (!e?.code && e?.message) {
    return /EMFILE|ENFILE|too many open files/i.test(e.message);
  }
  return false;
}

/**
 * Верно, если ошибка означает исчерпание *числа наблюдений* Linux inotify.
 * `fs.watch` сигнализирует о достижении `fs.inotify.max_user_watches` как ENOSPC.
 */
function isInotifyWatchExhaustion(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | undefined)?.code === 'ENOSPC';
}

/**
 * Нативный рекурсивный `fs.watch` работает надёжно только на macOS и Windows;
 * на Linux (и AIX) он выбрасывает `ERR_FEATURE_UNAVAILABLE_ON_PLATFORM`.
 */
function supportsRecursiveWatch(): boolean {
  return process.platform === 'darwin' || process.platform === 'win32';
}

/**
 * Индирекция над `fs.watch`, чтобы тесты могли внедрить фейковую реализацию.
 */
type WatchFn = typeof fs.watch;
let watchImpl: WatchFn = fs.watch;

/** @internal Только для тестов: внедрение фейковой реализации fs.watch. */
export function __setFsWatchForTests(fn: WatchFn | null): void {
  watchImpl = fn ?? fs.watch;
}

/**
 * Верхняя граница одновременно наблюдаемых директорий на Linux.
 * Каждая — одно inotify-наблюдение; ядро имеет жёсткий лимит.
 */
const DEFAULT_MAX_DIR_WATCHES = 50_000;

function maxDirWatches(): number {
  const raw = process.env.NTGRAPH_MAX_DIR_WATCHES;
  if (raw && /^\d+$/.test(raw)) {
    const n = Number(raw);
    if (n > 0) return n;
  }
  return DEFAULT_MAX_DIR_WATCHES;
}

/**
 * Тестовый шов. Сопоставляет корень проекта с его живым экземпляром,
 * чтобы тесты могли детерминированно генерировать события изменений.
 */
const liveWatchersForTests = new Map<string, FileWatcher>();
const IS_TEST_RUNTIME = !!(process.env.VITEST || process.env.NODE_ENV === 'test');

/**
 * Опции файлового наблюдателя
 */
export interface WatchOptions {
  /**
   * Задержка дебаунса в миллисекундах.
   * После последнего изменения файла ждать столько перед запуском синхронизации.
   * По умолчанию: 2000мс
   */
  debounceMs?: number;

  /**
   * Обратный вызов при завершении синхронизации (для логирования/диагностики).
   */
  onSyncComplete?: (result: { filesChanged: number; durationMs: number }) => void;

  /**
   * Обратный вызов при ошибке синхронизации (для логирования/диагностики).
   */
  onSyncError?: (error: Error) => void;

  /**
   * Обратный вызов, вызываемый ОДИН РАЗ, когда живое наблюдение
   * необратимо деградирует и авто-синхронизация отключается.
   */
  onDegraded?: (reason: string) => void;

  /**
   * Только для тестов. Когда true, `start()` НЕ устанавливает
   * OS-уровневый fs.watch — наблюдатель «инертен» и управляется
   * только через `__emitWatchEventForTests` / `FileWatcher.ingestEventForTests`.
   */
  inertForTests?: boolean;
}

/**
 * Бросается `syncFn`, чтобы сигнализировать, что синхронизация не смогла
 * получить межпроцессную блокировку записи.
 */
export class LockUnavailableError extends Error {
  constructor(message = 'Блокировка файла NtGraph недоступна; другой процесс пишет') {
    super(message);
    this.name = 'LockUnavailableError';
  }
}

/**
 * Записи ожидаемых файлов — отслеживает исходный файл, для которого
 * наблюдатель увидел событие, но ещё не синхронизировал в индекс.
 */
export interface PendingFile {
  /** Относительный POSIX-путь проекта (например, "src/foo.ts"). */
  path: string;
  /** Миллисекунды настенных часов при первом событии для этого пути. */
  firstSeenMs: number;
  /** Миллисекунды настенных часов при последнем событии для этого пути. */
  lastSeenMs: number;
  /**
   * Верно, когда синхронизация сейчас выполняется, которая началась
   * ПОСЛЕ последнего события этого файла.
   */
  indexing: boolean;
}

/**
 * Сynchronous-функция для создания ScopeIgnore для проекта.
 * Вложенные репозитории определяются простым синхронным поиском .git директорий.
 */
function buildScopeIgnore(projectRoot: string): ScopeIgnore {
  const embedded: string[] = [];

  // Простой синхронный поиск вложенных репозиториев (одна вложенность)
  try {
    const entries = fs.readdirSync(projectRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const gitDir = path.join(projectRoot, entry.name, '.git');
        if (classifyGitDir(gitDir) !== null) {
          embedded.push(entry.name);
        }
      }
    }
  } catch {
    // Ошибка чтения директории — игнорируем
  }

  const matcher = new ScopeIgnore(projectRoot, embedded);

  // Загружаем паттерны из .gitignore
  const gitignorePath = path.join(projectRoot, '.gitignore');
  try {
    if (fs.existsSync(gitignorePath)) {
      const content = fs.readFileSync(gitignorePath, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
        matcher.addPattern(trimmed);
      }
    }
  } catch {
    // Ошибка чтения .gitignore — игнорируем
  }

  return matcher;
}

/**
 * Проверяет, является ли имя директории директорией данных NtGraph.
 */
function isNtGraphDataDir(name: string): boolean {
  return name === '.ntgraph';
}

/**
 * FileWatcher наблюдает за изменениями в директории проекта и запускает
 * синхронизацию с задержкой через предоставленный обратный вызов.
 *
 * Цели проектирования:
 * - Ограниченное использование ресурсов: O(1) дескрипторов на macOS/Windows,
 *   O(директорий) inotify-наблюдений на Linux — никогда не O(файлов)
 * - Дебаунс для предотвращения перегрузки при быстрых сохранениях
 * - Фильтрация исходных файлов по расширению
 * - Игнорирует .ntgraph/ и .git/ независимо от .gitignore
 * - Отслеживание состояния ожидаемых файлов на каждый файл
 */
export class FileWatcher {
  /** macOS/Windows: единственный рекурсивный наблюдатель. Null на Linux. */
  private recursiveWatcher: fs.FSWatcher | null = null;
  /** Linux: один наблюдатель на наблюдаемую директорию (по абсолютному пути). */
  private dirWatchers = new Map<string, fs.FSWatcher>();
  /** Установлен один раз, когда лимит директорий достигнут. */
  private dirCapWarned = false;
  /**
   * Установлен один раз, когда лимит наблюдений Linux inotify (ENOSPC)
   * достигнут. Предупреждаем один раз и перестаём добавлять наблюдения.
   */
  private inotifyLimitWarned = false;
  /**
   * Односторонний замок: причина, по которой живое наблюдение было
   * постоянно отключено, или null, пока здорово.
   */
  private degradedReason: string | null = null;
  /** Последовательные повторные попытки при конфликте блокировки. */
  private lockRetryCount = 0;
  /** Последовательные общие ошибки синхронизации; сбрасываются только чистой синхронизацией. */
  private syncFailureRetryCount = 0;
  /** Только для тестов: инертный режим. */
  private inert = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Файлы, увиденные наблюдателем с момента последней успешной синхронизации.
   */
  private pendingFiles = new Map<string, { firstSeenMs: number; lastSeenMs: number }>();
  /**
   * Миллисекунды настенных часов, когда началась выполняющаяся синхронизация.
   */
  private syncStartedMs = 0;
  private syncing = false;
  private stopped = false;
  /**
   * Верно, когда начальный набор наблюдений установлен.
   */
  private ready = false;
  /**
   * Обратные вызовы, которые резолвятся, когда набор наблюдений установлен.
   */
  private readyWaiters: Array<() => void> = [];
  /**
   * Общий сопоставитель области (встроенные значения по умолчанию + .gitignore проекта),
   * созданный один раз при start().
   */
  private ignoreMatcher: ScopeIgnore | null = null;

  private readonly projectRoot: string;
  private readonly debounceMs: number;
  private readonly syncFn: () => Promise<{ filesChanged: number; durationMs: number }>;
  private readonly onSyncComplete?: WatchOptions['onSyncComplete'];
  private readonly onSyncError?: WatchOptions['onSyncError'];
  private readonly onDegraded?: WatchOptions['onDegraded'];
  private readonly inertForTests: boolean;

  constructor(
    projectRoot: string,
    syncFn: () => Promise<{ filesChanged: number; durationMs: number }>,
    options: WatchOptions = {}
  ) {
    this.projectRoot = projectRoot;
    this.syncFn = syncFn;
    this.debounceMs = options.debounceMs ?? 2000;
    this.onSyncComplete = options.onSyncComplete;
    this.onSyncError = options.onSyncError;
    this.onDegraded = options.onDegraded;
    this.inertForTests = options.inertForTests ?? false;
  }

  /**
   * Запускает наблюдение за изменениями файлов.
   * Возвращает true, если наблюдение запущено успешно, false в противном случае.
   */
  start(): boolean {
    if (this.recursiveWatcher || this.dirWatchers.size > 0 || this.inert) return true;
    this.stopped = false;
    this.degradedReason = null;
    this.lockRetryCount = 0;
    this.syncFailureRetryCount = 0;

    // Некоторые среды делают файловое наблюдение непригодным — наиболее
    // заметный WSL2 /mnt/ диски. Пропускаем наблюдение там.
    const disabledReason = watchDisabledReason(this.projectRoot);
    if (disabledReason) {
      console.debug('[NtGraph] Файловый наблюдатель отключён', { reason: disabledReason, projectRoot: this.projectRoot });
      return false;
    }

    // Переиспользуем набор игнорирования индексатора, чтобы наблюдатель
    // и индексатор были согласованы в области.
    this.ignoreMatcher = buildScopeIgnore(this.projectRoot);

    try {
      if (this.inertForTests) {
        // Только для тестов: не устанавливаем OS-наблюдатель.
        this.inert = true;
      } else if (supportsRecursiveWatch()) {
        this.startRecursive();
      } else {
        this.startPerDirectory();
      }

      if (this.degradedReason) return false;

      this.pendingFiles.clear();
      this.ready = true;
      for (const cb of this.readyWaiters) cb();
      this.readyWaiters.length = 0;
      if (IS_TEST_RUNTIME) liveWatchersForTests.set(this.projectRoot, this);

      console.debug('[NtGraph] Файловый наблюдатель запущен', {
        projectRoot: this.projectRoot,
        debounceMs: this.debounceMs,
        mode: this.inertForTests ? 'инертен' : supportsRecursiveWatch() ? 'рекурсивный' : 'по директориям',
        watchedDirs: this.dirWatchers.size || undefined,
      });
      return true;
    } catch (err) {
      if (isWatchResourceExhaustion(err)) {
        this.degrade(EXHAUSTION_REASON, { error: String(err) });
      } else {
        console.warn('[NtGraph] Не удалось запустить файловый наблюдатель', { error: String(err) });
        this.stop();
      }
      return false;
    }
  }

  /**
   * macOS/Windows: один рекурсивный наблюдатель для всего дерева. O(1) дескрипторов.
   */
  private startRecursive(): void {
    this.recursiveWatcher = watchImpl(
      this.projectRoot,
      { recursive: true, persistent: true },
      (_event, filename) => {
        if (this.stopped || filename == null) return;
        this.handleChange(normalizePath(String(filename)));
      }
    );
    this.recursiveWatcher.on('error', (err: unknown) => {
      if (isWatchResourceExhaustion(err)) {
        this.degrade(EXHAUSTION_REASON, { error: String(err) });
        return;
      }
      console.warn('[NtGraph] Ошибка файлового наблюдателя', { error: String(err) });
    });
  }

  /**
   * Linux: обход (не игнорируемого) дерева и наблюдение за каждой директорией.
   */
  private startPerDirectory(): void {
    this.watchTree(this.projectRoot, false);
  }

  /**
   * Добавляет inotify-наблюдение для `dir` и рекурсирует в не игнорируемые
   * поддиректории. Когда `markExisting` true, исходные файлы внутри
   * записываются как ожидаемые.
   */
  private watchTree(dir: string, markExisting: boolean): void {
    if (this.stopped || this.degradedReason || this.inotifyLimitWarned) return;
    if (this.dirWatchers.has(dir)) return;
    if (this.dirWatchers.size >= maxDirWatches()) {
      if (!this.dirCapWarned) {
        this.dirCapWarned = true;
        console.warn('[NtGraph] Файловый наблюдатель достиг лимита наблюдений директорий; оставшиеся поддеревья зависят от ручной/периодической синхронизации', {
          cap: maxDirWatches(),
        });
      }
      return;
    }

    let w: fs.FSWatcher;
    try {
      w = watchImpl(dir, { persistent: true }, (_event, filename) =>
        this.handleDirEvent(dir, filename)
      );
    } catch (err) {
      if (isWatchResourceExhaustion(err)) {
        this.degrade(EXHAUSTION_REASON, { error: String(err), dir });
      } else if (isInotifyWatchExhaustion(err)) {
        this.warnInotifyLimit({ error: String(err), dir });
      }
      return;
    }
    w.on('error', (err: unknown) => {
      if (isWatchResourceExhaustion(err)) {
        this.degrade(EXHAUSTION_REASON, { error: String(err), dir });
        return;
      }
      if (isInotifyWatchExhaustion(err)) {
        this.warnInotifyLimit({ error: String(err), dir });
      }
      this.unwatchDir(dir);
    });
    this.dirWatchers.set(dir, w);

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (this.shouldIgnoreDir(child)) continue;
        this.watchTree(child, markExisting);
      } else if (markExisting && entry.isFile()) {
        this.handleChange(normalizePath(path.relative(this.projectRoot, child)));
      }
    }
  }

  /**
   * Обработчик событий Linux по директориям.
   */
  private handleDirEvent(dir: string, filename: string | Buffer | null): void {
    if (this.stopped || filename == null) return;
    const full = path.join(dir, String(filename));

    try {
      if (fs.statSync(full).isDirectory()) {
        if (!this.shouldIgnoreDir(full)) this.watchTree(full, true);
        return;
      }
    } catch {
      // удалён/недоступен — обрабатываем как обычное изменение ниже
    }

    this.handleChange(normalizePath(path.relative(this.projectRoot, full)));
  }

  /**
   * Общий обработчик изменений для обеих стратегий наблюдения.
   * Применяет фильтры игнорирования и исходных файлов, записывает
   * как ожидаемый и планирует синхронизацию с задержкой.
   */
  private handleChange(rel: string): void {
    if (!rel || rel === '.' || rel.startsWith('..')) return;
    if (this.isAlwaysIgnored(rel)) return;
    if (this.ignoreMatcher && this.ignoreMatcher.shouldIgnore(rel)) return;
    if (!isSourceFile(rel)) return;

    console.debug('[NtGraph] Изменение файла обнаружено', { file: rel });
    if (this.ready) {
      const now = Date.now();
      const existing = this.pendingFiles.get(rel);
      this.pendingFiles.set(rel, {
        firstSeenMs: existing?.firstSeenMs ?? now,
        lastSeenMs: now,
      });
    }
    this.scheduleSync();
  }

  /** Закрывает и забывает наблюдение за директорией, которая ошиблась/удалена. */
  private unwatchDir(dir: string): void {
    const w = this.dirWatchers.get(dir);
    if (w) {
      try {
        w.close();
      } catch {
        /* уже закрыт */
      }
      this.dirWatchers.delete(dir);
    }
  }

  /** Собственные директории всегда игнорируются независимо от .gitignore. */
  private isAlwaysIgnored(rel: string): boolean {
    const top = rel.split('/')[0] ?? rel;
    return (
      isNtGraphDataDir(top) ||
      rel === '.git' || rel.startsWith('.git/')
    );
  }

  /**
   * Верно для любой директории, которую НЕ следует наблюдать (используется
   * при построении дерева наблюдений по директориям на Linux).
   */
  private shouldIgnoreDir(dirPath: string): boolean {
    const rel = normalizePath(path.relative(this.projectRoot, dirPath));
    if (!rel || rel === '.' || rel.startsWith('..')) return false;
    if (this.isAlwaysIgnored(rel)) return true;
    if (!this.ignoreMatcher) return false;
    return this.ignoreMatcher.shouldIgnore(rel + '/');
  }

  /**
   * Постоянно отключает живое наблюдение после терминальной ошибки
   * выполнения (исчерпание ресурсов наблюдения, конфликт блокировки
   * за пределами бюджета повторных попыток, или устойчивая общая ошибка
   * синхронизации за пределами бюджета повторных попыток).
   */
  private degrade(reason: string, context: Record<string, unknown> = {}): void {
    if (this.degradedReason) return;
    this.degradedReason = reason;
    console.warn('[NtGraph] Файловый наблюдатель отключён', { projectRoot: this.projectRoot, reason, ...context });
    this.onDegraded?.(reason);
    this.stop();
  }

  /**
   * Предупреждает ОДИН РАЗ, что лимит наблюдений Linux inotify исчерпан,
   * и перестаёт добавлять новые наблюдения на оставшуюся часть сессии.
   */
  private warnInotifyLimit(context: Record<string, unknown> = {}): void {
    if (this.inotifyLimitWarned) return;
    this.inotifyLimitWarned = true;
    console.warn(INOTIFY_LIMIT_REASON, { watchedDirs: this.dirWatchers.size, ...context });
  }

  /**
   * Указывает, деградировало ли живое наблюдение постоянно (до следующего start()).
   */
  isDegraded(): boolean {
    return this.degradedReason !== null;
  }

  /** Причина деградации живого наблюдения, или null, если здорово. */
  getDegradedReason(): string | null {
    return this.degradedReason;
  }

  /**
   * Останавливает наблюдение за изменениями файлов.
   */
  stop(): void {
    this.stopped = true;

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.recursiveWatcher) {
      try {
        this.recursiveWatcher.close();
      } catch {
        /* уже закрыт */
      }
      this.recursiveWatcher = null;
    }
    for (const w of this.dirWatchers.values()) {
      try {
        w.close();
      } catch {
        /* уже закрыт */
      }
    }
    this.dirWatchers.clear();
    this.dirCapWarned = false;
    this.inotifyLimitWarned = false;
    this.lockRetryCount = 0;
    this.syncFailureRetryCount = 0;
    this.inert = false;

    this.pendingFiles.clear();
    this.ready = false;
    this.ignoreMatcher = null;
    if (IS_TEST_RUNTIME) liveWatchersForTests.delete(this.projectRoot);
    console.debug('[NtGraph] Файловый наблюдатель остановлен');
  }

  /**
   * @internal Только для тестов: подача синтетического изменения проекта
   * через тот же путь фильтр → pendingFiles → синхронизация с задержкой.
   */
  ingestEventForTests(relPath: string): void {
    this.handleChange(normalizePath(relPath));
  }

  /**
   * Указывает, активен ли наблюдатель в данный момент.
   */
  isActive(): boolean {
    return (this.recursiveWatcher !== null || this.dirWatchers.size > 0 || this.inert) && !this.stopped;
  }

  /**
   * Резолвится, когда набор наблюдений установлен (или немедленно,
   * если он уже установлен). Полезно для тестов.
   */
  waitUntilReady(timeoutMs = 10000): Promise<void> {
    if (this.ready) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        const idx = this.readyWaiters.indexOf(handler);
        if (idx >= 0) this.readyWaiters.splice(idx, 1);
        reject(new Error(`FileWatcher.waitUntilReady истёк таймаут после ${timeoutMs}мс`));
      }, timeoutMs);
      const handler = () => { clearTimeout(t); resolve(); };
      this.readyWaiters.push(handler);
    });
  }

  /**
   * Планирует обычную синхронизацию с задержкой после редактирования исходного файла.
   */
  private scheduleSync(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.flush();
    }, this.debounceMs);
  }

  /**
   * Планирует повторную попытку после восстанавливаемой ошибки синхронизации.
   */
  private scheduleRetrySync(delayMs: number): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.flush();
    }, delayMs);
  }

  /**
   * Очищает ожидающие изменения, запустив синхронизацию.
   */
  private async flush(): Promise<void> {
    if (this.syncing || this.stopped) return;

    this.syncStartedMs = Date.now();
    this.syncing = true;

    try {
      const result = await this.syncFn();
      this.lockRetryCount = 0;
      this.syncFailureRetryCount = 0;
      for (const [filePath, info] of this.pendingFiles) {
        if (info.lastSeenMs <= this.syncStartedMs) {
          this.pendingFiles.delete(filePath);
        }
      }
      this.onSyncComplete?.(result);
    } catch (err) {
      if (err instanceof LockUnavailableError) {
        this.lockRetryCount += 1;
        console.debug('[NtGraph] Синхронизация наблюдения пропущена: блокировка файла недоступна', {
          pendingFiles: this.pendingFiles.size,
          retryCount: this.lockRetryCount,
        });
        if (this.lockRetryCount > MAX_LOCK_RETRIES) {
          this.degrade(
            'Блокировка файла NtGraph удерживается другим процессом за пределами бюджета повторных попыток; ' +
              'авто-синхронизация отключена. Запустите `ntgraph sync`, когда другой писатель завершит ' +
              '(или установите git-хуки синхронизации) для обновления графа.',
            { pendingFiles: this.pendingFiles.size, retryCount: this.lockRetryCount }
          );
        }
      } else {
        this.lockRetryCount = 0;
        this.syncFailureRetryCount += 1;
        const error = err instanceof Error ? err : new Error(String(err));
        console.warn('[NtGraph] Синхронизация наблюдения не удалась', {
          error: error.message,
          retryCount: this.syncFailureRetryCount,
        });
        this.onSyncError?.(error);
        if (this.syncFailureRetryCount > MAX_SYNC_FAILURE_RETRIES) {
          this.degrade(
            `Авто-синхронизация NtGraph не удалась ${this.syncFailureRetryCount} раз подряд; ` +
              'авто-синхронизация отключена. Запустите `ntgraph sync` (или установите git-хуки синхронизации) для ' +
              `обновления графа после изменений. Последняя ошибка: ${error.message}`,
            { error: error.message, retryCount: this.syncFailureRetryCount }
          );
        }
      }
    } finally {
      this.syncing = false;

      if (this.pendingFiles.size > 0 && !this.stopped) {
        const retryCount = Math.max(this.lockRetryCount, this.syncFailureRetryCount);
        if (retryCount > 0) {
          const retryDelayMs = Math.min(
            this.debounceMs * 2 ** Math.max(0, retryCount - 1),
            MAX_RETRY_BACKOFF_MS
          );
          this.scheduleRetrySync(retryDelayMs);
        } else {
          this.scheduleSync();
        }
      }
    }
  }

  /**
   * Снимок файлов, увиденных наблюдателем с момента последней успешной синхронизации.
   */
  getPendingFiles(): PendingFile[] {
    const result: PendingFile[] = [];
    for (const [filePath, info] of this.pendingFiles) {
      result.push({
        path: filePath,
        firstSeenMs: info.firstSeenMs,
        lastSeenMs: info.lastSeenMs,
        indexing: this.syncing && this.syncStartedMs >= info.lastSeenMs,
      });
    }
    return result;
  }
}

/**
 * Только для тестов: синтезирует изменение исходного файла для живого
 * наблюдателя, работающего в `projectRoot`.
 */
export function __emitWatchEventForTests(projectRoot: string, relPath: string): boolean {
  const w = liveWatchersForTests.get(projectRoot);
  if (!w) return false;
  w.ingestEventForTests(relPath);
  return true;
}
