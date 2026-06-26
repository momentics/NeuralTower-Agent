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
  NodeKind,
  EdgeKind,
  DATABASE_FILENAME,
  SQLITE_PARAM_CHUNK_SIZE,
} from './Types';
import {
  deriveProjectNameTokens,
  normalizePath,
  getDatabasePath,
  FileLock,
  processInBatches,
  Mutex,
} from './Utils';

/** Параметры инициализации. */
export interface InitOptions {
  projectRoot: string;
  dbPath?: string;
}

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

  constructor(dbPath: string) {
    this._dbPath = dbPath;
    this._projectRoot = path.dirname(dbPath);
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
    this._db.close();
  }

  /** Лёгкое обслуживание после пакетных записей: PRAGMA optimize + wal_checkpoint(PASSIVE). Ошибки тихо проглатываются. */
  runMaintenance(): void {
    this._db.runMaintenance();
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
    if (!acquired) throw new Error('Failed to acquire file lock');
    try {
      this._qb.insertNode(node);
    } finally {
      this._fileLock.release();
    }
  }

  insertNodes(nodes: INode[]): void {
    this._qb.insertNodes(nodes);
  }

  /** Пакетная вставка узлов с FileLock, Mutex и разбиением на чанки. */
  // TODO: Подключить MemoryMonitor для проверки памяти между батчами индексации.
  // Пример: const monitor = new MemoryMonitor(threshold, () => /* GC / пауза */);
  //         monitor.check() в onBatchComplete callback processInBatches.
  async insertNodesBatch(nodes: INode[]): Promise<void> {
    const acquired = await this._fileLock.acquire();
    if (!acquired) throw new Error('Failed to acquire file lock');
    try {
      await this._mutex.withLock(async () => {
        await processInBatches(nodes, SQLITE_PARAM_CHUNK_SIZE, async (batch) => {
          this._qb.insertNodes(batch);
        });
      });
    } finally {
      this._fileLock.release();
    }
  }

  async updateNode(node: INode): Promise<void> {
    const acquired = await this._fileLock.acquire();
    if (!acquired) throw new Error('Failed to acquire file lock');
    try {
      this._qb.updateNode(node);
    } finally {
      this._fileLock.release();
    }
  }

  async deleteNode(id: string): Promise<void> {
    const acquired = await this._fileLock.acquire();
    if (!acquired) throw new Error('Failed to acquire file lock');
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

  getNodesByIds(ids: readonly string[]): INode[] {
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

  getDominantFile(): IDominantFile | null {
    return this._qb.getDominantFile();
  }

  getTopRouteFile(): INode | null {
    return this._qb.getTopRouteFile();
  }

  getRoutingManifest(limit?: number): INode[] {
    return this._qb.getRoutingManifest(limit);
  }

  getDependentFilePaths(filePath: string): string[] {
    return this._qb.getDependentFilePaths(filePath);
  }

  getDependencyFilePaths(filePath: string): string[] {
    return this._qb.getDependencyFilePaths(filePath);
  }

  getCrossFileIncomingEdgesWithTarget(filePath: string): Array<{ edge: IEdge; targetKind: NodeKind; targetName: string }> {
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
    if (!acquired) throw new Error('Failed to acquire file lock');
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
    if (!acquired) throw new Error('Failed to acquire file lock');
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

  getOutgoingEdges(sourceId: string, kinds?: EdgeKind[], provenance?: string): IEdge[] {
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
    if (!acquired) throw new Error('Failed to acquire file lock');
    try {
      this._qb.upsertFile(file);
    } finally {
      this._fileLock.release();
    }
  }

  async deleteFile(filePath: string): Promise<void> {
    const acquired = await this._fileLock.acquire();
    if (!acquired) throw new Error('Failed to acquire file lock');
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

  getStaleFiles(currentHashes?: Map<string, string>): IFileRecord[] {
    return this._qb.getStaleFiles(currentHashes);
  }

  getAllFilePaths(): string[] {
    return this._qb.getAllFilePaths();
  }

  getAllNodeNames(): string[] {
    return this._qb.getAllNodeNames();
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

  getUnresolvedReferencesByFiles(filePaths: string[]): IUnresolvedReference[] {
    return this._qb.getUnresolvedReferencesByFiles(filePaths);
  }

  clearUnresolvedReferences(): void {
    this._qb.clearUnresolvedReferences();
  }

  deleteResolvedReferences(fromNodeIds: string[]): void {
    this._qb.deleteResolvedReferences(fromNodeIds);
  }

  deleteSpecificResolvedReferences(refs: Array<{ fromNodeId: string; referenceName: string; referenceKind: string }>): number {
    return this._qb.deleteSpecificResolvedReferences(refs);
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

  getAllMetadata(): Map<string, string> {
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

// =============================================================================
// Re-exports from Types
// =============================================================================

export {
  // Interfaces
  INode, IEdge, IFileRecord, IUnresolvedReference, ISearchOptions,
  ISearchResult, IGraphStats, IDominantFile, IExtractionResult,
  IExtractionError, ISubgraph, Context, CodeBlock, TaskInput,
  BuildContextOptions, TaskContext, FindRelevantContextOptions,
  ParsedQuery, TraversalOptions, IIndexProgress, IIndexResult,
  ISyncResult, IResolutionContext, IResolvedRef, IResolutionResult,
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
  LRU_CACHE_SIZE, GENERATED_PATTERNS, MAX_FILE_SIZE, WORKER_RECYCLE_INTERVAL,
  PARSE_TIMEOUT_MS, PARSE_TIMEOUT_PER_10KB, FILE_IO_BATCH_SIZE,
  SCAN_YIELD_INTERVAL, SYNC_YIELD_INTERVAL, SYNC_RECONCILE_YIELD_INTERVAL,
  EMBEDDED_REPO_SEARCH_DEPTH, EMBEDDED_REPO_SEARCH_ENTRIES,
  DEFAULT_IGNORE_DIRS, DEFAULT_IGNORE_PATTERNS,
  // Classes
  ScopeIgnore,
} from './Types';

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
  // Query parser
  parseQuery,
  // File classifiers
  isTestFile, isGeneratedFile, isDistinctiveIdentifier, isConfigLeafNode,
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
