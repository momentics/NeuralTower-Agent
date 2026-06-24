/**
 * Типы данных для графа кода.
 * Узлы, рёбра, файлы, результаты поиска и аналитики.
 */

// =============================================================================
// Перечисления
// =============================================================================

/** Вид узла графа (22 значения). */
export type NodeKind =
  | 'file' | 'class' | 'function' | 'method' | 'property' | 'field'
  | 'interface' | 'struct' | 'enum' | 'type_alias' | 'constant' | 'variable'
  | 'namespace' | 'module' | 'route' | 'trait' | 'protocol' | 'enum_member'
  | 'parameter' | 'import' | 'export' | 'component';

/** Вид ребра графа (12 значений). */
export type EdgeKind =
  | 'contains' | 'calls' | 'imports' | 'extends' | 'implements'
  | 'references' | 'type_of' | 'returns' | 'instantiates' | 'overrides'
  | 'decorates' | 'exports';

/** Поддерживаемые языки (39 значений). */
export const Language = Object.freeze([
  'typescript', 'javascript', 'tsx', 'jsx', 'python', 'go', 'rust', 'java',
  'c', 'cpp', 'csharp', 'razor', 'php', 'ruby', 'swift', 'kotlin', 'dart',
  'svelte', 'vue', 'astro', 'liquid', 'pascal', 'scala', 'lua', 'luau',
  'objc', 'r', 'yaml', 'twig', 'xml', 'properties', 'unknown',
  'html', 'css', 'sql', 'json', 'markdown', 'shell', 'dockerfile', 'toml', 'ini'
] as const);

export type Language = (typeof Language)[number];

// =============================================================================
// Интерфейсы
// =============================================================================

/** Узел графа — символ кода (функция, класс, переменная и т.д.). */
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

/** Ребро графа — связь между узлами. */
export interface IEdge {
  source: string;
  target: string;
  kind: EdgeKind;
  metadata?: Record<string, unknown>;
  line?: number;
  column?: number;
  provenance?: string;
}

/** Запись о файле в БД. */
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

/** Неразрешённая ссылка — требует разрешения после полной индексации. */
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

/** Результат извлечения символов из файла. */
export interface IExtractionResult {
  nodes: INode[];
  edges: IEdge[];
  unresolvedReferences: IUnresolvedReference[];
  errors: IExtractionError[];
  durationMs: number;
}

/** Ошибка извлечения. */
export interface IExtractionError {
  message: string;
  filePath: string;
  line?: number;
  column?: number;
  severity: 'error' | 'warning' | 'info';
  code: 'read_error' | 'size_exceeded' | 'parse_error' | 'path_traversal';
}

/** Статистика графа. */
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

/** Параметры поиска. */
export interface ISearchOptions {
  kinds?: NodeKind[];
  languages?: string[];
  includePatterns?: string[];
  excludePatterns?: string[];
  pathFilters?: string[];
  nameFilters?: string[];
  limit?: number;
  offset?: number;
  caseSensitive?: boolean;
}

/** Результат поиска. */
export interface ISearchResult {
  node: INode;
  score: number;
  highlights?: string[];
}

/** Доминирующий файл — файл с наибольшей концентрацией внутренних рёбер. */
export interface IDominantFile {
  filePath: string;
  edgeCount: number;
  nextEdgeCount: number;
}

/** Версия схемы БД. */
export interface ISchemaVersion {
  version: number;
  description: string;
  appliedAt: number;
}

/** Подграф. */
export interface ISubgraph {
  nodes: Map<string, INode>;
  edges: IEdge[];
  roots: string[];
  confidence?: 'high' | 'low';
}

/** Параметры обхода графа. */
export interface TraversalOptions {
  maxDepth: number;
  edgeKinds?: EdgeKind[];
  nodeKinds?: NodeKind[];
  direction?: 'outgoing' | 'incoming' | 'both';
  limit?: number;
  includeStart?: boolean;
}

/** Контекст узла. */
export interface Context {
  focal: INode;
  ancestors: INode[];
  children: INode[];
  incomingRefs: IEdge[];
  outgoingRefs: IEdge[];
  types: INode[];
  imports: IEdge[];
}

/** Блок кода. */
export interface CodeBlock {
  content: string;
  filePath: string;
  startLine: number;
  endLine: number;
  language: string;
  node: INode;
}

/** Входные данные задачи. */
export type TaskInput = string | { title: string; description: string };

/** Параметры построения контекста. */
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

/** Контекст задачи. */
export interface TaskContext {
  query: string;
  subgraph: ISubgraph;
  entryPoints: INode[];
  codeBlocks: CodeBlock[];
  relatedFiles: string[];
  summary: string;
  stats: IGraphStats;
}

/** Параметры поиска релевантного контекста. */
export interface FindRelevantContextOptions {
  searchLimit?: number;
  traversalDepth?: number;
  maxNodes?: number;
  minScore?: number;
  edgeKinds?: EdgeKind[];
  nodeKinds?: NodeKind[];
}

/** Разобранный запрос. */
export interface ParsedQuery {
  text: string;
  kinds: NodeKind[];
  languages: string[];
  pathFilters: string[];
  nameFilters: string[];
}

// =============================================================================
// Константы
// =============================================================================

/** Минимальный лимит выборки FTS. */
export const FTS_LIMIT_MIN = 100;

/** FTS загружает в 5 раз больше запрошенного лимита для пост-пересчёта. */
export const FTS_OVER_FETCH_MULTIPLIER = 5;

/** Запросы только по фильтрам загружают в 5 раз больше. */
export const FILTER_ONLY_OVER_FETCH_MULTIPLIER = 5;

/** Лимит на термин для точного дополнения по имени. */
export const EXACT_MATCH_SUPPLEMENT_LIMIT = 20;

/** Макс. расстояние редактирования для запросов <= 4 символов. */
export const FUZZY_MAX_DIST_SHORT = 1;

/** Макс. расстояние для запросов > 4 символов. */
export const FUZZY_MAX_DIST_DEFAULT = 2;

/** Минимальное число рёбер для доминирующего файла. */
export const DOMINANT_FILE_EDGE_THRESHOLD = 20;

/** Минимальное общее число маршрутов для getTopRouteFile. */
export const TOP_ROUTE_MIN_TOTAL = 3;

/** Минимальная концентрация (30%) для getTopRouteFile. */
export const TOP_ROUTE_MIN_CONCENTRATION = 0.30;

/** Дефолтный лимит для getRoutingManifest. */
export const ROUTING_MANIFEST_DEFAULT_LIMIT = 40;

/** Языки для leaf-конфигураций. */
export const CONFIG_LEAF_LANGUAGES = new Set(['yaml', 'properties']);

/** Системные директории для блокировки. */
export const SENSITIVE_PATHS = new Set([
  '/proc', '/sys', '/dev', 'C:\\Windows', 'C:\\Program Files', 'C:\\ProgramData'
]);

/** Время устаревания блокировки — 2 минуты. */
export const FileLock_STALE_TIMEOUT_MS = 2 * 60 * 1000;

/** Имя файла БД по умолчанию. */
export const DATABASE_FILENAME = 'ntgraph.db';

/** Размер чанка для batch-запросов (ограничение SQLite). */
export const SQLITE_PARAM_CHUNK_SIZE = 500;

/** Размер LRU-кэша узлов. */
export const LRU_CACHE_SIZE = 1000;

/** Паттерны для генерируемых файлов. */
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
];
