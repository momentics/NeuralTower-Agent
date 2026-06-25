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
  NodeKind,
  EdgeKind,
  Language,
  MAX_FILE_SIZE,
  FILE_IO_BATCH_SIZE,
  SYNC_YIELD_INTERVAL,
  SCAN_YIELD_INTERVAL,
  DEFAULT_IGNORE_DIRS,
  DEFAULT_IGNORE_PATTERNS,
} from '../ntgraph/Types';
import { detectLanguage } from './LanguageDetector';
import { shouldIndexFile, isBinaryFile, isTooLarge, resolveRelativePath } from './PathValidation';
import { detectFrameworks } from './FrameworkDetection';
import { discoverEmbeddedRepos } from './EmbeddedRepos';
import { IExtractor, ExtractorBase } from './ExtractorBase';
import { TypeScriptExtractor } from './extractors/TypeScript';
import { PythonExtractor } from './extractors/Python';

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
        onProgress?.({ phase: 'scanning', current: count, total: 0, currentFile: filePath });
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
        onProgress?.({ phase: 'scanning', current: countRef, total: 0, currentFile: relativePath });
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
  deleted: string[];
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
    const deleted: string[] = [];

    for (const line of output.split('\n')) {
      if (line.length < 4) continue;

      const statusCode = line.substring(0, 2);
      const rel = line.substring(3).replace(/\\/g, '/');

      if (statusCode.includes('D')) {
        deleted.push(rel);
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

    return { modified, added, deleted };
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
export class IndexOrchestrator {
  private db: NtGraphDb;
  private projectRoot: string;
  private options: IndexOptions;
  private detectedFrameworks: string[] | null = null;

  constructor(db: NtGraphDb, projectRoot: string, options?: IndexOptions) {
    this.db = db;
    this.projectRoot = projectRoot;
    this.options = options ?? {};
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
  async index(): Promise<IIndexResult> {
    const startTime = Date.now();
    const { onProgress, signal, ignoreDirs, ignorePatterns, maxFileSize } = this.options;
    const errors: IExtractionError[] = [];
    let filesIndexed = 0;
    let filesSkipped = 0;
    let filesErrored = 0;
    let totalNodes = 0;
    let totalEdges = 0;

    try {
      // Фаза 1: Сканирование файлов
      onProgress?.({ phase: 'scanning', current: 0, total: 0 });

      const files = await scanDirectory(this.projectRoot, this.options);

      if (signal?.aborted) {
        return this.abortResult(startTime, filesIndexed, filesSkipped, filesErrored, totalNodes, totalEdges, errors);
      }

      // Обнаружение фреймворков
      const frameworkNames = this.options.frameworkNames ?? await this.detectFrameworksInternal();

      // Фаза 2: Парсинг и извлечение
      const total = files.length;
      let processed = 0;

      onProgress?.({ phase: 'parsing', current: 0, total });

      // Инициализация экстракторов
      ensureExtractors();

      // Обработка батчами для параллельного чтения файлов
      for (let i = 0; i < files.length; i += FILE_IO_BATCH_SIZE) {
        checkAbort(signal);

        const batch = files.slice(i, i + FILE_IO_BATCH_SIZE);

        // Параллельное чтение файлов в батче
        const fileContents = await Promise.all(
          batch.map(async (fp) => {
            try {
              const fullPath = path.join(this.projectRoot, fp);
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
            currentFile: filePath,
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
          const effectiveMaxSize = maxFileSize ?? MAX_FILE_SIZE;
          if (isTooLarge(stats.size) || stats.size > effectiveMaxSize) {
            processed++;
            filesSkipped++;
            errors.push({
              message: `Файл превышает максимальный размер (${stats.size} > ${effectiveMaxSize})`,
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

          // Сохранение в БД
          if (result.nodes.length > 0 || result.errors.length === 0) {
            this.storeExtractionResult(filePath, content, language, stats, result);
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
      onProgress?.({ phase: 'parsing', current: total, total });

      // Отдача управления для флеша вывода
      await yieldToEventLoop();

      return {
        success: filesIndexed > 0 || errors.filter((e) => e.severity === 'error').length === 0,
        filesIndexed,
        filesSkipped,
        filesErrored,
        nodesCreated: totalNodes,
        edgesCreated: totalEdges,
        errors,
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      if (err instanceof Error && err.message === 'Операция отменена') {
        return this.abortResult(startTime, filesIndexed, filesSkipped, filesErrored, totalNodes, totalEdges, errors);
      }
      throw err;
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
   * 5. Кооперативная отдача каждые SYNC_YIELD_INTERVAL файлов
   */
  async sync(): Promise<ISyncResult> {
    const startTime = Date.now();
    const { onProgress, signal } = this.options;
    let filesChecked = 0;
    let filesAdded = 0;
    let filesModified = 0;
    let filesRemoved = 0;
    let nodesUpdated = 0;
    const changedFilePaths: string[] = [];

    onProgress?.({ phase: 'scanning', current: 0, total: 0 });

    // Пытаемся использовать git для быстрого обнаружения изменений
    const gitChanges = getGitChangedFiles(this.projectRoot);

    if (gitChanges) {
      // Git-путь: быстрое обнаружение изменений
      const { modified, added, deleted } = gitChanges;

      // Удалённые файлы — удаляем из БД
      for (const filePath of deleted) {
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
        const fullPath = path.join(this.projectRoot, filePath);

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
      const currentFiles = await scanDirectory(this.projectRoot, this.options);
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

        if (!currentSet.has(tracked.path) || !fs.existsSync(path.join(this.projectRoot, tracked.path))) {
          this.db.deleteFile(tracked.path);
          filesRemoved++;
          changedFilePaths.push(tracked.path);
        }

        if (++reconcileChecks % SYNC_YIELD_INTERVAL === 0) {
          await yieldToEventLoop();
        }
      }

      // Добавления и модификации
      for (const filePath of currentFiles) {
        checkAbort(signal);

        if (++reconcileChecks % SYNC_YIELD_INTERVAL === 0) {
          await yieldToEventLoop();
        }

        const fullPath = path.join(this.projectRoot, filePath);
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
      filesChecked,
      filesAdded,
      filesModified,
      filesRemoved,
      nodesUpdated,
      durationMs: Date.now() - startTime,
      changedFilePaths: changedFilePaths.length > 0 ? changedFilePaths : undefined,
    };
  }

  /**
   * Разрешение кросс-файловых ссылок.
   *
   * Забирает неразрешённые ссылки из БД, пытается разрешить их
   * по имени, квалифицированному имени и виду узла, создаёт рёбра
   * для разрешённых и оставляет неразрешённые.
   */
  async resolveReferences(): Promise<IResolutionResult> {
    const { onProgress, signal } = this.options;
    const resolved: IResolvedRef[] = [];
    const unresolved: IUnresolvedReference[] = [];

    onProgress?.({ phase: 'resolving', current: 0, total: 0 });

    // Получаем все неразрешённые ссылки
    const allRefs = this.db.getUnresolvedReferences();
    const total = allRefs.length;

    onProgress?.({ phase: 'resolving', current: 0, total });

    for (let i = 0; i < allRefs.length; i++) {
      checkAbort(signal);

      const ref = allRefs[i];
      onProgress?.({ phase: 'resolving', current: i + 1, total });

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
            provenance: 'resolver',
          });

          resolved.push({
            fromNodeId: ref.fromNodeId,
            toNodeId: best.id,
            referenceKind: edgeKind,
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
          provenance: 'resolver',
        });

        resolved.push({
          fromNodeId: ref.fromNodeId,
          toNodeId: best.id,
          referenceKind: edgeKind,
        });

        this.db.deleteUnresolvedByNode(ref.fromNodeId);
        continue;
      }

      // Не удалось разрешить
      unresolved.push(ref);
    }

    onProgress?.({ phase: 'resolving', current: total, total });

    return { resolved, unresolved };
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
    const result = extractor.extract(filePath, content, frameworkNames);
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
  private storeExtractionResult(
    filePath: string,
    content: string,
    language: string,
    stats: fs.Stats,
    result: IExtractionResult,
  ): void {
    const contentHash = hashContent(content);

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
      (n) => n.id && n.kind && n.name && n.filePath && n.language,
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
            source: e.source,
            target: newTargetId,
            kind: e.kind,
            metadata: e.metadata,
            line: e.line,
            column: e.column,
            provenance: e.provenance,
          });
        }
      }

      if (reinserted.length > 0) {
        this.db.insertEdges(reinserted);
      }
    }

    // 9. Вставка неразрешённых ссылок пакетом
    const unresolvedRefs = result.unresolvedReferences ?? result.unresolvedRefs ?? [];
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
    const fileRecord: IFileRecord = {
      path: filePath,
      contentHash,
      language,
      size: stats.size,
      modifiedAt: stats.mtimeMs,
      indexedAt: Date.now(),
      nodeCount: result.nodes.length,
      errors: result.errors.length > 0 ? result.errors : undefined,
    };

    this.db.upsertFile(fileRecord);
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

    const fullPath = path.join(this.projectRoot, filePath);

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

    const frameworkNames = this.options.frameworkNames ?? this.detectedFrameworks ?? undefined;

    try {
      const result = this.extractFile(filePath, content, language, frameworkNames);

      if (result.nodes.length > 0 || result.errors.length === 0) {
        this.storeExtractionResult(filePath, content, language, stats, result);
      }
    } catch {
      // Ошибка парсинга — пропускаем файл
    }
  }

  /**
   * Обнаружение фреймворков в проекте.
   */
  private async detectFrameworksInternal(): Promise<string[]> {
    if (this.detectedFrameworks) return this.detectedFrameworks;

    try {
      this.detectedFrameworks = await detectFrameworks(this.projectRoot);
    } catch {
      this.detectedFrameworks = [];
    }

    return this.detectedFrameworks;
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
    const byLang = candidates.filter((c) => ref.language && c.language === ref.language);
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
    filesSkipped: number,
    filesErrored: number,
    totalNodes: number,
    totalEdges: number,
    errors: IExtractionError[],
  ): IIndexResult {
    return {
      success: false,
      filesIndexed,
      filesSkipped,
      filesErrored,
      nodesCreated: totalNodes,
      edgesCreated: totalEdges,
      errors: [{ message: 'Операция отменена', severity: 'error', filePath: '', code: 'read_error' }, ...errors],
      durationMs: Date.now() - startTime,
    };
  }
}
