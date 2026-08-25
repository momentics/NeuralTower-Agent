/**
 * NtGraphDb — главный класс модуля.
 *
 * Инициализация, PRAGMA в строгом порядке, CRUD через QueryBuilder,
 * поиск через FtsSearch, аналитика, размер БД.
 */

import { SqliteDatabase } from './Adapter';
import { createDatabase } from './Adapter';
import { QueryBuilder } from './QueryBuilder';
import { FtsSearch } from './FtsSearch';
import { applyMigrations, needsMigration, getMigrationHistory, CURRENT_SCHEMA_VERSION } from './Migration';
import * as fs from 'fs';
import * as path from 'path';
import {
  INode,
  IEdge,
  IFileRecord,
  IUnresolvedReference,
  ISearchOptions,
  ISearchResult,
  IGraphStats,
  IDominantFile,
  ITopRouteFile,
  IRoutingManifest,
  IRoutingManifestEntry,
  NodeKind,
  EdgeKind,
  DATABASE_FILENAME,
  SQLITE_PARAM_CHUNK_SIZE,
} from './Types';
import { EXTRACTION_VERSION } from '../extraction/ExtractionVersion';
import { WalCheckpointValve } from './WalValve';
import {
  deriveProjectNameTokens,
  normalizePath,
  getDatabasePath,
  FileLock,
  processInBatches,
  Mutex,
  MemoryMonitor,
} from './Utils';

/** Параметры инициализации. */
export interface InitOptions {
  projectRoot: string;
  dbPath?: string;
}

/** Имя директории графовой БД проекта. */
export const NTGRAPH_DIR_NAME = '.ntgraph';

/**
 * Главный класс модуля NtGraphDb.
 *
 * PRAGMA порядок:
 * 1. busy_timeout=5000
 * 2. foreign_keys=ON
 * 3. journal_mode=WAL
 * 4. synchronous=NORMAL
 * 5. cache_size=-64000
 * 6. temp_store=MEMORY
 * 7. mmap_size=268435456
 */
export class NtGraphDb {
  private _db!: SqliteDatabase;
  private _qb!: QueryBuilder;
  private _ftsSearch!: FtsSearch;
  private _projectRoot: string;
  private _projectNameTokens: Set<string>;
  private _dbPath: string;
  private _fileLock!: FileLock;
  private _mutex = new Mutex();
  private _walValve: WalCheckpointValve | null = null;

  constructor(dbPath: string, projectRoot?: string) {
    this._dbPath = dbPath;
    // Если БД лежит в поддиректории (например, .ntgraph/), корень проекта
    // передаётся явно; иначе — родительская директория файла БД.
    this._projectRoot = projectRoot ?? path.dirname(dbPath);
    this._projectNameTokens = deriveProjectNameTokens(this._projectRoot);
    this._fileLock = new FileLock(dbPath);
  }

  /** Инициализация с настройкой PRAGMA. */
  initialize(): void {
    const { db } = createDatabase(this._dbPath);
    this._db = db;

    // PRAGMA в строгом порядке
    this.applyPragmas();

    // Создаём таблицу schema_versions до проверки миграций
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_versions (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL,
        description TEXT
      )
    `);

    // Миграции
    if (needsMigration(db)) {
      applyMigrations(db);
    }

    this._qb = new QueryBuilder(db);
    this._qb.setProjectNameTokens(this._projectNameTokens);
    this._ftsSearch = new FtsSearch(db);
    this._ftsSearch.setProjectNameTokens(this._projectNameTokens);
  }

  /** Закрытие БД. */
  close(): void {
    if (this._db.open) {
      this._db.close();
    }
  }

  /** Лёгкое обслуживание после пакетных записей: PRAGMA optimize + wal_checkpoint(PASSIVE). Ошибки тихо проглатываются. */
  runMaintenance(): void {
    this._db.runMaintenance();
  }

  /** Включает WAL-клапан для массовой индексации. */
  enableWalValve(verbose?: boolean): void {
    this._walValve = new WalCheckpointValve(
      this._db,
      undefined,
      undefined,
      verbose ? (m: string) => console.log(`[WAL] ${m}`) : undefined
    );
    this._walValve.start();
  }

  /** Отключает WAL-клапан. */
  disableWalValve(): void {
    this._walValve?.stop();
    this._walValve = null;
  }

  /** Принудительный чекпоинт WAL между фазами. */
  async foldWalNow(): Promise<void> {
    if (this._walValve) {
      await this._walValve.foldNow();
    }
  }

  /** Применяет PRAGMA в строгом порядке. */
  private applyPragmas(): void {
    this._db.pragma('busy_timeout = 5000');
    this._db.pragma('foreign_keys = ON');
    this._db.pragma('journal_mode = WAL');
    this._db.pragma('synchronous = NORMAL');
    this._db.pragma('cache_size = -64000');
    this._db.pragma('temp_store = MEMORY');
    this._db.pragma('mmap_size = 268435456');
  }

  /** Размер БД в байтах. */
  getSize(): number {
    try {
      const stats = fs.statSync(this._dbPath);
      return stats.size;
    } catch {
      return 0;
    }
  }

  /** Статистика графа. */
  getStats(): IGraphStats & { dbSizeBytes: number } {
    const base = this._qb.getStats();
    return {
      ...base,
      dbSizeBytes: this.getSize(),
    };
  }

  // ===================================================================
  // Узлы
  // ===================================================================

  async insertNode(node: INode): Promise<void> {
    const acquired = await this._fileLock.acquire();
    if (!acquired) throw new Error('Не удалось захватить файловую блокировку');
    try {
      this._qb.insertNode(node);
    } finally {
      this._fileLock.release();
    }
  }

  insertNodes(nodes: INode[]): void {
    this._qb.insertNodes(nodes);
  }

  /** Пакетная вставка узлов с FileLock, Mutex, MemoryMonitor и разбиением на чанки. */
  async insertNodesBatch(nodes: INode[]): Promise<void> {
    const acquired = await this._fileLock.acquire();
    if (!acquired) throw new Error('Не удалось захватить файловую блокировку');
    try {
      const monitor = new MemoryMonitor(512 * 1024 * 1024, () => {
        global.gc?.();
      });
      await this._mutex.withLock(async () => {
        await processInBatches(nodes, SQLITE_PARAM_CHUNK_SIZE, async (batch) => {
          this._qb.insertNodes(batch);
        }, () => {
          monitor.check();
        });
      });
    } finally {
      this._fileLock.release();
    }
  }

  async updateNode(node: INode): Promise<void> {
    const acquired = await this._fileLock.acquire();
    if (!acquired) throw new Error('Не удалось захватить файловую блокировку');
    try {
      this._qb.updateNode(node);
    } finally {
      this._fileLock.release();
    }
  }

  async deleteNode(id: string): Promise<void> {
    const acquired = await this._fileLock.acquire();
    if (!acquired) throw new Error('Не удалось захватить файловую блокировку');
    try {
      this._qb.deleteNode(id);
    } finally {
      this._fileLock.release();
    }
  }

  deleteNodesByFile(filePath: string): number {
    return this._qb.deleteNodesByFile(filePath);
  }

  getNodeById(id: string): INode | null {
    return this._qb.getNodeById(id);
  }

  getNodesByIds(ids: readonly string[]): Map<string, INode> {
    return this._qb.getNodesByIds(ids);
  }

  getNodesByFile(filePath: string): INode[] {
    return this._qb.getNodesByFile(filePath);
  }

  getNodesByKind(kind: NodeKind): INode[] {
    return this._qb.getNodesByKind(kind);
  }

  *iterateNodesByKind(kind: NodeKind): IterableIterator<INode> {
    yield* this._qb.iterateNodesByKind(kind);
  }

  *iterateNodesByLanguageWithDecorator(language: string, decorator: string): IterableIterator<INode> {
    yield* this._qb.iterateNodesByLanguageWithDecorator(language, decorator);
  }

  getAllNodes(): INode[] {
    return this._qb.getAllNodes();
  }

  getNodesByName(name: string): INode[] {
    return this._qb.getNodesByName(name);
  }

  getNodesByQualifiedNameExact(qualifiedName: string): INode[] {
    return this._qb.getNodesByQualifiedNameExact(qualifiedName);
  }

  getNodesByLowerName(lowerName: string): INode[] {
    return this._qb.getNodesByLowerName(lowerName);
  }

  getNodesByNamePrefix(prefix: string, limit?: number): INode[] {
    return this._qb.getNodesByNamePrefix(prefix, limit);
  }

  getDominantFile(): IDominantFile | null {
    return this._qb.getDominantFile();
  }

  getTopRouteFile(): ITopRouteFile | null {
    return this._qb.getTopRouteFile();
  }

  getRoutingManifest(limit?: number): IRoutingManifest | null {
    return this._qb.getRoutingManifest(limit);
  }

  getDependentFilePaths(filePath: string): string[] {
    return this._qb.getDependentFilePaths(filePath);
  }

  getDependencyFilePaths(filePath: string): string[] {
    return this._qb.getDependencyFilePaths(filePath);
  }

  getCrossFileIncomingEdgesWithTarget(filePath: string): Array<{ edge: IEdge; targetKind: NodeKind; targetName: string; sourceFilePath: string; sourceLanguage: string }> {
    return this._qb.getCrossFileIncomingEdgesWithTarget(filePath);
  }

  findEdgesBetweenNodes(nodeIds: string[], kinds?: EdgeKind[]): IEdge[] {
    return this._qb.findEdgesBetweenNodes(nodeIds, kinds);
  }

  // ===================================================================
  // Рёбра
  // ===================================================================

  async insertEdge(edge: IEdge): Promise<void> {
    const acquired = await this._fileLock.acquire();
    if (!acquired) throw new Error('Не удалось захватить файловую блокировку');
    try {
      this._qb.insertEdge(edge);
    } finally {
      this._fileLock.release();
    }
  }

  insertEdges(edges: IEdge[]): void {
    this._qb.insertEdges(edges);
  }

  /** Пакетная вставка рёбер с FileLock, Mutex и разбиением на чанки. */
  async insertEdgesBatch(edges: IEdge[]): Promise<void> {
    const acquired = await this._fileLock.acquire();
    if (!acquired) throw new Error('Не удалось захватить файловую блокировку');
    try {
      await this._mutex.withLock(async () => {
        await processInBatches(edges, SQLITE_PARAM_CHUNK_SIZE, async (batch) => {
          this._qb.insertEdges(batch);
        });
      });
    } finally {
      this._fileLock.release();
    }
  }

  deleteEdgesBySource(sourceId: string): number {
    return this._qb.deleteEdgesBySource(sourceId);
  }

  deleteEdgesByTarget(targetId: string): number {
    return this._qb.deleteEdgesByTarget(targetId);
  }

  getOutgoingEdges(sourceId: string, kinds?: EdgeKind[], provenance?: IEdge['provenance']): IEdge[] {
    return this._qb.getOutgoingEdges(sourceId, kinds, provenance);
  }

  getIncomingEdges(targetId: string, kinds?: EdgeKind[]): IEdge[] {
    return this._qb.getIncomingEdges(targetId, kinds);
  }

  // ===================================================================
  // Файлы
  // ===================================================================

  async upsertFile(file: IFileRecord): Promise<void> {
    const acquired = await this._fileLock.acquire();
    if (!acquired) throw new Error('Не удалось захватить файловую блокировку');
    try {
      this._qb.upsertFile(file);
    } finally {
      this._fileLock.release();
    }
  }

  async deleteFile(filePath: string): Promise<void> {
    const acquired = await this._fileLock.acquire();
    if (!acquired) throw new Error('Не удалось захватить файловую блокировку');
    try {
      await this._mutex.withLock(async () => {
        this._qb.deleteFile(filePath);
      });
    } finally {
      this._fileLock.release();
    }
  }

  getFileByPath(filePath: string): IFileRecord | null {
    return this._qb.getFileByPath(filePath);
  }

  getAllFiles(): IFileRecord[] {
    return this._qb.getAllFiles();
  }

  getLastIndexedAt(): number | null {
    return this._qb.getLastIndexedAt();
  }

  getStaleFiles(currentHashes: Map<string, string>): IFileRecord[] {
    return this._qb.getStaleFiles(currentHashes);
  }

  getAllFilePaths(): string[] {
    return this._qb.getAllFilePaths();
  }

  getAllNodeNames(): string[] {
    return this._qb.getAllNodeNames();
  }

  getDistinctFileLanguages(): Set<string> {
    return this._qb.getDistinctFileLanguages();
  }

  /** Хранение пакета файла: узлы, рёбра, ссылки, запись файла — одна транзакция. */
  storeFileBundle(bundle: { nodes: INode[]; edges: IEdge[]; refs: IUnresolvedReference[]; file: IFileRecord }): void {
    this._qb.storeFileBundle(bundle);
  }

  /** Очищает словарь сегментов имён. */
  clearNameSegmentVocab(): void {
    this._qb.clearNameSegmentVocab();
  }

  /** Проверяет, пуст ли словарь сегментов имён. */
  isNameSegmentVocabEmpty(): boolean {
    return this._qb.isNameSegmentVocabEmpty();
  }

  /** Страница отличных имён сегментируемых узлов для пакетной перестройки словаря. */
  getDistinctNodeNames(limit: number, offset: number): string[] {
    return this._qb.getDistinctNodeNames(limit, offset);
  }

  /** Вставка сегментов для пакета имён в одной транзакции. */
  insertNameSegmentsBatch(names: string[]): void {
    this._qb.insertNameSegmentsBatch(names);
  }

  /**
   * Имена, чьи сегменты покрывают не менее `minWords` различных ключевых слов —
   * проверка совместного вхождения.
   */
  getSegmentCoOccurrence(
    variants: Array<{ segment: string; word: string }>,
    minWords: number,
    limit: number
  ): Array<{ name: string; matches: number }> {
    return this._qb.getSegmentCoOccurrence(variants, minWords, limit);
  }

  /** Сколько отличных имён содержит каждый сегмент. */
  getSegmentNameCounts(segments: string[]): Map<string, number> {
    return this._qb.getSegmentNameCounts(segments);
  }

  /** Имена, содержащие заданный сегмент. */
  getNamesForSegment(segment: string, limit: number): string[] {
    return this._qb.getNamesForSegment(segment, limit);
  }

  // ===================================================================
  // Неразрешённые ссылки
  // ===================================================================

  insertUnresolvedRef(ref: IUnresolvedReference): void {
    this._qb.insertUnresolvedRef(ref);
  }

  insertUnresolvedRefsBatch(refs: IUnresolvedReference[]): void {
    this._qb.insertUnresolvedRefsBatch(refs);
  }

  deleteUnresolvedByNode(nodeId: string): void {
    this._qb.deleteUnresolvedByNode(nodeId);
  }

  getUnresolvedByName(name: string): IUnresolvedReference[] {
    return this._qb.getUnresolvedByName(name);
  }

  getUnresolvedReferences(): IUnresolvedReference[] {
    return this._qb.getUnresolvedReferences();
  }

  getUnresolvedReferencesCount(): number {
    return this._qb.getUnresolvedReferencesCount();
  }

  getUnresolvedReferencesBatch(offset: number, limit: number): IUnresolvedReference[] {
    return this._qb.getUnresolvedReferencesBatch(offset, limit);
  }

  /** Пагинированный запрос неразрешённых ссылок по keyset (rowid > afterRowId). */
  getUnresolvedReferencesBatchAfter(afterRowId: number, limit: number): IUnresolvedReference[] {
    return this._qb.getUnresolvedReferencesBatchAfter(afterRowId, limit);
  }

  getUnresolvedReferencesByFiles(filePaths: string[]): IUnresolvedReference[] {
    return this._qb.getUnresolvedReferencesByFiles(filePaths);
  }

  clearUnresolvedReferences(): void {
    this._qb.clearUnresolvedReferences();
  }

  deleteResolvedReferences(fromNodeIds: string[]): void {
    this._qb.deleteResolvedReferences(fromNodeIds);
  }

  deleteSpecificResolvedReferences(refs: IUnresolvedReference[]): number {
    return this._qb.deleteSpecificResolvedReferences(refs);
  }

  markReferencesFailed(refs: IUnresolvedReference[]): number {
    return this._qb.markReferencesFailed(refs);
  }

  markReferencesFailedByRowIds(refs: Array<{ rowId: number; nameTail: string }>): number {
    return this._qb.markReferencesFailedByRowIds(refs);
  }

  getRetryableFailedReferences(names: string[], perNameCeiling?: number): IUnresolvedReference[] {
    return this._qb.getRetryableFailedReferences(names, perNameCeiling);
  }

  deleteReferencesByRowIds(rowIds: number[]): number {
    return this._qb.deleteReferencesByRowIds(rowIds);
  }

  getNodeNamesByFiles(filePaths: string[]): string[] {
    return this._qb.getNodeNamesByFiles(filePaths);
  }

  // ===================================================================
  // Поиск
  // ===================================================================

  search(query: string, options: ISearchOptions = {}): ISearchResult[] {
    return this._qb.searchNodes(query, options);
  }

  findNodesByExactName(names: string[], options: ISearchOptions = {}): ISearchResult[] {
    return this._qb.findNodesByExactName(names, options);
  }

  findNodesByNameSubstring(
    substring: string,
    options: ISearchOptions & { excludePrefix?: boolean } = {}
  ): ISearchResult[] {
    return this._qb.findNodesByNameSubstring(substring, options);
  }

  /** Возвращает экземпляр FtsSearch для прямого использования. */
  getFtsSearch(): FtsSearch {
    return this._ftsSearch;
  }

  // ===================================================================
  // Метаданные
  // ===================================================================

  getMetadata(key: string): string | null {
    return this._qb.getMetadata(key);
  }

  setMetadata(key: string, value: string): void {
    this._qb.setMetadata(key, value);
  }

  getAllMetadata(): Record<string, string> {
    return this._qb.getAllMetadata();
  }

  // ===================================================================
  // Аналитика
  // ===================================================================

  getNodeAndEdgeCount(): { nodeCount: number; edgeCount: number } {
    return this._qb.getNodeAndEdgeCount();
  }

  // ===================================================================
  // Утилиты
  // ===================================================================

  clear(): void {
    this._qb.clear();
  }

  clearCache(): void {
    this._qb.clearCache();
  }

/** Возвращает QueryBuilder для прямого доступа. */
  get queryBuilder(): QueryBuilder {
    return this._qb;
  }

  /** Возвращает SqliteDatabase для прямого доступа. */
  getDatabase(): SqliteDatabase {
    return this._db;
  }

  /** Текущая версия схемы. */
  getSchemaVersion(): number {
    return CURRENT_SCHEMA_VERSION;
  }

  /** Проверяет, требуется ли повторная индексация из-за изменения версии экстракции. */
  needsReindex(): boolean {
    const stored = this.getMetadata('extraction_version');
    return stored !== String(EXTRACTION_VERSION);
  }

  /** История миграций. */
  getMigrationHistory(): { version: number; description: string; appliedAt: number }[] {
    return getMigrationHistory(this._db);
  }

  /** Корень проекта. */
  getProjectRoot(): string {
    return this._projectRoot;
  }

  /** Токены имени проекта. */
  getProjectNameTokens(): string[] {
    return Array.from(this._projectNameTokens);
  }
}

/**
 * Путь к директории графовой БД проекта (.ntgraph).
 */
export function getNtGraphDirPath(projectRoot: string): string {
  return path.join(projectRoot, NTGRAPH_DIR_NAME);
}

/**
 * Путь к файлу графовой БД проекта (.ntgraph/ntgraph.db).
 */
export function getNtGraphDbPath(projectRoot: string): string {
  return path.join(projectRoot, NTGRAPH_DIR_NAME, DATABASE_FILENAME);
}

/**
 * Открывает (или создаёт) графовую БД проекта в директории .ntgraph.
 *
 * Создаёт директории при необходимости, применяет PRAGMA и миграции.
 * Корень проекта передаётся явно, чтобы он не совпадал с директорией БД.
 */
export function openProjectGraphDb(projectRoot: string): NtGraphDb {
  const dir = getNtGraphDirPath(projectRoot);
  fs.mkdirSync(dir, { recursive: true });
  const db = new NtGraphDb(path.join(dir, DATABASE_FILENAME), projectRoot);
  db.initialize();
  return db;
}

// =============================================================================
// Re-exports from Types
// =============================================================================

export {
  // Interfaces
  INode, IEdge, IFileRecord, IUnresolvedReference, ISearchOptions,
  ISearchResult, IGraphStats, IDominantFile, ITopRouteFile, IRoutingManifestEntry, IExtractionResult,
  IExtractionError, ISubgraph, Context, CodeBlock, TaskInput,
  BuildContextOptions, TaskContext, FindRelevantContextOptions,
  ParsedQuery, ITraversalOptions, IIndexProgress, IIndexResult,
  ISyncResult, IGraphQueryContext, IFileContext, IResolutionContext, IResolvedRef, IResolutionResult,
  IReExport, IAliasMap, IGoModule, IWorkspacePackages,
  IImportMapping, IFrameworkResolver, ISchemaVersion,
  // Types
  NodeKind, EdgeKind, Language, ReferenceKind,
  // Constants
  FTS_LIMIT_MIN, FTS_OVER_FETCH_MULTIPLIER, FILTER_ONLY_OVER_FETCH_MULTIPLIER,
  EXACT_MATCH_SUPPLEMENT_LIMIT, FUZZY_MAX_DIST_SHORT, FUZZY_MAX_DIST_DEFAULT,
  DOMINANT_FILE_EDGE_THRESHOLD, TOP_ROUTE_MIN_TOTAL, TOP_ROUTE_MIN_CONCENTRATION,
  ROUTING_MANIFEST_DEFAULT_LIMIT, CONFIG_LEAF_LANGUAGES, SENSITIVE_PATHS,
  FileLock_STALE_TIMEOUT_MS, DATABASE_FILENAME, SQLITE_PARAM_CHUNK_SIZE,
  LRU_CACHE_SIZE, MAX_FILE_SIZE, WORKER_RECYCLE_INTERVAL,
  PARSE_TIMEOUT_MS, PARSE_TIMEOUT_PER_10KB, FILE_IO_BATCH_SIZE,
  SCAN_YIELD_INTERVAL, SYNC_YIELD_INTERVAL, SYNC_RECONCILE_YIELD_INTERVAL,
  EMBEDDED_REPO_SEARCH_DEPTH, EMBEDDED_REPO_SEARCH_ENTRIES,
  DEFAULT_IGNORE_DIRS, DEFAULT_IGNORE_PATTERNS,
  // Classes
  ScopeIgnore,
} from './Types';

// =============================================================================
// Re-exports from QueryBuilder
// =============================================================================

export { QueryBuilder } from './QueryBuilder';

// =============================================================================
// Re-exports from Adapter
// =============================================================================

export { SqliteDatabase, SqliteStatement, createDatabase } from './Adapter';

// =============================================================================
// Re-exports from Migration
// =============================================================================

export {
  applyMigrations,
  needsMigration,
  getMigrationHistory,
  CURRENT_SCHEMA_VERSION,
  Migration,
} from './Migration';

// =============================================================================
// Re-exports from Utils
// =============================================================================

export {
  // Converters
  rowToNode, rowToEdge, rowToFileRecord, safeJsonParse,
  // String utils
  normalizeNameToken, deriveProjectNameTokens, getStemVariants,
  extractSearchTerms, unquote, boundedEditDistance,
  // Search
  kindBonus, nameMatchBonus, scorePathRelevance, isLowValueFile,
  // Path proximity
  pathProximityFromDirs, computePathProximity, findBestMatch, splitCamelCase,
  // Query parser
  parseQuery,
  // File classifiers
  isTestFile, isDistinctiveIdentifier, isConfigLeafNode,
  // Path safety
  isWithinDir, validatePathWithinRoot, validateProjectPath,
  // Paths
  normalizePath, getDatabasePath,
  // Numeric
  clamp,
  // Async utils
  processInBatches, Mutex, FileLock, readFileInChunks,
  debounce, throttle,
  // Memory
  estimateSize, MemoryMonitor,
} from './Utils';
export { isGeneratedFile } from '../extraction/GeneratedDetection';
