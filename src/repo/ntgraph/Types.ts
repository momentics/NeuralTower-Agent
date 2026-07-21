/**
 * Типы данных для графа кода.
 * Узлы, рёбра, файлы, результаты поиска и аналитики.
 */

// =============================================================================
// Перечисления
// =============================================================================

/** Вид узла графа (22 значения). */
export const NodeKind = Object.freeze({
  File: 'file',
  Class: 'class',
  Function: 'function',
  Method: 'method',
  Property: 'property',
  Field: 'field',
  Interface: 'interface',
  Struct: 'struct',
  Enum: 'enum',
  TypeAlias: 'type_alias',
  Constant: 'constant',
  Variable: 'variable',
  Namespace: 'namespace',
  Module: 'module',
  Route: 'route',
  Trait: 'trait',
  Protocol: 'protocol',
  EnumMember: 'enum_member',
  Parameter: 'parameter',
  Import: 'import',
  Export: 'export',
  Component: 'component',
} as const);

export type NodeKind = (typeof NodeKind)[keyof typeof NodeKind];

/** Вид ребра графа (12 значений). */
export const EdgeKind = Object.freeze({
  Contains: 'contains',
  Calls: 'calls',
  Imports: 'imports',
  Extends: 'extends',
  Implements: 'implements',
  References: 'references',
  TypeOf: 'type_of',
  Returns: 'returns',
  Instantiates: 'instantiates',
  Overrides: 'overrides',
  Decorates: 'decorates',
  Exports: 'exports',
} as const);

export type EdgeKind = (typeof EdgeKind)[keyof typeof EdgeKind];

/** Вид ссылки — вид ребра или функциональная ссылка. */
export type ReferenceKind = EdgeKind | 'function_ref';

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
  language: Language;
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
  metadata?: Record<string, unknown>;
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
  provenance?: 'tree-sitter' | 'scip' | 'heuristic';
}

/** Запись о файле в БД. */
export interface IFileRecord {
  path: string;
  contentHash: string;
  language: Language;
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
  referenceKind: ReferenceKind;
  line: number;
  column: number;
  filePath?: string;
  language?: Language;
  candidates?: string[];
  status?: 'pending' | 'failed';
  nameTail?: string;
  rowId?: number;
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
export interface ITraversalOptions {
  maxDepth?: number;
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
  incomingRefs: Array<{ node: INode; edge: IEdge }>;
  outgoingRefs: Array<{ node: INode; edge: IEdge }>;
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
// Классы
// =============================================================================

/** Простое сопоставление glob-паттерна с путём файла. */
function matchGlob(filePath: string, pattern: string): boolean {
  // Разбираем паттерн на сегменты по разделителю
  const pSegs = pattern.split('/');
  const fSegs = filePath.split('/');
  return matchGlobSegs(pSegs, 0, fSegs, 0);
}

/** Рекурсивное сопоставление сегментов паттерна и пути. */
function matchGlobSegs(pSegs: string[], pi: number, fSegs: string[], fi: number): boolean {
  // Паттерн исчерпан — путь тоже должен быть исчерпан
  if (pi === pSegs.length) return fi === fSegs.length;

  // Паттерн исчерпан, а путь нет — не совпадает
  if (fi > fSegs.length) return false;

  const pSeg = pSegs[pi];

  // Паттерн ** — соответствует любому числу сегментов
  if (pSeg === '**') {
    // Пытаемся пропустить 0, 1, 2 ... сегментов пути
    for (let skip = 0; skip <= fSegs.length - fi; skip++) {
      if (matchGlobSegs(pSegs, pi + 1, fSegs, fi + skip)) return true;
    }
    return false;
  }

  // Текущий сегмент пути исчерпан, но паттерн ещё есть
  if (fi === fSegs.length) return false;

  // Сопоставляем текущий сегмент с учётом * и ?
  if (segMatch(pSeg, fSegs[fi])) {
    return matchGlobSegs(pSegs, pi + 1, fSegs, fi + 1);
  }

  return false;
}

/** Сопоставление одного сегмента с учётом * и ?. */
function segMatch(pSeg: string, fSeg: string): boolean {
  let pi = 0;
  let fi = 0;
  let starPi = -1;
  let starFi = -1;

  while (fi < fSeg.length) {
    const pc = pSeg[pi];

    if (pc === '*') {
      // Запоминаем позицию звезды для бэктрекинга
      starPi = pi + 1;
      starFi = fi;
      pi++;
    } else if (pc === '?' || pc === fSeg[fi]) {
      pi++;
      fi++;
    } else if (starPi !== -1) {
      // Откат к последней звезде и продвигаем её на один символ
      pi = starPi;
      starFi++;
      fi = starFi;
    } else {
      return false;
    }
  }

  // Остаток паттерна может быть только звёздами
  while (pi < pSeg.length && pSeg[pi] === '*') pi++;

  return pi === pSeg.length;
}

/** Класс для управления игнорированием файлов с поддержкой вложенных репозиториев. */
export class ScopeIgnore {
  private readonly _baseDir: string;
  private readonly _embeddedRepoRoots: string[];
  private readonly _customPatterns: Set<string>;

  constructor(baseDir: string, embeddedRepoRoots: string[]) {
    this._baseDir = baseDir.replace(/\\/g, '/');
    this._embeddedRepoRoots = embeddedRepoRoots.map(r => r.replace(/\\/g, '/'));
    this._customPatterns = new Set();
  }

  /** Проверяет, следует ли игнорировать указанный файл. */
  shouldIgnore(filePath: string): boolean {
    // Нормализуем разделители
    const norm = filePath.replace(/\\/g, '/');

    // Вложенные репозитории включаются — не игнорируем
    for (const root of this._embeddedRepoRoots) {
      if (norm.startsWith(root + '/') || norm === root) return false;
    }

    // Проверяем компоненты пути на совпадение с игнорируемыми директориями
    const parts = norm.split('/');
    for (const part of parts) {
      if (DEFAULT_IGNORE_DIRS.has(part)) return true;
    }

    // Проверяем паттерны по умолчанию
    for (const pat of DEFAULT_IGNORE_PATTERNS) {
      if (matchGlob(norm, pat)) return true;
    }

    // Проверяем пользовательские паттерны
    for (const pat of this._customPatterns) {
      if (matchGlob(norm, pat)) return true;
    }

    return false;
  }

  /** Добавляет пользовательский паттерн игнорирования. */
  addPattern(pattern: string): void {
    this._customPatterns.add(pattern.replace(/\\/g, '/'));
  }
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

// =============================================================================
// Типы экстракции
// =============================================================================

/** Прогресс индексации. */
export interface IIndexProgress {
  current: number;
  total: number;
  file: string;
  phase: 'scanning' | 'parsing' | 'storing' | 'resolving';
  durationMs: number;
}

/** Результат индексации. */
export interface IIndexResult {
  indexed: number;
  updated: number;
  removed: number;
  errors: IExtractionError[];
  durationMs: number;
}

/** Результат синхронизации. */
export interface ISyncResult {
  added: number;
  updated: number;
  removed: number;
  errors: IExtractionError[];
  durationMs: number;
}

/** Контекст запросов к графу — узлы, рёбра, иерархия. */
export interface IGraphQueryContext {
  getNodeById(id: string): INode | null;
  getNodesByKind(kind: NodeKind): INode[];
  getNodesByQualifiedName(qualifiedName: string): INode[];
  getNodesByLowerName(lowerName: string): INode[];
  getSupertypes(nodeId: string): INode[];
  getChildren(nodeId: string): INode[];
  getAncestors(nodeId: string): INode[];
  getIncomingEdges(nodeId: string): IEdge[];
  getOutgoingEdges(nodeId: string): IEdge[];
}

/** Контекст файловых запросов — файлы, импорты, содержимое. */
export interface IFileContext {
  getNodesByFile(filePath: string): INode[];
  getNodesByName(name: string): INode[];
  getImportMappings(filePath: string): IImportMapping[];
  getReExports(filePath: string, language?: Language): IReExport[];
  getFileContent(filePath: string): string | null;
  getFilePathFromNodeId(nodeId: string): string | null;
  getLanguageFromNodeId(nodeId: string): Language | null;
  getDetectedFrameworks(): string[];
  getAllFiles(): string[];
  iterateNodesByKind?(kind: NodeKind): IterableIterator<INode>;
  getFileLines?(filePath: string): string[] | null;
  getMethodMatches?(typeName: string, methodName: string, language: Language): INode[];
  getSupertypesByName?(typeName: string, language: Language): string[];
  getProjectAliases?(): IAliasMap | null;
  getGoModule?(): IGoModule | null;
  getWorkspacePackages?(): IWorkspacePackages | null;
  listDirectories?(relativePath: string): string[];
  getCppIncludeDirs?(): string[];
}

/** Контекст разрешения ссылок — объединяет графовые и файловые запросы. */
export interface IResolutionContext extends IGraphQueryContext, IFileContext {}

/** Разрешённая ссылка. */
export interface IResolvedRef {
  original: IUnresolvedReference;
  targetNodeId: string;
  confidence: number;
  provenance: string;
}

/** Результат разрешения. */
export interface IResolutionResult {
  resolved: IResolvedRef[];
  unresolved: IUnresolvedReference[];
  durationMs: number;
}

/** Re-export из модуля. */
export type IReExport =
  | { kind: 'named'; exportedName: string; originalName: string; source: string }
  | { kind: 'wildcard'; source: string };

/** Карта алиасов импортов (tsconfig paths и т.д.). */
export interface IAliasMap {
  [alias: string]: string[];
}

/** Информация о Go-модуле. */
export interface IGoModule {
  modulePath: string;
  goVersion: string;
  dependencies: Map<string, string>;
}

/** Пакеты workspace (monorepo). */
export interface IWorkspacePackages {
  packages: Map<string, string>;
  workspaces: string[];
}

/** Маппинг импорта на файл. */
export interface IImportMapping {
  localName: string;
  exportedName: string;
  source: string;
  isDefault: boolean;
  isNamespace: boolean;
  resolvedPath?: string;
}

/** Резолвер фреймворков. */
export interface IFrameworkResolver {
  /** Имя фреймворка */
  name: string;
  /** Языки, к которым применим резолвер. Если не указан — все языки. */
  languages?: Language[];
  /** Определение применимости резолвера к проекту (вызывается один раз при старте) */
  detect(context: IResolutionContext): boolean;
  /** Разрешение ссылки с использованием фреймворк-специфичных паттернов */
  resolve(ref: IUnresolvedReference, context: IResolutionContext): IResolvedRef | null;
  /**
   * Пропуск ссылки через pre-filter resolveOne, даже когда нет узла с таким именем.
   * Необходимо для динамической диспетчеризации, где цель вызова — атрибут/дескриптор,
   * а не объявленный символ (например, Django self._iterable_class(...), Laravel Controller@method).
   * Возврат true позволяет ссылке достичь resolve() вместо отбрасывания.
   */
  claimsReference?(name: string): boolean;
  /**
   * Экстракция фреймворк-специфичных узлов и ссылок из файла.
   * Возвращает route-узлы, middleware-узлы и т.д., плюс неразрешённые ссылки,
   * которые связывают эти узлы с обработчиками (view-классы, методы контроллеров).
   */
  extract?(filePath: string, content: string): IFrameworkExtractionResult;
  /**
   * Кросс-файловая финализация, вызывается один раз после завершения экстракции
   * всех файлов (и снова при каждой инкрементальной синхронизации).
   * Используется фреймворками, где финальное представление символа зависит от
   * соседнего файла, который per-file extract() никогда не видел.
   * Например, NestJS RouterModule.register([...]) устанавливает префиксы маршрутов
   * для контроллеров, объявленных в другом месте.
   */
  postExtract?(context: IResolutionContext): INode[];
}

/** Результат фреймворк-экстракции. */
export interface IFrameworkExtractionResult {
  /** Фреймворк-специфичные узлы (например, маршруты) */
  nodes: INode[];
  /** Фреймворк-специфичные неразрешённые ссылки (например, маршрут → обработчик) */
  references: IUnresolvedReference[];
}

/** Максимальный размер файла для индексации (1 МБ). */
export const MAX_FILE_SIZE = 1024 * 1024;

/** Интервал пересоздания worker-потока (250 файлов). */
export const WORKER_RECYCLE_INTERVAL = 250;

/** Базовый таймаут парсинга (10 секунд). */
export const PARSE_TIMEOUT_MS = 10_000;

/** Доп. таймаут на каждые 10 КБ (10 секунд). */
export const PARSE_TIMEOUT_PER_10KB = 10_000;

/** Размер батча для чтения файлов. */
export const FILE_IO_BATCH_SIZE = 10;

/** Интервал cooperative yield при сканировании. */
export const SCAN_YIELD_INTERVAL = 100;

/** Интервал cooperative yield при синхронизации. */
export const SYNC_YIELD_INTERVAL = 1000;

/** Интервал уступки event loop при sync (каждые 1000 файлов). */
export const SYNC_RECONCILE_YIELD_INTERVAL = SYNC_YIELD_INTERVAL;

/** Глубина поиска вложенных репозиториев. */
export const EMBEDDED_REPO_SEARCH_DEPTH = 4;

/** Лимит директорий при поиске вложенных репозиториев. */
export const EMBEDDED_REPO_SEARCH_ENTRIES = 2000;

/** Директории по умолчанию для игнорирования. */
export const DEFAULT_IGNORE_DIRS: ReadonlySet<string> = new Set([
  'node_modules', 'bower_components', 'jspm_packages', 'web_modules',
  '.yarn', '.pnpm-store',
  '.next', '.nuxt', '.svelte-kit', '.turbo', '.vite', '.parcel-cache', '.angular',
  '.docusaurus', 'storybook-static', '.vinxi', '.nitro', 'out-tsc',
  '.vercel', '.netlify', '.wrangler',
  'dist', 'build', 'out', '.output',
  'coverage', '.nyc_output',
  '__pycache__', '__pypackages__', '.venv', 'venv', '.pixi', '.pdm-build',
  '.mypy_cache', '.pytest_cache', '.ruff_cache', '.tox', '.nox', '.hypothesis',
  '.ipynb_checkpoints', '.eggs',
  'target', '.gradle',
  'obj',
  'vendor',
  '.build', 'Pods', 'Carthage', 'DerivedData', '.swiftpm',
  '.dart_tool', '.pub-cache',
  '.cxx', '.externalNativeBuild', 'vcpkg_installed',
  '.bloop', '.metals',
  'lua_modules', '.luarocks',
  '__history', '__recovery',
  '.cache',
]);

/** Паттерны игнорирования по умолчанию. */
export const DEFAULT_IGNORE_PATTERNS: string[] = [
  ...Array.from(DEFAULT_IGNORE_DIRS, (d) => `${d}/`),
  '*.egg-info/',
  'cmake-build-*/',
  'bazel-*/',
];
