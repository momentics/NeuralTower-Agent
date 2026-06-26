/**
 * Оркестратор индексации.
 *
 * Координирует весь пайплайн: сканирование файлов, определение языка,
 * извлечение AST через экстракторы, сохранение в БД, разрешение ссылок.
 * Поддерживает AbortSignal, прогресс и инкрементальную синхронизацию.
 */

import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFileSync } from 'child_process';
import { NtGraphDb } from '../ntgraph/index';
import {
  INode,
  IEdge,
  IFileRecord,
  IUnresolvedReference,
  IExtractionResult,
  IExtractionError,
  IIndexProgress,
  IIndexResult,
  ISyncResult,
  IResolutionResult,
  IResolvedRef,
  IGraphStats,
  IResolutionContext,
  NodeKind,
  EdgeKind,
  Language,
  MAX_FILE_SIZE,
  FILE_IO_BATCH_SIZE,
  SYNC_YIELD_INTERVAL,
  SYNC_RECONCILE_YIELD_INTERVAL,
  SCAN_YIELD_INTERVAL,
  DEFAULT_IGNORE_DIRS,
  DEFAULT_IGNORE_PATTERNS,
} from '../ntgraph/Types';
import { detectLanguage } from './LanguageDetector';
import { shouldIndexFile, isBinaryFile, isTooLarge, resolveRelativePath } from './PathValidation';
import { detectFrameworks } from './FrameworkDetection';
import { discoverEmbeddedRepoRoots } from './EmbeddedRepos';
import { IExtractor, ExtractorBase } from './ExtractorBase';
import { TypeScriptExtractor } from './extractors/TypeScript';
import { PythonExtractor } from './extractors/Python';
import { parseFile as parseFileWorker, loadGrammars as loadGrammarsWorker, destroy as destroyWorker } from './ParserWorker';

/** Параметры индексации. */
export interface IndexOptions {
  onProgress?: (progress: IIndexProgress) => void;
  signal?: AbortSignal;
  ignoreDirs?: ReadonlySet<string>;
  ignorePatterns?: string[];
  maxFileSize?: number;
  includeTests?: boolean;
  frameworkNames?: string[];
}

/** Карта расширение → язык. */
const EXT_TO_LANGUAGE: Record<string, Language> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.pyi': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.h': 'cpp',
  '.c': 'c',
  '.cs': 'csharp',
};

/** Определяет язык по расширению файла. */
function extToLanguage(filePath: string): Language {
  const ext = path.extname(filePath).toLowerCase();
  return EXT_TO_LANGUAGE[ext] ?? 'unknown';
}

/** Флаг: доступны ли воркеры для парсинга. */
let PARSER_WORKER_AVAILABLE = false;
try {
  require.resolve('worker_threads');
  PARSER_WORKER_AVAILABLE = true;
} catch {
  // Воркеры недоступны
}

/** Карта язык → экстрактор. */
const EXTRACTOR_MAP = new Map<string, IExtractor>();

/** Инициализирует карту экстракторов (ленивая инициализация). */
function ensureExtractors(): void {
  if (EXTRACTOR_MAP.size === 0) {
    EXTRACTOR_MAP.set('typescript', new TypeScriptExtractor());
    EXTRACTOR_MAP.set('python', new PythonExtractor());
  }
}

/** Вычисляет SHA-256 хеш содержимого файла. */
function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Кооперативная отдача управления — позволяет циклу событий обработать
 * отложенные задачи (например, прогресс-бар) во время длительных циклов.
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

/**
 * Проверяет AbortSignal и выбрасывает ошибку, если отмена запрошена.
 */
function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error('Операция отменена');
  }
}

/**
 * Проверяет, является ли язык поддерживаемым для индексации.
 */
function isLanguageSupported(language: string): boolean {
  return language !== 'unknown';
}

/**
 * Проверяет, является ли файл исходным по расширению.
 */
function isSourceFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  const supported = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
    '.py', '.pyi',
    '.go', '.rs', '.java',
    '.cpp', '.cc', '.cxx', '.hpp', '.h',
    '.c', '.cs',
  ]);
  return supported.has(ext);
}

/**
 * Сканирует директорию и возвращает список относительных путей к исходным файлам.
 * Использует git для быстрого обхода при наличии репозитория.
 */
async function scanDirectory(
  rootDir: string,
  options: IndexOptions = {},
): Promise<string[]> {
  const { ignoreDirs, ignorePatterns, onProgress, signal } = options;
  const files: string[] = [];
  let count = 0;

  // Пытаемся использовать git для быстрого обхода
  const gitFiles = getGitVisibleFiles(rootDir);
  if (gitFiles) {
    for (const filePath of gitFiles) {
      checkAbort(signal);

      if (!isSourceFile(filePath)) continue;
      if (!shouldIndexFile(filePath, ignoreDirs ?? DEFAULT_IGNORE_DIRS, ignorePatterns ?? DEFAULT_IGNORE_PATTERNS)) continue;

      files.push(filePath);
      count++;

      if (count % SCAN_YIELD_INTERVAL === 0) {
        onProgress?.({ phase: 'scanning', current: count, total: 0, file: filePath, durationMs: 0 });
        await yieldToEventLoop();
      }
    }
    return files;
  }

  // Фолбэк: обход файловой системы
  await walkDirectory(rootDir, rootDir, files, count, ignoreDirs ?? DEFAULT_IGNORE_DIRS, ignorePatterns ?? DEFAULT_IGNORE_PATTERNS, onProgress, signal);
  return files;
}

/**
 * Рекурсивный обход файловой системы для проектов без git.
 */
async function walkDirectory(
  rootDir: string,
  currentDir: string,
  files: string[],
  countRef: number,
  ignoreDirs: ReadonlySet<string>,
  ignorePatterns: string[],
  onProgress?: (progress: IIndexProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(currentDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    checkAbort(signal);

    if (entry.name === '.git') continue;

    const fullPath = path.join(currentDir, entry.name);
    const relativePath = resolveRelativePath(fullPath, rootDir);

    if (entry.isDirectory()) {
      if (ignoreDirs.has(entry.name)) continue;
      let skip = false;
      for (const pattern of ignorePatterns) {
        if (relativePath.includes(pattern)) {
          skip = true;
          break;
        }
      }
      if (skip) continue;
      await walkDirectory(rootDir, fullPath, files, countRef, ignoreDirs, ignorePatterns, onProgress, signal);
    } else if (entry.isFile()) {
      if (!isSourceFile(relativePath)) continue;
      if (!shouldIndexFile(relativePath, ignoreDirs, ignorePatterns)) continue;

      files.push(relativePath);
      countRef++;

      if (countRef % SCAN_YIELD_INTERVAL === 0) {
        onProgress?.({ phase: 'scanning', current: countRef, total: 0, file: relativePath, durationMs: 0 });
        await yieldToEventLoop();
      }
    }
  }
}

/**
 * Получает видимые файлы из git (отслеживаемые + неотслеживаемые, с учётом .gitignore).
 * Возвращает null, если git недоступен.
 */
function getGitVisibleFiles(rootDir: string): Set<string> | null {
  try {
    const opts = {
      cwd: rootDir,
      encoding: 'utf-8' as const,
      timeout: 30000,
      maxBuffer: 50 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'] as ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    };

    const tracked = execFileSync('git', ['ls-files', '-z', '-c', '--recurse-submodules'], opts);
    const untracked = execFileSync('git', ['ls-files', '-z', '-o', '--exclude-standard'], opts);

    const files = new Set<string>();
    for (const rel of tracked.split('\0')) {
      if (rel) files.add(rel.replace(/\\/g, '/'));
    }
    for (const rel of untracked.split('\0')) {
      if (rel && !rel.endsWith('/')) files.add(rel.replace(/\\/g, '/'));
    }

    return files;
  } catch {
    return null;
  }
}

/**
 * Получает изменённые файлы из git status.
 * Возвращает null, если git недоступен.
 */
function getGitChangedFiles(rootDir: string): {
  modified: string[];
  added: string[];
  removed: string[];
} | null {
  try {
    const output = execFileSync(
      'git',
      ['status', '--porcelain', '--no-renames'],
      {
        cwd: rootDir,
        encoding: 'utf-8' as const,
        timeout: 10000,
        maxBuffer: 50 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'] as ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );

    const modified: string[] = [];
    const added: string[] = [];
    const removed: string[] = [];

    for (const line of output.split('\n')) {
      if (line.length < 4) continue;

      const statusCode = line.substring(0, 2);
      const rel = line.substring(3).replace(/\\/g, '/');

      if (statusCode.includes('D')) {
        removed.push(rel);
      } else if (statusCode === '??') {
        if (isSourceFile(rel)) {
          added.push(rel);
        }
      } else {
        if (isSourceFile(rel)) {
          modified.push(rel);
        }
      }
    }

    return { modified, added, removed };
  } catch {
    return null;
  }
}

/**
 * Главный оркестратор индексации.
 *
 * Координирует сканирование файлов, определение языка, извлечение AST
 * через экстракторы, сохранение в БД и разрешение ссылок.
 */
export class ExtractionOrchestrator {
  private rootDir: string;
  private db: NtGraphDb;
  private _detectedFrameworks: string[] | null = null;

  constructor(rootDir: string, db: NtGraphDb) {
    this.rootDir = rootDir;
    this.db = db;
  }

  /**
   * Получает изменённые файлы из git status.
   */
  public getChangedFiles(): {
    modified: string[];
    added: string[];
    removed: string[];
  } | null {
    return getGitChangedFiles(this.rootDir);
  }

  /**
   * Вычисляет SHA-256 хеш содержимого.
   */
  public hashContent(content: string): string {
    return hashContent(content);
  }

  /**
    * Полная индексация проекта.
    *
    * Алгоритм:
    * 1. Сканирование файлов (с учётом игнорируемых паттернов, размера, бинарности)
    * 2. Для каждого файла: определение языка и извлечение AST через экстрактор
    * 3. Сохранение результата через storeExtractionResult()
    * 4. Отслеживание прогресса через onProgress
    * 5. Поддержка AbortSignal — проверка перед каждым файлом, очистка при отмене
    */
  async indexAll(
    onProgress?: (progress: IIndexProgress) => void,
    signal?: AbortSignal,
    verbose?: boolean,
  ): Promise<IIndexResult> {
    const startTime = Date.now();
    const errors: IExtractionError[] = [];
    let filesIndexed = 0;
    let filesSkipped = 0;
    let filesErrored = 0;
    let totalNodes = 0;
    let totalEdges = 0;

    // Сброс кэша фреймворков при каждом запуске
    this._detectedFrameworks = null;

    try {
      // Фаза 1: Сканирование файлов
      onProgress?.({ phase: 'scanning', current: 0, total: 0, file: '', durationMs: 0 });

      const files = await scanDirectory(this.rootDir, { onProgress, signal });

      if (signal?.aborted) {
        return this.abortResult(startTime, filesIndexed, filesSkipped, filesErrored, totalNodes, totalEdges, errors);
      }

      // Обнаружение фреймворков
      const frameworkNames = this.ensureDetectedFrameworks(files);

      // Фаза 2: Парсинг и извлечение
      const total = files.length;
      let processed = 0;

      onProgress?.({ phase: 'parsing', current: 0, total, file: '', durationMs: 0 });

      // Инициализация экстракторов
      ensureExtractors();

      // Загрузка грамматик для воркера
      if (PARSER_WORKER_AVAILABLE) {
        const languages = new Set<string>();
        for (const fp of files) {
          const lang = extToLanguage(fp);
          if (lang !== 'unknown') languages.add(lang);
        }
        if (languages.size > 0) {
          try {
            await loadGrammarsWorker([...languages]);
          } catch {
            // Игнорируем ошибки загрузки грамматик
          }
        }
      }

      // Обработка батчами для параллельного чтения файлов
      for (let i = 0; i < files.length; i += FILE_IO_BATCH_SIZE) {
        checkAbort(signal);

        const batch = files.slice(i, i + FILE_IO_BATCH_SIZE);

        // Параллельное чтение файлов в батче
        const fileContents = await Promise.all(
          batch.map(async (fp) => {
            try {
              const fullPath = path.join(this.rootDir, fp);
              const stats = await fsp.stat(fullPath);
              const content = await fsp.readFile(fullPath, 'utf-8');
              return { filePath: fp, content, stats, error: null as Error | null };
            } catch (err) {
              return { filePath: fp, content: null as string | null, stats: null as fs.Stats | null, error: err as Error };
            }
          }),
        );

        // Обработка каждого файла в батче
        for (const { filePath, content, stats, error } of fileContents) {
          checkAbort(signal);

          onProgress?.({
            phase: 'parsing',
            current: processed,
            total,
            file: filePath,
            durationMs: 0,
          });

          // Ошибка чтения
          if (error || content === null || stats === null) {
            processed++;
            filesErrored++;
            errors.push({
              message: `Ошибка чтения файла: ${error?.message ?? String(error)}`,
              filePath,
              severity: 'error',
              code: 'read_error',
            });
            continue;
          }

          // Проверка размера файла
          if (isTooLarge(stats.size) || stats.size > MAX_FILE_SIZE) {
            processed++;
            filesSkipped++;
            errors.push({
              message: `Файл превышает максимальный размер (${stats.size} > ${MAX_FILE_SIZE})`,
              filePath,
              severity: 'warning',
              code: 'size_exceeded',
            });
            continue;
          }

          // Проверка бинарности
          const buffer = Buffer.from(content, 'utf-8');
          if (isBinaryFile(buffer)) {
            processed++;
            filesSkipped++;
            continue;
          }

          // Определение языка
          const language = detectLanguage(filePath, content);

          if (!isLanguageSupported(language)) {
            processed++;
            filesSkipped++;
            continue;
          }

          // Извлечение AST через экстрактор
          let result: IExtractionResult;
          try {
            if (PARSER_WORKER_AVAILABLE) {
              result = await parseFileWorker(filePath, content, frameworkNames ?? [], language, [language]);
            } else {
              result = this.extractFile(filePath, content, language, frameworkNames);
            }
          } catch (parseErr) {
            processed++;
            filesErrored++;
            errors.push({
              message: parseErr instanceof Error ? parseErr.message : String(parseErr),
              filePath,
              severity: 'error',
              code: 'parse_error',
            });
            continue;
          }

          processed++;

          // Создание записи файла
          const fileRecord: IFileRecord = {
            path: filePath,
            contentHash: hashContent(content),
            language,
            size: stats.size,
            modifiedAt: stats.mtimeMs,
            indexedAt: Date.now(),
            nodeCount: result.nodes.length,
            errors: result.errors.length > 0 ? result.errors : undefined,
          };

          // Сохранение в БД
          if (result.nodes.length > 0 || result.errors.length === 0) {
            this.storeExtractionResult(fileRecord, result);
          }

          // Сбор ошибок извлечения
          if (result.errors.length > 0) {
            for (const err of result.errors) {
              if (!err.filePath) err.filePath = filePath;
            }
            errors.push(...result.errors);
          }

          // Обновление счётчиков
          if (result.nodes.length > 0) {
            filesIndexed++;
            totalNodes += result.nodes.length;
            totalEdges += result.edges.length;
          } else if (result.errors.some((e) => e.severity === 'error')) {
            filesErrored++;
          } else {
            filesSkipped++;
          }
        }
      }

      // Финальный прогресс
      onProgress?.({ phase: 'parsing', current: total, total, file: '', durationMs: 0 });

      // Отдача управления для флеша вывода
      await yieldToEventLoop();

      return {
        indexed: filesIndexed,
        updated: 0,
        removed: 0,
        errors,
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      if (err instanceof Error && err.message === 'Операция отменена') {
        return this.abortResult(startTime, filesIndexed, filesSkipped, filesErrored, totalNodes, totalEdges, errors);
      }
      throw err;
    } finally {
      if (PARSER_WORKER_AVAILABLE) {
        try {
          await destroyWorker();
        } catch {
          // Игнорируем ошибки при уничтожении воркера
        }
      }
    }
  }

  /**
    * Инкрементальная синхронизация.
    *
    * Алгоритм:
    * 1. git status --porcelain --no-renames для обнаружения изменённых файлов
    * 2. Для каждого изменённого файла: stat (размер, mtime) как префильтр
    * 3. Сравнение по хешу содержимого только если stat изменился
    * 4. Переизвлечение изменённых файлов, удаление удалённых
    * 5. Кооперативная отдача каждые SYNC_RECONCILE_YIELD_INTERVAL файлов
    */
  async sync(
    onProgress?: (progress: IIndexProgress) => void,
    signal?: AbortSignal,
  ): Promise<ISyncResult> {
    const startTime = Date.now();
    let filesChecked = 0;
    let filesAdded = 0;
    let filesModified = 0;
    let filesRemoved = 0;
    let nodesUpdated = 0;
    const changedFilePaths: string[] = [];

    onProgress?.({ phase: 'scanning', current: 0, total: 0, file: '', durationMs: 0 });

    // Пытаемся использовать git для быстрого обнаружения изменений
    const gitChanges = getGitChangedFiles(this.rootDir);

    if (gitChanges) {
      // Git-путь: быстрое обнаружение изменений
      const { modified, added, removed } = gitChanges;

      // Удалённые файлы — удаляем из БД
      for (const filePath of removed) {
        checkAbort(signal);
        const tracked = this.db.getFileByPath(filePath);
        if (tracked) {
          this.db.deleteFile(filePath);
          filesRemoved++;
          changedFilePaths.push(filePath);
        }
        filesChecked++;
      }

      // Изменённые и добавленные файлы — хеш-сравнение
      for (const filePath of [...modified, ...added]) {
        checkAbort(signal);
        const fullPath = path.join(this.rootDir, filePath);

        let content: string;
        try {
          content = await fsp.readFile(fullPath, 'utf-8');
        } catch {
          filesChecked++;
          continue;
        }

        const contentHash = hashContent(content);
        const tracked = this.db.getFileByPath(filePath);

        if (!tracked) {
          changedFilePaths.push(filePath);
          filesAdded++;
          await this.indexSingleFile(filePath, onProgress, signal);
        } else if (tracked.contentHash !== contentHash) {
          changedFilePaths.push(filePath);
          filesModified++;
          await this.indexSingleFile(filePath, onProgress, signal);
        }

        filesChecked++;
      }

      // Кооперативная отдача
      if (filesChecked % SYNC_YIELD_INTERVAL === 0) {
        await yieldToEventLoop();
      }
    } else {
      // Фолбэк: полное сравнение файловой системы с БД
      const currentFiles = await scanDirectory(this.rootDir, { onProgress, signal });
      filesChecked = currentFiles.length;
      const currentSet = new Set(currentFiles);

      const trackedFiles = this.db.getAllFiles();
      const trackedMap = new Map<string, IFileRecord>();
      for (const f of trackedFiles) {
        trackedMap.set(f.path, f);
      }

      // Удаления: есть в БД, но нет на файловой системе
      let reconcileChecks = 0;
      for (const tracked of trackedFiles) {
        checkAbort(signal);

        if (!currentSet.has(tracked.path) || !fs.existsSync(path.join(this.rootDir, tracked.path))) {
          this.db.deleteFile(tracked.path);
          filesRemoved++;
          changedFilePaths.push(tracked.path);
        }

        if (++reconcileChecks % SYNC_RECONCILE_YIELD_INTERVAL === 0) {
          await yieldToEventLoop();
        }
      }

      // Добавления и модификации
      for (const filePath of currentFiles) {
        checkAbort(signal);

        if (++reconcileChecks % SYNC_RECONCILE_YIELD_INTERVAL === 0) {
          await yieldToEventLoop();
        }

        const fullPath = path.join(this.rootDir, filePath);
        const tracked = trackedMap.get(filePath);

        // Префильтр: если размер и mtime совпадают, файл не изменился
        if (tracked) {
          try {
            const stat = fs.statSync(fullPath);
            if (stat.size === tracked.size && Math.floor(stat.mtimeMs) === Math.floor(tracked.modifiedAt)) {
              continue;
            }
          } catch {
            continue;
          }
        }

        // Чтение и хеш-сравнение
        let content: string;
        try {
          content = await fsp.readFile(fullPath, 'utf-8');
        } catch {
          continue;
        }

        const contentHash = hashContent(content);

        if (!tracked) {
          changedFilePaths.push(filePath);
          filesAdded++;
          await this.indexSingleFile(filePath, onProgress, signal);
        } else if (tracked.contentHash !== contentHash) {
          changedFilePaths.push(filePath);
          filesModified++;
          await this.indexSingleFile(filePath, onProgress, signal);
        }
      }
    }

    // Подсчёт обновлённых узлов
    for (const filePath of changedFilePaths) {
      const nodes = this.db.getNodesByFile(filePath);
      nodesUpdated += nodes.length;
    }

    return {
      added: filesAdded,
      updated: filesModified,
      removed: filesRemoved,
      errors: [],
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Разрешение кросс-файловых ссылок.
   *
   * Забирает неразрешённые ссылки из БД, пытается разрешить их
   * по имени, квалифицированному имени и виду узла, создаёт рёбра
   * для разрешённых и оставляет неразрешённые.
   */
  async resolveReferences(
    onProgress?: (progress: IIndexProgress) => void,
    signal?: AbortSignal,
  ): Promise<IResolutionResult> {
    const resolved: IResolvedRef[] = [];
    const unresolved: IUnresolvedReference[] = [];

    onProgress?.({ phase: 'resolving', current: 0, total: 0, file: '', durationMs: 0 });

    // Получаем все неразрешённые ссылки
    const allRefs = this.db.getUnresolvedReferences();
    const total = allRefs.length;

    onProgress?.({ phase: 'resolving', current: 0, total, file: '', durationMs: 0 });

    for (let i = 0; i < allRefs.length; i++) {
      checkAbort(signal);

      const ref = allRefs[i];
      onProgress?.({ phase: 'resolving', current: i + 1, total, file: '', durationMs: 0 });

      // Попытка разрешения по имени
      const candidates = this.db.getNodesByName(ref.referenceName);

      if (candidates.length > 0) {
        // Выбираем лучший кандидат: тот же язык, тот же файл (если language совпадает)
        const best = this.selectBestCandidate(candidates, ref);

        if (best) {
          // Создаём ребро
          const edgeKind = this.resolveEdgeKind(ref.referenceKind);
          this.db.insertEdge({
            source: ref.fromNodeId,
            target: best.id,
            kind: edgeKind,
            provenance: 'heuristic',
          });

          resolved.push({
            original: ref,
            targetNodeId: best.id,
            confidence: 0.9,
            provenance: 'heuristic',
          });

          // Удаляем неразрешённую ссылку
          this.db.deleteUnresolvedByNode(ref.fromNodeId);
          continue;
        }
      }

      // Попытка разрешения по квалифицированному имени
      const qualifiedCandidates = this.db.getNodesByQualifiedNameExact(ref.referenceName);

      if (qualifiedCandidates.length > 0) {
        const best = qualifiedCandidates[0];
        const edgeKind = this.resolveEdgeKind(ref.referenceKind);

        this.db.insertEdge({
          source: ref.fromNodeId,
          target: best.id,
          kind: edgeKind,
          provenance: 'heuristic',
        });

        resolved.push({
          original: ref,
          targetNodeId: best.id,
          confidence: 0.95,
          provenance: 'resolver',
        });

        this.db.deleteUnresolvedByNode(ref.fromNodeId);
        continue;
      }

      // Не удалось разрешить
      unresolved.push(ref);
    }

    onProgress?.({ phase: 'resolving', current: total, total, file: '', durationMs: 0 });

    return { resolved, unresolved, durationMs: 0 };
  }

/**
    * Статистика графа.
    *
    * Запрашивает данные из БД: количество узлов, рёбер, файлов,
    * распределение по видам и языкам, размер БД.
    */
  async getStats(): Promise<IGraphStats> {
    return this.db.getStats();
  }

  /**
    * Индексация конкретного списка файлов.
    *
    * Аналогично indexAll, но принимает список файлов вместо сканирования.
    */
  async indexFiles(filePaths: string[]): Promise<IIndexResult> {
    const startTime = Date.now();
    const errors: IExtractionError[] = [];
    let filesIndexed = 0;
    let filesSkipped = 0;
    let filesErrored = 0;
    let totalNodes = 0;
    let totalEdges = 0;

    this._detectedFrameworks = null;
    const frameworkNames = this.ensureDetectedFrameworks(filePaths);

    const total = filePaths.length;
    let processed = 0;

    ensureExtractors();

    for (let i = 0; i < filePaths.length; i += FILE_IO_BATCH_SIZE) {
      const batch = filePaths.slice(i, i + FILE_IO_BATCH_SIZE);

      const fileContents = await Promise.all(
        batch.map(async (fp) => {
          try {
            const fullPath = path.join(this.rootDir, fp);
            const stats = await fsp.stat(fullPath);
            const content = await fsp.readFile(fullPath, 'utf-8');
            return { filePath: fp, content, stats, error: null as Error | null };
          } catch (err) {
            return { filePath: fp, content: null as string | null, stats: null as fs.Stats | null, error: err as Error };
          }
        }),
      );

      for (const { filePath, content, stats, error } of fileContents) {
        // Ошибка чтения
        if (error || content === null || stats === null) {
          processed++;
          filesErrored++;
          errors.push({
            message: `Ошибка чтения файла: ${error?.message ?? String(error)}`,
            filePath,
            severity: 'error',
            code: 'read_error',
          });
          continue;
        }

        // Проверка размера файла
        if (isTooLarge(stats.size) || stats.size > MAX_FILE_SIZE) {
          processed++;
          filesSkipped++;
          continue;
        }

        // Проверка бинарности
        const buffer = Buffer.from(content, 'utf-8');
        if (isBinaryFile(buffer)) {
          processed++;
          filesSkipped++;
          continue;
        }

        // Определение языка
        const language = detectLanguage(filePath, content);

        if (!isLanguageSupported(language)) {
          processed++;
          filesSkipped++;
          continue;
        }

        // Извлечение AST через экстрактор
        let result: IExtractionResult;
        try {
          result = this.extractFile(filePath, content, language, frameworkNames);
        } catch (parseErr) {
          processed++;
          filesErrored++;
          errors.push({
            message: parseErr instanceof Error ? parseErr.message : String(parseErr),
            filePath,
            severity: 'error',
            code: 'parse_error',
          });
          continue;
        }

        processed++;

        // Создание записи файла
        const fileRecord: IFileRecord = {
          path: filePath,
          contentHash: hashContent(content),
          language,
          size: stats.size,
          modifiedAt: stats.mtimeMs,
          indexedAt: Date.now(),
          nodeCount: result.nodes.length,
          errors: result.errors.length > 0 ? result.errors : undefined,
        };

        // Сохранение в БД
        if (result.nodes.length > 0 || result.errors.length === 0) {
          this.storeExtractionResult(fileRecord, result);
        }

        // Сбор ошибок извлечения
        if (result.errors.length > 0) {
          for (const err of result.errors) {
            if (!err.filePath) err.filePath = filePath;
          }
          errors.push(...result.errors);
        }

        // Обновление счётчиков
        if (result.nodes.length > 0) {
          filesIndexed++;
          totalNodes += result.nodes.length;
          totalEdges += result.edges.length;
        } else if (result.errors.some((e) => e.severity === 'error')) {
          filesErrored++;
        } else {
          filesSkipped++;
        }
      }
    }

    return {
      indexed: filesIndexed,
      updated: 0,
      removed: 0,
      errors,
      durationMs: Date.now() - startTime,
    };
  }

  /**
    * Индексация одного файла.
    *
    * Читает файл, определяет язык, извлекает AST, сохраняет результат.
    */
  async indexFile(relativePath: string): Promise<IExtractionResult> {
    const fullPath = path.join(this.rootDir, relativePath);

    let content: string;
    let stats: fs.Stats;
    try {
      stats = await fsp.stat(fullPath);
      content = await fsp.readFile(fullPath, 'utf-8');
    } catch (err) {
      return {
        nodes: [],
        edges: [],
        unresolvedReferences: [],
        errors: [{
          message: err instanceof Error ? err.message : String(err),
          filePath: relativePath,
          severity: 'error',
          code: 'read_error',
        }],
        durationMs: 0,
      };
    }

    return this.indexFileWithContent(relativePath, content, {
      size: stats.size,
      mtimeMs: stats.mtimeMs,
    });
  }

  /**
    * Индексация файла с заранее прочитанным содержимым.
    *
    * Аналогично indexFile, но принимает содержимое и статистику напрямую
    * (для пакетного чтения).
    */
  async indexFileWithContent(
    relativePath: string,
    content: string,
    stats: { size: number; mtimeMs: number },
  ): Promise<IExtractionResult> {
    // Проверка размера файла
    if (stats.size > MAX_FILE_SIZE) {
      return {
        nodes: [],
        edges: [],
        unresolvedReferences: [],
        errors: [{
          message: `Файл превышает максимальный размер (${stats.size} > ${MAX_FILE_SIZE})`,
          filePath: relativePath,
          severity: 'warning',
          code: 'size_exceeded',
        }],
        durationMs: 0,
      };
    }

    // Проверка бинарности
    const buffer = Buffer.from(content, 'utf-8');
    if (isBinaryFile(buffer)) {
      return {
        nodes: [],
        edges: [],
        unresolvedReferences: [],
        errors: [],
        durationMs: 0,
      };
    }

    // Определение языка
    const language = detectLanguage(relativePath, content);

    if (!isLanguageSupported(language)) {
      return {
        nodes: [],
        edges: [],
        unresolvedReferences: [],
        errors: [],
        durationMs: 0,
      };
    }

    ensureExtractors();

    const frameworkNames = this._detectedFrameworks ?? undefined;

    const start = Date.now();
    const result = this.extractFile(relativePath, content, language, frameworkNames);
    result.durationMs = Date.now() - start;

    // Создание записи файла
    const fileRecord: IFileRecord = {
      path: relativePath,
      contentHash: hashContent(content),
      language,
      size: stats.size,
      modifiedAt: stats.mtimeMs,
      indexedAt: Date.now(),
      nodeCount: result.nodes.length,
      errors: result.errors.length > 0 ? result.errors : undefined,
    };

    // Сохранение в БД
    if (result.nodes.length > 0 || result.errors.length === 0) {
      this.storeExtractionResult(fileRecord, result);
    }

    return result;
  }

  /**
    * Построение контекста разрешения для детекции фреймворков.
    *
    * Создаёт объект, реализующий IResolutionContext, на основе списка файлов.
    */
  buildDetectionContext(files: string[]): IResolutionContext {
    return {
      getNodesByFile: (filePath: string) => this.db.getNodesByFile(filePath),
      getNodesByName: (name: string) => this.db.getNodesByName(name),
      getImportMappings: (_filePath: string) => [],
      getReExports: (_filePath: string) => [],
      getNodeById: (id: string) => this.db.getNodeById(id),
      getNodesByKind: (kind: NodeKind) => this.db.getNodesByKind(kind),
      getNodesByQualifiedName: (qualifiedName: string) => this.db.getNodesByQualifiedNameExact(qualifiedName),
      getNodesByLowerName: (lowerName: string) => this.db.getNodesByLowerName(lowerName),
      getSupertypes: (nodeId: string) => {
        const node = this.db.getNodeById(nodeId);
        if (!node) return [];
        const edges = this.db.getIncomingEdges(nodeId, ['extends', 'implements']);
        return edges.map((e) => this.db.getNodeById(e.source)).filter((n): n is INode => n !== null);
      },
      getChildren: (nodeId: string) => {
        const edges = this.db.getOutgoingEdges(nodeId, ['contains']);
        return edges.map((e) => this.db.getNodeById(e.target)).filter((n): n is INode => n !== null);
      },
      getAncestors: (nodeId: string) => {
        const edges = this.db.getIncomingEdges(nodeId, ['contains']);
        return edges.map((e) => this.db.getNodeById(e.source)).filter((n): n is INode => n !== null);
      },
      getIncomingEdges: (nodeId: string) => this.db.getIncomingEdges(nodeId),
      getOutgoingEdges: (nodeId: string) => this.db.getOutgoingEdges(nodeId),
      getFileContent: (_filePath: string) => null,
      getFilePathFromNodeId: (nodeId: string) => {
        const node = this.db.getNodeById(nodeId);
        return node?.filePath ?? null;
      },
      getLanguageFromNodeId: (nodeId: string) => {
        const node = this.db.getNodeById(nodeId);
        return (node?.language as Language) ?? null;
      },
      getDetectedFrameworks: () => this.ensureDetectedFrameworks(files),
      getAllFiles: () => files,
    };
  }

  /**
    * Обеспечивает детекцию фреймворков с кэшированием результата.
    *
    * Кэш сбрасывается при каждом вызове indexAll.
    */
  ensureDetectedFrameworks(files?: string[]): string[] {
    if (this._detectedFrameworks) return this._detectedFrameworks;

    try {
      this._detectedFrameworks = detectFrameworks(files ?? []);
    } catch {
      this._detectedFrameworks = [];
    }

    return this._detectedFrameworks;
  }

  // ===================================================================
  // Внутренние методы
  // ===================================================================

  /**
   * Извлекает AST из файла через соответствующий экстрактор.
   */
  private extractFile(
    filePath: string,
    content: string,
    language: string,
    frameworkNames?: string[],
  ): IExtractionResult {
    ensureExtractors();

    const extractor = EXTRACTOR_MAP.get(language);

    if (!extractor) {
      return {
        nodes: [],
        edges: [],
        unresolvedReferences: [],
        errors: [
          {
            message: `Экстрактор для языка ${language} не найден`,
            filePath,
            severity: 'warning',
            code: 'parse_error',
          },
        ],
        durationMs: 0,
      };
    }

    const start = Date.now();
    const result = extractor.extract(content, filePath, frameworkNames);
    result.durationMs = Date.now() - start;

    return result;
  }

 /**
    * Сохраняет результат извлечения в БД.
    *
    * Алгоритм:
    * 1. Проверка по хешу содержимого — пропускаем если не изменилось
    * 2. Снэпшот входящих кросс-файловых рёбер
    * 3. Удаление данных файла (FK cascade)
    * 4. Фильтрация узлов
    * 5. INSERT OR REPLACE узлов
    * 6. Фильтрация рёбер
    * 7. INSERT OR IGNORE рёбер
    * 8. Восстановление входящих кросс-файловых рёбер
    * 9. Вставка неразрешённых ссылок пакетом
    * 10. Upsert записи файла
    */
  public storeExtractionResult(
    fileRecord: IFileRecord,
    result: IExtractionResult,
  ): void {
    const filePath = fileRecord.path;
    const contentHash = fileRecord.contentHash;
    const language = fileRecord.language;

    // 1. Проверка по хешу — пропускаем если не изменилось
    const existingFile = this.db.getFileByPath(filePath);
    if (existingFile && existingFile.contentHash === contentHash) {
      return;
    }

    // 2. Снэпшот входящих кросс-файловых рёбер ДО удаления
    // Это необходимо, потому что deleteFile удаляет все рёбра каскадно,
    // включая рёбра из других файлов в этот.
    const crossFileIncomingEdges = existingFile
      ? this.db.getCrossFileIncomingEdgesWithTarget(filePath)
      : [];

    // 3. Удаление данных файла (FK cascade удалит узлы и рёбра)
    if (existingFile) {
      this.db.deleteFile(filePath);
    }

    // 4. Фильтрация узлов — оставляем только с заполненными обязательными полями
    const validNodes = result.nodes.filter(
      (n) => n.id && n.kind && n.name && n.filePath && n.language && n.startLine != null && n.endLine != null,
    );

    // 5. INSERT OR REPLACE узлов
    if (validNodes.length > 0) {
      this.db.insertNodes(validNodes);
    }

    // 6. Фильтрация рёбер — только на вставленные узлы
    const insertedIds = new Set(validNodes.map((n) => n.id));

    if (result.edges.length > 0) {
      const validEdges = result.edges.filter(
        (e) => insertedIds.has(e.source) && insertedIds.has(e.target),
      );

      // 7. INSERT OR IGNORE рёбер
      if (validEdges.length > 0) {
        this.db.insertEdges(validEdges);
      }
    }

    // 8. Восстановление входящих кросс-файловых рёбер
    // Перерешиваем target по (kind, name) → новый id, т.к. id зависит от строки
    if (crossFileIncomingEdges.length > 0) {
      const newNodesByKindName = new Map<string, string>();
      for (const n of validNodes) {
        newNodesByKindName.set(`${n.kind}\0${n.name}`, n.id);
      }

      const reinserted: IEdge[] = [];
      for (const e of crossFileIncomingEdges) {
        const newTargetId = newNodesByKindName.get(`${e.targetKind}\0${e.targetName}`);
        if (newTargetId) {
          reinserted.push({
            source: e.edge.source,
            target: newTargetId,
            kind: e.edge.kind,
            metadata: e.edge.metadata,
            line: e.edge.line,
            column: e.edge.column,
            provenance: e.edge.provenance,
          });
        }
      }

      if (reinserted.length > 0) {
        this.db.insertEdges(reinserted);
      }
    }

    // 9. Вставка неразрешённых ссылок пакетом
    const unresolvedRefs = result.unresolvedReferences;
    if (unresolvedRefs.length > 0) {
      const refsWithContext = unresolvedRefs
        .filter((ref) => insertedIds.has(ref.fromNodeId))
        .map((ref) => ({
          ...ref,
          filePath: ref.filePath ?? filePath,
          language: ref.language ?? language,
        }));

      if (refsWithContext.length > 0) {
        this.db.insertUnresolvedRefsBatch(refsWithContext);
      }
    }

    // 10. Upsert записи файла
    this.db.upsertFile({
      ...fileRecord,
      indexedAt: Date.now(),
      nodeCount: result.nodes.length,
      errors: result.errors.length > 0 ? result.errors : fileRecord.errors,
    });
  }

  /**
   * Индексирует один файл.
   */
  private async indexSingleFile(
    filePath: string,
    onProgress?: (progress: IIndexProgress) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    checkAbort(signal);

    const fullPath = path.join(this.rootDir, filePath);

    let content: string;
    let stats: fs.Stats;
    try {
      stats = await fsp.stat(fullPath);
      content = await fsp.readFile(fullPath, 'utf-8');
    } catch {
      return;
    }

    if (isTooLarge(stats.size)) {
      return;
    }

    const language = detectLanguage(filePath, content);

    if (!isLanguageSupported(language)) {
      return;
    }

    ensureExtractors();

    const frameworkNames = this._detectedFrameworks ?? undefined;

    try {
      const result = this.extractFile(filePath, content, language, frameworkNames);

      const fileRecord: IFileRecord = {
        path: filePath,
        contentHash: hashContent(content),
        language,
        size: stats.size,
        modifiedAt: stats.mtimeMs,
        indexedAt: Date.now(),
        nodeCount: result.nodes.length,
        errors: result.errors.length > 0 ? result.errors : undefined,
      };

      if (result.nodes.length > 0 || result.errors.length === 0) {
        this.storeExtractionResult(fileRecord, result);
      }
    } catch {
      // Ошибка парсинга — пропускаем файл
    }
  }

 /**
    * Обнаружение фреймворков в проекте.
    */
  private detectFrameworksInternal(): string[] {
    if (this._detectedFrameworks) return this._detectedFrameworks;

    try {
      this._detectedFrameworks = detectFrameworks([]);
    } catch {
      this._detectedFrameworks = [];
    }

    return this._detectedFrameworks;
  }

  /**
   * Выбирает лучшего кандидата для разрешения ссылки.
   *
   * Приоритет:
   * 1. Тот же язык
   * 2. Экспортированный узел
   * 3. Публичная видимость
   */
  private selectBestCandidate(candidates: INode[], ref: IUnresolvedReference): INode | null {
    if (candidates.length === 0) return null;

    // Фильтруем по языку, если известен
    const byLang = candidates.filter((c) => ref.language && c.language === (ref.language as Language));
    const pool = byLang.length > 0 ? byLang : candidates;

    // Фильтруем по виду узла, если referenceKind подсказывает
    if (ref.referenceKind === 'function_ref') {
      const funcs = pool.filter(
        (c) => c.kind === 'function' || c.kind === 'method',
      );
      if (funcs.length > 0) return funcs[0];
    }

    // Предпочитаем экспортированные узлы
    const exported = pool.filter((c) => c.isExported);
    if (exported.length > 0) return exported[0];

    // Предпочитаем публичные узлы
    const public_ = pool.filter((c) => c.visibility === 'public');
    if (public_.length > 0) return public_[0];

    return pool[0];
  }

  /**
   * Преобразует referenceKind в EdgeKind.
   */
  private resolveEdgeKind(referenceKind: string): EdgeKind {
    const mapping: Record<string, EdgeKind> = {
      'function_ref': 'calls',
      'calls': 'calls',
      'imports': 'imports',
      'references': 'references',
      'extends': 'extends',
      'implements': 'implements',
    };

    return mapping[referenceKind] ?? 'references';
  }

  /**
   * Формирует результат при отмене операции.
   */
  private abortResult(
    startTime: number,
    filesIndexed: number,
    _filesSkipped: number,
    _filesErrored: number,
    _totalNodes: number,
    _totalEdges: number,
    errors: IExtractionError[],
  ): IIndexResult {
    return {
      indexed: filesIndexed,
      updated: 0,
      removed: 0,
      errors: [{ message: 'Операция отменена', severity: 'error', filePath: '', code: 'read_error' }, ...errors],
      durationMs: Date.now() - startTime,
    };
  }
}
