# Фаза 1: SQLite-слой и FTS5-полнотекстовый поиск

## Обзор

Замена текущего in-memory полнотекстового поиска на SQLite с FTS5 и добавление постоянного хранилища для узлов, ребер и файлов. Это фундамент для всех последующих фаз.

## Текущее состояние

### Модули нашего репозитория

- `src/repo/FullTextSearch.ts` — in-memory BM25-подобный поиск на основе TombstoneStore. Хранит токены и фрагменты в памяти. Нет постоянного хранилища, нет FTS5.
- `src/repo/ChunkTypes.ts` — типы фрагментов кода (ICodeChunk с filePath, content, startLine, endLine, charLength и т.д.).
- `src/repo/CodebaseSearch.ts` — гибридный поиск (семантический + ключевые слова), не использует граф.
- `src/repo/RepoAnalyzer.ts` — поверхностный анализ репозитория без графа.
- `src/repo/VectorStore.ts` — векторное хранилище для семантического поиска.

### Проблемы текущего подхода

- Данные теряются при перезапуске процесса
- Нет связей между символами (вызовы, импорты, наследование)
- Поиск не понимает структуру кода
- Ограничения памяти для больших репозиториев

## Референсный код

### Схема SQLite

Референс: `ref/contents/codegraph/src/db/schema.sql`

Таблицы:
- `schema_versions` — отслеживание версии схемы
- `project_metadata` — пары ключ-значение для метаданных проекта с колонкой updated_at
- `nodes` — узлы графа (функции, классы, переменные и т.д.)
- `edges` — связи между узлами
- `files` — отслеживаемые файлы
- `unresolved_refs` — неразрешенные ссылки для последующего разрешения
- `nodes_fts` — виртуальная таблица FTS5 для полнотекстового поиска

Ключевые индексы:
- `idx_nodes_kind`, `idx_nodes_name`, `idx_nodes_qualified_name`
- `idx_nodes_file_path`, `idx_nodes_language`
- `idx_nodes_file_line` — составной индекс для быстрого поиска по файлу и строке
- `idx_nodes_lower_name` — выражение-индекс ON nodes(lower(name)) для нечувствительного к регистру поиска
- `idx_files_language ON files(language)`
- `idx_files_modified_at ON files(modified_at)`
- `idx_edges_kind`, `idx_edges_source_kind ON edges(source, kind)` — составной индекс для исходящих ребер
- `idx_edges_target_kind ON edges(target, kind)` — составной индекс для входящих ребер
- `idx_unresolved_from_node ON unresolved_refs(from_node_id)`
- `idx_unresolved_name ON unresolved_refs(reference_name)`
- `idx_unresolved_file_path ON unresolved_refs(file_path)`
- `idx_unresolved_from_name ON unresolved_refs(from_node_id, reference_name)`
- `idx_edges_provenance ON edges(provenance)`

SQL-паттерны:
- `INSERT OR REPLACE` для узлов (идемпотентный upsert)
- `INSERT OR IGNORE` для ребер (дублирующиеся ребра тихо пропускаются)
- `ON CONFLICT(path) DO UPDATE SET` для upsert файлов
- `ON DELETE CASCADE` внешние ключи на ребрах (source, target)
- `COLLATE NOCASE` для нечувствительного к регистру сопоставления
- `json_each()` для расширения JSON-массивов в IN-списки
- `bm25(nodes_fts, 0, 20, 5, 1, 2)` — фактический вызов SQL-функции с весами столбцов
- `strftime('%s', 'now') * 1000` — паттерн временной метки

### Адаптер SQLite

Референс: `ref/contents/codegraph/src/db/sqlite-adapter.ts`

Интерфейсы:
- `SqliteStatement` — prepared statement с методами run, get, all, iterate
- `SqliteDatabase` — prepare, exec, pragma, transaction, close

Реализация `NodeSqliteAdapter` оборачивает `node:sqlite` (DatabaseSync) и предоставляет интерфейс, совместимый с better-sqlite3.

### QueryBuilder

Референс: `ref/contents/codegraph/src/db/queries.ts`

Класс `QueryBuilder` предоставляет:
- CRUD для узлов (insertNode, updateNode, deleteNode, getNodeById, getNodesByFile, getNodesByKind и т.д.)
- CRUD для ребер (insertEdge, insertEdges, getOutgoingEdges, getIncomingEdges)
- CRUD для файлов (upsertFile, getFileByPath, getAllFiles)
- FTS5-поиск (searchNodes с префиксным совпадением, LIKE-фоллбэк, fuzzy-фоллбэк)
- Точный поиск (findNodesByExactName, findNodesByNameSubstring)
- Кэширование узлов (LRU, макс 1000 записей)
- Batch-запросы (getNodesByIds для устранения паттерна N+1)
- Lazy-инициализация prepared statements

Методы итерации:
- `iterateNodesByKind(kind): Generator<INode>` — ленивый итератор, O(1) память через `stmt.iterate()`. Каждый вызов создает новый statement (не кэшируется), поскольку итератор удерживает открытый курсор. Паттерн `iterate()` обеспечивает итерацию по строкам с O(1) памятью.

Методы пакетных операций:
- `getNodesByIds(ids: string[]): INode[]` — пакетный поиск, чанки по 500 (SQLITE_PARAM_CHUNK_SIZE)
- `getExistingNodeIds(ids: string[]): Set<string>` — для валидации ребер

Методы работы с файлами:
- `getStaleFiles(currentHashes: Map<string, string>): IFileRecord[]` — для инкрементальной индексации
- `getLastIndexedAt(): number | null` — последняя метка индексации
- `getAllFilePaths(): string[]` — легковесный запрос, только строки
- `getAllNodeNames(): string[]` — легковесный запрос, только строки

Аналитические методы:
- `getDominantFile(): INode | null` — файл с наибольшим числом внутренних ребер (минимум DOMINANT_FILE_EDGE_THRESHOLD = 20 ребер)
- `getTopRouteFile(): INode | null` — файл с наибольшим числом route-узлов (требует TOP_ROUTE_MIN_TOTAL = 3 маршрутов и концентрации TOP_ROUTE_MIN_CONCENTRATION = 0.30)
- `getRoutingManifest(): INode[]` — все route-узлы (дефолтный лимит ROUTING_MANIFEST_DEFAULT_LIMIT = 40)
- `getDependentFilePaths(filePath: string): string[]` — файлы, зависящие от данного
- `getDependencyFilePaths(filePath: string): string[]` — файлы, от которых зависит данный
- `getCrossFileIncomingEdgesWithTarget(filePath: string): Array<{edge: IEdge, targetKind: string, targetName: string}>` — сохранение входящих ребер при повторной индексации
- `findEdgesBetweenNodes(nodeIds: string[], kinds?: EdgeKind[]): IEdge[]` — ребра между заданными узлами

Методы работы с ребрами:
- `deleteEdgesBySource(sourceId: string): number` — удаление по источнику
- `deleteEdgesByTarget(targetId: string): number` — удаление по цели
- `getIncomingEdges(targetId: string, kinds?: EdgeKind[]): IEdge[]` — с фильтром kinds
- `getOutgoingEdges(sourceId: string, kinds?: EdgeKind[], provenance?: string): IEdge[]` — с фильтром kinds и provenance

Методы поиска:
- `getNodesByName(name: string): INode[]` — точный поиск по имени
- `getNodesByQualifiedNameExact(qualifiedName: string): INode[]` — точный поиск по квалифицированному имени
- `getNodesByLowerName(lowerName: string): INode[]` — поиск по нижнему регистру имени
- `getAllNodes(): INode[]` — все узлы
- `findNodesByNameSubstring(substring: string, options?: ISearchOptions): INode[]` — LIKE-поиск с excludePrefix
- `searchNodesFTS(query: string, options?: ISearchOptions): ISearchResult[]` — FTS5-поиск
- `searchNodesLike(query: string, options?: ISearchOptions): ISearchResult[]` — LIKE-фоллбэк
- `searchNodesFuzzy(query: string, options?: ISearchOptions): ISearchResult[]` — fuzzy-фоллбэк
- `searchAllByFilters(options?: ISearchOptions): ISearchResult[]` — поиск только по фильтрам без текста

Методы неразрешенных ссылок:
- `insertUnresolvedRef(ref: IUnresolvedReference): void`
- `insertUnresolvedRefsBatch(refs: IUnresolvedReference[]): void`
- `deleteUnresolvedByNode(nodeId: string): void`
- `getUnresolvedByName(name: string): IUnresolvedReference[]`
- `getUnresolvedReferences(): IUnresolvedReference[]`
- `clearUnresolvedReferences(): void`
- `deleteResolvedReferences(fromNodeIds: string[]): void`
- `getUnresolvedReferencesCount(): number`
- `getUnresolvedReferencesBatch(offset: number, limit: number): IUnresolvedReference[]` — пагинированный запрос
- `getUnresolvedReferencesByFiles(filePaths: string[]): IUnresolvedReference[]` — с чанкингом по 500 файлов
- `deleteSpecificResolvedReferences(refs: IUnresolvedReference[]): number`

Методы метаданных:
- `getMetadata(key: string): string | null`
- `setMetadata(key: string, value: string): void` — upsert: создает новую запись или обновляет существующую
- `getAllMetadata(): Map<string, string>`

Утилитарные методы:
- `clear(): void` — очистка всей БД
- `clearCache(): void` — очистка LRU-кэша
- `getNodeAndEdgeCount(): {nodeCount: number, edgeCount: number}` — легковесный снапшот
- `setProjectNameTokens(tokens: Set<string>): void` — токены имени проекта для подавления в поиске (принимает Set, не массив)
- `getProjectNameTokens(): string[]`

## Референсные файлы

При реализации каждого модуля ниже смотри указанный файл референсного кода.
**Важно:** код писать новый, с нашими именами (NtGraphDb, ntgraph и т.д.).
Методы и алгоритмы можно использовать как образец.

| Наш файл | Референсный файл |
|---|---|
| `src/repo/ntgraph/schema.sql` | `ref/contents/codegraph/src/db/schema.sql` |
| `src/repo/ntgraph/Adapter.ts` | `ref/contents/codegraph/src/db/sqlite-adapter.ts` |
| `src/repo/ntgraph/QueryBuilder.ts` | `ref/contents/codegraph/src/db/queries.ts` |

## Архитектура

### Структура модуля

```
src/repo/
 ntgraph/
    index.ts              — точка экспорта
    schema.sql            — схема БД
    Adapter.ts            — адаптер SQLite
    Types.ts              — типы узлов, ребер, файлов
    QueryBuilder.ts       — QueryBuilder
    FtsSearch.ts          — FTS5-поиск
    Migration.ts          — миграции схемы
```

### Типы данных

Узел (Node):
```typescript
export interface INode {
  id: string;
  kind: NodeKind;
  name: string;
  qualifiedName: string;
  filePath: string;
  language: string;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
  docstring?: string;
  signature?: string;
  visibility?: 'public' | 'private' | 'protected' | 'internal';
  isExported?: boolean;
  isAsync?: boolean;
  isStatic?: boolean;
  isAbstract?: boolean;
  decorators?: string[];
  typeParameters?: string[];
  returnType?: string;
  updatedAt: number;
}
```

Ребро (Edge):
```typescript
export interface IEdge {
  source: string;
  target: string;
  kind: EdgeKind;
  metadata?: Record<string, unknown>;
  line?: number;
  column?: number;
  provenance?: string;
}
```

Файл (FileRecord):
```typescript
export interface IFileRecord {
  path: string;
  contentHash: string;
  language: string;
  size: number;
  modifiedAt: number;
  indexedAt: number;
  nodeCount: number;
  errors?: IExtractionError[];
}
```

Неразрешенная ссылка (UnresolvedReference):
```typescript
export interface IUnresolvedReference {
  fromNodeId: string;
  referenceName: string;
  referenceKind: EdgeKind | 'function_ref';
  line: number;
  column: number;
  filePath?: string;
  language?: string;
  candidates?: string[];
}
```

Результат извлечения (ExtractionResult):
```typescript
export interface IExtractionResult {
  nodes: INode[];
  edges: IEdge[];
  unresolvedReferences: IUnresolvedReference[];
  errors: IExtractionError[];
  durationMs: number;
}
```

Ошибка извлечения (ExtractionError):
```typescript
export interface IExtractionError {
  message: string;
  filePath: string;
  line?: number;
  column?: number;
  severity: 'warning' | 'error';
  code: 'read_error' | 'size_exceeded' | 'parse_error' | 'path_traversal';
}
```

Статистика графа (GraphStats):
```typescript
export interface IGraphStats {
  nodeCount: number;
  edgeCount: number;
  fileCount: number;
  nodesByKind: Record<NodeKind, number>;
  edgesByKind: Record<EdgeKind, number>;
  filesByLanguage: Record<string, number>;
  dbSizeBytes: number;
  lastUpdated: number;
}
```

Параметры поиска (SearchOptions):
```typescript
export interface ISearchOptions {
  kinds?: NodeKind[];
  languages?: string[];
  includePatterns?: string[];
  excludePatterns?: string[];
  limit?: number;
  offset?: number;
  caseSensitive?: boolean;
}
```

Результат поиска (SearchResult):
```typescript
export interface ISearchResult {
  node: INode;
  score: number;
  highlights?: string[];
}
```

Версия схемы (SchemaVersion):
```typescript
export interface ISchemaVersion {
  version: number;
  description: string;
  appliedAt: number;
}
```

Подграф (Subgraph):
```typescript
export interface Subgraph {
  nodes: INode[];
  edges: IEdge[];
  roots: string[];
  confidence: number;
}
```

Параметры обхода (TraversalOptions):
```typescript
export interface TraversalOptions {
  maxDepth: number;
  edgeKinds?: EdgeKind[];
  nodeKinds?: NodeKind[];
  direction?: 'outgoing' | 'incoming' | 'both';
  limit?: number;
  includeStart?: boolean;
}
```

Контекст (Context):
```typescript
export interface Context {
  focal: INode;
  ancestors: INode[];
  children: INode[];
  incomingRefs: IEdge[];
  outgoingRefs: IEdge[];
  types: INode[];
  imports: IEdge[];
}
```

Блок кода (CodeBlock):
```typescript
export interface CodeBlock {
  content: string;
  filePath: string;
  startLine: number;
  endLine: number;
  language: string;
  node: INode;
}
```

Входные данные задачи (TaskInput):
```typescript
export type TaskInput = string | { title: string; description: string };
```

Параметры построения контекста (BuildContextOptions):
```typescript
export interface BuildContextOptions {
  maxNodes?: number;
  maxCodeBlocks?: number;
  maxCodeBlockSize?: number;
  includeCode?: boolean;
  format?: string;
  searchLimit?: number;
  traversalDepth?: number;
  minScore?: number;
}
```

Контекст задачи (TaskContext):
```typescript
export interface TaskContext {
  query: string;
  subgraph: Subgraph;
  entryPoints: INode[];
  codeBlocks: CodeBlock[];
  relatedFiles: string[];
  summary: string;
  stats: IGraphStats;
}
```

Параметры поиска релевантного контекста (FindRelevantContextOptions):
```typescript
export interface FindRelevantContextOptions {
  searchLimit?: number;
  traversalDepth?: number;
  maxNodes?: number;
  minScore?: number;
  edgeKinds?: EdgeKind[];
  nodeKinds?: NodeKind[];
}
```

Разобранный запрос (ParsedQuery):
```typescript
export interface ParsedQuery {
  text: string;
  kinds: NodeKind[];
  languages: string[];
  pathFilters: string[];
  nameFilters: string[];
}
```

### Перечисления

NodeKind (22 значения):
```typescript
export type NodeKind =
  | 'file' | 'class' | 'function' | 'method' | 'property' | 'field'
  | 'interface' | 'struct' | 'enum' | 'type_alias' | 'constant' | 'variable'
  | 'namespace' | 'module' | 'route' | 'trait' | 'protocol' | 'enum_member'
  | 'parameter' | 'import' | 'export' | 'component';
```

EdgeKind (12 значений):
```typescript
export type EdgeKind =
  | 'contains' | 'calls' | 'imports' | 'extends' | 'implements'
  | 'references' | 'type_of' | 'returns' | 'instantiates' | 'overrides'
  | 'decorates' | 'exports';
```

Тип языка (Language):
```typescript
export const Language = [
  'typescript', 'javascript', 'tsx', 'jsx', 'python', 'go', 'rust', 'java',
  'c', 'cpp', 'csharp', 'razor', 'php', 'ruby', 'swift', 'kotlin', 'dart',
  'svelte', 'vue', 'astro', 'liquid', 'pascal', 'scala', 'lua', 'luau',
  'objc', 'r', 'yaml', 'twig', 'xml', 'properties', 'unknown'
] as const;

export type Language = (typeof Language)[number];
```

### Константы

```typescript
// Поиск
export const FUZZY_FOLLOWUP_CAP = Math.max(limit * 2, 50); // лимит дополнительных запросов на одно имя в fuzzy-поиске
export const FTS_LIMIT_MIN = 100; // минимальный лимит выборки FTS
export const FTS_OVER_FETCH_MULTIPLIER = 5; // FTS загружает в 5 раз больше запрошенного лимита для пост-пересчета
export const FILTER_ONLY_OVER_FETCH_MULTIPLIER = 5; // запросы только по фильтрам загружают в 5 раз больше
export const EXACT_MATCH_SUPPLEMENT_LIMIT = 20; // лимит на термин для точного дополнения по имени
export const FUZZY_MAX_DIST_SHORT = 1; // макс. расстояние редактирования для запросов <= 4 символов
export const FUZZY_MAX_DIST_DEFAULT = 2; // макс. расстояние для запросов > 4 символов

// Аналитика
export const DOMINANT_FILE_EDGE_THRESHOLD = 20; // минимальное число ребер для доминирующего файла
export const TOP_ROUTE_MIN_TOTAL = 3; // минимальное общее число маршрутов для getTopRouteFile
export const TOP_ROUTE_MIN_CONCENTRATION = 0.30; // минимальная концентрация (30%) для getTopRouteFile
export const ROUTING_MANIFEST_DEFAULT_LIMIT = 40; // дефолтный лимит для getRoutingManifest

// Безопасность
export const CONFIG_LEAF_LANGUAGES = new Set(['yaml', 'properties']); // языки для leaf-конфигураций
export const SENSITIVE_PATHS = new Set([
  '/proc', '/sys', '/dev', 'C:\\Windows', 'C:\\Program Files', 'C:\\ProgramData'
]); // системные директории для блокировки

// Блокировка
export const FileLock_STALE_TIMEOUT_MS = 2 * 60 * 1000; // 2 минуты — время устаревания блокировки
export const DATABASE_FILENAME = 'ntgraph.db'; // имя файла БД по умолчанию

// Генерируемые файлы
export const GENERATED_PATTERNS: RegExp[] = [
  /\/generated\//i, /\/gen\//i, /\/proto\//i, /\/__generated__/i,
  /\.pb\.ts$/, /\.pb\.js$/, /\.pb\.go$/, /\.pb\.py$/,
  /\.gen\.ts$/, /\.gen\.js$/, /\.gen\.go$/, /\.gen\.py$/,
  /\/\.next\//i, /\/\.nuxt\//i, /\/dist\//i, /\/build\//i,
  /\/node_modules\//i, /\/vendor\//i,
  /-lock\.json$/, /package-lock\.json$/, /yarn\.lock$/, /pnpm-lock\.yaml$/,
  /\/coverage\//i, /\/\.nyc_output\//i,
  /\.d\.ts$/, /\.min\.js$/, /\.min\.css$/, /\.bundle\.js$/,
  /\/\.svelte-kit\//i, /\/\.vite\//i, /\/\.angular\//i,
  /\/\.parcel-cache\//i, /\/\.swc\//i,
  /\/\.turbo\//i, /\/\.vercel\//i,
  /\/\.cache\//i, /\/\.parcel-cache\//i,
  /swagger\.json$/, /openapi\.json$/, /\.map$/,
  /\/__snapshots__\//i, /\/\.jest\//i,
  /\/\.cache\//i, /\/\.rollup\//i,
  /\/\.eslintrc\//i, /\/\.prettierrc\//i
]; // 30+ паттернов для генерируемых файлов
```

### Класс NtGraphDb

```typescript
export class NtGraphDb {
  constructor(dbPath: string);
  initialize(): void;
  close(): void;
  get queryBuilder(): QueryBuilder;
  getStats(): IGraphStats;
  getSize(): number;
}
```

Метод initialize():
- Создает БД в WAL-режиме
- Применяет PRAGMA в строгом порядке (см. ниже)
- Создает все таблицы и индексы
- Создает виртуальную таблицу FTS5
- Создает триггеры для синхронизации FTS5

Порядок PRAGMA (критичен):
1. `busy_timeout = 5000` — ДОЛЖЕН быть установлен ПЕРВЫМ (issue #238)
2. `foreign_keys = ON` — ДОЛЖЕН быть установлен ДО `journal_mode = WAL` (включает ON DELETE CASCADE)
3. `journal_mode = WAL` — WAL-режим
4. `synchronous = NORMAL` — баланс между безопасностью и производительностью (OFF — риск потери данных, FULL — медленно)
5. `cache_size = -64000` — 64MB внутреннего кэша SQLite (отрицательное значение = килобайты)
6. `temp_store = MEMORY` — временные таблицы в памяти
7. `mmap_size = 268435456` — 256MB для кеширования данных в памяти ОС (быстрее чтения с диска)

## Детали реализации

### Адаптер SQLite

Адаптер оборачивает `node:sqlite` (DatabaseSync):
- `prepare(sql)` — возвращает SqliteStatement с run, get, all, iterate
- `exec(sql)` — выполняет SQL без результатов
- `pragma(str, options)` — выполняет PRAGMA
- `transaction(fn)` — оборачивает функцию в транзакцию
- `close()` — закрывает БД (идемпотентно)

### QueryBuilder

Lazy-инициализация prepared statements — каждое поле `stmts` проверяется на undefined перед созданием.

Кэширование узлов (LRU):
- Размер 1000 записей
- Использует Map с порядком вставки
- Вытеснение: удаляется первый ключ (`keys().next().value`)
- Touch при чтении: delete + re-set для перемещения в конец
- Delete при записи: при insert/update узла запись удаляется из кэша
- File-scoped invalidation: при deleteNodesByFile все узлы файла удаляются из кэша

Batch-запросы:
- `getNodesByIds(ids)` — разбивает на чанки по 500 элементов (ограничение SQLite)
- `insertNodes(nodes)` — вставка в транзакции
- `insertEdges(edges)` — вставка в транзакции с проверкой существования узлов

FTS5-поиск:
- Префиксное совпадение: `"term"*` для каждого токена запроса
- BM25 с весами: id=0, name=20, qualified_name=5, docstring=1, signature=2
- FTS загружает в 5 раз больше запрошенного лимита (FTS_OVER_FETCH_MULTIPLIER = 5) для пост-пересчета
- Fallback цепочка с минимальными длинами: LIKE требует text.length >= 2, fuzzy требует text.length >= 3
- Fuzzy maxDist адаптируется: lowered.length <= 4 ? FUZZY_MAX_DIST_SHORT (1) : FUZZY_MAX_DIST_DEFAULT (2)
- Exact match supplement: после FTS-результатов выполняется WHERE name = ? COLLATE NOCASE для каждого термина >= 2 символов (EXACT_MATCH_SUPPLEMENT_LIMIT = 20 на термин)
- Multi-signal rescoring: после FTS применяются kindBonus + scorePathRelevance + nameMatchBonus
- Path/name фильтры из parseQuery применяются ПОСЛЕ скоринга как жесткий фильтр

### Триггеры FTS5

```sql
CREATE TRIGGER nodes_ai AFTER INSERT ON nodes BEGIN
  INSERT INTO nodes_fts(rowid, id, name, qualified_name, docstring, signature)
  VALUES (NEW.rowid, NEW.id, NEW.name, NEW.qualified_name, NEW.docstring, NEW.signature);
END;

CREATE TRIGGER nodes_ad AFTER DELETE ON nodes BEGIN
  INSERT INTO nodes_fts(nodes_fts, rowid, id, name, qualified_name, docstring, signature)
  VALUES ('delete', OLD.rowid, OLD.id, OLD.name, OLD.qualified_name, OLD.docstring, OLD.signature);
END;

CREATE TRIGGER nodes_au AFTER UPDATE ON nodes BEGIN
  INSERT INTO nodes_fts(nodes_fts, rowid, id, name, qualified_name, docstring, signature)
  VALUES ('delete', OLD.rowid, OLD.id, OLD.name, OLD.qualified_name, OLD.docstring, OLD.signature);
  INSERT INTO nodes_fts(rowid, id, name, qualified_name, docstring, signature)
  VALUES (NEW.rowid, NEW.id, NEW.name, NEW.qualified_name, NEW.docstring, NEW.signature);
END;
```

## Утилиты

### Конвертеры строк БД

- `rowToNode(row)` — преобразует строку БД из snake_case в camelCase Node
- `rowToEdge(row)` — преобразует строку БД из snake_case в camelCase Edge
- `rowToFileRecord(row)` — преобразует строку БД из snake_case в FileRecord

### Строковые утилиты

- `normalizeNameToken(raw: string): string` — переводит в нижний регистр, оставляет только буквенно-цифровые символы
- `deriveProjectNameTokens(projectRoot: string): Set<string>` — читает go.mod, package.json, имя директории репо; фильтрует токены короче 5 символов
- `getStemVariants(term: string): string[]` — генерирует варианты основы: -ing, -tion, -ment, -ies, -es, -s, -ed, -er
- `extractSearchTerms(query: string, options?): string[]` — разделяет camelCase, PascalCase, snake_case, SCREAMING_SNAKE, dot.notation
- `unquote(s: string): string` — удаляет окружающие двойные кавычки
- `boundedEditDistance(a: string, b: string, maxDist: number): number` — чистый DP с ранним выходом при превышении maxDist

### Поиск

- `kindBonus(kind: NodeKind): number` — бонус по виду узла
- `nameMatchBonus(query: string, name: string): number` — бонус по совпадению имени
- `scorePathRelevance(path: string, query: string): number` — релевантность пути
- `isLowValueFile(path: string): boolean` — определение тестовых/сгенерированных файлов

### Парсер запросов

- `parseQuery(raw: string): ParsedQuery` — полный парсер запросов с токенизацией, поддержкой кавычек, валидацией полей. Поддерживает префиксы kind:, lang:, path:, name:. Неизвестные поля пропускаются. Пустые значения игнорируются.

### Классификаторы файлов

- `isTestFile(filePath: string): boolean` — комплексное определение тестовых файлов по именам файлов, директориям и не-продуктовым директориям
- `isGeneratedFile(filePath: string): boolean` — 30+ regex-паттернов для генерируемых файлов
- `isDistinctiveIdentifier(token: string): boolean` — проверяет наличие подчеркивания, цифры или внутреннего заглавного символа
- `isConfigLeafNode(node): boolean` — определяет узлы-константы YAML/properties (языки из CONFIG_LEAF_LANGUAGES)

### Безопасность путей

- `validatePathWithinRoot(projectRoot, filePath, options?)` — лексическая + realpath проверка вложенности
- `validateProjectPath(dirPath): string | null` — отклоняет чувствительные системные директории (SENSITIVE_PATHS)
- `isWithinDir(child, parent)` — нечувствительный к регистру на Windows

### Числовые утилиты

- `clamp(value, min, max)` — числовое ограничение

### Пути

- `normalizePath(filePath)` — нормализация с прямым слэшем

### Асинхронные утилиты

- `processInBatches<T, R>(items, batchSize, processor, onBatchComplete)` — асинхронная пакетная обработка с GC между батчами
- `Mutex` — класс асинхронного мьютекса с очередью ожидания
- `FileLock` — класс межпроцессной блокировки файлов с отслеживанием PID и обнаружением устаревания (STALE_TIMEOUT_MS = 2 минуты). Использует флаг wx для атомарного создания. Проверяет живость PID.
- `readFileInChunks` — генератор постраничного чтения файлов
- `debounce` / `throttle` — дебаунсинг и троттлинг функций

### Память

- `estimateSize(obj)` — приблизительная оценка размера объекта в памяти
- `MemoryMonitor` — класс мониторинга использования памяти с callback при достижении порога

### Базовые пути

- `getDatabasePath(projectRoot)` — формирует путь к БД по умолчанию (projectRoot / DATABASE_FILENAME)

### QueryBuilder утилиты

- `safeJsonParse<T>(str: string | null, fallback: T): T` — безопасный парсинг JSON из SQLite

## Шаблоны обработки ошибок

- `insertNode`/`updateNode`: валидирует обязательные поля, логирует ошибку с деталями полей, возвращается досрочно
- `insertEdges`: тихо пропускает ребра, у которых source или target не существуют
- `searchNodesFTS`: try/catch вокруг FTS-запроса, возвращает `[]` при сбое
- `FileLock.acquire`: проверяет живость PID, считает блокировки старше 2 минут устаревшими, использует флаг wx для атомарного создания
- `runMaintenance`: ошибки PRAGMA optimize и wal_checkpoint тихо проглатываются
- `createDatabase`: обертка ошибки с сообщением о версии Node.js
- `close()`: проверка `isOpen` перед закрытием

## Интеграция с текущим кодом

### Маппинг ICodeChunk → INode

- ICodeChunk.filePath → INode.filePath
- ICodeChunk.nodeKind → INode.kind (ChunkNodeKind → NodeKind: class→class, function→function, method→method, interface→interface, type→type_alias, enum→enum, const→constant, block→variable, top_level→variable)
- ICodeChunk.symbolName → INode.name
- ICodeChunk.content → INode.signature
- ICodeChunk.startLine/endLine → INode.startLine/endLine

### Маппинг IFtsResult → ISearchResult

- IFtsResult.chunk → ISearchResult.node (через маппинг ICodeChunk → INode)
- IFtsResult.score → ISearchResult.score
- IFtsResult.matchCount → ISearchResult.highlights (длина массива)

### NtGraphDb.map() к DatabaseConnection

- NtGraphDb.open() для существующих БД
- NtGraphDb.initialize() для новых БД

### FileLock для блокировки БД

- Используется перед записью в БД для блокировки на межпроцессном уровне

### processInBatches для безопасной пакетной обработки

- Используется при пакетной вставке узлов и ребер с GC между батчами

### Mutex для безопасности в процессе

- Используется для защиты критических секций внутри одного процесса

### MemoryMonitor для отслеживания памяти при индексации

- Мониторит использование памяти во время индексации больших репозиториев

### Стратегия миграции FullTextSearch → FTS5

- Сохранить интерфейс IFullTextSearch
- Создать SQLite-реализацию, которая использует QueryBuilder.searchNodes()
- Метод compactIfNeeded() — no-op для FTS5 (не требуется)
- Метод add(chunks: ICodeChunk[]) — конвертация в INode[] перед вставкой

### Интеграция CodebaseSearch с NtGraphDb

- CodebaseSearch.search() вызывает QueryBuilder.searchNodes()
- Результаты маппятся из ISearchResult[] в IUnifiedSearchResult[]
- CodebaseSearch становится тонкой оберткой над NtGraphDb
- AbortSignal: SQLite синхронный, но можно проверять signal.aborted между батчами

## Архитектурные детали

- `DatabaseConnection` абстракция: оборачивает адаптер + схему + QueryBuilder + отслеживание размера
- `NtGraphDb.getSize(): number` — размер БД в байтах
- `SqliteStatement.iterate()`: критичен для итерации по большим наборам данных с O(1) памятью (в отличие от all() с O(N))
- `SQLITE_PARAM_CHUNK_SIZE = 500` — константа для безопасного чанкинга
- `projectNameTokens`: токены имени проекта для подавления недискриминативных слов в поиске (извлекаются из go.mod / package.json / директории репо)
- Exact-match supplement в поиске: после FTS-результатов добавляются точные совпадения по имени (предотвращает погребение коротких имен BM25)
- Query parser для field-qualified запросов: kind:, lang:, path:, name: префиксы
- Стратегия инвалидации кэша: delete при insert/update/delete, file-scoped invalidation при deleteNodesByFile, LRU touch при чтении

## Сценарии тестирования

- FTS5 trigger sync test: INSERT/UPDATE/DELETE на nodes синхронизирует nodes_fts
- LRU cache eviction test: вставка 1001 узла вытесняет старейший
- Batch query chunking test: getNodesByIds с >500 ID не нарушает лимит параметров SQLite
- Three-tier search fallback test: FTS5 → LIKE → Fuzzy цепочка фоллбэков
- Edge endpoint validation test: insertEdges пропускает ребра без существующих узлов
- Cascading delete test: удаление узла каскадно удаляет ребра
- Unresolved reference chunking test: getUnresolvedReferencesByFiles с >500 файлов
- FTS5 special character escaping test: обработка :: и FTS5 спецсимволов
- isLowValueFile test: определение тестовых/сгенерированных файлов
- Transaction rollback test: transaction() откатывает при ошибке
- Upsert file test: upsertFile создает новые и обновляет существующие
- getDominantFile test: исключает тестовые файлы, возвращает null для разреженных графов
- isTestFile test: все паттерны имен файлов, паттерны директорий, не-продуктовые директории
- isGeneratedFile test: все паттерны генерируемых файлов для разных языков
- deriveProjectNameTokens test: чтение из go.mod, package.json, директории репо; фильтрация токенов короче 5 символов
- extractSearchTerms test: разделение camelCase, snake_case, сохранение составных слов, варианты основы
- getStemVariants test: все паттерны суффиксов (-ing, -tion, -ment, -ies, -es, -s, -ed, -er)
- isDistinctiveIdentifier test: snake_case, встроенные цифры, внутренний заглавный символ против обычных слов
- FileLock staleness test: блокировка старше 2 минут считается устаревшей
- foreign_keys = ON cascade test: удаление узла каскадно удаляет ребра
- clearUnresolvedReferences test: очистка всех неразрешенных ссылок
- deleteResolvedReferences test: удаление по ID узлов
- setMetadata upsert test: создание новых и обновление существующих записей
- boundedEditDistance test: ранний выход при превышении maxDist
- parseQuery test: поддержка кавычек, пропуск неизвестных полей, обработка пустых значений

## Детали миграций

### Инфраструктура миграций

- `CURRENT_SCHEMA_VERSION = 5`
- Интерфейс `Migration`: `{ version: number; description: string; up: (db) => void }`
- `recordMigration(db, version, description)` — вставляет запись в schema_versions
- `needsMigration(db): boolean` — проверяет необходимость миграции
- `getPendingMigrations(db): Migration[]` — возвращает список ожидающих миграций
- `getMigrationHistory(db): Array<{ version, appliedAt, description }>` — история примененных миграций

### Версии миграций

- v1: начальная схема (таблицы nodes, edges, files, unresolved_refs, schema_versions, project_metadata, nodes_fts, все индексы, триггеры)
- v2: добавлена таблица project_metadata с колонкой updated_at; добавлены колонки file_path и language в unresolved_refs; добавлена колонка provenance в edges; созданы индексы idx_unresolved_file_path и idx_edges_provenance
- v3: добавлен выражение-индекс idx_nodes_lower_name ON nodes(lower(name))
- v4: удалены избыточные индексы idx_edges_source и idx_edges_target (заменены составными idx_edges_source_kind и idx_edges_target_kind)
- v5: добавлена колонка nodes.return_type

Версии миграций отслеживаются через таблицу schema_versions. Инкрементальные миграции, не полная пересоздание схемы. Откат: полная пересоздание схемы из schema.sql.

## Требования к качеству

### SOLID

- Single Responsibility: адаптер отвечает только за доступ к SQLite, QueryBuilder — только за запросы, миграции — только за обновление схемы
- Open/Closed: новые типы узлов и ребер добавляются без изменения существующего кода (через расширение перечислений)
- Liskov Substitution: адаптер SQLite заменяем через интерфейс SqliteDatabase
- Interface Segregation: отдельные интерфейсы для Statement, Database, QueryBuilder
- Dependency Inversion: модули зависят от интерфейсов, а не от конкретных реализаций

### Безопасность

- Валидация всех входных данных перед вставкой в БД
- Параметризованные запросы (prepared statements) для предотвращения SQL-инъекций
- Обработка исключений при ошибках БД
- Корректное закрытие соединений (finally-блоки)
- Предотвращение утечек памяти: кэш LRU с ограниченным размером, итераторы вместо массивов для больших наборов данных

### Оптимизация

- Время выполнения операций CRUD: O(1) с индексами
- Поиск FTS5: O(log N) с BM25
- Batch-запросы: O(N/B) вместо O(N) (B — размер батча)
- WAL-режим для конкурентного чтения
- Транзакции для пакетных вставок
- Кэш LRU для часто запрашиваемых узлов

## Правила именования и языка

### Именование папок

- **Однословные**: строчные буквы — `repo`, `tools`, `skills`, `di`, `mcp`, `utils`
- **Многословные**: kebab-case — `code-actions`, `commit-message`, `builtins`
- **Исключение**: `__tests__` (dunder-конвенция для тестовой инфраструктуры)

### Именование файлов

- **Исходные файлы**: PascalCase — `AgentOrchestrator.ts`, `FullTextSearch.ts`
- **Тестовые файлы**: `SourceFile.test.ts` в той же директории — `WriteFileTool.test.ts`
- **Интерфейсы/типы**: PascalCase, часто в отдельных файлах — `IVectorStore.ts`, `ChunkTypes.ts`
- **Точки экспорта**: `index.ts` (строчные) — `src/repo/index.ts`
- **SQL-схемы**: kebab-case с расширением `.sql` — `schema.sql`

### Именование типов

- **Интерфейсы**: префикс `I` + PascalCase — `INode`, `IEdge`, `IFileRecord`, `IVectorStore`
- **Классы**: PascalCase без префикса — `NtGraphDb`, `QueryBuilder`
- **Классы ошибок**: PascalCase + суффикс `Error` — `BackendError`, `ValidationError`
- **Type-алиасы (перечисления)**: PascalCase без префикса — `NodeKind`, `EdgeKind`, `SearchMode`
- **Константы**: UPPER_SNAKE_CASE — `LSP_TIMEOUT_MS`, `FTS_MAX_CACHE_SIZE`
- **Функции**: camelCase — `loadAppConfig()`, `detectLanguage()`
- **Фабрики**: `makeXxx()` для провайдеров, `createXxx()` для DI — `makeUrlProvider()`, `createDeps()`
- **Свойство `name` инструментов**: snake_case строка — `"write_file"`, `"read_file"`
- **Свойство `name` сервисов**: строчные/kebab-case — `"git"`, `"codebase-indexer"`

### Язык

- **Русский язык** для комментариев в исходном коде
- **Русский язык** для исходного кода тестов (комментарии, описания шагов, данные)
- **Русский язык** для строк, показываемых пользователю (сообщения, уведомления, UI-тексты) в файлах кода
- **Английский язык** для `description` и `it` в файлах тестов (`.test.ts`)

## План действий

1. Создать типы данных (Types.ts)
2. Создать адаптер SQLite (Adapter.ts)
3. Создать схему БД (schema.sql)
4. Создать миграции (Migration.ts)
5. Создать QueryBuilder (QueryBuilder.ts)
6. Создать FTS5-поиск (FtsSearch.ts)
7. Создать класс NtGraphDb (index.ts)
8. Написать unit-тесты для каждого компонента
9. Интегрировать с CodebaseSearch

## Зависимости

- Node.js >= 22.5 (для встроенного `node:sqlite`)
- Нет внешних зависимостей для БД (встроенный SQLite в Node.js)
