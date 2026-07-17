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
  IImportMapping,
  IReExport,
  IAliasMap,
  IGoModule,
  IWorkspacePackages,
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
import { EXTRACTION_VERSION } from './ExtractionVersion';
import { detectLanguage, loadExtensionOverrides, isFileLevelOnlyLanguage } from './LanguageDetector';
import { shouldIndexFile, isBinaryFile, isTooLarge, resolveRelativePath } from './PathValidation';
import { detectFrameworks } from './FrameworkDetection';
import { discoverEmbeddedRepoRoots, findIgnoredEmbeddedRepos } from './EmbeddedRepos';
import { readGitignorePatterns, matchGitignorePattern } from './Gitignore';
import { IExtractor, ExtractorBase } from './ExtractorBase';
import { CppExtractor } from './extractors/Cpp';
import { TypeScriptExtractor } from './extractors/TypeScript';
import { PythonExtractor } from './extractors/Python';
import { GoExtractor } from './extractors/Go';
import { RustExtractor } from './extractors/Rust';
import { JavaExtractor } from './extractors/Java';
import { CSharpExtractor } from './extractors/CSharp';
import { DefaultExtractor } from './extractors/Default';
import { stripCommentsForRegex } from './StripComments';
import { ParseWorkerPool, resolveParsePoolSize } from './ParserWorkerPool';
import os from 'os';

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

/** Карта язык → экстрактор. */
const EXTRACTOR_MAP = new Map<string, IExtractor>();

/** Инициализирует карту экстракторов (ленивая инициализация). */
function ensureExtractors(): void {
  if (EXTRACTOR_MAP.size === 0) {
    EXTRACTOR_MAP.set('typescript', new TypeScriptExtractor());
    EXTRACTOR_MAP.set('python', new PythonExtractor());
    EXTRACTOR_MAP.set('cpp', new CppExtractor());
    EXTRACTOR_MAP.set('c', new CppExtractor());
    EXTRACTOR_MAP.set('go', new GoExtractor());
    EXTRACTOR_MAP.set('rust', new RustExtractor());
    EXTRACTOR_MAP.set('java', new JavaExtractor());
    EXTRACTOR_MAP.set('csharp', new CSharpExtractor());
    EXTRACTOR_MAP.set('unknown', new DefaultExtractor());
  }
}

/** Вычисляет SHA-256 хеш содержимого файла. */
function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Кооперативная отдача управления с бюджетом.
 * Yield только если прошло > budgetMs с последнего yield.
 * Эффективнее для быстрых репозиториев.
 */
const DEFAULT_YIELD_BUDGET_MS = 250;

function createYielder(budgetMs: number = DEFAULT_YIELD_BUDGET_MS): () => Promise<void> {
  let last = Date.now();
  return async function maybeYield(): Promise<void> {
    if (Date.now() - last < budgetMs) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
    last = Date.now();
  };
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
  const yielder = createYielder();
  if (gitFiles) {
    for (const filePath of gitFiles) {
      checkAbort(signal);

      if (!isSourceFile(filePath)) continue;
      if (!shouldIndexFile(filePath, ignoreDirs ?? DEFAULT_IGNORE_DIRS, ignorePatterns ?? DEFAULT_IGNORE_PATTERNS)) continue;

      files.push(filePath);
      count++;

      if (count % SCAN_YIELD_INTERVAL === 0) {
        onProgress?.({ phase: 'scanning', current: count, total: 0, file: filePath, durationMs: 0 });
        await yielder();
      }
    }
    return files;
  }

  // Фолбэк: обход файловой системы
  await walkDirectory(rootDir, rootDir, files, count, ignoreDirs ?? DEFAULT_IGNORE_DIRS, ignorePatterns ?? DEFAULT_IGNORE_PATTERNS, onProgress, signal);
  return files;
}

/**
 * Обнаруживает вложенные репозитории, включая те, что находятся в gitignored директориях.
 * Например, vendor/ в Go проектах содержит внешние зависимости с собственными .git.
 */
async function discoverAllEmbeddedRepoRoots(rootDir: string): Promise<string[]> {
  const results = new Set<string>();

  // Стандартный поиск вложенных репозиториев
  const embedded = await discoverEmbeddedRepoRoots(rootDir);
  for (const r of embedded) {
    results.add(r);
  }

  // Поиск вложенных репозиториев в gitignored директориях
  const ignored = findIgnoredEmbeddedRepos(rootDir);
  for (const r of ignored) {
    results.add(path.join(rootDir, r));
  }

  return [...results];
}

/**
 * Проверяет, игнорируется ли путь gitignore-паттернами.
 * Применяет паттерны последовательно: последний совпавший определяет результат.
 * Негативные паттерны (!) отменяют игнорирование.
 */
function isIgnoredByGitignore(relativePath: string, patterns: string[]): boolean {
  let ignored = false;
  for (const pattern of patterns) {
    const isNegation = pattern.startsWith('!');
    if (isNegation) {
      // Негативный паттерн отменяет игнорирование
      const actualPattern = pattern.slice(1);
      if (matchGitignorePattern(relativePath, actualPattern)) {
        ignored = false;
      }
    } else if (matchGitignorePattern(relativePath, pattern)) {
      ignored = true;
    }
  }
  return ignored;
}

/**
 * Рекурсивный обход файловой системы для проектов без git.
 * Поддерживает symlink cycle detection и per-directory .gitignore.
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
  visitedDirs: Set<string> = new Set(),
  accumulatedGitignorePatterns: string[] = [],
): Promise<void> {
  // Symlink cycle detection — проверяем realpath
  let realDir: string;
  try {
    realDir = await fsp.realpath(currentDir);
  } catch {
    return;
  }

  if (visitedDirs.has(realDir)) return;
  visitedDirs.add(realDir);

  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(currentDir, { withFileTypes: true });
  } catch {
    return;
  }

  // Читаем .gitignore в текущей директории и добавляем паттерны
  const currentGitignorePatterns: string[] = [...accumulatedGitignorePatterns];
  const gitignorePath = path.join(currentDir, '.gitignore');
  try {
    const patterns = readGitignorePatterns(gitignorePath);
    currentGitignorePatterns.push(...patterns);
  } catch {
    // .gitignore не найден — пропускаем
  }

  const yielder = createYielder();
  for (const entry of entries) {
    checkAbort(signal);

    if (entry.name === '.git') continue;

    const fullPath = path.join(currentDir, entry.name);
    const relativePath = resolveRelativePath(fullPath, rootDir);

    if (entry.isDirectory()) {
      if (ignoreDirs.has(entry.name)) continue;
      if (isIgnoredByGitignore(relativePath + '/', currentGitignorePatterns)) continue;
      await walkDirectory(rootDir, fullPath, files, countRef, ignoreDirs, ignorePatterns, onProgress, signal, visitedDirs, currentGitignorePatterns);
    } else if (entry.isFile()) {
      if (!isSourceFile(relativePath)) continue;
      if (!shouldIndexFile(relativePath, ignoreDirs, ignorePatterns)) continue;

      if (isIgnoredByGitignore(relativePath, currentGitignorePatterns)) continue;

      files.push(relativePath);
      countRef++;

      if (countRef % SCAN_YIELD_INTERVAL === 0) {
        onProgress?.({ phase: 'scanning', current: countRef, total: 0, file: relativePath, durationMs: 0 });
        await yielder();
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
  * Возвращает пустые массивы, если git недоступен.
  */
function getGitChangedFiles(rootDir: string): {
  modified: string[];
  added: string[];
  removed: string[];
  error?: boolean;
} {
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
    return { added: [], modified: [], removed: [], error: true };
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
    error?: boolean;
  } {
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

    // Пул воркеров (объявлен до try для доступа из finally)
    let parsePool: ParseWorkerPool | null = null;
    let usePool = false;

    try {
      // Загрузка кастомных маппингов расширений из ntgraph.json
      loadExtensionOverrides(this.rootDir);

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
      let parseCount = 0;

      onProgress?.({ phase: 'parsing', current: 0, total, file: '', durationMs: 0 });

      // Инициализация экстракторов
      ensureExtractors();

      // Создание yielder с бюджетом
      const yielder = createYielder();

      // Включение WAL-клапана для массовой индексации
      this.db.enableWalValve(verbose);

      // Определяем доступные языки для загрузки грамматик
      const neededLanguages = new Set<string>();
      for (const filePath of files) {
        const lang = detectLanguage(filePath);
        if (lang !== 'unknown' && isLanguageSupported(lang) && !isFileLevelOnlyLanguage(lang)) {
          neededLanguages.add(lang);
        }
      }

      // Создаём пул воркеров для мульти-поточного парсинга
      try {
        require.resolve('worker_threads');
        const poolSize = resolveParsePoolSize(process.env.CODEGRAPH_PARSE_WORKERS, os.cpus().length);
        if (poolSize > 0) {
          const workerScriptPath = require.resolve('./ParserWorker.script.js');
          parsePool = new ParseWorkerPool({
            languages: [...neededLanguages],
            size: poolSize,
            workerScriptPath,
            log: verbose ? (msg: string) => console.log(`[pool] ${msg}`) : undefined,
          });
          usePool = true;
        }
      } catch {
        // worker_threads не доступны — используем синхронный режим
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

          // Языки только на уровне файла (yaml, properties, xml) — создаём file-узел
          if (isFileLevelOnlyLanguage(language)) {
            const fileBasename = path.basename(filePath);
            const lines = content.split('\n');
            const endLine = lines.length;
            const endColumn = lines[endLine - 1]?.length ?? 0;

            const fileNode: INode = {
              id: crypto.createHash('sha256').update(`${filePath}:${NodeKind.File}:${fileBasename}:1`).digest('hex'),
              kind: NodeKind.File,
              name: fileBasename,
              qualifiedName: filePath,
              filePath,
              language: language as Language,
              startLine: 1,
              endLine,
              startColumn: 0,
              endColumn,
              updatedAt: Date.now(),
            };

            const fileRecord: IFileRecord = {
              path: filePath,
              contentHash: hashContent(content),
              language: language as Language,
              size: stats.size,
              modifiedAt: stats.mtimeMs,
              indexedAt: Date.now(),
              nodeCount: 1,
            };

            await this.db.deleteFile(filePath);
            this.db.insertNodes([fileNode]);
            await this.db.upsertFile(fileRecord);

            processed++;
            filesIndexed++;
            totalNodes++;
            continue;
          }

          if (!isLanguageSupported(language)) {
            processed++;
            filesSkipped++;
            continue;
          }

          // Извлечение AST (через пул воркеров или синхронно)
          let result: IExtractionResult;
          try {
            if (usePool && parsePool) {
              result = await parsePool.requestParse({
                filePath,
                content,
                language: language as Language,
                frameworkNames,
              });
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
          language: language as Language,
          size: stats.size,
            modifiedAt: stats.mtimeMs,
            indexedAt: Date.now(),
            nodeCount: result.nodes.length,
            errors: result.errors.length > 0 ? result.errors : undefined,
          };

          // Сохранение в БД
          if (result.nodes.length > 0 || result.errors.length === 0) {
await this.storeExtractionResult(fileRecord, result);
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
      await yielder();

      // Сохранение версии экстракции
      this.db.setMetadata('extraction_version', String(EXTRACTION_VERSION));

      // Фолдинг WAL между фазами
      await this.db.foldWalNow();

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
      this.db.disableWalValve();
      if (parsePool) {
        await parsePool.destroy();
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
    const yielder = createYielder(1000);

    onProgress?.({ phase: 'scanning', current: 0, total: 0, file: '', durationMs: 0 });

    // Пытаемся использовать git для быстрого обнаружения изменений
    const gitChanges = getGitChangedFiles(this.rootDir);

    if (!gitChanges.error) {
      // Git-путь: быстрое обнаружение изменений
      const { modified, added, removed } = gitChanges;

      // Собираем уникальный набор языков из файлов, которые будут обработаны
      const neededLanguages = new Set<string>();
      for (const filePath of [...modified, ...added]) {
        const lang = detectLanguage(filePath);
        if (lang !== 'unknown' && isLanguageSupported(lang)) {
          neededLanguages.add(lang);
        }
      }

      // Удалённые файлы — удаляем из БД
      for (const filePath of removed) {
        checkAbort(signal);
        const tracked = this.db.getFileByPath(filePath);
        if (tracked) {
          await this.db.deleteFile(filePath);
          filesRemoved++;
          changedFilePaths.push(filePath);
        }
        filesChecked++;

        if (filesChecked % SYNC_RECONCILE_YIELD_INTERVAL === 0) {
          await yielder();
        }
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

          if (filesChecked % SYNC_RECONCILE_YIELD_INTERVAL === 0) {
            await yielder();
          }
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

        if (filesChecked % SYNC_RECONCILE_YIELD_INTERVAL === 0) {
          await yielder();
        }
      }
    } else {
      // Фолбэк: полное сравнение файловой системы с БД
      const currentFiles = await scanDirectory(this.rootDir, { onProgress, signal });
      filesChecked = currentFiles.length;

      // Собираем уникальный набор языков из файлов
      const neededLanguages = new Set<string>();
      for (const filePath of currentFiles) {
        const lang = detectLanguage(filePath);
        if (lang !== 'unknown' && isLanguageSupported(lang)) {
          neededLanguages.add(lang);
        }
      }

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
          await this.db.deleteFile(tracked.path);
          filesRemoved++;
          changedFilePaths.push(tracked.path);
        }

        if (++reconcileChecks % SYNC_RECONCILE_YIELD_INTERVAL === 0) {
          await yielder();
        }
      }

      // Добавления и модификации
      for (const filePath of currentFiles) {
        checkAbort(signal);

        if (++reconcileChecks % SYNC_RECONCILE_YIELD_INTERVAL === 0) {
          await yielder();
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
          await this.db.insertEdge({
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

        await this.db.insertEdge({
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
   * Batch-разрешение неразрешённых ссылок с persist.
   *
   * Алгоритм:
   * 1. Получаем неразрешённые ссылки пачками по batchSize
   * 2. Разрешаем каждую ссылку через resolveOne
   * 3. Создаём рёбра из разрешённых ссылок
   * 4. Вставляем рёбра в БД
   * 5. Удаляем разрешённые ссылки из unresolved_refs
   * 6. Yield для event loop между пачками
   * 7. После всех пачек удаляем неразрешимые ссылки
   * 8. Вызываем synthesizeCallbackEdges
   */
  async resolveAndPersistBatched(
    onProgress?: (resolved: number, total: number) => void,
    batchSize: number = 5000,
  ): Promise<IResolutionResult> {
    const resolved: IResolvedRef[] = [];
    const unresolved: IUnresolvedReference[] = [];
    const startTime = Date.now();
    const yielder = createYielder();

    let offset = 0;
    let prevRemaining = Infinity;

    while (true) {
      const batch = this.db.getUnresolvedReferencesBatch(offset, batchSize);
      if (batch.length === 0) break;

      const batchResolved: IResolvedRef[] = [];
      const batchUnresolved: IUnresolvedReference[] = [];

      for (const ref of batch) {
        const r = this.resolveOne(ref);
        if (r) {
          batchResolved.push(r);
        } else {
          batchUnresolved.push(ref);
        }

        onProgress?.(resolved.length + batchResolved.length, batch.length + offset);
      }

      // Создаём рёбра из разрешённых ссылок
      const edges = this.createEdges(batchResolved);
      if (edges.length > 0) {
        this.db.insertEdges(edges);
      }

      // Удаляем разрешённые ссылки из unresolved_refs
      if (batchResolved.length > 0) {
        this.db.deleteSpecificResolvedReferences(
          batchResolved.map(r => r.original),
        );
      }

      resolved.push(...batchResolved);
      unresolved.push(...batchUnresolved);

      // Yield для event loop
      await yielder();

      offset += batchSize;

      // Защита от бесконечного цикла
      const remaining = this.db.getUnresolvedReferencesCount();
      if (remaining >= prevRemaining) break;
      prevRemaining = remaining;
    }

    // Вызываем synthesizeCallbackEdges
    try {
      this.synthesizeCallbackEdges();
    } catch {
      // Синтез добавочный — ошибки игнорируем
    }

    return {
      resolved,
      unresolved,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Разрешает одну неразрешённую ссылку.
   */
  private resolveOne(ref: IUnresolvedReference): IResolvedRef | null {
    // Попытка разрешения по имени
    const candidates = this.db.getNodesByName(ref.referenceName);
    if (candidates.length > 0) {
      const best = this.selectBestCandidate(candidates, ref);
      if (best) {
        return {
          original: ref,
          targetNodeId: best.id,
          confidence: 0.9,
          provenance: 'heuristic',
        };
      }
    }

    // Попытка разрешения по квалифицированному имени
    const qualifiedCandidates = this.db.getNodesByQualifiedNameExact(ref.referenceName);
    if (qualifiedCandidates.length > 0) {
      return {
        original: ref,
        targetNodeId: qualifiedCandidates[0]!.id,
        confidence: 0.95,
        provenance: 'resolver',
      };
    }

    // Попытка разрешения по нижнему регистру имени
    const lowerCandidates = this.db.getNodesByLowerName(ref.referenceName.toLowerCase());
    if (lowerCandidates.length > 0) {
      return {
        original: ref,
        targetNodeId: lowerCandidates[0]!.id,
        confidence: 0.85,
        provenance: 'heuristic',
      };
    }

    return null;
  }

  /**
   * Создаёт рёбра из разрешённых ссылок.
   */
  private createEdges(resolved: IResolvedRef[]): IEdge[] {
    const edges: IEdge[] = [];

    for (const r of resolved) {
      const edgeKind = this.resolveEdgeKind(r.original.referenceKind);
      edges.push({
        source: r.original.fromNodeId,
        target: r.targetNodeId,
        kind: edgeKind,
        provenance: 'heuristic',
      });
    }

    return edges;
  }

 /**
   * Синтезирует callback-рёбра — ребра динамической диспетчеризации.
   *
   * Два канала:
   * (1) Field-backed observer (фаза 1): registrar/dispatcher делят хранилище.
   * (2) String-keyed EventEmitter (фаза 2): on('e', fn) ↔ emit('e').
   */
  private synthesizeCallbackEdges(): void {
    const ON_RE = /\.(?:on|once|addListener)\(\s*['"]([^'"]+)['"]\s*,\s*(?:function\s+(\w+)|(?:this\.)?(\w+))/g;
    const EMIT_RE = /\.(?:emit|fire|dispatchEvent)\(\s*['"]([^'"]+)['"]/g;
    const JSX_TAG_RE = /<([A-Z][A-Za-z0-9_]*)[\s/>]/g;
    const VUE_HANDLER_RE = /(?:@|v-on:)([a-zA-Z][\w-]*)(?:\.[\w]+)*\s*=\s*"([^"]+)"/g;

    const REGISTRAR_NAME = /^(on[A-Z]\w*|subscribe|addListener|addEventListener|register|watch|listen|addCallback)$/;
    const DISPATCHER_NAME = /(emit|trigger|notify|dispatch|fire|publish|flush)/i;
    const EVENT_FANOUT_CAP = 6;
    const MAX_CALLBACKS_PER_CHANNEL = 40;

    const edgesToInsert: IEdge[] = [];

    // ---------- Фаза 2: String-keyed EventEmitter ----------
    const emitsByEvent = new Map<string, Set<string>>();
    const handlersByEvent = new Map<string, Map<string, string>>();

    const allFiles = this.db.getAllFiles();

    for (const fileRec of allFiles) {
      const filePath = fileRec.path;
      const ext = path.extname(filePath).toLowerCase();
      const langMap: Record<string, string> = {
        '.ts': 'typescript', '.tsx': 'typescript',
        '.js': 'javascript', '.jsx': 'javascript',
        '.mjs': 'javascript', '.cjs': 'javascript',
        '.py': 'python',
      };
      const lang = langMap[ext];
      if (!lang) continue;

      const content = this.getFileLines(filePath);
      if (!content) continue;
      const fullContent = content.join('\n');

      const hasEmit = fullContent.includes('.emit(') || fullContent.includes('.fire(') || fullContent.includes('.dispatchEvent(');
      const hasOn = fullContent.includes('.on(') || fullContent.includes('.once(') || fullContent.includes('.addListener(');
      if (!hasEmit && !hasOn) continue;

      const stripped = stripCommentsForRegex(fullContent, lang as any);
      const nodesInFile = this.db.getNodesByKind('method').concat(this.db.getNodesByKind('function')).filter(n => n.filePath === filePath);

      const lineOf = (idx: number): number => {
        return stripped.slice(0, idx).split('\n').length;
      };

      if (hasEmit) {
        EMIT_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = EMIT_RE.exec(stripped))) {
          const eventName = m[1];
          const line = lineOf(m.index);
          const enclosing = this.enclosingFn(nodesInFile, line);
          if (!enclosing) continue;
          const set = emitsByEvent.get(eventName) ?? new Set();
          set.add(enclosing.id);
          emitsByEvent.set(eventName, set);
        }
      }

      if (hasOn) {
        ON_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = ON_RE.exec(stripped))) {
          const eventName = m[1];
          const handlerName = m[2] || m[3];
          if (!handlerName) continue;
          const handler = this.db.getNodesByName(handlerName).find(n => n.kind === 'function' || n.kind === 'method');
          if (!handler) continue;
          const line = lineOf(m.index);
          const map = handlersByEvent.get(eventName) ?? new Map();
          map.set(handler.id, `${filePath}:${line}`);
          handlersByEvent.set(eventName, map);
        }
      }
    }

    const seen = new Set<string>();
    for (const [event, dispatchers] of emitsByEvent) {
      const handlers = handlersByEvent.get(event);
      if (!handlers) continue;
      if (dispatchers.size > EVENT_FANOUT_CAP || handlers.size > EVENT_FANOUT_CAP) continue;
      for (const d of dispatchers) {
        for (const [h, registeredAt] of handlers) {
          if (d === h) continue;
          const key = `${d}>${h}`;
          if (seen.has(key)) continue;
          seen.add(key);
          edgesToInsert.push({
            source: d,
            target: h,
            kind: 'calls',
            metadata: { synthesizedBy: 'event-emitter', event, registeredAt },
            provenance: 'heuristic',
          });
        }
      }
    }

    // ---------- Фаза 1: Field-backed observer ----------
    const registrars: Array<{ node: INode; field: string }> = [];
    const dispatchers: Array<{ node: INode; field: string }> = [];

    const allMethods = this.db.getNodesByKind('method').concat(this.db.getNodesByKind('function'));

    for (const m of allMethods) {
      const isReg = REGISTRAR_NAME.test(m.name);
      const isDisp = DISPATCHER_NAME.test(m.name);
      if (!isReg && !isDisp) continue;

      const lines = this.getFileLines(m.filePath);
      if (!lines) continue;
      const src = lines.slice(m.startLine - 1, m.endLine).join('\n');
      if (!src) continue;

      if (isReg) {
        const field = this.registrarField(src);
        if (field) registrars.push({ node: m, field });
      }
      if (isDisp) {
        const field = this.dispatcherField(src);
        if (field) dispatchers.push({ node: m, field });
      }
    }

    let added = 0;
    for (const reg of registrars) {
      const chDispatchers = dispatchers.filter(d => d.node.filePath === reg.node.filePath && d.field === reg.field);
      if (chDispatchers.length === 0) continue;

      const argRe = new RegExp(`${reg.node.name}\\s*\\(\\s*(?:this\\.)?(\\w+)`);

      for (const e of this.db.getIncomingEdges(reg.node.id, ['calls'])) {
        if (added >= MAX_CALLBACKS_PER_CHANNEL) break;
        if (!e.line) continue;

        const caller = this.db.getNodeById(e.source);
        if (!caller) continue;

        const callerLines = this.getFileLines(caller.filePath);
        if (!callerLines) continue;
        const line = callerLines[e.line - 1];
        const am = line?.match(argRe);
        if (!am) continue;

        const fn = this.db.getNodesByName(am[1]).find(n => n.kind === 'method' || n.kind === 'function');
        if (!fn) continue;

        for (const disp of chDispatchers) {
          if (disp.node.id === fn.id) continue;
          const key = `${disp.node.id}>${fn.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          edgesToInsert.push({
            source: disp.node.id,
            target: fn.id,
            kind: 'calls',
            line: disp.node.startLine,
            metadata: {
              synthesizedBy: 'callback',
              via: reg.node.name,
              field: reg.field,
              registeredAt: `${caller.filePath}:${e.line}`,
            },
            provenance: 'heuristic',
          });
          added++;
        }
      }
    }

    // (JSX_TAG_RE и VUE_HANDLER_RE определены для будущего использования)

    if (edgesToInsert.length > 0) {
      this.db.insertEdges(edgesToInsert);
    }
  }

  /** Извлекает поле-хранилище из registrar-метода. */
  private registrarField(src: string): string | null {
    const m = src.match(/this\.(\w+)\.(?:add|push|set)\(/);
    return m ? m[1] : null;
  }

  /** Извлекает поле-хранилище из dispatcher-метода. */
  private dispatcherField(src: string): string | null {
    const forOf = src.match(/\bof\s+(?:Array\.from\(\s*)?this\.(\w+)/);
    if (forOf && /\b\w+\s*\(/.test(src)) return forOf[1];
    const forEach = src.match(/this\.(\w+)\.forEach\(/);
    if (forEach) return forEach[1];
    return null;
  }

  /** Внутренняя функция/метод, содержащая указанную строку. */
  private enclosingFn(nodesInFile: INode[], line: number): INode | null {
    const FN_KINDS = new Set(['method', 'function', 'component']);
    let best: INode | null = null;
    for (const n of nodesInFile) {
      if (!FN_KINDS.has(n.kind)) continue;
      const end = n.endLine ?? n.startLine;
      if (n.startLine <= line && end >= line) {
        if (!best || n.startLine >= best.startLine) best = n;
      }
    }
    return best;
  }

  /**
   * Получает маппинги импорта для файла.
   *
   * Возвращает массив IImportMapping, описывающих связи
   * между импортированными именами и их целевыми файлами.
   */
  private getImportMappings(filePath: string): IImportMapping[] {
    const importNodes = this.db.getNodesByKind(NodeKind.Import);
    const mappings: IImportMapping[] = [];

    for (const imp of importNodes) {
      if (imp.filePath !== filePath) continue;

      // Ищем исходящие imports-рёбра
      const importEdges = this.db.getOutgoingEdges(imp.id, ['imports']);
      for (const edge of importEdges) {
        const target = this.db.getNodeById(edge.target);
        if (target) {
          mappings.push({
            localName: imp.name,
            exportedName: target.name,
            source: target.filePath,
            isDefault: false,
            isNamespace: false,
            resolvedPath: target.filePath,
          });
        }
      }
    }

    return mappings;
  }

  /**
   * Получает ре-экспорты для файла.
   *
   * Возвращает массив IReExport, описывающих символы,
   * ре-экспортируемые из данного файла.
   */
  private getReExports(filePath: string): IReExport[] {
    const exportNodes = this.db.getNodesByKind(NodeKind.Export);
    const reExports: IReExport[] = [];

    for (const exp of exportNodes) {
      if (exp.filePath !== filePath) continue;

      // Ищем исходящие exports-рёбра
      const exportEdges = this.db.getOutgoingEdges(exp.id, ['exports']);
      for (const edge of exportEdges) {
        const target = this.db.getNodeById(edge.target);
        if (target) {
          reExports.push({
            kind: 'named',
            exportedName: exp.name,
            originalName: target.name,
            source: target.filePath,
          });
        } else {
          reExports.push({
            kind: 'named',
            exportedName: exp.name,
            originalName: exp.name,
            source: filePath,
          });
        }
      }
    }

    return reExports;
  }

  /** Ленивый итератор по узлам вида. */
  public iterateNodesByKind(kind: NodeKind): IterableIterator<INode> {
    return this.db.iterateNodesByKind(kind);
  }

  /** Строки файла. */
  public getFileLines(filePath: string): string[] | null {
    try {
      const content = fs.readFileSync(path.join(this.rootDir, filePath), 'utf-8');
      return content.split('\n');
    } catch {
      return null;
    }
  }

  /** Поиск методов по имени типа и имени метода. */
  public getMethodMatches(typeName: string, methodName: string, _language: Language): INode[] {
    const methods = this.db.getNodesByKind('method');
    const qualifiedName = `${typeName}.${methodName}`;
    return methods.filter(m => m.qualifiedName === qualifiedName || m.name === methodName);
  }

  /** Супертипы по имени типа. */
  public getSupertypesByName(typeName: string, _language: Language): string[] {
    const nodes = this.db.getNodesByName(typeName);
    const supertypes: string[] = [];
    for (const node of nodes) {
      const edges = this.db.getOutgoingEdges(node.id, ['extends', 'implements']);
      for (const edge of edges) {
        const target = this.db.getNodeById(edge.target);
        if (target) supertypes.push(target.name);
      }
    }
    return supertypes;
  }

  /** Карта алиасов проекта. */
  public getProjectAliases(): IAliasMap | null {
    try {
      const tsconfigPath = path.join(this.rootDir, 'tsconfig.json');
      if (!fs.existsSync(tsconfigPath)) return null;
      const raw = fs.readFileSync(tsconfigPath, 'utf-8');
      const config = JSON.parse(raw);
      const paths = config?.compilerOptions?.paths;
      if (!paths) return null;
      const aliases: IAliasMap = {};
      for (const [alias, targets] of Object.entries(paths)) {
        aliases[alias] = Array.isArray(targets) ? targets : [targets];
      }
      return aliases;
    } catch {
      return null;
    }
  }

  /** Go-модуль. */
  public getGoModule(): IGoModule | null {
    try {
      const goModPath = path.join(this.rootDir, 'go.mod');
      if (!fs.existsSync(goModPath)) return null;
      const content = fs.readFileSync(goModPath, 'utf-8');
      const stripped = content.replace(/\/\/[^\n]*/g, '');
      const match = stripped.match(/^\s*module\s+(\S+)\s*$/m);
      if (!match) return null;
      const modulePath = match[1]!.replace(/^["']|["']$/g, '');
      return { modulePath, goVersion: '', dependencies: new Map() };
    } catch {
      return null;
    }
  }

  /** Пакеты workspace. */
  public getWorkspacePackages(): IWorkspacePackages | null {
    try {
      const pkgPath = path.join(this.rootDir, 'package.json');
      if (!fs.existsSync(pkgPath)) return null;
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const ws = pkg?.workspaces;
      if (!ws) return null;
      const patterns = Array.isArray(ws) ? ws : ws.packages ?? [];
      if (!Array.isArray(patterns) || patterns.length === 0) return null;
      const packages = new Map<string, string>();
      const workspaces: string[] = [];
      for (const p of patterns) {
        workspaces.push(p);
      }
      return { packages, workspaces };
    } catch {
      return null;
    }
  }

  /** Список директорий. */
  public listDirectories(relativePath: string): string[] {
    try {
      const fullPath = path.join(this.rootDir, relativePath);
      const entries = fs.readdirSync(fullPath, { withFileTypes: true });
      return entries.filter(e => e.isDirectory()).map(e => e.name);
    } catch {
      return [];
    }
  }

  /** Директории include для C++. */
  public getCppIncludeDirs(): string[] {
    return [];
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

    // Уровень 2: сборка списка файлов, которые не удалось распарсить
    const failedFiles: { filePath: string; content: string; language: string; stats: fs.Stats }[] = [];

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
        } catch (parseErr3) {
          // Сохраняем для повторной обработки с фолбэком
          failedFiles.push({ filePath, content, language, stats });
          processed++;
          filesErrored++;
          errors.push({
            message: parseErr3 instanceof Error ? parseErr3.message : String(parseErr3),
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
          await this.storeExtractionResult(fileRecord, result);
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

    // Уровень 2: повторная обработка файлов, которые не удалось распарсить, с фолбэком
    for (const { filePath, content, language, stats } of failedFiles) {
      // Фолбэк: пробовать каждый доступный экстрактор
      let fallbackResult: IExtractionResult | null = null;
      for (const [lang, extractor] of EXTRACTOR_MAP) {
        try {
          fallbackResult = extractor.extract(content, filePath, frameworkNames);
          if (fallbackResult.nodes.length > 0) {
            break;
          }
        } catch {
          // Пробуем следующий экстрактор
        }
      }

      if (fallbackResult && fallbackResult.nodes.length > 0) {
        const fileRecord: IFileRecord = {
          path: filePath,
          contentHash: hashContent(content),
          language: language as Language,
          size: stats.size,
          modifiedAt: stats.mtimeMs,
          indexedAt: Date.now(),
          nodeCount: fallbackResult.nodes.length,
          errors: fallbackResult.errors.length > 0 ? fallbackResult.errors : undefined,
        };

        await this.storeExtractionResult(fileRecord, fallbackResult);

        filesErrored--;
        filesIndexed++;
        totalNodes += fallbackResult.nodes.length;
        totalEdges += fallbackResult.edges.length;

        if (fallbackResult.errors.length > 0) {
          for (const err of fallbackResult.errors) {
            if (!err.filePath) err.filePath = filePath;
          }
          errors.push(...fallbackResult.errors);
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
      await this.storeExtractionResult(fileRecord, result);
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
      getImportMappings: (filePath: string) => this.getImportMappings(filePath),
      getReExports: (filePath: string) => this.getReExports(filePath),
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
      getFileContent: (filePath: string): string | null => {
        try {
          return fs.readFileSync(path.join(this.rootDir, filePath), 'utf-8');
        } catch {
          return null;
        }
      },
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
  private stripComments(content: string, language: string): string {
     const lines = content.split('\n');
     if (language === 'typescript' || language === 'cpp' || language === 'csharp' || language === 'java') {
       const result: string[] = [];
       let inBlock = false;
       for (const line of lines) {
         let p = line;
         if (inBlock) {
           const ei = p.indexOf('*/');
           if (ei !== -1) { p = p.slice(ei + 2); inBlock = false; }
           else { result.push(''); continue; }
         }
         const si = p.indexOf('//');
         if (si !== -1) p = p.slice(0, si);
         const bs = p.indexOf('/*');
         if (bs !== -1) {
           const be = p.indexOf('*/', bs + 2);
           if (be !== -1) p = p.slice(0, bs) + p.slice(be + 2);
           else { p = p.slice(0, bs); inBlock = true; }
         }
         result.push(p);
       }
       return result.join('\n');
     }
     if (language === 'python') {
       // Python: # комментарии удаляются, но # внутри тройных кавычек
       // (строки и docstrings) сохраняются. Тройные кавычки пропускаются целиком.
       const result: string[] = [];
       let inTripleSingle = false;
       let inTripleDouble = false;

       for (const line of lines) {
         // Если мы внутри тройных кавычек — пропускаем строку целиком
         if (inTripleSingle || inTripleDouble) {
           const quote = inTripleSingle ? "'''" : '"""';
           const endIdx = line.indexOf(quote);
           if (endIdx !== -1) {
             // Закрывающая тройная кавычка найдена — обрабатываем остаток строки
             const rest = line.slice(endIdx + 3);
             const restResult = this.stripPythonLineComments(rest);
             result.push(restResult);
             if (inTripleSingle) inTripleSingle = false;
             else inTripleDouble = false;
           } else {
             // Всё содержимое строки — часть тройной кавычки
             result.push(line);
           }
           continue;
         }

         // Ищем первую тройную кавычку
         const tripleSingleIdx = line.indexOf("'''");
         const tripleDoubleIdx = line.indexOf('"""');

         if (tripleSingleIdx !== -1 || tripleDoubleIdx !== -1) {
           const firstIdx = Math.min(
             tripleSingleIdx !== -1 ? tripleSingleIdx : Infinity,
             tripleDoubleIdx !== -1 ? tripleDoubleIdx : Infinity,
           );

           const quote = firstIdx === tripleSingleIdx ? "'''" : '"""';
           const closeIdx = line.indexOf(quote, firstIdx + 3);

           if (closeIdx !== -1) {
             // Открывается и закрывается на той же строке — пропускаем целиком
             const before = line.slice(0, firstIdx);
             const after = line.slice(closeIdx + 3);
             const strippedBefore = this.stripPythonLineComments(before);
             const strippedAfter = this.stripPythonLineComments(after);
             result.push(strippedBefore + quote + line.slice(firstIdx + 3, closeIdx) + quote + strippedAfter);
           } else {
             // Открывается, но не закрывается — пропускаем до конца строки
             const before = line.slice(0, firstIdx);
             const strippedBefore = this.stripPythonLineComments(before);
             result.push(strippedBefore + line.slice(firstIdx));
             if (quote === "'''") inTripleSingle = true;
             else inTripleDouble = true;
           }
         } else {
           // Обычная строка — удаляем # комментарии
           const stripped = this.stripPythonLineComments(line);
           result.push(stripped);
         }
       }

       return result.join('\n');
     }
     if (language === 'go' || language === 'rust') {
       const result: string[] = [];
       for (const line of lines) {
         const t = line.trim();
         if (t.startsWith('#') || t.startsWith('//')) { result.push(''); continue; }
         const ci = line.indexOf('#');
         if (ci !== -1) result.push(line.slice(0, ci));
         else result.push(line);
       }
       return result.join('\n');
     }
     return content;
   }

   /** Удаляет # комментарии из одной строки Python (вне тройных кавычек). */
   private stripPythonLineComments(line: string): string {
     const ci = line.indexOf('#');
     if (ci !== -1) return line.slice(0, ci);
     return line;
   }

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
 public async storeExtractionResult(
    fileRecord: IFileRecord,
    result: IExtractionResult,
  ): Promise<void> {
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
      await this.db.deleteFile(filePath);
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
    await this.db.upsertFile({
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
          language: language as Language,
        size: stats.size,
        modifiedAt: stats.mtimeMs,
        indexedAt: Date.now(),
        nodeCount: result.nodes.length,
        errors: result.errors.length > 0 ? result.errors : undefined,
      };

      if (result.nodes.length > 0 || result.errors.length === 0) {
        await this.storeExtractionResult(fileRecord, result);
      }
    } catch {
      // Ошибка парсинга — пропускаем файл
    }
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
