/**
 * QueryBuilder — CRUD, поиск, аналитика, LRU-кэш, batch.
 *
 * Prepared statements инициализируются лениво. LRU-кэш узлов — 1000 записей.
 * Batch-запросы — чанки по 500 (SQLITE_PARAM_CHUNK_SIZE).
 */

import { SqliteDatabase, SqliteStatement } from './Adapter';
import {
  NodeKind,
  EdgeKind,
  Language,
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
} from './Types';
import {
  rowToNode,
  rowToEdge,
  rowToFileRecord,
  safeJsonParse,
  isLowValueFile,
  parseQuery,
  splitIdentifierSegments,
} from './Utils';
import {
  DOMINANT_FILE_EDGE_THRESHOLD,
  TOP_ROUTE_MIN_TOTAL,
  TOP_ROUTE_MIN_CONCENTRATION,
  ROUTING_MANIFEST_DEFAULT_LIMIT,
  SQLITE_PARAM_CHUNK_SIZE,
  LRU_CACHE_SIZE,
  FILTER_ONLY_OVER_FETCH_MULTIPLIER,
} from './Types';
import { FtsSearch } from './FtsSearch';
import { LRUCache } from './LruCache';

// =============================================================================
// Типы строк БД
// =============================================================================

interface NodeRow {
  id: string;
  kind: string;
  name: string;
  qualified_name: string;
  file_path: string;
  language: string;
  start_line: number;
  end_line: number;
  start_column: number;
  end_column: number;
  docstring: string | null;
  signature: string | null;
  visibility: string | null;
  is_exported: number;
  is_async: number;
  is_static: number;
  is_abstract: number;
  decorators: string | null;
  type_parameters: string | null;
  return_type: string | null;
  updated_at: number;
}

interface EdgeRow {
  id: number;
  source: string;
  target: string;
  kind: string;
  metadata: string | null;
  line: number | null;
  col: number | null;
  provenance: string | null;
}

interface FileRow {
  path: string;
  content_hash: string;
  language: string;
  size: number;
  modified_at: number;
  indexed_at: number;
  node_count: number;
  errors: string | null;
}

interface UnresolvedRefRow {
  id: number;
  from_node_id: string;
  reference_name: string;
  reference_kind: string;
  line: number;
  col: number;
  candidates: string | null;
  file_path: string;
  language: string;
  status: string;
  name_tail: string;
}

// =============================================================================
// QueryBuilder
// =============================================================================

export class QueryBuilder {
  private db: SqliteDatabase;

  // Токены имени проекта для подавления недискриминативных слов в поиске
  private projectNameTokens: Set<string> = new Set();

  // LRU-кэш узлов (макс 1000 записей)
  private nodeCache: LRUCache<string, INode>;

  // Prepared statements (ленивая инициализация)
  private stmts: {
    insertNode?: SqliteStatement;
    updateNode?: SqliteStatement;
    deleteNode?: SqliteStatement;
    deleteNodesByFile?: SqliteStatement;
    deleteEdgesByFile?: SqliteStatement;
    getNodeById?: SqliteStatement;
    getNodesByFile?: SqliteStatement;
    getNodesByKind?: SqliteStatement;
    insertEdge?: SqliteStatement;
    upsertFile?: SqliteStatement;
    deleteEdgesBySource?: SqliteStatement;
    deleteEdgesByTarget?: SqliteStatement;
    getEdgesBySource?: SqliteStatement;
    getEdgesByTarget?: SqliteStatement;
    deleteFile?: SqliteStatement;
    getFileByPath?: SqliteStatement;
    getAllFiles?: SqliteStatement;
    insertUnresolved?: SqliteStatement;
    deleteUnresolvedByNode?: SqliteStatement;
    getUnresolvedByName?: SqliteStatement;
    getNodesByName?: SqliteStatement;
    getNodesByNamePrefix?: SqliteStatement;
    getNodesByQualifiedNameExact?: SqliteStatement;
    getNodesByLowerName?: SqliteStatement;
    getUnresolvedCount?: SqliteStatement;
    getUnresolvedBatch?: SqliteStatement;
    getUnresolvedBatchAfter?: SqliteStatement;
    getAllFilePaths?: SqliteStatement;
    getAllNodeNames?: SqliteStatement;
    getDominantFile?: SqliteStatement;
    getTopRouteFile?: SqliteStatement;
  } = {};

  /** Размеры батчей для многострочных INSERT — кэширует prepared statements по размеру. */
  private static readonly BATCH_SIZES: readonly number[] = [128, 32, 8, 1];

  /** Кэш prepared statements для многострочных INSERT (по ключу kind:size). */
  private batchStmts: Map<string, SqliteStatement> = new Map();

  /** Имена узлов, сегменты которых уже вставлены в словарь — ускорение write-path. */
  private segmentedNames: Set<string> = new Set();
  private static readonly MAX_SEGMENTED_NAMES = 65536;

  constructor(db: SqliteDatabase) {
    this.db = db;
    this.nodeCache = new LRUCache<string, INode>(LRU_CACHE_SIZE);
  }

  /**
   * Выполняет N строк через многострочный INSERT вида head + (tuple,)*n,
   * разбивая на фиксированные батчи. Сохраняет порядок строк.
   */
  private runBatched(kind: string, head: string, tuple: string, rows: unknown[][]): void {
    if (rows.length === 0) return;
    let i = 0;
    for (const size of QueryBuilder.BATCH_SIZES) {
      while (rows.length - i >= size) {
        const key = `${kind}:${size}`;
        let stmt = this.batchStmts.get(key);
        if (!stmt) {
          stmt = this.db.prepare(head + new Array(size).fill(tuple).join(','));
          this.batchStmts.set(key, stmt);
        }
        if (size === 1) {
          stmt.run(...rows[i]!);
        } else {
          const params: unknown[] = [];
          for (let r = 0; r < size; r++) {
            const row = rows[i + r]!;
            for (let c = 0; c < row.length; c++) params.push(row[c]);
          }
          stmt.run(...params);
        }
        i += size;
      }
    }
  }

  /** Устанавливает токены имени проекта для подавления в поиске. */
  setProjectNameTokens(tokens: Set<string>): void {
    this.projectNameTokens = tokens;
  }

  /** Возвращает токены имени проекта. */
  getProjectNameTokens(): string[] {
    return Array.from(this.projectNameTokens);
  }

  /** Возвращает экземпляр FtsSearch. */
  getFtsSearch(): FtsSearch {
    if (!this._ftsSearch) {
      this._ftsSearch = new FtsSearch(this.db);
      this._ftsSearch.setProjectNameTokens(this.projectNameTokens);
    }
    return this._ftsSearch;
  }

  private _ftsSearch: FtsSearch | null = null;

  /**
   * Заменяет подключение к БД и сбрасывает prepared statements.
   * Используется воркерами пула для переработки соединений: соединение
   * закрывается и открывается заново на границе простоя пула, всё, что выше
   * подключения (QueryBuilder, resolver, кэши) сохраняется, а состояние,
   * зависящее от соединения (prepared statements), сбрасывается и
   * переподготавливается лениво при следующем использовании.
   */
  rebind(db: SqliteDatabase): void {
    this.db = db;
    this.stmts = {};
    this.batchStmts.clear();
  }

  // ===================================================================
  // Узлы
  // ===================================================================

  /** Вставка узла (INSERT OR REPLACE — идемпотентный upsert). */
  insertNode(node: INode): void {
    if (!this.stmts.insertNode) {
      this.stmts.insertNode = this.db.prepare(`
        INSERT OR REPLACE INTO nodes (
          id, kind, name, qualified_name, file_path, language,
          start_line, end_line, start_column, end_column,
          docstring, signature, visibility,
          is_exported, is_async, is_static, is_abstract,
          decorators, type_parameters, return_type, updated_at
        ) VALUES (
          @id, @kind, @name, @qualifiedName, @filePath, @language,
          @startLine, @endLine, @startColumn, @endColumn,
          @docstring, @signature, @visibility,
          @isExported, @isAsync, @isStatic, @isAbstract,
          @decorators, @typeParameters, @returnType, @updatedAt
        )
      `);
    }

    // Валидация обязательных полей
    if (!node.id || !node.kind || !node.name || !node.filePath || !node.language) {
      console.error('[NtGraph] Пропущен узел с отсутствующими обязательными полями:', {
        id: node.id,
        kind: node.kind,
        name: node.name,
        filePath: node.filePath,
        language: node.language,
      });
      return;
    }

    // Удаление устаревшей записи из кэша
    this.nodeCache.delete(node.id);

    this.stmts.insertNode.run({
      id: node.id,
      kind: node.kind,
      name: node.name,
      qualifiedName: node.qualifiedName ?? node.name,
      filePath: node.filePath,
      language: node.language,
      startLine: node.startLine ?? 0,
      endLine: node.endLine ?? 0,
      startColumn: node.startColumn ?? 0,
      endColumn: node.endColumn ?? 0,
      docstring: node.docstring ?? null,
      signature: node.signature ?? null,
      visibility: node.visibility ?? null,
      isExported: node.isExported ? 1 : 0,
      isAsync: node.isAsync ? 1 : 0,
      isStatic: node.isStatic ? 1 : 0,
      isAbstract: node.isAbstract ? 1 : 0,
      decorators: node.decorators ? JSON.stringify(node.decorators) : null,
      typeParameters: node.typeParameters ? JSON.stringify(node.typeParameters) : null,
      returnType: node.returnType ?? null,
      updatedAt: node.updatedAt ?? Date.now(),
    });

    if (this.isSegmentableKind(node.kind)) {
      const rows: unknown[][] = [];
      this.collectNameSegmentRows(node.name, rows);
      this.runBatched(
        'insertNameSegments',
        'INSERT OR IGNORE INTO name_segment_vocab (segment, name) VALUES ',
        '(?,?)',
        rows
      );
    }
  }

  /** Вставка множества узлов в транзакции (bulk через runBatched). */
  insertNodes(nodes: INode[]): void {
    if (nodes.length === 0) return;
    this.db.transaction(() => {
      const rows: unknown[][] = [];
      for (const node of nodes) {
        // Валидация обязательных полей
        if (!node.id || !node.kind || !node.name || !node.filePath || !node.language) {
          console.error('[NtGraph] Пропущен узел с отсутствующими обязательными полями:', {
            id: node.id,
            kind: node.kind,
            name: node.name,
            filePath: node.filePath,
            language: node.language,
          });
          continue;
        }
        // Удаление устаревшей записи из кэша
        this.nodeCache.delete(node.id);
        rows.push([
          node.id,
          node.kind,
          node.name,
          node.qualifiedName ?? node.name,
          node.filePath,
          node.language,
          node.startLine ?? 0,
          node.endLine ?? 0,
          node.startColumn ?? 0,
          node.endColumn ?? 0,
          node.docstring ?? null,
          node.signature ?? null,
          node.visibility ?? null,
          node.isExported ? 1 : 0,
          node.isAsync ? 1 : 0,
          node.isStatic ? 1 : 0,
          node.isAbstract ? 1 : 0,
          node.decorators ? JSON.stringify(node.decorators) : null,
          node.typeParameters ? JSON.stringify(node.typeParameters) : null,
          node.returnType ?? null,
          node.updatedAt ?? Date.now(),
        ]);
      }
      const nodeCols = 'id, kind, name, qualified_name, file_path, language, start_line, end_line, start_column, end_column, docstring, signature, visibility, is_exported, is_async, is_static, is_abstract, decorators, type_parameters, return_type, updated_at';
      const nodeTuple = `(${new Array(21).fill('?').join(',')})`;
      this.runBatched('insertNode', `INSERT OR REPLACE INTO nodes (${nodeCols}) VALUES `, nodeTuple, rows);
      this.insertNameSegmentVocab(nodes);
    })();
  }

  /** Какие виды узлов вносят имя в словарь сегментов — file и import исключены. */
  public isSegmentableKind(kind: NodeKind): boolean {
    return kind !== 'file' && kind !== 'import';
  }

  /** Собирает строки сегментов имени для пакетной вставки. */
  private collectNameSegmentRows(name: string, out: unknown[][]): void {
    if (this.segmentedNames.has(name)) return;
    if (this.segmentedNames.size >= QueryBuilder.MAX_SEGMENTED_NAMES) this.segmentedNames.clear();
    this.segmentedNames.add(name);
    for (const segment of splitIdentifierSegments(name)) out.push([segment, name]);
  }

  /** Вставка сегментов имён в словарь (bulk через runBatched). */
  private insertNameSegmentVocab(nodes: INode[]): void {
    const segmentRows: unknown[][] = [];
    for (const node of nodes) {
      if (!this.isSegmentableKind(node.kind)) continue;
      this.collectNameSegmentRows(node.name, segmentRows);
    }
    this.runBatched(
      'insertNameSegments',
      'INSERT OR IGNORE INTO name_segment_vocab (segment, name) VALUES ',
      '(?,?)',
      segmentRows
    );
  }

  /** Удаление сегментов имён для узлов файла. */
  private deleteNameSegmentVocabByFile(filePath: string): void {
    const nodes = this.getNodesByFile(filePath);
    if (nodes.length === 0) return;
    const names = new Set(nodes.map(n => n.name));
    const stmt = this.db.prepare('DELETE FROM name_segment_vocab WHERE name = ?');
    for (const name of names) {
      stmt.run(name);
    }
  }

  /** Очищает словарь сегментов имён. */
  clearNameSegmentVocab(): void {
    this.db.exec('DELETE FROM name_segment_vocab');
    this.segmentedNames.clear();
  }

  /** Проверяет, пуст ли словарь сегментов имён. */
  isNameSegmentVocabEmpty(): boolean {
    const row = this.db.prepare('SELECT 1 FROM name_segment_vocab LIMIT 1').get();
    return row === undefined;
  }

  /** Страница отличных имён сегментируемых узлов для пакетной перестройки словаря. */
  getDistinctNodeNames(limit: number, offset: number): string[] {
    const rows = this.db
      .prepare("SELECT DISTINCT name FROM nodes WHERE kind NOT IN ('file', 'import') ORDER BY name LIMIT ? OFFSET ?")
      .all(limit, offset) as Array<{ name: string }>;
    return rows.map((r) => r.name);
  }

  /** Вставка сегментов для пакета имён в одной транзакции (путь восстановления словаря). */
  insertNameSegmentsBatch(names: string[]): void {
    this.db.transaction(() => {
      const rows: unknown[][] = [];
      for (const name of names) {
        this.collectNameSegmentRows(name, rows);
      }
      this.runBatched(
        'insertNameSegments',
        'INSERT OR IGNORE INTO name_segment_vocab (segment, name) VALUES ',
        '(?,?)',
        rows
      );
    })();
  }

  /**
   * Имена, чьи сегменты покрывают не менее `minWords` различных ключевых слов —
   * проверка совместного вхождения для среднего уровня prompt hook.
   * Словари (вариант → исходное слово) сворачиваются к слову внутри SQL:
   * имя, совпадающее и с `service`, и с `services`, считается ОДНИМ словом.
   */
  getSegmentCoOccurrence(
    variants: Array<{ segment: string; word: string }>,
    minWords: number,
    limit: number
  ): Array<{ name: string; matches: number }> {
    if (variants.length === 0) return [];
    const placeholders = variants.map(() => '?').join(', ');
    const whens = variants.map(() => 'WHEN ? THEN ?').join(' ');
    const rows = this.db
      .prepare(
        `SELECT name, COUNT(DISTINCT CASE segment ${whens} END) AS matches
         FROM name_segment_vocab
         WHERE segment IN (${placeholders})
         GROUP BY name
         HAVING matches >= ?
         ORDER BY matches DESC, length(name) ASC
         LIMIT ?`
      )
      .all(
        ...variants.flatMap((v) => [v.segment, v.word]),
        ...variants.map((v) => v.segment),
        minWords,
        limit
      ) as Array<{ name: string; matches: number }>;
    return rows;
  }

  /** Сколько отличных имён содержит каждый сегмент — сигнал редкости. */
  getSegmentNameCounts(segments: string[]): Map<string, number> {
    if (segments.length === 0) return new Map();
    const placeholders = segments.map(() => '?').join(', ');
    const rows = this.db
      .prepare(
        `SELECT segment, COUNT(*) AS n FROM name_segment_vocab
         WHERE segment IN (${placeholders}) GROUP BY segment`
      )
      .all(...segments) as Array<{ segment: string; n: number }>;
    return new Map(rows.map((r) => [r.segment, r.n]));
  }

  /** Имена, содержащие заданный сегмент (уровень редкого одиночного слова). */
  getNamesForSegment(segment: string, limit: number): string[] {
    const rows = this.db
      .prepare('SELECT name FROM name_segment_vocab WHERE segment = ? ORDER BY length(name) ASC LIMIT ?')
      .all(segment, limit) as Array<{ name: string }>;
    return rows.map((r) => r.name);
  }

  /** Обновление узла. */
  updateNode(node: INode): void {
    if (!this.stmts.updateNode) {
      this.stmts.updateNode = this.db.prepare(`
        UPDATE nodes SET
          kind = @kind,
          name = @name,
          qualified_name = @qualifiedName,
          file_path = @filePath,
          language = @language,
          start_line = @startLine,
          end_line = @endLine,
          start_column = @startColumn,
          end_column = @endColumn,
          docstring = @docstring,
          signature = @signature,
          visibility = @visibility,
          is_exported = @isExported,
          is_async = @isAsync,
          is_static = @isStatic,
          is_abstract = @isAbstract,
          decorators = @decorators,
          type_parameters = @typeParameters,
          return_type = @returnType,
          updated_at = @updatedAt
        WHERE id = @id
      `);
    }

    this.nodeCache.delete(node.id);

    if (!node.id || !node.kind || !node.name || !node.filePath || !node.language) {
      console.error('[NtGraph] Пропущено обновление узла с отсутствующими полями:', node.id);
      return;
    }

    this.stmts.updateNode.run({
      id: node.id,
      kind: node.kind,
      name: node.name,
      qualifiedName: node.qualifiedName ?? node.name,
      filePath: node.filePath,
      language: node.language,
      startLine: node.startLine ?? 0,
      endLine: node.endLine ?? 0,
      startColumn: node.startColumn ?? 0,
      endColumn: node.endColumn ?? 0,
      docstring: node.docstring ?? null,
      signature: node.signature ?? null,
      visibility: node.visibility ?? null,
      isExported: node.isExported ? 1 : 0,
      isAsync: node.isAsync ? 1 : 0,
      isStatic: node.isStatic ? 1 : 0,
      isAbstract: node.isAbstract ? 1 : 0,
      decorators: node.decorators ? JSON.stringify(node.decorators) : null,
      typeParameters: node.typeParameters ? JSON.stringify(node.typeParameters) : null,
      returnType: node.returnType ?? null,
      updatedAt: node.updatedAt ?? Date.now(),
    });

    if (this.isSegmentableKind(node.kind)) {
      const rows: unknown[][] = [];
      this.collectNameSegmentRows(node.name, rows);
      this.runBatched(
        'insertNameSegments',
        'INSERT OR IGNORE INTO name_segment_vocab (segment, name) VALUES ',
        '(?,?)',
        rows
      );
    }
  }

  /** Удаление узла по ID. */
  deleteNode(id: string): void {
    if (!this.stmts.deleteNode) {
      this.stmts.deleteNode = this.db.prepare('DELETE FROM nodes WHERE id = ?');
    }
    this.nodeCache.delete(id);
    this.stmts.deleteNode.run(id);
  }

  /** Удаление всех узлов файла и связанных рёбер. */
  deleteNodesByFile(filePath: string): number {
    // Сначала удаляем сегменты — ДО удаления узлов
    this.deleteNameSegmentVocabByFile(filePath);

    // Сначала удаляем все рёбра, где источник или цель — один из удаляемых узлов
    if (!this.stmts.deleteEdgesByFile) {
      this.stmts.deleteEdgesByFile = this.db.prepare(
        'DELETE FROM edges WHERE source IN (SELECT id FROM nodes WHERE file_path = ?) OR target IN (SELECT id FROM nodes WHERE file_path = ?)'
      );
    }
    this.stmts.deleteEdgesByFile.run(filePath, filePath);

    if (!this.stmts.deleteNodesByFile) {
      this.stmts.deleteNodesByFile = this.db.prepare('DELETE FROM nodes WHERE file_path = ?');
    }
    // Инвалидация кэша для узлов этого файла
    const cacheStore = (this.nodeCache as any).store as Map<string, INode>;
    for (const [id, node] of cacheStore) {
      if (node.filePath === filePath) {
        this.nodeCache.delete(id);
      }
    }
    const result = this.stmts.deleteNodesByFile.run(filePath);
    return result.changes;
  }

  /** Получение узла по ID (с LRU-кэшем). */
  getNodeById(id: string): INode | null {
    // Проверка кэша (LRUCache.get автоматически обновляет порядок)
    const cached = this.nodeCache.get(id);
    if (cached !== undefined) return cached;

    if (!this.stmts.getNodeById) {
      this.stmts.getNodeById = this.db.prepare('SELECT * FROM nodes WHERE id = ?');
    }
    const row = this.stmts.getNodeById.get(id) as NodeRow | undefined;
    if (!row) return null;

    const node = rowToNode(row);
    this.cacheNode(node);
    return node;
  }
 /** Пакетный поиск узлов по ID (устраняет паттерн N+1). */
  getNodesByIds(ids: readonly string[]): Map<string, INode> {
    const out = new Map<string, INode>();

    if (ids.length === 0) return out;

    // Кэш-хиты (LRUCache.get автоматически обновляет порядок)
    const misses: string[] = [];
    for (const id of ids) {
      const cached = this.nodeCache.get(id);
      if (cached !== undefined) {
        out.set(id, cached);
      } else {
        misses.push(id);
      }
    }
    if (misses.length === 0) return out;

    // Чанки по 500
    for (let i = 0; i < misses.length; i += SQLITE_PARAM_CHUNK_SIZE) {
      const chunk = misses.slice(i, i + SQLITE_PARAM_CHUNK_SIZE);
      const placeholders = chunk.map(() => '?').join(',');
      const rows = this.db
        .prepare(`SELECT * FROM nodes WHERE id IN (${placeholders})`)
        .all(...chunk) as NodeRow[];
      for (const row of rows) {
        const node = rowToNode(row);
        out.set(node.id, node);
        this.cacheNode(node);
      }
    }
    return out;
  }

  /** Получение существующих ID узлов (для валидации рёбер). */
  getExistingNodeIds(ids: string[]): Set<string> {
    const out = new Set<string>();
    if (ids.length === 0) return out;

    const uniqueIds = [...new Set(ids)];
    for (let i = 0; i < uniqueIds.length; i += SQLITE_PARAM_CHUNK_SIZE) {
      const chunk = uniqueIds.slice(i, i + SQLITE_PARAM_CHUNK_SIZE);
      const placeholders = chunk.map(() => '?').join(',');
      const rows = this.db
        .prepare(`SELECT id FROM nodes WHERE id IN (${placeholders})`)
        .all(...chunk) as { id: string }[];
      for (const row of rows) {
        out.add(row.id);
      }
    }
    return out;
  }

  /** Добавление узла в кэш с вытеснением старейшего. */
  private cacheNode(node: INode): void {
    this.nodeCache.set(node.id, node);
  }

  /** Очистка LRU-кэша. */
  clearCache(): void {
    this.nodeCache.clear();
  }

  /** Все узлы файла. */
  getNodesByFile(filePath: string): INode[] {
    if (!this.stmts.getNodesByFile) {
      this.stmts.getNodesByFile = this.db.prepare(
        'SELECT * FROM nodes WHERE file_path = ? ORDER BY start_line'
      );
    }
    const rows = this.stmts.getNodesByFile.all(filePath) as NodeRow[];
    return rows.map(rowToNode);
  }

  /** Все узлы заданного вида. */
  getNodesByKind(kind: NodeKind): INode[] {
    if (!this.stmts.getNodesByKind) {
      this.stmts.getNodesByKind = this.db.prepare('SELECT * FROM nodes WHERE kind = ?');
    }
    const rows = this.stmts.getNodesByKind.all(kind) as NodeRow[];
    return rows.map(rowToNode);
  }

  /** Ленивый итератор по узлам вида (O(1) память). */
  *iterateNodesByKind(kind: NodeKind): IterableIterator<INode> {
    const stmt = this.db.prepare('SELECT * FROM nodes WHERE kind = ?');
    for (const row of stmt.iterate(kind)) {
      yield rowToNode(row as NodeRow);
    }
  }

  /** Ленивый итератор по узлам с заданным языком и декоратором (O(1) память). */
  *iterateNodesByLanguageWithDecorator(language: string, decorator: string): IterableIterator<INode> {
    const stmt = this.db.prepare(
      "SELECT * FROM nodes WHERE language = ? AND decorators LIKE '%' || ? || '%'"
    );
    for (const row of stmt.iterate(language, `"${decorator}"`)) {
      yield rowToNode(row as NodeRow);
    }
  }

  /** Все узлы БД. */
  getAllNodes(): INode[] {
    const rows = this.db.prepare('SELECT * FROM nodes').all() as NodeRow[];
    return rows.map(rowToNode);
  }

  /** Узлы по точному имени. */
  getNodesByName(name: string): INode[] {
    if (!this.stmts.getNodesByName) {
      this.stmts.getNodesByName = this.db.prepare('SELECT * FROM nodes WHERE name = ?');
    }
    const rows = this.stmts.getNodesByName.all(name) as NodeRow[];
    return rows.map(rowToNode);
  }

  /** Узлы по префиксу имени — range scan по idx_nodes_name. */
  getNodesByNamePrefix(prefix: string, limit: number = 20): INode[] {
    if (!this.stmts.getNodesByNamePrefix) {
      this.stmts.getNodesByNamePrefix = this.db.prepare(
        'SELECT * FROM nodes WHERE name >= ? AND name < ? ORDER BY name LIMIT ?'
      );
    }
    const rows = this.stmts.getNodesByNamePrefix.all(prefix, prefix + '\uffff', limit) as NodeRow[];
    return rows.map(rowToNode);
  }

  /** Узлы по точному квалифицированному имени. */
  getNodesByQualifiedNameExact(qualifiedName: string): INode[] {
    if (!this.stmts.getNodesByQualifiedNameExact) {
      this.stmts.getNodesByQualifiedNameExact = this.db.prepare(
        'SELECT * FROM nodes WHERE qualified_name = ?'
      );
    }
    const rows = this.stmts.getNodesByQualifiedNameExact.all(qualifiedName) as NodeRow[];
    return rows.map(rowToNode);
  }

  /** Узлы по нижнему регистру имени. */
  getNodesByLowerName(lowerName: string): INode[] {
    if (!this.stmts.getNodesByLowerName) {
      this.stmts.getNodesByLowerName = this.db.prepare(
        'SELECT * FROM nodes WHERE lower(name) = ?'
      );
    }
    const rows = this.stmts.getNodesByLowerName.all(lowerName) as NodeRow[];
    return rows.map(rowToNode);
  }

  /** Доминирующий файл — файл с наибольшей концентрацией внутренних рёбер. */
  getDominantFile(): IDominantFile | null {
    if (!this.stmts.getDominantFile) {
      this.stmts.getDominantFile = this.db.prepare(`
        SELECT n.file_path AS file_path, COUNT(*) AS edge_count
        FROM edges e
        JOIN nodes n ON e.source = n.id
        JOIN nodes m ON e.target = m.id
        WHERE n.file_path = m.file_path
        GROUP BY n.file_path
        ORDER BY edge_count DESC
        LIMIT 20
      `);
    }
    const rows = this.stmts.getDominantFile.all() as Array<{ file_path: string; edge_count: number }>;
    const filtered = rows.filter(r => !isLowValueFile(r.file_path));
    if (filtered.length === 0 || filtered[0]!.edge_count < DOMINANT_FILE_EDGE_THRESHOLD) return null;
    return {
      filePath: filtered[0]!.file_path,
      edgeCount: filtered[0]!.edge_count,
      nextEdgeCount: filtered[1]?.edge_count ?? 0,
    };
  }

  /** Файл с наибольшей концентрацией route-узлов. */
  getTopRouteFile(): ITopRouteFile | null {
    if (!this.stmts.getTopRouteFile) {
      this.stmts.getTopRouteFile = this.db.prepare(`
        SELECT file_path, COUNT(*) AS cnt
        FROM nodes
        WHERE kind = 'route'
        GROUP BY file_path
        ORDER BY cnt DESC
        LIMIT 20
      `);
    }
    const rows = this.stmts.getTopRouteFile.all() as Array<{ file_path: string; cnt: number }>;
    const filtered = rows.filter(r => !isLowValueFile(r.file_path));
    if (filtered.length === 0) return null;
    const totalRoutes = filtered.reduce((sum, r) => sum + r.cnt, 0);
    const top = filtered[0]!;
    if (totalRoutes < TOP_ROUTE_MIN_TOTAL || top.cnt < TOP_ROUTE_MIN_TOTAL) return null;
    if (top.cnt / totalRoutes < TOP_ROUTE_MIN_CONCENTRATION) return null;
    return { filePath: top.file_path, routeCount: top.cnt, totalRoutes };
  }

  /** Манифест маршрутизации — route-узлы с обработчиками и статистикой. */
  getRoutingManifest(limit: number = ROUTING_MANIFEST_DEFAULT_LIMIT): IRoutingManifest | null {
    const rows = this.db
      .prepare(`
        SELECT
          r.name AS url,
          h.name AS handler,
          h.file_path AS handler_file,
          h.start_line AS handler_line,
          h.kind AS handler_kind
        FROM nodes r
        JOIN edges e ON e.source = r.id
        JOIN nodes h ON e.target = h.id
        WHERE r.kind = 'route'
          AND e.kind IN ('references', 'calls')
          AND h.kind IN ('function', 'method', 'class')
        ORDER BY r.file_path, r.start_line
        LIMIT ?
      `)
      .all(limit) as Array<{ url: string; handler: string; handler_file: string; handler_line: number; handler_kind: string }>;

    const filtered = rows.filter(r => !isLowValueFile(r.handler_file));
    if (filtered.length < TOP_ROUTE_MIN_TOTAL) return null;

    const fileCounts: Record<string, number> = {};
    for (const r of filtered) {
      fileCounts[r.handler_file] = (fileCounts[r.handler_file] || 0) + 1;
    }

    let topHandlerFile: string | null = null;
    let topHandlerFileCount = 0;
    for (const [file, count] of Object.entries(fileCounts)) {
      if (count > topHandlerFileCount) {
        topHandlerFile = file;
        topHandlerFileCount = count;
      }
    }

    const entries = filtered.map(r => ({
      url: r.url,
      handler: r.handler,
      handlerFile: r.handler_file,
      handlerLine: r.handler_line,
      handlerKind: r.handler_kind,
    }));

    return {
      entries,
      topHandlerFile,
      topHandlerFileCount,
      totalRoutes: filtered.length,
    };
  }

  /** Файлы, зависящие от данного. */
  getDependentFilePaths(filePath: string): string[] {
    const sql = `SELECT DISTINCT src.file_path AS fp
      FROM edges e
      JOIN nodes tgt ON tgt.id = e.target
      JOIN nodes src ON src.id = e.source
      WHERE tgt.file_path = ?
        AND e.kind != 'contains'
        AND src.file_path != ?`;
    const rows = this.db.prepare(sql).all(filePath, filePath) as Array<{ fp: string }>;
    return rows.map((r) => r.fp);
  }

  /** Файлы, от которых зависит данный. */
  getDependencyFilePaths(filePath: string): string[] {
    const sql = `SELECT DISTINCT tgt.file_path AS fp
      FROM edges e
      JOIN nodes src ON src.id = e.source
      JOIN nodes tgt ON tgt.id = e.target
      WHERE src.file_path = ?
        AND e.kind != 'contains'
        AND tgt.file_path != ?`;
    const rows = this.db.prepare(sql).all(filePath, filePath) as Array<{ fp: string }>;
    return rows.map((r) => r.fp);
  }

  /** Входящие межфайловые рёбра с данными о цели и источнике. */
  getCrossFileIncomingEdgesWithTarget(filePath: string): Array<{ edge: IEdge; targetKind: NodeKind; targetName: string; sourceFilePath: string; sourceLanguage: string }> {
    const sql = `SELECT e.*, tgt.name AS target_name, tgt.kind AS target_kind,
      src.file_path AS source_file_path, src.language AS source_language
      FROM edges e
      JOIN nodes tgt ON tgt.id = e.target
      JOIN nodes src ON src.id = e.source
      WHERE tgt.file_path = ?
        AND e.kind != 'contains'
        AND src.file_path != ?`;
    const rows = this.db.prepare(sql).all(filePath, filePath) as Array<EdgeRow & { target_name: string; target_kind: NodeKind; source_file_path: string; source_language: string }>;
    return rows.map(row => ({
      edge: rowToEdge(row),
      targetName: row.target_name,
      targetKind: row.target_kind,
      sourceFilePath: row.source_file_path,
      sourceLanguage: row.source_language,
    }));
  }

  /** Рёбра между заданными узлами. */
  findEdgesBetweenNodes(nodeIds: string[], kinds?: EdgeKind[]): IEdge[] {
    if (nodeIds.length === 0) return [];

    const idsJson = JSON.stringify(nodeIds);
    let sql = `SELECT * FROM edges WHERE source IN (SELECT value FROM json_each(?)) AND target IN (SELECT value FROM json_each(?))`;
    const params: string[] = [idsJson, idsJson];

    if (kinds && kinds.length > 0) {
      sql += ` AND kind IN (${kinds.map(() => '?').join(',')})`;
      params.push(...kinds);
    }

    const rows = this.db.prepare(sql).all(...params) as EdgeRow[];
    return rows.map(rowToEdge);
  }

  // ===================================================================
  // Рёбра
  // ===================================================================

  /** Вставка ребра (INSERT OR IGNORE — дубли тихо пропускаются). */
  insertEdge(edge: IEdge): void {
    if (!this.stmts.insertEdge) {
      this.stmts.insertEdge = this.db.prepare(`
        INSERT OR IGNORE INTO edges (source, target, kind, metadata, line, col, provenance)
        VALUES (@source, @target, @kind, @metadata, @line, @col, @provenance)
      `);
    }

    this.stmts.insertEdge.run({
      source: edge.source,
      target: edge.target,
      kind: edge.kind,
      metadata: edge.metadata ? JSON.stringify(edge.metadata) : null,
      line: edge.line ?? null,
      col: edge.column ?? null,
      provenance: edge.provenance ?? null,
    });
  }

  /** Вставка множества рёбер в транзакции (bulk через runBatched). */
  insertEdges(edges: IEdge[]): void {
    if (edges.length === 0) return;

    this.db.transaction(() => {
      const endpointIds = new Set<string>();
      for (const edge of edges) {
        endpointIds.add(edge.source);
        endpointIds.add(edge.target);
      }
      const existingNodeIds = this.getExistingNodeIds([...endpointIds]);

      const rows: unknown[][] = [];
      for (const edge of edges) {
        if (!existingNodeIds.has(edge.source) || !existingNodeIds.has(edge.target)) {
          continue;
        }
        rows.push([
          edge.source,
          edge.target,
          edge.kind,
          edge.metadata ? JSON.stringify(edge.metadata) : null,
          edge.line ?? null,
          edge.column ?? null,
          edge.provenance ?? null,
        ]);
      }

      const edgeCols = 'source, target, kind, metadata, line, col, provenance';
      const edgeTuple = `(${new Array(7).fill('?').join(',')})`;
      this.runBatched('insertEdge', `INSERT OR IGNORE INTO edges (${edgeCols}) VALUES `, edgeTuple, rows);
    })();
  }

  /** Удаление всех рёбер от источника. */
  deleteEdgesBySource(sourceId: string): number {
    if (!this.stmts.deleteEdgesBySource) {
      this.stmts.deleteEdgesBySource = this.db.prepare('DELETE FROM edges WHERE source = ?');
    }
    const result = this.stmts.deleteEdgesBySource.run(sourceId);
    return result.changes;
  }

  /** Удаление всех рёбер к цели. */
  deleteEdgesByTarget(targetId: string): number {
    if (!this.stmts.deleteEdgesByTarget) {
      this.stmts.deleteEdgesByTarget = this.db.prepare('DELETE FROM edges WHERE target = ?');
    }
    const result = this.stmts.deleteEdgesByTarget.run(targetId);
    return result.changes;
  }

  /** Исходящие рёбра узла. */
  getOutgoingEdges(sourceId: string, kinds?: EdgeKind[], provenance?: IEdge['provenance']): IEdge[] {
    if ((kinds && kinds.length > 0) || provenance) {
      let sql = 'SELECT * FROM edges WHERE source = ?';
      const params: (string | number)[] = [sourceId];

      if (kinds && kinds.length > 0) {
        sql += ` AND kind IN (${kinds.map(() => '?').join(',')})`;
        params.push(...kinds);
      }

      if (provenance) {
        sql += ' AND provenance = ?';
        params.push(provenance);
      }

      const rows = this.db.prepare(sql).all(...params) as EdgeRow[];
      return rows.map(rowToEdge);
    }

    if (!this.stmts.getEdgesBySource) {
      this.stmts.getEdgesBySource = this.db.prepare('SELECT * FROM edges WHERE source = ?');
    }
    const rows = this.stmts.getEdgesBySource.all(sourceId) as EdgeRow[];
    return rows.map(rowToEdge);
  }

  /** Входящие рёбра узла. */
  getIncomingEdges(targetId: string, kinds?: EdgeKind[]): IEdge[] {
    if (kinds && kinds.length > 0) {
      const sql = `SELECT * FROM edges WHERE target = ? AND kind IN (${kinds.map(() => '?').join(',')})`;
      const rows = this.db.prepare(sql).all(targetId, ...kinds) as EdgeRow[];
      return rows.map(rowToEdge);
    }

    if (!this.stmts.getEdgesByTarget) {
      this.stmts.getEdgesByTarget = this.db.prepare('SELECT * FROM edges WHERE target = ?');
    }
    const rows = this.stmts.getEdgesByTarget.all(targetId) as EdgeRow[];
    return rows.map(rowToEdge);
  }

  // ===================================================================
  // Файлы
  // ===================================================================

  /** Upsert файла (ON CONFLICT DO UPDATE). */
  upsertFile(file: IFileRecord): void {
    if (!this.stmts.upsertFile) {
      this.stmts.upsertFile = this.db.prepare(`
        INSERT INTO files (path, content_hash, language, size, modified_at, indexed_at, node_count, errors)
        VALUES (@path, @contentHash, @language, @size, @modifiedAt, @indexedAt, @nodeCount, @errors)
        ON CONFLICT(path) DO UPDATE SET
          content_hash = @contentHash,
          language = @language,
          size = @size,
          modified_at = @modifiedAt,
          indexed_at = @indexedAt,
          node_count = @nodeCount,
          errors = @errors
      `);
    }

    this.stmts.upsertFile.run({
      path: file.path,
      contentHash: file.contentHash,
      language: file.language,
      size: file.size,
      modifiedAt: file.modifiedAt,
      indexedAt: file.indexedAt,
      nodeCount: file.nodeCount,
      errors: file.errors ? JSON.stringify(file.errors) : null,
    });
  }

  /** Удаление файла и его узлов. */
  deleteFile(filePath: string): void {
    this.db.transaction(() => {
      this.deleteNodesByFile(filePath);
      if (!this.stmts.deleteFile) {
        this.stmts.deleteFile = this.db.prepare('DELETE FROM files WHERE path = ?');
      }
      this.stmts.deleteFile.run(filePath);
    })();
  }

  /** Файл по пути. */
  getFileByPath(filePath: string): IFileRecord | null {
    if (!this.stmts.getFileByPath) {
      this.stmts.getFileByPath = this.db.prepare('SELECT * FROM files WHERE path = ?');
    }
    const row = this.stmts.getFileByPath.get(filePath) as FileRow | undefined;
    return row ? rowToFileRecord(row) : null;
  }

  /** Все файлы. */
  getAllFiles(): IFileRecord[] {
    if (!this.stmts.getAllFiles) {
      this.stmts.getAllFiles = this.db.prepare('SELECT * FROM files ORDER BY path');
    }
    const rows = this.stmts.getAllFiles.all() as FileRow[];
    return rows.map(rowToFileRecord);
  }

  /** Последняя метка индексации. */
  getLastIndexedAt(): number | null {
    const row = this.db
      .prepare('SELECT MAX(indexed_at) AS last FROM files')
      .get() as { last: number | null } | undefined;
    return row?.last ?? null;
  }

  /** Устаревшие файлы — только файлы, чей хеш изменился. */
  getStaleFiles(currentHashes: Map<string, string>): IFileRecord[] {
    const files = this.getAllFiles();
    return files.filter((f) => {
      const currentHash = currentHashes.get(f.path);
      return currentHash && currentHash !== f.contentHash;
    });
  }

  /** Все пути файлов (легковесный запрос). */
  getAllFilePaths(): string[] {
    if (!this.stmts.getAllFilePaths) {
      this.stmts.getAllFilePaths = this.db.prepare('SELECT path FROM files ORDER BY path');
    }
    const rows = this.stmts.getAllFilePaths.all() as Array<{ path: string }>;
    return rows.map((r) => r.path);
  }

  /** Отличные языки из таблицы файлов. */
  getDistinctFileLanguages(): Set<string> {
    const rows = this.db.prepare('SELECT DISTINCT language FROM files').all() as Array<{ language: string }>;
    return new Set(rows.map((r) => r.language));
  }

  /** Все имена узлов (легковесный запрос). */
  getAllNodeNames(): string[] {
    if (!this.stmts.getAllNodeNames) {
      this.stmts.getAllNodeNames = this.db.prepare('SELECT DISTINCT name FROM nodes');
    }
    const rows = this.stmts.getAllNodeNames.all() as Array<{ name: string }>;
    return rows.map((r) => r.name);
  }

  /** Ленивый итератор по всем именам узлов. */
  *iterateNodeNames(): IterableIterator<string> {
    const stmt = this.db.prepare('SELECT DISTINCT name FROM nodes');
    for (const row of stmt.iterate()) {
      yield (row as { name: string }).name;
    }
  }

  // ===================================================================
  // Неразрешённые ссылки
  // ===================================================================

  /** Вставка неразрешённой ссылки. */
  insertUnresolvedRef(ref: IUnresolvedReference): void {
    if (!this.stmts.insertUnresolved) {
      this.stmts.insertUnresolved = this.db.prepare(`
        INSERT INTO unresolved_refs (from_node_id, reference_name, reference_kind, line, col, candidates, file_path, language)
        VALUES (@fromNodeId, @referenceName, @referenceKind, @line, @col, @candidates, @filePath, @language)
      `);
    }

    this.stmts.insertUnresolved.run({
      fromNodeId: ref.fromNodeId,
      referenceName: ref.referenceName,
      referenceKind: ref.referenceKind,
      line: ref.line,
      col: ref.column,
      candidates: ref.candidates ? JSON.stringify(ref.candidates) : null,
      filePath: ref.filePath ?? '',
      language: ref.language ?? 'unknown',
    });
  }

  /** Пакетная вставка неразрешённых ссылок (bulk через runBatched). */
  insertUnresolvedRefsBatch(refs: IUnresolvedReference[]): void {
    if (refs.length === 0) return;

    const rows: unknown[][] = [];
    for (const ref of refs) {
      rows.push([
        ref.fromNodeId,
        ref.referenceName,
        ref.referenceKind,
        ref.line,
        ref.column,
        ref.candidates ? JSON.stringify(ref.candidates) : null,
        ref.filePath ?? '',
        ref.language ?? 'unknown',
        ref.status ?? 'pending',
        ref.nameTail ?? '',
      ]);
    }

    const refCols = 'from_node_id, reference_name, reference_kind, line, col, candidates, file_path, language, status, name_tail';
    const refTuple = `(${new Array(10).fill('?').join(',')})`;
    this.runBatched('insertUnresolved', `INSERT INTO unresolved_refs (${refCols}) VALUES `, refTuple, rows);
  }

  /** Удаление неразрешённых ссылок узла. */
  deleteUnresolvedByNode(nodeId: string): void {
    if (!this.stmts.deleteUnresolvedByNode) {
      this.stmts.deleteUnresolvedByNode = this.db.prepare(
        'DELETE FROM unresolved_refs WHERE from_node_id = ?'
      );
    }
    this.stmts.deleteUnresolvedByNode.run(nodeId);
  }

  /** Неразрешённые ссылки по имени. */
  getUnresolvedByName(name: string): IUnresolvedReference[] {
    if (!this.stmts.getUnresolvedByName) {
      this.stmts.getUnresolvedByName = this.db.prepare(
        'SELECT * FROM unresolved_refs WHERE reference_name = ?'
      );
    }
    const rows = this.stmts.getUnresolvedByName.all(name) as UnresolvedRefRow[];
    return rows.map(rowToUnresolvedRef);
  }

  /** Все неразрешённые ссылки. */
  getUnresolvedReferences(): IUnresolvedReference[] {
    const rows = this.db.prepare('SELECT * FROM unresolved_refs').all() as UnresolvedRefRow[];
    return rows.map(rowToUnresolvedRef);
  }

  /** Число неразрешённых ссылок. */
  getUnresolvedReferencesCount(): number {
    if (!this.stmts.getUnresolvedCount) {
      this.stmts.getUnresolvedCount = this.db.prepare(
        "SELECT COUNT(*) as count FROM unresolved_refs WHERE status = 'pending'"
      );
    }
    const row = this.stmts.getUnresolvedCount.get() as { count: number };
    return row.count;
  }

  /** Пагинированный запрос неразрешённых ссылок. */
  getUnresolvedReferencesBatch(offset: number, limit: number): IUnresolvedReference[] {
    if (!this.stmts.getUnresolvedBatch) {
      this.stmts.getUnresolvedBatch = this.db.prepare(
        "SELECT * FROM unresolved_refs WHERE status = 'pending' ORDER BY rowid LIMIT ? OFFSET ?"
      );
    }
    const rows = this.stmts.getUnresolvedBatch.all(limit, offset) as UnresolvedRefRow[];
    return rows.map(rowToUnresolvedRef);
  }

  /** Пагинированный запрос неразрешённых ссылок по keyset (rowid > afterRowId) с фильтром status='pending'. */
  getUnresolvedReferencesBatchAfter(afterRowId: number, limit: number): IUnresolvedReference[] {
    if (!this.stmts.getUnresolvedBatchAfter) {
      this.stmts.getUnresolvedBatchAfter = this.db.prepare(
        "SELECT * FROM unresolved_refs WHERE status = 'pending' AND rowid > ? ORDER BY rowid LIMIT ?"
      );
    }
    const rows = this.stmts.getUnresolvedBatchAfter.all(afterRowId, limit) as UnresolvedRefRow[];
    return rows.map(rowToUnresolvedRef);
  }

  /** Неразрешённые ссылки по путям файлов (с чанкингом). */
  getUnresolvedReferencesByFiles(filePaths: string[]): IUnresolvedReference[] {
    if (filePaths.length === 0) return [];

    const rows: UnresolvedRefRow[] = [];
    for (let i = 0; i < filePaths.length; i += SQLITE_PARAM_CHUNK_SIZE) {
      const chunk = filePaths.slice(i, i + SQLITE_PARAM_CHUNK_SIZE);
      const placeholders = chunk.map(() => '?').join(',');
      const chunkRows = this.db
        .prepare(`SELECT * FROM unresolved_refs WHERE status = 'pending' AND file_path IN (${placeholders})`)
        .all(...chunk) as UnresolvedRefRow[];
      rows.push(...chunkRows);
    }

    return rows.map(rowToUnresolvedRef);
  }

  /** Очистка всех неразрешённых ссылок. */
  clearUnresolvedReferences(): void {
    this.db.exec('DELETE FROM unresolved_refs');
  }

  /** Удаление по ID узлов. */
  deleteResolvedReferences(fromNodeIds: string[]): void {
    if (fromNodeIds.length === 0) return;
    for (let i = 0; i < fromNodeIds.length; i += SQLITE_PARAM_CHUNK_SIZE) {
      const chunk = fromNodeIds.slice(i, i + SQLITE_PARAM_CHUNK_SIZE);
      const placeholders = chunk.map(() => '?').join(',');
      this.db.prepare(`DELETE FROM unresolved_refs WHERE from_node_id IN (${placeholders})`).run(...chunk);
    }
  }

  /** Удаление конкретных разрешённых ссылок. */
  deleteSpecificResolvedReferences(refs: IUnresolvedReference[]): number {
    if (refs.length === 0) return 0;
    const stmt = this.db.prepare(
      'DELETE FROM unresolved_refs WHERE from_node_id = ? AND reference_name = ? AND reference_kind = ?'
    );
    let total = 0;
    const deleteMany = this.db.transaction((items: IUnresolvedReference[]) => {
      for (const ref of items) {
        const r = stmt.run(ref.fromNodeId, ref.referenceName, ref.referenceKind);
        total += r.changes;
      }
    });
    deleteMany(refs);
    return total;
  }

  /** Помечает неразрешённые ссылки как failed с установкой name_tail. */
  markReferencesFailed(refs: IUnresolvedReference[]): number {
    if (refs.length === 0) return 0;
    const stmt = this.db.prepare(
      "UPDATE unresolved_refs SET status = 'failed', name_tail = ? WHERE from_node_id = ? AND reference_name = ? AND reference_kind = ?"
    );
    let changed = 0;
    const markMany = this.db.transaction((items: IUnresolvedReference[]) => {
      for (const ref of items) {
        changed += stmt.run(ref.nameTail ?? '', ref.fromNodeId, ref.referenceName, ref.referenceKind).changes;
      }
    });
    markMany(refs);
    return changed;
  }

  /** Помечает ссылки как failed по точным row id — чтобы не затрагивать соседние строки с тем же ключом. */
  markReferencesFailedByRowIds(refs: Array<{ rowId: number; nameTail: string }>): number {
    if (refs.length === 0) return 0;
    const stmt = this.db.prepare(
      "UPDATE unresolved_refs SET status = 'failed', name_tail = ? WHERE rowid = ?"
    );
    let changed = 0;
    const markMany = this.db.transaction((items: typeof refs) => {
      for (const ref of items) {
        changed += stmt.run(ref.nameTail, ref.rowId).changes;
      }
    });
    markMany(refs);
    return changed;
  }

  /** Возвращает failed-ссылки, чей name_tail совпадает с заданными именами — кандидаты на перезапуск. Имена с более чем perNameCeiling записями пропускаются. */
  getRetryableFailedReferences(names: string[], perNameCeiling: number = 500): IUnresolvedReference[] {
    if (names.length === 0) return [];

    // Проход 1: подсчёт по name_tail, с чанкингом
    const retryNames: string[] = [];
    for (let i = 0; i < names.length; i += SQLITE_PARAM_CHUNK_SIZE) {
      const chunk = names.slice(i, i + SQLITE_PARAM_CHUNK_SIZE);
      const placeholders = chunk.map(() => '?').join(',');
      const counts = this.db
        .prepare(
          `SELECT name_tail, COUNT(*) as count FROM unresolved_refs WHERE status = 'failed' AND name_tail IN (${placeholders}) GROUP BY name_tail`
        )
        .all(...chunk) as Array<{ name_tail: string; count: number }>;
      for (const row of counts) {
        if (row.count <= perNameCeiling) retryNames.push(row.name_tail);
      }
    }
    if (retryNames.length === 0) return [];

    // Проход 2: загрузка оставшихся строк
    const rows: UnresolvedRefRow[] = [];
    for (let i = 0; i < retryNames.length; i += SQLITE_PARAM_CHUNK_SIZE) {
      const chunk = retryNames.slice(i, i + SQLITE_PARAM_CHUNK_SIZE);
      const placeholders = chunk.map(() => '?').join(',');
      const chunkRows = this.db
        .prepare(`SELECT * FROM unresolved_refs WHERE status = 'failed' AND name_tail IN (${placeholders})`)
        .all(...chunk) as UnresolvedRefRow[];
      rows.push(...chunkRows);
    }

    return rows.map(rowToUnresolvedRef);
  }

  /** Удаление неразрешённых ссылок по точным row id с чанкингом. */
  deleteReferencesByRowIds(rowIds: number[]): number {
    if (rowIds.length === 0) return 0;
    let changed = 0;
    this.db.transaction(() => {
      for (let i = 0; i < rowIds.length; i += SQLITE_PARAM_CHUNK_SIZE) {
        const chunk = rowIds.slice(i, i + SQLITE_PARAM_CHUNK_SIZE);
        const placeholders = chunk.map(() => '?').join(',');
        changed += this.db.prepare(`DELETE FROM unresolved_refs WHERE rowid IN (${placeholders})`).run(...chunk).changes;
      }
    })();
    return changed;
  }

  /** Отличные имена узлов в заданных файлах. */
  getNodeNamesByFiles(filePaths: string[]): string[] {
    if (filePaths.length === 0) return [];
    const names = new Set<string>();
    for (let i = 0; i < filePaths.length; i += SQLITE_PARAM_CHUNK_SIZE) {
      const chunk = filePaths.slice(i, i + SQLITE_PARAM_CHUNK_SIZE);
      const placeholders = chunk.map(() => '?').join(',');
      const rows = this.db
        .prepare(`SELECT DISTINCT name FROM nodes WHERE file_path IN (${placeholders})`)
        .all(...chunk) as Array<{ name: string }>;
      for (const row of rows) names.add(row.name);
    }
    return [...names];
  }

  // ===================================================================
  // Поиск
  // ===================================================================

  /** Основной поиск: FTS5 → LIKE → Fuzzy fallback. */
  searchNodes(query: string, options: ISearchOptions = {}): ISearchResult[] {
    const { limit = 100, offset = 0 } = options;

    const parsed = parseQuery(query);
    const mergedKinds =
      parsed.kinds.length > 0
        ? Array.from(new Set([...(options.kinds ?? []), ...parsed.kinds]))
        : options.kinds;
    const mergedLanguages =
      parsed.languages.length > 0
        ? Array.from(new Set([...(options.languages ?? []), ...parsed.languages]))
        : options.languages;
    const pathFilters = parsed.pathFilters;
    const nameFilters = parsed.nameFilters;
    const text = parsed.text;
    const kinds = mergedKinds;
    const languages = mergedLanguages;

    // Поиск через FtsSearch
    const ftsSearch = this.getFtsSearch();
    let results = text
      ? ftsSearch.search(text, { kinds, languages, limit, offset })
      : this.searchAllByFilters({ kinds, languages, limit: limit * FILTER_ONLY_OVER_FETCH_MULTIPLIER });

    // Жёсткие фильтры path: и name:
    if (pathFilters.length > 0) {
      const lowered = pathFilters.map((p) => p.toLowerCase());
      results = results.filter((r) => {
        const fp = r.node.filePath.toLowerCase();
        return lowered.some((p) => fp.includes(p));
      });
    }
    if (nameFilters.length > 0) {
      const lowered = nameFilters.map((n) => n.toLowerCase());
      results = results.filter((r) => {
        const nm = r.node.name.toLowerCase();
        return lowered.some((n) => nm.includes(n));
      });
    }

    return results;
  }

  /** Поиск только по фильтрам без текста. */
  searchAllByFilters(options: {
    kinds?: NodeKind[];
    languages?: string[];
    limit: number;
  }): ISearchResult[] {
    const { kinds, languages, limit } = options;
    let sql = 'SELECT * FROM nodes WHERE 1=1';
    const params: (string | number)[] = [];
    if (kinds && kinds.length > 0) {
      sql += ` AND kind IN (${kinds.map(() => '?').join(',')})`;
      params.push(...kinds);
    }
    if (languages && languages.length > 0) {
      sql += ` AND language IN (${languages.map(() => '?').join(',')})`;
      params.push(...languages);
    }
    sql += ' ORDER BY name LIMIT ?';
    params.push(limit);
    const rows = this.db.prepare(sql).all(...params) as NodeRow[];
    return rows.map((row) => ({ node: rowToNode(row), score: 1 }));
  }

  /** Точный поиск по имени. */
  findNodesByExactName(names: string[], options: ISearchOptions = {}): ISearchResult[] {
    if (names.length === 0) return [];

    const { kinds, languages, limit = 50 } = options;

    const nameToFiles = new Map<string, Set<string>>();
    for (const name of names) {
      let sql = 'SELECT DISTINCT file_path FROM nodes WHERE name COLLATE NOCASE = ?';
      const params: (string | number)[] = [name];
      if (kinds && kinds.length > 0) {
        sql += ` AND kind IN (${kinds.map(() => '?').join(',')})`;
        params.push(...kinds);
      }
      sql += ' LIMIT 100';
      const rows = this.db.prepare(sql).all(...params) as { file_path: string }[];
      nameToFiles.set(name.toLowerCase(), new Set(rows.map(r => r.file_path)));
    }

    const distinctiveFiles = new Set<string>();
    for (const [, files] of nameToFiles) {
      if (files.size > 0 && files.size < 10) {
        for (const f of files) distinctiveFiles.add(f);
      }
    }

    const perNameLimit = Math.max(8, Math.ceil(limit / names.length));
    const allResults: ISearchResult[] = [];
    const seenIds = new Set<string>();

    for (const name of names) {
      let sql = `SELECT nodes.*, 1.0 as score FROM nodes WHERE name COLLATE NOCASE = ?`;
      const params: (string | number)[] = [name];

      if (kinds && kinds.length > 0) {
        sql += ` AND kind IN (${kinds.map(() => '?').join(',')})`;
        params.push(...kinds);
      }

      if (languages && languages.length > 0) {
        sql += ` AND language IN (${languages.map(() => '?').join(',')})`;
        params.push(...languages);
      }

      sql += ' LIMIT ?';
      params.push(Math.max(perNameLimit * 3, 50));

      const rows = this.db.prepare(sql).all(...params) as (NodeRow & { score: number })[];
      const nameResults: ISearchResult[] = [];
      for (const row of rows) {
        const node = rowToNode(row);
        if (seenIds.has(node.id)) continue;
        const coLocationBoost = distinctiveFiles.has(node.filePath) ? 20 : 0;
        nameResults.push({ node, score: row.score + coLocationBoost });
      }

      nameResults.sort((a, b) => b.score - a.score);
      for (const r of nameResults.slice(0, perNameLimit)) {
        seenIds.add(r.node.id);
        allResults.push(r);
      }
    }

    allResults.sort((a, b) => b.score - a.score);
    return allResults.slice(0, limit);
  }

  /** FTS5-поиск напрямую. */
  searchNodesFTS(query: string, options: ISearchOptions = {}): ISearchResult[] {
    const ftsSearch = this.getFtsSearch();
    return ftsSearch.search(query, options);
  }

  /** LIKE-фоллбэк поиска. */
  searchNodesLike(query: string, options: ISearchOptions = {}): ISearchResult[] {
    const ftsSearch = this.getFtsSearch();
    return ftsSearch.searchLike(query, options);
  }

  /** Fuzzy-фоллбэк поиска. */
  searchNodesFuzzy(query: string, options: ISearchOptions = {}): ISearchResult[] {
    const ftsSearch = this.getFtsSearch();
    return ftsSearch.searchFuzzy(query, options);
  }

  /** LIKE-поиск по подстроке имени. */
  findNodesByNameSubstring(
    substring: string,
    options: ISearchOptions & { excludePrefix?: boolean } = {}
  ): ISearchResult[] {
    const { kinds, languages, limit = 30, excludePrefix } = options;

    let sql = `SELECT nodes.* FROM nodes WHERE name LIKE ?`;
    const params: (string | number)[] = [`%${substring}%`];

    if (excludePrefix) {
      sql += ` AND name NOT LIKE ?`;
      params.push(`${substring}%`);
    }

    if (kinds && kinds.length > 0) {
      sql += ` AND kind IN (${kinds.map(() => '?').join(',')})`;
      params.push(...kinds);
    }

    if (languages && languages.length > 0) {
      sql += ` AND language IN (${languages.map(() => '?').join(',')})`;
      params.push(...languages);
    }

    sql += ' ORDER BY length(name) ASC LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as NodeRow[];
    return rows.map((row) => ({
      node: rowToNode(row),
      score: 1.0,
    }));
  }

  // ===================================================================
  // Метаданные
  // ===================================================================

  /** Получение метаданных по ключу. */
  getMetadata(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM project_metadata WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  /** Установка метаданных (upsert). */
  setMetadata(key: string, value: string): void {
    this.db.prepare(
      'INSERT INTO project_metadata (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
    ).run(key, value, Date.now());
  }

  /** Все метаданные. */
  getAllMetadata(): Record<string, string> {
    const rows = this.db.prepare('SELECT key, value FROM project_metadata').all() as { key: string; value: string }[];
    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  }

  // ===================================================================
  // Аналитика
  // ===================================================================

  /** Снапшот (узлы, рёбра). */
  getNodeAndEdgeCount(): { nodeCount: number; edgeCount: number } {
    const row = this.db
      .prepare('SELECT (SELECT COUNT(*) FROM nodes) AS nodes, (SELECT COUNT(*) FROM edges) AS edges')
      .get() as { nodes: number; edges: number };
    return { nodeCount: row.nodes, edgeCount: row.edges };
  }

  /** Статистика графа. */
  getStats(): IGraphStats {
    const counts = this.db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM nodes) AS node_count,
        (SELECT COUNT(*) FROM edges) AS edge_count,
        (SELECT COUNT(*) FROM files) AS file_count
    `).get() as { node_count: number; edge_count: number; file_count: number };

    const nodesByKind: Record<NodeKind, number> = {} as Record<NodeKind, number>;
    const nodeKindRows = this.db
      .prepare('SELECT kind, COUNT(*) as count FROM nodes GROUP BY kind')
      .all() as Array<{ kind: string; count: number }>;
    for (const row of nodeKindRows) {
      nodesByKind[row.kind as NodeKind] = row.count;
    }

    const edgesByKind: Record<EdgeKind, number> = {} as Record<EdgeKind, number>;
    const edgeKindRows = this.db
      .prepare('SELECT kind, COUNT(*) as count FROM edges GROUP BY kind')
      .all() as Array<{ kind: string; count: number }>;
    for (const row of edgeKindRows) {
      edgesByKind[row.kind as EdgeKind] = row.count;
    }

    const filesByLanguage: Record<string, number> = {};
    const languageRows = this.db
      .prepare('SELECT language, COUNT(*) as count FROM files GROUP BY language')
      .all() as Array<{ language: string; count: number }>;
    for (const row of languageRows) {
      filesByLanguage[row.language] = row.count;
    }

    return {
      nodeCount: counts.node_count,
      edgeCount: counts.edge_count,
      fileCount: counts.file_count,
      nodesByKind,
      edgesByKind,
      filesByLanguage,
      dbSizeBytes: 0,
      lastUpdated: Date.now(),
    };
  }

  // ===================================================================
  // Утилиты
  // ===================================================================

  /** Хранение пакета файла: узлы, рёбра, ссылки, запись файла — одна транзакция. */
  storeFileBundle(bundle: { nodes: INode[]; edges: IEdge[]; refs: IUnresolvedReference[]; file: IFileRecord }): void {
    this.db.transaction(() => {
      this.insertNodes(bundle.nodes);
      this.insertEdges(bundle.edges);
      this.insertUnresolvedRefsBatch(bundle.refs);
      this.upsertFile(bundle.file);
    })();
  }

  /** Очистка всей БД. */
  clear(): void {
    this.nodeCache.clear();
    this.db.transaction(() => {
      this.db.exec('DELETE FROM unresolved_refs');
      this.db.exec('DELETE FROM edges');
      this.db.exec('DELETE FROM nodes');
      this.db.exec('DELETE FROM files');
    })();
  }
}

// =============================================================================
// Вспомогательные конвертеры
// =============================================================================

function rowToUnresolvedRef(row: UnresolvedRefRow): IUnresolvedReference {
  return {
    fromNodeId: row.from_node_id,
    referenceName: row.reference_name,
    referenceKind: row.reference_kind as EdgeKind | 'function_ref',
    line: row.line,
    column: row.col,
    candidates: row.candidates ? safeJsonParse(row.candidates, undefined) : undefined,
    filePath: row.file_path,
    language: row.language as Language,
    status: row.status as 'pending' | 'failed' | undefined,
    nameTail: row.name_tail || undefined,
    rowId: row.id,
  };
}

/** Извлекает последний сегмент имени ссылки — после последней точки или двоеточия. */
function referenceNameTail(name: string): string {
  const lastDot = name.lastIndexOf('.');
  const lastColon = name.lastIndexOf(':');
  const sep = Math.max(lastDot, lastColon);
  return sep >= 0 ? name.slice(sep + 1) : name;
}
