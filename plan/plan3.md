# Фаза 3: Графовый обход и разрешение ссылок

## Обзор

Добавление графового обхода (BFS/DFS), анализа радиуса воздействия, разрешения ссылок (импорты, вызовы, наследование) и построения контекста для AI. Эта фаза использует узлы и ребра из Фазы 1 и Фазы 2 для построения семантического графа кода.

## Текущее состояние

### Модули нашего репозитория

- `src/repo/RepoAnalyzer.ts` — поверхностный анализ репозитория без графа. Не понимает связи между символами.
- `src/repo/CodebaseSearch.ts` — гибридный поиск (семантический + ключевые слова), не использует граф.
- Нет модулей для графового обхода, разрешения ссылок, или построения контекста.

### Проблемы текущего подхода

- Нет понимания связей между символами (кто кого вызывает, что наследует)
- Поиск не может найти все использования символа
- Нет анализа радиуса воздействия изменений
- Нет разрешения импортов (где определен импортируемый символ)
- Контекст для AI не включает графовые отношения

## Типы данных

### ITraversalOptions

```typescript
export interface ITraversalOptions {
  maxDepth?: number;
  edgeKinds?: EdgeKind[];
  nodeKinds?: NodeKind[];
  direction?: 'outgoing' | 'incoming' | 'both';
  limit?: number;
  includeStart?: boolean;
}
```

### ISubgraph

```typescript
export interface ISubgraph {
  nodes: Map<string, INode>;
  edges: IEdge[];
  roots: string[];
  confidence?: 'high' | 'low';
}
```

### IUnresolvedRef

```typescript
export interface IUnresolvedRef {
  fromNodeId: string;
  referenceName: string;
  referenceKind: string;
  line: number;
  column: number;
  filePath: string;
  language: string;
  candidates?: string[];
}
```

### IResolvedRef

```typescript
export interface IResolvedRef {
  original: IUnresolvedRef;
  targetNodeId: string;
  confidence: number;
  provenance: string;
}
```

### IResolutionResult

```typescript
export interface IResolutionResult {
  resolved: IResolvedRef[];
  unresolved: IUnresolvedRef[];
  durationMs: number;
}
```

### IResolutionContext

Интерфейс с 18 методами для доступа к данным графа из кода разрешения ссылок:

```typescript
export interface IResolutionContext {
  getNodesByFile(filePath: string): INode[];
  getNodesByName(name: string): INode[];
  getImportMappings(filePath: string): IImportMapping[];
  getReExports(filePath: string): IReExport[];
  getNodeById(id: string): INode | null;
  getNodesByKind(kind: NodeKind): INode[];
  getNodesByQualifiedName(qualifiedName: string): INode[];
  getNodesByLowerName(lowerName: string): INode[];
  getSupertypes(nodeId: string): INode[];
  getChildren(nodeId: string): INode[];
  getAncestors(nodeId: string): INode[];
  getIncomingEdges(nodeId: string, kinds?: EdgeKind[]): IEdge[];
  getOutgoingEdges(nodeId: string, kinds?: EdgeKind[]): IEdge[];
  getFileContent(filePath: string): string | null;
  getFilePathFromNodeId(nodeId: string): string | null;
  getLanguageFromNodeId(nodeId: string): string | null;
  getDetectedFrameworks(): string[];
  getAllFiles(): string[];
}
```

### IFrameworkResolver

```typescript
export interface IFrameworkResolver {
  name: string;
  resolve(ref: IUnresolvedRef, context: IResolutionContext): IResolvedRef | null;
  postExtract?(context: IResolutionContext): INode[];
  claimsReference?(name: string): boolean;
}
```

### IImportMapping

```typescript
export interface IImportMapping {
  sourcePath: string;
  sourceName: string;
  targetPath: string;
  targetName: string;
  language: string;
}
```

### IReExport

```typescript
export interface IReExport {
  sourcePath: string;
  sourceName: string;
  language: string;
}
```

### IAliasMap

```typescript
export interface IAliasMap {
  [alias: string]: string[];
}
```

### IGoModule

```typescript
export interface IGoModule {
  modulePath: string;
  goVersion: string;
  dependencies: Map<string, string>;
}
```

### IWorkspacePackages

```typescript
export interface IWorkspacePackages {
  packages: Map<string, string>;
  workspaces: string[];
}
```

### ITaskContext

```typescript
export interface ITaskContext {
  query: string;
  subgraph: ISubgraph;
  entryPoints: INode[];
  codeBlocks: ICodeBlock[];
  relatedFiles: string[];
  summary: string;
  stats: {
    nodeCount: number;
    edgeCount: number;
    fileCount: number;
    codeBlockCount: number;
    totalCodeSize: number;
  };
}
```

### ICodeBlock

```typescript
export interface ICodeBlock {
  content: string;
  filePath: string;
  startLine: number;
  endLine: number;
  language: string;
  node: INode;
}
```

### ISearchResult

```typescript
export interface ISearchResult {
  node: INode;
  score: number;
  highlights?: string[];
}
```

### ISearchOptions

```typescript
export interface ISearchOptions {
  kinds?: NodeKind[];
  languages?: string[];
  pathFilters?: string[];
  nameFilters?: string[];
  limit?: number;
  offset?: number;
}
```

### Language

```typescript
export const Language = Object.freeze([
  'typescript', 'javascript', 'python', 'go', 'rust', 'java', 'kotlin',
  'csharp', 'swift', 'scala', 'dart', 'ruby', 'php', 'cpp', 'c',
  'pascal', 'objc', 'html', 'css', 'sql', 'json', 'yaml', 'xml',
  'markdown', 'shell', 'dockerfile', 'toml', 'ini', 'razor', 'vue', 'svelte'
] as const);

export type Language = (typeof Language)[number];
```

## Константы

### DEFAULT_OPTIONS

```typescript
export const DEFAULT_OPTIONS: Required<ITraversalOptions> = {
  maxDepth: Infinity,
  edgeKinds: [],
  nodeKinds: [],
  direction: 'outgoing',
  limit: 1000,
  includeStart: true,
};
```

### DEFAULT_BUILD_OPTIONS

```typescript
export const DEFAULT_BUILD_OPTIONS: Required<IBuildContextOptions> = {
  maxNodes: 20,
  maxCodeBlocks: 5,
  maxCodeBlockSize: 1500,
  includeCode: true,
  format: 'markdown',
  searchLimit: 3,
  traversalDepth: 1,
  minScore: 0.3,
};
```

### DEFAULT_FIND_OPTIONS

```typescript
export const DEFAULT_FIND_OPTIONS: Required<IFindRelevantContextOptions> = {
  searchLimit: 3,
  traversalDepth: 1,
  maxNodes: 20,
  minScore: 0.3,
  edgeKinds: [],
  nodeKinds: HIGH_VALUE_NODE_KINDS,
};
```

### DEFAULT_CACHE_LIMIT

```typescript
export const DEFAULT_CACHE_LIMIT = 5_000;
```

### HIGH_VALUE_NODE_KINDS

```typescript
export const HIGH_VALUE_NODE_KINDS = new Set<NodeKind>([
  'function', 'method', 'class', 'interface', 'type_alias', 'struct',
  'trait', 'component', 'route', 'variable', 'constant', 'enum',
  'module', 'namespace'
]);
```

### SUPERTYPE_BEARING_KINDS

```typescript
export const SUPERTYPE_BEARING_KINDS = new Set<NodeKind>([
  'class', 'struct', 'interface', 'trait', 'protocol', 'enum'
]);
```

### CHAIN_LANGUAGES

```typescript
export const CHAIN_LANGUAGES = new Set([
  'java', 'kotlin', 'csharp', 'swift', 'rust', 'go', 'scala', 'dart', 'objc', 'pascal'
]);
```

### SCOPED_CHAIN_LANGUAGES

```typescript
export const SCOPED_CHAIN_LANGUAGES = new Set(['rust']);
```

### CHAIN_SHAPE

```typescript
export const CHAIN_SHAPE = /^(.+)\(\)\.(\w+)$/;
```

### MAX_HOPS

```typescript
export const MAX_HOPS = 6;
```

### LOW_CONFIDENCE_MARKER

```typescript
export const LOW_CONFIDENCE_MARKER = '__LOW_CONFIDENCE_HANDOFF__';
```

### Встроенные символы по языкам

```typescript
// JavaScript/TypeScript — 27 символов
export const JS_BUILT_INS = new Set([
  'console', 'window', 'document', 'Promise', 'Array', 'Object',
  'String', 'Number', 'Boolean', 'Map', 'Set', 'WeakMap', 'WeakSet',
  'Date', 'Math', 'JSON', 'RegExp', 'Error', 'TypeError', 'SyntaxError',
  'ReferenceError', 'RangeError', 'parseInt', 'parseFloat', 'setTimeout',
  'setInterval', 'clearTimeout', 'clearInterval'
]);

// React hooks — 10 хуков
export const REACT_HOOKS = new Set([
  'useState', 'useEffect', 'useContext', 'useReducer', 'useMemo',
  'useCallback', 'useRef', 'useImperativeHandle', 'useLayoutEffect',
  'useDebugValue'
]);

// Python — 20 встроенных символов
export const PYTHON_BUILT_INS = new Set([
  'print', 'len', 'range', 'list', 'dict', 'set', 'tuple', 'str',
  'int', 'float', 'bool', 'type', 'isinstance', 'issubclass', 'hasattr',
  'getattr', 'setattr', 'delattr', 'super', 'property', 'staticmethod',
  'classmethod', 'enumerate', 'zip', 'map', 'filter', 'sorted', 'reversed',
  'any', 'all', 'min', 'max', 'sum', 'abs', 'round', 'open', 'input',
  'repr', 'id', 'hash', 'callable', 'dir', 'vars', 'locals', 'globals'
]);

// Python встроенные типы — 10 типов
export const PYTHON_BUILT_IN_TYPES = new Set([
  'str', 'int', 'float', 'bool', 'list', 'dict', 'set', 'tuple', 'bytes', 'NoneType'
]);

// Python встроенные методы — 50+ методов
export const PYTHON_BUILT_IN_METHODS = new Set([
  'append', 'extend', 'insert', 'remove', 'pop', 'clear', 'index', 'count',
  'sort', 'reverse', 'copy', 'keys', 'values', 'items', 'get', 'setdefault',
  'update', 'popitem', 'fromkeys', 'add', 'discard', 'difference', 'union',
  'intersection', 'symmetric_difference', 'startswith', 'endswith', 'find',
  'rfind', 'index', 'rindex', 'count', 'replace', 'split', 'rsplit', 'join',
  'strip', 'lstrip', 'rstrip', 'lower', 'upper', 'capitalize', 'title',
  'swapcase', 'encode', 'decode', 'format', 'center', 'ljust', 'rjust',
  'zfill', 'translate', 'maketrans', 'isalnum', 'isalpha', 'isdigit',
  'islower', 'isupper', 'isspace', 'istitle', 'isnumeric', 'isdecimal',
  'isidentifier', 'isascii', 'casefold', 'expandtabs', 'partition', 'rpartition',
  'splitlines', 'lstrip', 'rstrip', 'strip'
]);

// Go стандартные пакеты — 65+ пакетов
export const GO_STDLIB_PACKAGES = new Set([
  'fmt', 'os', 'io', 'net', 'http', 'context', 'sync', 'time', 'strings',
  'strconv', 'sort', 'math', 'math/rand', 'math/big', 'encoding/json',
  'encoding/xml', 'encoding/csv', 'encoding/base64', 'encoding/hex',
  'errors', 'log', 'log/slog', 'path', 'path/filepath', 'strings',
  'bytes', 'bufio', 'regexp', 'reflect', 'unsafe', 'runtime', 'runtime/debug',
  'runtime/pprof', 'debug/elf', 'debug/gosym', 'debug/macho', 'debug/pe',
  'go/ast', 'go/parser', 'go/token', 'go/types', 'go/importer',
  'go/build', 'go/doc', 'go/format', 'go/printer', 'go/scanner',
  'text/template', 'text/tabwriter', 'text/scanner', 'text/csv',
  'database/sql', 'crypto', 'crypto/aes', 'crypto/cipher', 'crypto/des',
  'crypto/dsa', 'crypto/ecdsa', 'crypto/ed25519', 'crypto/elliptic',
  'crypto/hmac', 'crypto/md5', 'crypto/rand', 'crypto/rc4', 'crypto/rsa',
  'crypto/sha1', 'crypto/sha256', 'crypto/sha512', 'crypto/subtle',
  'crypto/tls', 'crypto/x509', 'crypto/x509/pkix', 'compress/gzip',
  'compress/flate', 'compress/zlib', 'compress/lzw', 'compress/bzip2',
  'archive/tar', 'archive/zip', 'hash', 'hash/adler32', 'hash/crc32',
  'hash/crc64', 'hash/fnv', 'hash/maphash', 'unicode', 'unicode/utf8',
  'unicode/utf16', 'image', 'image/color', 'image/draw', 'image/gif',
  'image/jpeg', 'image/png', 'net/url', 'net/http', 'net/http/httptest',
  'net/http/httputil', 'net/textproto', 'net/rpc', 'net/smtp',
  'net/mail', 'mime', 'mime/multipart', 'mime/quotedprintable',
  'testing', 'testing/fstest', 'testing/iotest', 'testing/quick',
  'plugin', 'internal/testenv', 'internal/trace', 'internal/profile'
]);

// Go встроенные — 35+ символов
export const GO_BUILT_INS = new Set([
  'make', 'new', 'len', 'cap', 'append', 'copy', 'delete', 'close',
  'panic', 'recover', 'print', 'println', 'error', 'string', 'int',
  'int8', 'int16', 'int32', 'int64', 'uint', 'uint8', 'uint16', 'uint32',
  'uint64', 'float32', 'float64', 'complex64', 'complex128', 'bool',
  'byte', 'rune', 'uintptr', 'complex', 'real', 'imag', 'iota',
  'true', 'false', 'nil'
]);

// Pascal префиксы модулей — 13 префиксов
export const PASCAL_UNIT_PREFIXES = new Set([
  'System', 'SysUtils', 'Classes', 'Graphics', 'Controls', 'Forms',
  'Dialogs', 'StdCtrls', 'ExtCtrls', 'Menus', 'Buttons', 'ComCtrls', 'ExtDlgs'
]);

// Pascal встроенные — 50+ символов
export const PASCAL_BUILT_INS = new Set([
  'WriteLn', 'Write', 'ReadLn', 'Read', 'Halt', 'Exit', 'Dispose',
  'GetMem', 'FreeMem', 'New', 'Inc', 'Dec', 'Ord', 'Chr', 'Succ',
  'Pred', 'Round', 'Trunc', 'Floor', 'Ceil', 'Abs', 'Sqr', 'Sqrt',
  'Sin', 'Cos', 'ArcTan', 'Ln', 'Exp', 'Pi', 'Odd', 'High', 'Low',
  'SizeOf', 'Length', 'Copy', 'Delete', 'Insert', 'Pos', 'Concat',
  'Str', 'Val', 'UpCase', 'LowCase', 'Trim', 'TrimLeft', 'TrimRight',
  'AnsiLowerCase', 'AnsiUpperCase', 'AnsiCompareStr', 'AnsiCompareText',
  'SameStr', 'SameText', 'Format', 'FormatFloat', 'IntToStr', 'StrToInt',
  'StrToFloat', 'FloatToStr', 'TryStrToInt', 'TryStrToFloat', 'ChangeFileExt',
  'ExtractFilePath', 'ExtractFileName', 'ExtractFileDir', 'ExtractFileDrive',
  'ExtractFileExt', 'ExtractFileExt', 'IncludeTrailingPathDelimiter',
  'ExcludeTrailingPathDelimiter', 'DirectoryExists', 'FileExists',
  'FileSearch', 'FileAge', 'FileSetDate', 'RenameFile', 'DeleteFile',
  'ForceDirectories', 'CreateDir', 'RemoveDir', 'GetDir', 'SetDir'
]);

// C встроенные — 70+ символов
export const C_BUILT_INS = new Set([
  'printf', 'fprintf', 'sprintf', 'snprintf', 'scanf', 'fscanf', 'sscanf',
  'puts', 'fputs', 'putchar', 'fputc', 'gets', 'fgets', 'getchar', 'fgetc',
  'malloc', 'calloc', 'realloc', 'free', 'printf', 'sprintf', 'snprintf',
  'strlen', 'strcpy', 'strncpy', 'strcat', 'strncat', 'strcmp', 'strncmp',
  'strstr', 'strchr', 'strrchr', 'strtok', 'strspn', 'strcspn', 'strpbrk',
  'atoi', 'atol', 'atof', 'strtol', 'strtoul', 'strtod', 'strtold',
  'fopen', 'fclose', 'fread', 'fwrite', 'fseek', 'ftell', 'rewind',
  'feof', 'ferror', 'clearerr', 'fflush', 'setvbuf', 'setbuf',
  'remove', 'rename', 'tmpfile', 'tmpnam', 'fgetpos', 'fsetpos',
  'perror', 'exit', 'abort', 'atexit', 'system', 'getenv', 'setenv',
  'signal', 'raise', 'time', 'clock', 'difftime', 'strftime', 'localtime',
  'gmtime', 'mktime', 'asctime', 'ctime', 'rand', 'srand', 'qsort', 'bsearch',
  'memcpy', 'memmove', 'memset', 'memcmp', 'offsetof', 'va_start', 'va_arg',
  'va_end', 'va_copy', 'va_list', 'size_t', 'ptrdiff_t', 'intptr_t',
  'uintptr_t', 'int8_t', 'int16_t', 'int32_t', 'int64_t', 'uint8_t',
  'uint16_t', 'uint32_t', 'uint64_t'
]);

// C++ встроенные — 15 символов
export const CPP_BUILT_INS = new Set([
  'cout', 'cin', 'cerr', 'clog', 'endl', 'std', 'vector', 'string',
  'map', 'unordered_map', 'set', 'unordered_set', 'pair', 'tuple', 'shared_ptr'
]);
```

## Референсный код

### GraphTraverser

Референс: `ref/contents/codegraph/src/graph/traversal.ts`

Класс `GraphTraverser` предоставляет:

#### BFS-обход

```typescript
traverseBFS(startId: string, options?: ITraversalOptions): ISubgraph
```

Алгоритм:
1. Создать очередь, начальная запись: `{ nodeId: startId, depth: 0, edge: null }`
2. Создать `visited: Set<string>` для отслеживания посещенных узлов
3. Создать `nodes: Map<string, INode>` и `edges: IEdge[]` для результата
4. Для каждой итерации из очереди:
   a. Пропустить, если nodeId уже в visited
   b. Добавить nodeId в visited
   c. Получить узел через `getNodeById(nodeId)`, добавить в nodes
   d. Если depth > 0 и edge не null, добавить edge в edges
   e. Получить соседние ребра через `getAdjacentEdges(nodeId, direction, edgeKinds)`
   f. Сортировать ребра по приоритету: contains (0) > calls (1) > остальные (2)
   f. Собрать все уникальные соседние nodeId из ребер
   g. Batch-запрос соседей через `getNodesByIds(neighborIds)` — устраняет N+1
   h. Для каждого отфильтрованного соседа (nodeKinds, depth < maxDepth) добавить в очередь `{ nodeId, depth: depth + 1, edge }`
5. Остановить, если достигнут limit или очередь пуста
6. Вернуть ISubgraph с nodes, edges, roots

#### DFS-обход

```typescript
traverseDFS(startId: string, options?: ITraversalOptions): ISubgraph
```

Алгоритм:
1. Создать `visited: Set<string>`, `nodes: Map<string, INode>`, `edges: IEdge[]`
2. Вызвать `dfsRecursive(startId, 0, null, options, nodes, edges, visited)`
3. Вернуть ISubgraph

Метод `dfsRecursive(nodeId, depth, edge, opts, nodes, edges, visited)`:
1. Пропустить, если nodeId в visited или глубина превышена
2. Добавить nodeId в visited, узел в nodes, ребро в edges (если depth > 0)
3. Получить соседние ребра через `getAdjacentEdges(nodeId, direction, edgeKinds)`
4. Сортировать по приоритету: contains (0) > calls (1) > остальные (2)
5. Для каждого соседа вызвать `dfsRecursive(neighborId, depth + 1, edge, opts, nodes, edges, visited)`

#### getAdjacentEdges

```typescript
getAdjacentEdges(nodeId: string, direction?: 'outgoing' | 'incoming' | 'both', edgeKinds?: EdgeKind[]): IEdge[]
```

- Если direction === 'outgoing': вызвать `getOutgoingEdges(nodeId, edgeKinds)`
- Если direction === 'incoming': вызвать `getIncomingEdges(nodeId, edgeKinds)`
- Если direction === 'both': объединить оба результата

#### Поиск вызывающих

```typescript
getCallers(nodeId: string, maxDepth?: number): Array<{ node: INode; edge: IEdge }>
```

- Находит все узлы, которые вызывают данный узел (входящие ребра `calls`, `references`, `imports`, `instantiates`)
- Рекурсивный обход с batch-запросами

#### Поиск вызываемых

```typescript
getCallees(nodeId: string, maxDepth?: number): Array<{ node: INode; edge: IEdge }>
```

- Находит все узлы, которые вызывает данный узел (исходящие ребра `calls`, `references`, `imports`, `instantiates`)
- Рекурсивный обход с batch-запросами

#### Граф вызовов

```typescript
getCallGraph(nodeId: string, depth?: number): ISubgraph
```

- Возвращает подграф вызывающих и вызываемых узлов

#### Иерархия типов

```typescript
getTypeHierarchy(nodeId: string): ISubgraph
```

- Находит предков (extends/implements) и потомков (что наследует этот тип)
- Рекурсивный обход с batch-запросами

#### Поиск использований

```typescript
findUsages(nodeId: string): Array<{ node: INode; edge: IEdge }>
```

- Все входящие ребра на узел (references, calls, type_of и т.д.)

#### Радиус воздействия

```typescript
getImpactRadius(nodeId: string, maxDepth?: number): ISubgraph
```

Алгоритм:
1. Начать от узла nodeId
2. Определить, является ли узел контейнером (class, interface, struct, trait, protocol, module, enum)
3. Если контейнер:
   a. Обойти дочерние узлы на той же глубине (не depth+1), так как они часть того же символа
   b. Ребра `contains` исключены из входящего обхода — предотвращает подъем к родителю и повторное расширение братьев
4. Получить все входящие ребра (исключая `contains`)
5. Рекурсивно обйти зависимости
6. Ограничить maxDepth (по умолчанию 3)
7. Вернуть ISubgraph

#### Поиск пути

```typescript
findPath(fromId: string, toId: string, edgeKinds?: EdgeKind[]): Array<{ node: INode; edge: IEdge | null }> | null
```

- BFS для поиска кратчайшего пути между двумя узлами
- Структура элемента очереди: `{ nodeId: string; path: Array<{ node: INode; edge: IEdge | null }> }`
- Путь накапливается по мере обхода (не восстанавливается из родителей)
- Batch-запрос ненавещенных целей для устранения N+1

#### Родители и дети

```typescript
getAncestors(nodeId: string): INode[];
getChildren(nodeId: string): INode[];
```

- Родители через входящие ребра `contains`
- Дети через исходящие ребра `contains` с batch-запросами

### Почему instantiates включен в callers/callees

- Конструирование класса `Foo()` / `new Foo()` — это вызов конструктора
- Без `instantiates` `callers <Class>` пропускает все места конструирования

### ReferenceResolver

Референс: `ref/contents/codegraph/src/resolution/index.ts`

Класс `ReferenceResolver` координирует все стратегии разрешения ссылок.

#### Методы

```typescript
export class ReferenceResolver {
  constructor(projectRoot: string, queries: QueryBuilder);

  initialize(): void;
  warmCaches(): void;
  clearCaches(): void;

  resolveAll(unresolvedRefs: IUnresolvedRef[], onProgress?: (resolved: number, total: number) => void): IResolutionResult;
  resolveOne(ref: IUnresolvedRef): IResolvedRef | null;
  createEdges(resolved: IResolvedRef[]): IEdge[];
  resolveAndPersist(unresolvedRefs: IUnresolvedRef[], onProgress?: (resolved: number, total: number) => void): IResolutionResult;
  async resolveAndPersistBatched(onProgress?: (resolved: number, total: number) => void, batchSize?: number): Promise<IResolutionResult>;

  resolveChainedCallsViaConformance(): number;
  resolveDeferredThisMemberRefs(): number;
  runPostExtract(): number;
  getDetectedFrameworks(): string[];
  hasAnyPossibleMatch(name: string): boolean;
  matchesAnyImport(ref: IUnresolvedRef): boolean;
  resolveThisMemberFnRef(ref: IUnresolvedRef): IResolvedRef | null;
  resolveRazorUsing(ref: IUnresolvedRef): IResolvedRef | null;
  getRazorUsings(filePath: string): string[];
  gateLanguage(result: IResolvedRef | null, ref: IUnresolvedRef): IResolvedRef | null;
  gateFrameworkLanguage(result: IResolvedRef | null, ref: IUnresolvedRef): IResolvedRef | null;
  getFilePathFromNodeId(nodeId: string): string | null;
  getLanguageFromNodeId(nodeId: string): string | null;
}
```

#### Стратегии разрешения

1. **Встроенные символы** — фильтрация по языку (JS_BUILT_INS, PYTHON_BUILT_INS, GO_BUILT_INS и т.д.)
2. **Фреймворк-специфичное разрешение** — для каждого обнаруженного фреймворка
3. **Razor/Blazor @using** — выделенная стратегия для .razor/.cshtml файлов
4. **JVM FQN импорт** — `resolveJvmImport()` для `com.example.foo.Bar`
5. **Разрешение через импорты** — `resolveViaImport()` — разрешение через import-карты
6. **Совпадение по имени** — `matchReference()` — поиск по имени символа
7. **Функции как значения** — `matchFunctionRef()` — для callback-регистраций

#### Кэширование

- LRU-кэш с ограничением (по умолчанию 5000 записей, настраивается через `NTGRAPH_RESOLVER_CACHE_SIZE`)
- Кэши: nodeCache, fileCache, importMappingCache, reExportCache, nameCache, lowerNameCache, qualifiedNameCache, razorUsingsCache
- Предварительная загрузка: `warmCaches()` загружает knownNames и knownFiles для быстрой фильтрации

#### hasAnyPossibleMatch

- O(1) предварительная фильтрация через knownNames Set
- Если имя ссылки отсутствует в knownNames, пропускает все стратегии

#### matchesAnyImport

- Escape hatch для разрешения цепочек реэкспорта
- Проверяет, совпадает ли ссылка с любым известным импортом

#### gateLanguage

- Отбрасывает разрешение через импорты/имена при переходе между языковыми семействами
- Использует `sameLanguageFamily()` и `crossesKnownFamily()`

#### gateFrameworkLanguage

- Отбрасывает фреймворковое разрешение для cross-family type-usage ребер

#### Batch-разрешение

```typescript
async resolveAndPersistBatched(onProgress?, batchSize = 5000): Promise<IResolutionResult>
```

Алгоритм:
1. Получить unresolved references пачками по batchSize
2. Разрешить каждую ссылку через `resolveOne()`
3. Создать ребра из разрешенных ссылок через `createEdges()`
4. Вставить ребра в БД через `insertEdges()`
5. Удалить разрешенные ссылки из unresolved_refs (удаляет только разрешенные, неразрешимые остаются)
6. Yield для event loop между пачками (await Promise.resolve())
7. После всех пачек вызвать `synthesizeCallbackEdges()` для добавления callback-ребер
8. Защита от бесконечного цикла: если `remaining >= prevRemaining`, break

#### resolveAndPersistBatched — удаление неразрешимых ссылок

- После всех пачек удаляет неразрешимые ссылки, которые не были разрешены ни одной стратегией
- Это предотвращает накопление мусора в unresolved_refs

#### runPostExtract

- Запускает cross-file финализацию каждого фреймворка
- Очищает кэши ДО и ПОСЛЕ запуска
- Оборачивается в try/catch для изоляции ошибок

#### 3-проходное разрешение

**Проход 1 — Основной:**
- `resolveAll()` / `resolveAndPersistBatched()` — стандартное разрешение через все стратегии

**Проход 2 — Цепные вызовы через соответствие (Chained calls via conformance):**
- `resolveChainedCallsViaConformance()` — разрешение `inner().method` паттернов на супертипах
- Работает только для языков из CHAIN_LANGUAGES
- Использует CHAIN_SHAPE regex для обнаружения паттерна
- Вызывается ПОСЛЕ построения extends/implements ребер

**Проход 3 — Отложенные this.<member> ссылки:**
- `resolveDeferredThisMemberRefs()` — разрешение `this.<member>` где member унаследован
- BFS по графу супертипов

### ContextBuilder

Референс: `ref/contents/codegraph/src/context/index.ts`

Класс `ContextBuilder` строит контекст для AI-задач.

#### Методы

```typescript
export class ContextBuilder {
  constructor(projectRoot: string, queries: QueryBuilder, traverser: GraphTraverser);

  async buildContext(input: TaskInput, options?: IBuildContextOptions): Promise<ITaskContext | string>;
  async findRelevantContext(query: string, options?: IFindRelevantContextOptions): Promise<ISubgraph>;
  async getCode(nodeId: string): Promise<string | null>;

  buildCallPathsSection(subgraph: ISubgraph): string;
  buildLowConfidenceNote(entryPoints: INode[]): string;
  extractCodeBlocks(subgraph: ISubgraph, maxBlocks: number, maxBlockSize: number): ICodeBlock[];
  extractNodeCode(node: INode): string | null;
  generateSummary(query: string, subgraph: ISubgraph, entryPoints: INode[]): string;
  getRelatedFiles(subgraph: ISubgraph): string[];
  resolveImportsToDefinitions(results: ISearchResult[]): ISearchResult[];
}
```

#### Конвейер построения контекста

1. Парсинг входных данных (строка или {title, description})
2. Извлечение символов из запроса (extractSymbolsFromQuery)
3. Точный поиск символов (findNodesByExactName)
4. FTS-поиск (searchNodes с префиксным совпадением)
5. Расширение графа от точек входа (BFS)
6. Извлечение блоков кода для ключевых узлов
7. Форматирование (Markdown или JSON)

#### extractCodeBlocks

Приоритизированное извлечение блоков кода:
1. Сначала точки входа (entry points)
2. Затем функции/методы
3. Затем классы

#### extractNodeCode

1. Прочитать файл из файловой системы
2. Извлечь строки от startLine до endLine
3. Ограничить maxCodeBlockSize (по умолчанию 1500 символов)
4. Защита config-листов: если `isConfigLeafNode(node)`, вернуть только ключ, не читать значение

#### buildCallPathsSection

Алгоритм:
1. DFS по ребрам `calls` с MAX_HOPS = 6
2. Бюджет 2000 для ограничения работы на плотных подграфах
3. Фильтрация цепей, соединяющих 2+ релевантных символов (roots)
4. Отметка динамических диспетчеризаций (callback, event, React re-render, Vue handler)
5. Синтезированные шаги помечаются инлайн-лейблами

#### buildLowConfidenceNote

- Обнаруживает, когда запрос совпал преимущественно с общими словами
- Добавляет заметку с маркером LOW_CONFIDENCE_MARKER, советующую использовать `ntgraph_explore` с точными именами

#### getRelatedFiles

- Возвращает отсортированный уникальный список файлов из подграфа

#### generateSummary

- Генерирует текстовое описание на основе query, subgraph и entryPoints

#### resolveImportsToDefinitions

- Следует imports/exports ребрам для замены узлов импорта их определениями

## Референсные файлы

При реализации каждого модуля ниже смотри указанный файл референсного кода.
**Важно:** код писать новый, с нашими именами (NtGraphDb, ntgraph и т.д.).
Методы и алгоритмы можно использовать как образец.

| Наш файл | Референсный файл |
|---|---|
| `src/repo/graph/Traverser.ts` | `ref/contents/codegraph/src/graph/traversal.ts` |
| `src/repo/resolution/Resolver.ts` | `ref/contents/codegraph/src/resolution/index.ts` |
| `src/repo/context/Builder.ts` | `ref/contents/codegraph/src/context/index.ts` |

## Архитектура

### Структура модуля

```
src/repo/
  graph/
    index.ts              — точка экспорта
    Traverser.ts          — GraphTraverser
    ImpactAnalyzer.ts     — анализ радиуса воздействия
  resolution/
    index.ts              — точка экспорта
    Resolver.ts           — ReferenceResolver
    LruCache.ts           — LRU-кэш
    NameMatcher.ts        — matchReference, matchFunctionRef, matchDottedCallChain, matchScopedCallChain, sameLanguageFamily, crossesKnownFamily
    ImportResolver.ts     — resolveViaImport, resolveJvmImport, extractImportMappings, extractReExports, loadCppIncludeDirs, isPhpIncludePathRef
    BuiltIns.ts           — встроенные символы по языкам
    CallbackSynthesizer.ts — synthesizeCallbackEdges
    PathAliases.ts        — loadProjectAliases
    GoModule.ts           — loadGoModule
    WorkspacePackages.ts  — loadWorkspacePackages
    Frameworks.ts         — detectFrameworks
  context/
    index.ts              — точка экспорта
    Builder.ts            — ContextBuilder
    Formatter.ts          — formatContextAsMarkdown, formatContextAsJson
    SymbolExtractor.ts    — извлечение символов из запроса
    Markers.ts            — LOW_CONFIDENCE_MARKER
  search/
    QueryUtils.ts         — isTestFile, extractSearchTerms, scorePathRelevance, getStemVariants, isDistinctiveIdentifier
  utils/
    Utils.ts              — validatePathWithinRoot, isConfigLeafNode
```

### Класс GraphTraverser

```typescript
export class GraphTraverser {
  constructor(queries: QueryBuilder);

  traverseBFS(startId: string, options?: ITraversalOptions): ISubgraph;
  traverseDFS(startId: string, options?: ITraversalOptions): ISubgraph;
  getAdjacentEdges(nodeId: string, direction?: 'outgoing' | 'incoming' | 'both', edgeKinds?: EdgeKind[]): IEdge[];
  getCallers(nodeId: string, maxDepth?: number): Array<{ node: INode; edge: IEdge }>;
  getCallees(nodeId: string, maxDepth?: number): Array<{ node: INode; edge: IEdge }>;
  getCallGraph(nodeId: string, depth?: number): ISubgraph;
  getTypeHierarchy(nodeId: string): ISubgraph;
  findUsages(nodeId: string): Array<{ node: INode; edge: IEdge }>;
  getImpactRadius(nodeId: string, maxDepth?: number): ISubgraph;
  findPath(fromId: string, toId: string, edgeKinds?: EdgeKind[]): Array<{ node: INode; edge: IEdge | null }> | null;
  getAncestors(nodeId: string): INode[];
  getChildren(nodeId: string): INode[];
}
```

### Класс ReferenceResolver

```typescript
export class ReferenceResolver {
  constructor(projectRoot: string, queries: QueryBuilder);

  initialize(): void;
  warmCaches(): void;
  clearCaches(): void;

  resolveAll(unresolvedRefs: IUnresolvedRef[], onProgress?: (resolved: number, total: number) => void): IResolutionResult;
  resolveOne(ref: IUnresolvedRef): IResolvedRef | null;
  createEdges(resolved: IResolvedRef[]): IEdge[];
  resolveAndPersist(unresolvedRefs: IUnresolvedRef[], onProgress?: (resolved: number, total: number) => void): IResolutionResult;
  async resolveAndPersistBatched(onProgress?: (resolved: number, total: number) => void, batchSize?: number): Promise<IResolutionResult>;

  resolveChainedCallsViaConformance(): number;
  resolveDeferredThisMemberRefs(): number;
  runPostExtract(): number;
  getDetectedFrameworks(): string[];
  hasAnyPossibleMatch(name: string): boolean;
  matchesAnyImport(ref: IUnresolvedRef): boolean;
  resolveThisMemberFnRef(ref: IUnresolvedRef): IResolvedRef | null;
  resolveRazorUsing(ref: IUnresolvedRef): IResolvedRef | null;
  getRazorUsings(filePath: string): string[];
  gateLanguage(result: IResolvedRef | null, ref: IUnresolvedRef): IResolvedRef | null;
  gateFrameworkLanguage(result: IResolvedRef | null, ref: IUnresolvedRef): IResolvedRef | null;
  getFilePathFromNodeId(nodeId: string): string | null;
  getLanguageFromNodeId(nodeId: string): string | null;
}
```

### Класс ContextBuilder

```typescript
export class ContextBuilder {
  constructor(projectRoot: string, queries: QueryBuilder, traverser: GraphTraverser);

  async buildContext(input: TaskInput, options?: IBuildContextOptions): Promise<ITaskContext | string>;
  async findRelevantContext(query: string, options?: IFindRelevantContextOptions): Promise<ISubgraph>;
  async getCode(nodeId: string): Promise<string | null>;

  buildCallPathsSection(subgraph: ISubgraph): string;
  buildLowConfidenceNote(entryPoints: INode[]): string;
  extractCodeBlocks(subgraph: ISubgraph, maxBlocks: number, maxBlockSize: number): ICodeBlock[];
  extractNodeCode(node: INode): string | null;
  generateSummary(query: string, subgraph: ISubgraph, entryPoints: INode[]): string;
  getRelatedFiles(subgraph: ISubgraph): string[];
  resolveImportsToDefinitions(results: ISearchResult[]): ISearchResult[];
}
```

## Детали реализации

### Графовый обход

#### BFS

Алгоритм:
1. Создать очередь: начальная запись `{ nodeId: startId, depth: 0, edge: null }`
2. Создать `visited: Set<string>`
3. Создать `nodes: Map<string, INode>` и `edges: IEdge[]`
4. Пока очередь не пуста и не достигнут limit:
   a. Взять запись из начала очереди
   b. Пропустить, если nodeId уже в visited
   c. Добавить nodeId в visited
   d. Получить узел через `getNodeById(nodeId)`, добавить в nodes
   e. Если depth > 0 и edge не null, добавить edge в edges
   f. Получить соседние ребра через `getAdjacentEdges(nodeId, direction, edgeKinds)`
   g. Сортировать ребра по приоритету: contains (0) > calls (1) > остальные (2)
   h. Собрать все уникальные соседние nodeId
   i. Batch-запрос соседей через `getNodesByIds(neighborIds)` — устраняет N+1
   j. Для каждого отфильтрованного соседа (nodeKinds, depth < maxDepth) добавить в очередь `{ nodeId, depth: depth + 1, edge }`
5. Вернуть ISubgraph с nodes, edges, roots

#### DFS

Алгоритм:
1. Создать `visited: Set<string>`, `nodes: Map<string, INode>`, `edges: IEdge[]`
2. Вызвать `dfsRecursive(startId, 0, null, options, nodes, edges, visited)`
3. Вернуть ISubgraph

Метод `dfsRecursive(nodeId, depth, edge, opts, nodes, edges, visited)`:
1. Пропустить, если nodeId в visited или depth >= maxDepth
2. Добавить nodeId в visited
3. Добавить узел в nodes, ребро в edges (если depth > 0)
4. Получить соседние ребра через `getAdjacentEdges(nodeId, direction, edgeKinds)`
5. Сортировать по приоритету: contains (0) > calls (1) > остальные (2)
6. Для каждого соседа вызвать `dfsRecursive(neighborId, depth + 1, edge, opts, nodes, edges, visited)`

#### Радиус воздействия

Алгоритм:
1. Начать от узла nodeId
2. Определить, является ли узел контейнером (class, interface, struct, trait, protocol, module, enum)
3. Если контейнер:
   a. Обойти дочерние узлы на той же глубине (не depth+1)
   b. Ребра `contains` исключены из входящего обхода
4. Получить все входящие ребра (исключая `contains`)
5. Рекурсивно обйти зависимости
6. Ограничить maxDepth (по умолчанию 3)
7. Вернуть ISubgraph

### Разрешение ссылок

#### Предварительная фильтрация

1. `warmCaches()` — загрузить knownNames (Set строк) и knownFiles (Set строк)
2. `hasAnyPossibleMatch(name)` — быстрая проверка по knownNames (O(1))
3. `isBuiltInOrExternal(ref)` — фильтрация встроенных символов

#### Стратегии (порядок)

1. **Встроенные символы**: проверка по языку через JS_BUILT_INS, PYTHON_BUILT_INS, GO_BUILT_INS и т.д.
2. **Фреймворк-специфичное**: для каждого обнаруженного фреймворка вызвать `framework.resolve(ref)`, затем `gateFrameworkLanguage(result, ref)`
3. **Razor/Blazor @using**: `resolveRazorUsing(ref)` — только для .razor/.cshtml файлов
4. **JVM FQN импорт**: `resolveJvmImport(ref, context)` — для `com.example.foo.Bar`
5. **Разрешение через импорты**: `resolveViaImport(ref)` — разрешение через import-карты файла, затем `gateLanguage(result, ref)`
6. **Совпадение по имени**: `matchReference(ref)` — поиск по имени символа, затем `gateLanguage(result, ref)`
7. **Функции как значения**: `matchFunctionRef(ref)` — для callback-регистраций

#### Кэширование

- LRU-кэш с ограничением (по умолчанию 5000)
- Кэши: nodeCache (узлы по файлу), fileCache (содержимое файлов, null для неудачных чтений), importMappingCache, reExportCache, nameCache, lowerNameCache, qualifiedNameCache, razorUsingsCache
- Content cache получает меньший бюджет (`limit / 5`), минимальный размер 64
- Инвалидация при изменении данных

#### Batch-разрешение

Алгоритм:
1. Получить unresolved references пачками по batchSize (по умолчанию 5000)
2. Для каждой пачки:
   a. Разрешить каждую ссылку через `resolveOne()`
   b. Создать ребра из разрешенных ссылок через `createEdges()`
   c. Вставить ребра в БД через `insertEdges()`
   d. Удалить разрешенные ссылки из unresolved_refs
   e. Yield для event loop: `await Promise.resolve()`
3. После всех пачек:
   a. Удалить неразрешимые ссылки
   b. Вызвать `synthesizeCallbackEdges()` — оборачивается в try/catch (синтез добавочный)
4. Защита от бесконечного цикла: если `remaining >= prevRemaining`, break

#### 3-проходное разрешение

**Проход 1 — Основной:**
- `resolveAll()` / `resolveAndPersistBatched()` — стандартное разрешение

**Проход 2 — Цепные вызовы через соответствие:**
- `resolveChainedCallsViaConformance()` — разрешение `inner().method` паттернов
- Работает только для языков из CHAIN_LANGUAGES
- Использует CHAIN_SHAPE regex: `/^(.+)\(\)\.(\w+)$/`
- Для Rust также проверяет `::` через `matchScopedCallChain()`
- Вызывается ПОСЛЕ построения extends/implements ребер

**Проход 3 — Отложенные this.<member> ссылки:**
- `resolveDeferredThisMemberRefs()` — разрешение `this.<member>` где member унаследован
- BFS по графу супертипов

#### Разрешение this.<member>

- `resolveThisMemberFnRef()` — разрешение `this.handleClick` против собственных членов класса
- `resolveDeferredThisMemberRefs()` — второй проход через BFS супертипов

#### Языковая фильтрация

- `gateLanguage()` — отбрасывает разрешение через импорты/имена при переходе между языковыми семействами
- `gateFrameworkLanguage()` — отбрасывает фреймворковое разрешение для cross-family type-usage ребер
- `sameLanguageFamily()` — сравнение языковых семейств
- `crossesKnownFamily()` — обнаружение cross-family ссылок

#### Цепные вызовы статических фабрик / fluent

- `CHAIN_LANGUAGES`: `['java', 'kotlin', 'csharp', 'swift', 'rust', 'go', 'scala', 'dart', 'objc', 'pascal']`
- `SCOPED_CHAIN_LANGUAGES`: `['rust']` — для `::`-синтаксиса
- `CHAIN_SHAPE`: `/^(.+)\(\)\.(\w+)$/`
- `matchDottedCallChain()` — для `.`-синтаксиса
- `matchScopedCallChain()` — для `::`-синтаксиса (Rust)
- Отложенный сбор и разрешение во втором проходе

#### Razor/Blazor @using разрешение

- `getRazorUsings(filePath)` — каскадный поиск _Imports.razor от папки файла до корня проекта
- `resolveRazorUsing()` — разрешение простых типов через @using namespace
- Кэширование в razorUsingsCache

#### JVM FQN импорт разрешение

- `resolveJvmImport(ref, context)` — разрешение `com.example.foo.Bar` через индекс qualifiedName
- Использует `getNodesByQualifiedNameExact()`

#### PHP include path защита

- `isPhpIncludePathRef(ref)` — предотвращает фоллбэк к name-matcher для PHP include path ссылок
- Без этой защиты `include 'vendor/autoload.php'` мог бы разрешиться на функцию `autoload` в кодовой базе

#### Python built-in method bare name collision

- `def index()` в кодовой базе не фильтруется как Python built-in method, когда в кодовой базе есть символ `index`
- Проверка: если bare name метода присутствует как отдельный символ в кодовой базе, не применять фильтрацию

#### Промоция вида ребра в createEdges

- `"extends"` → `"implements"` когда класс/struct нацелен на интерфейс/протокол
- `"calls"` → `"instantiates"` когда цель — класс/struct (Python/Ruby не имеют new)
- `"function_ref"` → `"references"` ребро с `metadata.fnRef: true` маркером

#### Синтез callback-ребер

- `synthesizeCallbackEdges()` — добавляет ребра динамической диспетчеризации
- Вызывается после batched разрешения
- Оборачивается в try/catch (синтез добавочный и опциональный)

#### Финализация фреймворков

- `runPostExtract()` — запускает cross-file финализацию каждого фреймворка
- Очищает кэши ДО и ПОСЛЕ запуска
- Оборачивается в try/catch для изоляции ошибок

### Построение контекста

#### Извлечение символов

```typescript
extractSymbolsFromQuery(query: string): string[]
```

1. CamelCase: `\b([A-Z][a-z]+(?:[A-Z][a-z]*)*|[a-z]+(?:[A-Z][a-z]*)+)\b`
2. snake_case: `\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b`
3. SCREAMING_SNAKE: `\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b`
4. dot.notation: `\b([a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)+)\b` — извлекает обе части
5. Фильтрация обычных английских слов (the, and, for, with и т.д.) через `isDistinctiveIdentifier()`

#### Гибридный поиск — полный алгоритм

**Шаг 1: Точное совпадение символов**
- `findNodesByExactName(symbolsFromQuery)` — высокая уверенность
- Оборачивается в try/catch

**Шаг 2a: Префиксный поиск определений**
- Заглавные буквы извлеченных символов для поиска классов/интерфейсов, начинающихся с префикса
- Расширение stem-вариантов: "caching" → "cache" находит `Cache`, `CacheBuilder` через `getStemVariants()`
- Бонус краткости: более короткие имена получают больший балл

**Шаг 2b: FTS-поиск с per-term search + multi-term boosting**
- `searchNodes(term)` для каждого термина запроса
- BM25 веса колонок: id=0, name=20, qualified_name=5, docstring=1, signature=2
- Multi-term boost: 2+ различных терминов → агрессивное масштабирование баллов

**Шаг 3: LIKE-фоллбэк для camelCase**
- LIKE-запрос для совпадений подстрок на границах CamelCase
- Обнаружение границ аббревиатур: `RPCProtocol` совпадает с "Protocol" на границе заглавной буквы
- FTS не находит "Search" внутри "TransportSearchAction", LIKE это исправляет

**Шаг 4: Составной термин**
- Для многозначных запросов находит классы, содержащие 2+ терминов запроса
- Multi-term boost: 2+ различных терминов → агрессивное масштабирование

**Шаг 5: Fuzzy-фоллбэк**
- Расстояние Левенштейна для опечаток

**Шаг 6: Расчет сигнала уверенности**
- Если результаты найдены только на шагах 4-5, confidence = 'low'
- Если результаты найдены на шагах 1-3, confidence = 'high'

#### Бонус ядра директории

- Поиск "доминирующего файла" через `getDominantFile()` (файл с наибольшим числом внутренних ребер)
- Результаты, разделяющие префикс директории с доминирующим файлом, получают бонус
- Оборачивается в try/catch

#### Разрешение импортов на определения

- `resolveImportsToDefinitions()` — следует imports/exports ребрам для замены узлов импорта их определениями

#### Расширение графа

1. Для каждой точки входа выполнить BFS с ограничением traversalDepth
2. Расширить иерархию типов для class/interface entry points
3. Собрать все узлы и ребра в Subgraph
4. Ограничить maxNodes (приоритет: точки входа и их соседи)
5. Восстановить ребра через `findEdgesBetweenNodes()`

#### Расширение иерархии типов в контексте

- Специальное расширение иерархии для class/interface entry points
- Двухпроходная иерархия: сначала прямая, затем родительские типы для поиска братьев
- Бюджет: `maxHierarchyNodes = Math.ceil(opts.maxNodes / 4)`

#### Лимит разнообразия по файлам

- `maxPerFile = Math.max(5, Math.ceil(opts.maxNodes * 0.2))` — каждый файл ограничен ~20% от maxNodes
- Приоритетная сортировка: сначала точки входа, затем по relevance score

#### Лимит непродуктивных узлов

- `maxNonProd = Math.max(3, Math.ceil(opts.maxNodes * 0.15))` — тестовые/примеры/интеграционные файлы ограничены максимум 15% бюджета
- `isTestFile(filePath)` — комплексное обнаружение тестовых файлов

#### Восстановление ребер

- `findEdgesBetweenNodes()` — обнаружение ребер между уже выбранными узлами
- Восстанавливает связность, потерянную при BFS от нескольких точек входа

#### Извлечение кода

1. Прочитать файл из файловой системы
2. Извлечь строки от startLine до endLine
3. Ограничить maxCodeBlockSize (по умолчанию 1500 символов)
4. Защита config-листов: `isConfigLeafNode(node)` возвращает только ключ

#### Call paths в выводе контекста

- `buildCallPathsSection()`:
  - DFS по ребрам `calls` с MAX_HOPS = 6
  - Бюджет 2000 для ограничения работы на плотных подграфах
  - Фильтрация цепей, соединяющих 2+ релевантных символов (roots)
  - Отметка динамических диспетчеризаций (callback, event, React re-render, Vue handler)
  - Синтезированные шаги помечаются инлайн-лейблами

#### Честный handoff низкой уверенности

- `buildLowConfidenceNote()`:
  - Обнаруживает, когда запрос совпал преимущественно с общими словами
  - Добавляет заметку с LOW_CONFIDENCE_MARKER, советующую использовать `ntgraph_explore` с точными именами

#### Защита config-листов

- `isConfigLeafNode()` — возвращает только ключ (никогда не читает значение с диска)

#### Ограничение точек входа

- Если `filteredResults.length > opts.searchLimit`, то `filteredResults = filteredResults.slice(0, opts.searchLimit)`

## Шаблоны обработки ошибок

- Прогресс-отчет: каждый 1% (не каждый элемент) для предотвращения избыточных обновлений
- Защита от бесконечного цикла batched разрешения: если `remaining >= prevRemaining`, break
- Изоляция ошибок framework postExtract: try/catch для каждого фреймворка
- Изоляция ошибок callback синтеза: try/catch (синтез добавочный)
- Изоляция ошибок core-directory boost: try/catch (поиск работает без бонуса)
- Неудачный точный поиск символов: try/catch вокруг `findNodesByExactName`
- Неудачный текстовый поиск: try/catch вокруг text search
- Неудачное чтение файла при разрешении: кэширует null для неудачных чтений
- Неудачное перечисление директории: возвращает [] при ошибке
- Защита config-листов: `isConfigLeafNode()` возвращает ключ, никогда не читает значение

## Шаблоны кэширования

- `NTGRAPH_RESOLVER_CACHE_SIZE` — env var для размера кэша
- Content cache получает меньший бюджет (`limit / 5`)
- Минимальный размер content cache: 64
- `warmCaches()`: кэширует только `knownNames` (Set строк) и `knownFiles` (Set строк)
- Флаг `cachesWarmed` предотвращает повторное нагревание
- `clearCaches()`: сбрасывает knownNames, knownFiles и cachesWarmed

### Архитектура кэшей

- `nodeCache: LRUCache<string, INode[]>` — кэш узлов по файлу
- `fileCache: LRUCache<string, string | null>` — кэш содержимого файлов (null для неудачных чтений)
- `nameCache: LRUCache<string, INode[]>` — имя → узлы
- `lowerNameCache: LRUCache<string, INode[]>` — lower(имя) → узлы
- `qualifiedNameCache: LRUCache<string, INode[]>` — qualified_name → узлы
- `importMappingCache: LRUCache<string, IImportMapping[]>` — кэш импортов
- `reExportCache: LRUCache<string, IReExport[]>` — кэш реэкспорта
- `razorUsingsCache: Map<string, string[]>` — кэш Razor @using

### Ленивая загрузка конфигурации

- `projectAliases: IAliasMap | null | undefined` — `undefined` = не вычислено, `null` = вычислено и отсутствует
- Та же схема для `goModule` и `workspacePackages`

## Вспомогательные функции

### isTestFile

```typescript
function isTestFile(filePath: string): boolean
```

Комплексное обнаружение тестовых файлов:
- Имена файлов: `*.test.ts`, `*.spec.ts`, `*_test.go`, `test_*.py`, `*_test.rb`
- Директории: `__tests__`, `tests/`, `test/`, `spec/`, `e2e/`, `integration/`
- Расширения: `.test.`, `.spec.`, `_test.`

### extractSearchTerms

```typescript
function extractSearchTerms(query: string, options?: { splitCamelCase?: boolean }): string[]
```

Разбивает запрос на поисковые термины:
- camelCase: `UserService` → `['User', 'Service']`
- PascalCase: `UserService` → `['User', 'Service']`
- snake_case: `user_service` → `['user', 'service']`
- SCREAMING_SNAKE: `MAX_RETRIES` → `['MAX', 'RETRIES']`
- dot.notation: `app.isPackaged` → `['app', 'isPackaged']`

### scorePathRelevance

```typescript
function scorePathRelevance(filePath: string, query: string): number
```

Оценивает релевантность пути файла к запросу.

### getStemVariants

```typescript
function getStemVariants(word: string): string[]
```

Расширяет слово до stem-вариантов: "caching" → ["caching", "cache"].

### isDistinctiveIdentifier

```typescript
function isDistinctiveIdentifier(symbol: string): boolean
```

Отличает идентификаторы от обычных слов (the, and, for, with и т.д.).

### isConfigLeafNode

```typescript
function isConfigLeafNode(node: INode): boolean
```

Защита config-листов: возвращает true для конфигурационных узлов, значение которых не должно читаться.

### validatePathWithinRoot

```typescript
function validatePathWithinRoot(projectRoot: string, filePath: string): boolean
```

Защита от path traversal: проверяет, что путь находится внутри корня проекта.

### sameLanguageFamily

```typescript
function sameLanguageFamily(lang1: string, lang2: string): boolean
```

Сравнение языковых семейств: TypeScript и JavaScript — одно семейство, Python и Go — разные.

### crossesKnownFamily

```typescript
function crossesKnownFamily(lang1: string, lang2: string): boolean
```

Обнаружение cross-family ссылок: возвращает true, если языки из разных семейств.

### resolveJvmImport

```typescript
function resolveJvmImport(ref: IUnresolvedRef, context: IResolutionContext): IResolvedRef | null
```

JVM FQN разрешение: `com.example.foo.Bar` → поиск по qualifiedName.

### matchDottedCallChain

```typescript
function matchDottedCallChain(ref: IUnresolvedRef, context: IResolutionContext): IResolvedRef | null
```

Сопоставление цепных вызовов через `.`: `Foo().bar()` → поиск Foo, затем bar на типе результата.

### matchScopedCallChain

```typescript
function matchScopedCallChain(ref: IUnresolvedRef, context: IResolutionContext): IResolvedRef | null
```

Сопоставление цепных вызовов через `::` (Rust): `Foo::bar()` → поиск Foo::bar.

### isPhpIncludePathRef

```typescript
function isPhpIncludePathRef(ref: IUnresolvedRef): boolean
```

PHP include path обнаружение: предотвращает фоллбэк к name-matcher.

### extractImportMappings

```typescript
function extractImportMappings(filePath: string, content: string, language: string): IImportMapping[]
```

Извлечение импортов из содержимого файла.

### extractReExports

```typescript
function extractReExports(content: string, language: string): IReExport[]
```

Извлечение реэкспорта из содержимого файла.

### loadCppIncludeDirs

```typescript
function loadCppIncludeDirs(projectRoot: string): string[]
```

Загрузка директорий include из C++ конфигурации.

### loadProjectAliases

```typescript
function loadProjectAliases(projectRoot: string): IAliasMap | null
```

Загрузка path-алиасов из tsconfig.json / jsconfig.json.

### loadGoModule

```typescript
function loadGoModule(projectRoot: string): IGoModule | null
```

Загрузка go.mod модуля.

### loadWorkspacePackages

```typescript
function loadWorkspacePackages(projectRoot: string): IWorkspacePackages | null
```

Загрузка workspace-пакетов из package.json workspaces.

### detectFrameworks

```typescript
function detectFrameworks(context: IResolutionContext): string[]
```

Обнаружение фреймворков в проекте.

### synthesizeCallbackEdges

```typescript
function synthesizeCallbackEdges(queries: QueryBuilder, context: IResolutionContext): IEdge[]
```

Синтез callback-ребер для динамической диспетчеризации.

### formatContextAsMarkdown

```typescript
function formatContextAsMarkdown(context: ITaskContext): string
```

Форматирование контекста в Markdown.

### formatContextAsJson

```typescript
function formatContextAsJson(context: ITaskContext): string
```

Форматирование контекста в JSON.

## Метаданные ребер

- `confidence: number` — уверенность разрешения
- `resolvedBy: string` — какая стратегия разрешила
- `fnRef: true` — маркер function-as-value ребер
- `synthesizedBy: string` — маркер callback-синтезированных ребер
- `registeredAt: string` — место регистрации для синтезированных ребер
- `via: string` — промежуточный символ для синтезированных ребер
- `event: string` — имя события для Vue handler ребер
- `provenance: 'heuristic'` — для динамически синтезированных ребер

## Константы видов узлов

- `HIGH_VALUE_NODE_KINDS`: `['function', 'method', 'class', 'interface', 'type_alias', 'struct', 'trait', 'component', 'route', 'variable', 'constant', 'enum', 'module', 'namespace']`
- `SUPERTYPE_BEARING_KINDS`: `['class', 'struct', 'interface', 'trait', 'protocol', 'enum']`
- `CONTAINER_NODE_KINDS`: `['class', 'interface', 'struct', 'trait', 'protocol', 'module', 'enum']`

## Методы QueryBuilder, необходимые для Фазы 3

- `getNodeById(id: string): INode | null`
- `getNodesByIds(ids: string[]): INode[]` — batch-запрос
- `getOutgoingEdges(nodeId: string, kinds?: EdgeKind[], provenance?: string): IEdge[]`
- `getIncomingEdges(nodeId: string, kinds?: EdgeKind[]): IEdge[]`
- `getNodesByFile(filePath: string): INode[]`
- `getNodesByName(name: string): INode[]`
- `getNodesByQualifiedNameExact(qualifiedName: string): INode[]`
- `getNodesByKind(kind: NodeKind): INode[]`
- `getNodesByLowerName(lowerName: string): INode[]`
- `getAllFilePaths(): string[]`
- `getAllNodeNames(): string[]`
- `findNodesByExactName(symbols: string[], options?: ISearchOptions): ISearchResult[]`
- `searchNodes(term: string, options?: ISearchOptions): ISearchResult[]`
- `findNodesByNameSubstring(term: string, options?: ISearchOptions): INode[]`
- `findEdgesBetweenNodes(nodeIds: string[], kinds?: EdgeKind[]): IEdge[]`
- `getUnresolvedReferencesCount(): number`
- `getUnresolvedReferencesBatch(offset: number, limit: number): IUnresolvedReference[]`
- `insertEdges(edges: IEdge[]): void`
- `deleteSpecificResolvedReferences(refs: IUnresolvedReference[]): number`
- `updateNode(node: INode): void`
- `getDominantFile(): { filePath: string; edgeCount: number; nextEdgeCount: number } | null`
- `getDependentFilePaths(filePath: string): string[]`
- `getDependencyFilePaths(filePath: string): string[]`
- `getCrossFileIncomingEdgesWithTarget(filePath: string): Array<{ edge: IEdge; targetName: string; targetKind: string }>`
- `getNodeAndEdgeCount(): { nodes: number; edges: number }`
- `getStats(): IGraphStats`
- `setMetadata(key: string, value: string): void`
- `getMetadata(key: string): string | null`
- `getAllMetadata(): Record<string, string>`
- `getLastIndexedAt(): number | null`
- `clear(): void` — удаляет в порядке: unresolved_refs → edges → nodes → files
- `getStaleFiles(): IFileRecord[]`
- `getTopRouteFile(): { filePath: string; count: number } | null`
- `getRoutingManifest(limit?: number): Array<{ url: string; handler: string; handlerFile: string; handlerLine: number; handlerKind: string }> | null`

## Интеграция с текущим кодом

### Замена RepoAnalyzer

`RepoAnalyzer` будет расширен графовыми возможностями:
- Поиск использований символа через `GraphTraverser.findUsages()`
- Анализ радиуса воздействия через `GraphTraverser.getImpactRadius()`
- Граф вызовов через `GraphTraverser.getCallGraph()`

### Интеграция с CodebaseSearch

`CodebaseSearch.search()` будет использовать `ContextBuilder.findRelevantContext()`:
- Извлечение символов из запроса
- Точное совпадение + FTS-поиск
- Расширение графа от точек входа
- Возврат ISubgraph с узлами, ребрами и блоками кода

### Интеграция с Фазой 2

После индексации файлов через ExtractionOrchestrator:
1. `ReferenceResolver.resolveAndPersistBatched()` — разрешение ссылок
2. `GraphTraverser` — обход графа с узлами и ребрами из БД
3. `ContextBuilder` — построение контекста для AI

## Требования к качеству

### SOLID

- Single Responsibility: Traverser — только обход, Resolver — только разрешение, Builder — только контекст
- Open/Closed: новые стратегии разрешения добавляются без изменения Resolver (регистрация через массив)
- Liskov Substitution: стратегии разрешения реализуют общий интерфейс
- Interface Segregation: узкие интерфейсы для каждой подсистемы
- Dependency Inversion: модули зависят от интерфейсов QueryBuilder, а не от конкретных реализаций

### Безопасность

- Валидация nodeId и edgeKinds
- Ограничение глубины обхода (maxDepth) для предотвращения бесконечных циклов
- Ограничение количества узлов (limit) для предотвращения OOM
- Обработка ошибок при чтении файлов
- Защита от path traversal при извлечении кода через `validatePathWithinRoot()`

### Оптимизация

- Batch-запросы: `getNodesByIds()` устраняет N+1 (O(N/B) вместо O(N))
- LRU-кэш: часто запрашиваемые узлы кэшируются (O(1) доступ)
- Предварительная фильтрация: `hasAnyPossibleMatch()` пропускает заведомо несовпадающие ссылки (O(1))
- Графовый обход: BFS/DFS с visited Set (O(V+E) с ограничениями)
- Радиус воздействия: O(V+E) с ограничением maxDepth
- Поиск пути: BFS, O(V+E) в худшем случае

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

## Сценарии тестирования

### Тесты обхода

1. BFS-обход с ограничением глубины
2. BFS-обход с фильтрацией по edgeKinds
3. BFS-обход с фильтрацией по nodeKinds
4. BFS-обход с ограничением limit
5. DFS-обход с ограничением глубины
6. Приоритет ребер BFS: contains обрабатывается перед calls
7. Batch-запрос устраняет N+1: один запрос для всех соседей
8. Поиск вызывающих с рекурсией
9. Поиск вызываемых с рекурсией
10. Граф вызовов
11. Иерархия типов (предки и потомки)
12. Поиск использований
13. Радиус воздействия для контейнера (class)
14. Радиус воздействия для функции
15. Радиус воздействия исключает contains входящие ребра
16. Радиус воздействия расширяет детей контейнера на той же глубине
17. Поиск пути между двумя узлами
18. findPath возвращает null при отсутствии пути
19. Родители узла
20. Дети узла
21. getAncestors останавливается при цикле (visited set)
22. instantiates включен в callers/callees

### Тесты разрешения

23. Разрешение ссылки через импорты
24. Разрешение ссылки через совпадение по имени
25. Разрешение встроенных символов (JS, Python, Go)
26. Разрешение фреймворк-специфичных ссылок
27. Фильтрация встроенных символов по языкам (JS, Python, Go, C/C++, Pascal)
28. Языковая фильтрация отбрасывает cross-family references
29. Batch-разрешение с yield для event loop
30. Цепные вызовы: отложенный сбор и разрешение во втором проходе
31. this.<member> разрешение против собственного класса
32. Отложенное this.<member> разрешение через BFS супертипов
33. Промоция ребер: extends → implements для интерфейсов
34. Промоция ребер: calls → instantiates для классов
35. Промоция ребер: function_ref → references с metadata.fnRef
36. Защита от бесконечного цикла batched разрешения
37. LRU cache eviction при давлении памяти
38. Razor/Blazor @using resolution
39. JVM FQN import resolution
40. PHP include path protection
41. Chained calls via conformance (CHAIN_LANGUAGES)
42. Deferred this.<member> resolution
43. Python built-in method bare name collision

### Тесты построения контекста

44. Построение контекста с точным совпадением
45. Построение контекста с FTS-поиском
46. Построение контекста с LIKE-фоллбэком для camelCase
47. Построение контекста с fuzzy-фоллбэком
48. Построение контекста с расширением графа
49. Построение контекста с извлечением кода
50. Построение контекста с форматированием Markdown
51. Построение контекста с форматированием JSON
52. Построение контекста с call paths
53. Построение контекста с low-confidence handoff
54. Извлечение символов: CamelCase, snake_case, SCREAMING_SNAKE, dot.notation
55. Фильтрация общих английских слов
56. Префиксный поиск определений со stem-вариантами
57. Совпадение CamelCase границ
58. Составной термин для многозначных запросов
59. Co-location boost
60. Multi-term co-occurrence re-ranking
61. Бонус ядра директории
62. Расширение иерархии типов двухпроходное
63. Лимит разнообразия по файлам (20%)
64. Лимит непродуктивных узлов (15%)
65. Восстановление ребер после BFS от нескольких точек входа
66. Извлечение call paths с отметкой динамических диспетчеризаций
67. Handoff низкой уверенности для запросов с общими словами
68. Защита config-листов: ключ возвращается, значение не читается
69. isTestFile detection
70. Non-production node cap (15%)
71. Per-file diversity cap (20%)

## План действий

1. Создать LRU-кэш (LruCache.ts)
2. Создать вспомогательные функции (QueryUtils.ts, Utils.ts)
3. Создать GraphTraverser (Traverser.ts) с BFS, DFS, callers, callees, impact radius
4. Создать встроенные символы (BuiltIns.ts) для JS/TS, Python, Go, C/C++, Pascal
5. Создать совпадение по имени (NameMatcher.ts)
6. Создать разрешение через импорты (ImportResolver.ts)
7. Создать разрешение path-алиасов (PathAliases.ts)
8. Создать загрузку Go модуля (GoModule.ts)
9. Создать загрузку workspace-пакетов (WorkspacePackages.ts)
10. Создать обнаружение фреймворков (Frameworks.ts)
11. Создать синтез callback-ребер (CallbackSynthesizer.ts)
12. Создать ReferenceResolver (Resolver.ts) со стратегиями разрешения
13. Создать ContextBuilder (Builder.ts) с гибридным поиском
14. Создать форматирование (Formatter.ts) для Markdown и JSON
15. Создать извлечение символов (SymbolExtractor.ts)
16. Создать маркеры (Markers.ts)
17. Написать unit-тесты для каждого компонента
18. Написать интеграционные тесты для Resolver и Builder
19. Интегрировать с CodebaseSearch
20. Интегрировать с ExtractionOrchestrator из Фазы 2

## Зависимости

- Фазы 1 (NtGraphDb, QueryBuilder) — для доступа к узлам и ребрам
- Фазы 2 (ExtractionOrchestrator) — для заполнения БД узлами и ребрами
- Нет внешних зависимостей (все на базе SQLite и встроенных модулей Node.js)
