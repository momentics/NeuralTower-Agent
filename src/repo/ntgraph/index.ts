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
} from './Types';
import {
  deriveProjectNameTokens,
  normalizePath,
  getDatabasePath,
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
  private db: SqliteDatabase;
  private qb: QueryBuilder;
  private ftsSearch: FtsSearch;
  private projectRoot: string;
  private projectNameTokens: Set<string>;
  private _dbPath: string;

  constructor(db: SqliteDatabase, projectRoot: string, dbPath?: string) {
    this.db = db;
    this.projectRoot = projectRoot;
    this._dbPath = dbPath ?? getDatabasePath(projectRoot);
    this.projectNameTokens = deriveProjectNameTokens(projectRoot);
    this.qb = new QueryBuilder(db);
    this.qb.setProjectNameTokens(this.projectNameTokens);
    this.ftsSearch = new FtsSearch(db);
    this.ftsSearch.setProjectNameTokens(this.projectNameTokens);
  }

  /** Инициализация с настройкой PRAGMA. */
  static initialize(options: InitOptions): NtGraphDb {
    const { projectRoot, dbPath } = options;
    const resolvedPath = dbPath ?? getDatabasePath(projectRoot);

    const { db } = createDatabase(resolvedPath);

    const instance = new NtGraphDb(db, projectRoot, resolvedPath);

    // PRAGMA в строгом порядке
    instance.applyPragmas();

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

    return instance;
  }

  /** Открытие существующей БД. */
  static open(options: InitOptions): NtGraphDb {
    const { projectRoot, dbPath } = options;
    const resolvedPath = dbPath ?? getDatabasePath(projectRoot);

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`База данных не найдена: ${resolvedPath}`);
    }

    const { db } = createDatabase(resolvedPath);

    const instance = new NtGraphDb(db, projectRoot, resolvedPath);

    // PRAGMA в строгом порядке
    instance.applyPragmas();

    // Создаём таблицу schema_versions до проверки миграций
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_versions (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL,
        description TEXT
      )
    `);

    // Миграции (если схема устарела)
    if (needsMigration(db)) {
      applyMigrations(db);
    }

    return instance;
  }

  /** Закрытие БД. */
  close(): void {
    this.db.close();
  }

  /** Лёгкое обслуживание после пакетных записей: PRAGMA optimize + wal_checkpoint(PASSIVE). Ошибки тихо проглатываются. */
  runMaintenance(): void {
    this.db.runMaintenance();
  }

  /** Применяет PRAGMA в строгом порядке. */
  private applyPragmas(): void {
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = -64000');
    this.db.pragma('temp_store = MEMORY');
    this.db.pragma('mmap_size = 268435456');
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
  getStats(): IGraphStats {
    const base = this.qb.getStats();
    return {
      ...base,
      dbSizeBytes: this.getSize(),
    };
  }

  // ===================================================================
  // Узлы
  // ===================================================================

  insertNode(node: INode): void {
    this.qb.insertNode(node);
  }

  insertNodes(nodes: INode[]): void {
    this.qb.insertNodes(nodes);
  }

  updateNode(node: INode): void {
    this.qb.updateNode(node);
  }

  deleteNode(id: string): void {
    this.qb.deleteNode(id);
  }

  deleteNodesByFile(filePath: string): number {
    return this.qb.deleteNodesByFile(filePath);
  }

  getNodeById(id: string): INode | null {
    return this.qb.getNodeById(id);
  }

  getNodesByIds(ids: readonly string[]): Map<string, INode> {
    return this.qb.getNodesByIds(ids);
  }

  getNodesByFile(filePath: string): INode[] {
    return this.qb.getNodesByFile(filePath);
  }

  getNodesByKind(kind: NodeKind): INode[] {
    return this.qb.getNodesByKind(kind);
  }

  *iterateNodesByKind(kind: NodeKind): IterableIterator<INode> {
    yield* this.qb.iterateNodesByKind(kind);
  }

  getAllNodes(): INode[] {
    return this.qb.getAllNodes();
  }

  getNodesByName(name: string): INode[] {
    return this.qb.getNodesByName(name);
  }

  getNodesByQualifiedNameExact(qualifiedName: string): INode[] {
    return this.qb.getNodesByQualifiedNameExact(qualifiedName);
  }

  getNodesByLowerName(lowerName: string): INode[] {
    return this.qb.getNodesByLowerName(lowerName);
  }

  getDominantFile(): IDominantFile | null {
    return this.qb.getDominantFile();
  }

  getTopRouteFile(): { filePath: string; routeCount: number; totalRoutes: number } | null {
    return this.qb.getTopRouteFile();
  }

  getRoutingManifest(limit?: number): {
    entries: Array<{ url: string; handler: string; handlerFile: string; handlerLine: number; handlerKind: string }>;
    topHandlerFile: string | null;
    topHandlerFileCount: number;
    totalRoutes: number;
  } | null {
    return this.qb.getRoutingManifest(limit);
  }

  getDependentFilePaths(filePath: string): string[] {
    return this.qb.getDependentFilePaths(filePath);
  }

  getDependencyFilePaths(filePath: string): string[] {
    return this.qb.getDependencyFilePaths(filePath);
  }

  getCrossFileIncomingEdgesWithTarget(filePath: string): Array<IEdge & { targetName: string; targetKind: NodeKind }> {
    return this.qb.getCrossFileIncomingEdgesWithTarget(filePath);
  }

  findEdgesBetweenNodes(nodeIds: string[], kinds?: EdgeKind[]): IEdge[] {
    return this.qb.findEdgesBetweenNodes(nodeIds, kinds);
  }

  // ===================================================================
  // Рёбра
  // ===================================================================

  insertEdge(edge: IEdge): void {
    this.qb.insertEdge(edge);
  }

  insertEdges(edges: IEdge[]): void {
    this.qb.insertEdges(edges);
  }

  deleteEdgesBySource(sourceId: string): number {
    return this.qb.deleteEdgesBySource(sourceId);
  }

  deleteEdgesByTarget(targetId: string): number {
    return this.qb.deleteEdgesByTarget(targetId);
  }

  getOutgoingEdges(sourceId: string, kinds?: EdgeKind[], provenance?: string): IEdge[] {
    return this.qb.getOutgoingEdges(sourceId, kinds, provenance);
  }

  getIncomingEdges(targetId: string, kinds?: EdgeKind[]): IEdge[] {
    return this.qb.getIncomingEdges(targetId, kinds);
  }

  // ===================================================================
  // Файлы
  // ===================================================================

  upsertFile(file: IFileRecord): void {
    this.qb.upsertFile(file);
  }

  deleteFile(filePath: string): void {
    this.qb.deleteFile(filePath);
  }

  getFileByPath(filePath: string): IFileRecord | null {
    return this.qb.getFileByPath(filePath);
  }

  getAllFiles(): IFileRecord[] {
    return this.qb.getAllFiles();
  }

  getLastIndexedAt(): number | null {
    return this.qb.getLastIndexedAt();
  }

  getStaleFiles(): IFileRecord[] {
    return this.qb.getStaleFiles();
  }

  getAllFilePaths(): string[] {
    return this.qb.getAllFilePaths();
  }

  getAllNodeNames(): string[] {
    return this.qb.getAllNodeNames();
  }

  // ===================================================================
  // Неразрешённые ссылки
  // ===================================================================

  insertUnresolvedRef(ref: IUnresolvedReference): void {
    this.qb.insertUnresolvedRef(ref);
  }

  insertUnresolvedRefsBatch(refs: IUnresolvedReference[]): void {
    this.qb.insertUnresolvedRefsBatch(refs);
  }

  deleteUnresolvedByNode(nodeId: string): void {
    this.qb.deleteUnresolvedByNode(nodeId);
  }

  getUnresolvedByName(name: string): IUnresolvedReference[] {
    return this.qb.getUnresolvedByName(name);
  }

  getUnresolvedReferences(): IUnresolvedReference[] {
    return this.qb.getUnresolvedReferences();
  }

  getUnresolvedReferencesCount(): number {
    return this.qb.getUnresolvedReferencesCount();
  }

  getUnresolvedReferencesBatch(offset: number, limit: number): IUnresolvedReference[] {
    return this.qb.getUnresolvedReferencesBatch(offset, limit);
  }

  getUnresolvedReferencesByFiles(filePaths: string[]): IUnresolvedReference[] {
    return this.qb.getUnresolvedReferencesByFiles(filePaths);
  }

  clearUnresolvedReferences(): void {
    this.qb.clearUnresolvedReferences();
  }

  deleteResolvedReferences(fromNodeIds: string[]): void {
    this.qb.deleteResolvedReferences(fromNodeIds);
  }

  deleteSpecificResolvedReferences(refs: Array<{ fromNodeId: string; referenceName: string; referenceKind: string }>): number {
    return this.qb.deleteSpecificResolvedReferences(refs);
  }

  // ===================================================================
  // Поиск
  // ===================================================================

  search(query: string, options: ISearchOptions = {}): ISearchResult[] {
    return this.qb.searchNodes(query, options);
  }

  findNodesByExactName(names: string[], options: ISearchOptions = {}): ISearchResult[] {
    return this.qb.findNodesByExactName(names, options);
  }

  findNodesByNameSubstring(
    substring: string,
    options: ISearchOptions & { excludePrefix?: boolean } = {}
  ): ISearchResult[] {
    return this.qb.findNodesByNameSubstring(substring, options);
  }

  /** Возвращает экземпляр FtsSearch для прямого использования. */
  getFtsSearch(): FtsSearch {
    return this.ftsSearch;
  }

  // ===================================================================
  // Метаданные
  // ===================================================================

  getMetadata(key: string): string | null {
    return this.qb.getMetadata(key);
  }

  setMetadata(key: string, value: string): void {
    this.qb.setMetadata(key, value);
  }

  getAllMetadata(): Map<string, string> {
    return this.qb.getAllMetadata();
  }

  // ===================================================================
  // Аналитика
  // ===================================================================

  getNodeAndEdgeCount(): { nodes: number; edges: number } {
    return this.qb.getNodeAndEdgeCount();
  }

  // ===================================================================
  // Утилиты
  // ===================================================================

  clear(): void {
    this.qb.clear();
  }

  clearCache(): void {
    this.qb.clearCache();
  }

  /** Возвращает QueryBuilder для прямого доступа. */
  getQueryBuilder(): QueryBuilder {
    return this.qb;
  }

  /** Возвращает SqliteDatabase для прямого доступа. */
  getDatabase(): SqliteDatabase {
    return this.db;
  }

  /** Текущая версия схемы. */
  getSchemaVersion(): number {
    return CURRENT_SCHEMA_VERSION;
  }

  /** История миграций. */
  getMigrationHistory(): { version: number; description: string; appliedAt: number }[] {
    return getMigrationHistory(this.db);
  }

  /** Корень проекта. */
  getProjectRoot(): string {
    return this.projectRoot;
  }

  /** Токены имени проекта. */
  getProjectNameTokens(): string[] {
    return Array.from(this.projectNameTokens);
  }
}
