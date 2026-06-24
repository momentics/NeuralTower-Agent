# Фаза 4: Интеграция с MCP-сервером

## Обзор

Экспорт граф-ориентированных инструментов через MCP-протокол. Эта фаза предоставляет AI-агентам доступ к графу кода через стандартизированный интерфейс: поиск, определение символов, исследование, радиус воздействия и т.д.

## Текущее состояние

### Модули нашего репозитория

- `src/mcp/` — текущая MCP-инфраструктура (если есть). Инструменты работают с фрагментами кода, без понимания графа.
- `src/repo/CodebaseSearch.ts` — поиск не использует граф, не понимает связи между символами.
- `src/repo/RepoAnalyzer.ts` — поверхностный анализ без графа.

### Проблемы текущего подхода

- Нет инструментов для навигации по графу кода
- AI-агент не может найти все использования символа
- AI-агент не может понять радиус воздействия изменений
- AI-агент не может получить контекст с учетом графовых отношений
- Нет инструментов для поиска определений, вызывающих, вызываемых

## Референсный код

### MCP-инструменты

8 инструментов, экспортируемых через MCP:

#### ntgraph_search

Поиск символов по ключевым словам. Использует FTS5 с BM25, LIKE-фоллбэк, fuzzy-фоллбэк.

Параметры:
- `query` (string, required) — поисковый запрос
- `kinds` (array of string, optional) — фильтровать по видам узлов; допустимые значения: `function`, `method`, `class`, `interface`, `type`, `variable`, `route`, `component`. Не enum, а массив строк.
- `limit` (number, optional) — количество результатов (по умолчанию 10)
- `projectPath` (string, optional) — путь к проекту для cross-project запросов

Схема:
```json
{
  "type": "object",
  "properties": {
    "query": { "type": "string", "description": "Search query" },
    "kinds": { "type": "array", "items": { "type": "string" }, "description": "Filter by node kinds" },
    "limit": { "type": "number", "description": "Max results", "default": 10 },
    "projectPath": { "type": "string", "description": "Project path for cross-project queries" }
  },
  "required": ["query"]
}
```

#### ntgraph_node

Получение информации о символе по имени или пути к файлу. Поддерживает ДВА режима:

- **Режим символа** (поиск символа): передан `symbol`, инструмент возвращает информацию о символе, его код, иерархию
- **Режим файла** (чтение файла): передан `symbol` как путь к файлу, инструмент возвращает содержимое файла

Параметры:
- `symbol` (string, required) — имя символа или путь к файлу
- `includeCode` (boolean, optional) — включить исходный код символа
- `includeCallers` (boolean, optional) — включить вызывающих
- `includeCallees` (boolean, optional) — включить вызываемых

Схема:
```json
{
  "type": "object",
  "properties": {
    "symbol": { "type": "string", "description": "Symbol name or file path" },
    "includeCode": { "type": "boolean", "description": "Include source code" },
    "includeCallers": { "type": "boolean", "description": "Include callers" },
    "includeCallees": { "type": "boolean", "description": "Include callees" }
  },
  "required": ["symbol"]
}
```

#### ntgraph_explore

Исследование кодовой базы по естественному языку.

Параметры:
- `query` (string, required) — запрос на естественном языке
- `maxFiles` (number, optional) — макс файлов для показа
- `maxCodeBlockSize` (number, optional) — макс размер блока кода
- `projectPath` (string, optional) — путь к проекту для cross-project запросов

Схема:
```json
{
  "type": "object",
  "properties": {
    "query": { "type": "string", "description": "Natural language query" },
    "maxFiles": { "type": "number", "description": "Max files to show" },
    "maxCodeBlockSize": { "type": "number", "description": "Max code block size" },
    "projectPath": { "type": "string", "description": "Project path for cross-project queries" }
  },
  "required": ["query"]
}
```

#### ntgraph_impact

Анализ радиуса воздействия символа.

Параметры:
- `symbol` (string, required) — имя символа
- `file` (string, optional) — путь к файлу для disambiguation символа
- `depth` (number, optional) — глубина (по умолчанию 2)
- `projectPath` (string, optional) — путь к проекту для cross-project запросов

Схема:
```json
{
  "type": "object",
  "properties": {
    "symbol": { "type": "string", "description": "Symbol name" },
    "file": { "type": "string", "description": "File path for disambiguation" },
    "depth": { "type": "number", "description": "Depth (default 2)", "default": 2 },
    "projectPath": { "type": "string", "description": "Project path for cross-project queries" }
  },
  "required": ["symbol"]
}
```

#### ntgraph_callers

Поиск вызывающих функции/метода.

Параметры:
- `symbol` (string, required) — имя символа
- `file` (string, optional) — путь к файлу для disambiguation символа
- `limit` (number, optional) — лимит результатов (по умолчанию 20)
- `projectPath` (string, optional) — путь к проекту для cross-project запросов

Схема:
```json
{
  "type": "object",
  "properties": {
    "symbol": { "type": "string", "description": "Symbol name" },
    "file": { "type": "string", "description": "File path for disambiguation" },
    "limit": { "type": "number", "description": "Max results", "default": 20 },
    "projectPath": { "type": "string", "description": "Project path for cross-project queries" }
  },
  "required": ["symbol"]
}
```

#### ntgraph_callees

Поиск вызываемых функций/методов.

Параметры:
- `symbol` (string, required) — имя символа
- `file` (string, optional) — путь к файлу для disambiguation символа
- `limit` (number, optional) — лимит результатов (по умолчанию 20)
- `projectPath` (string, optional) — путь к проекту для cross-project запросов

Схема:
```json
{
  "type": "object",
  "properties": {
    "symbol": { "type": "string", "description": "Symbol name" },
    "file": { "type": "string", "description": "File path for disambiguation" },
    "limit": { "type": "number", "description": "Max results", "default": 20 },
    "projectPath": { "type": "string", "description": "Project path for cross-project queries" }
  },
  "required": ["symbol"]
}
```

#### ntgraph_files

Список файлов в проекте.

Параметры:
- `path` (string, optional) — путь для фильтрации
- `pattern` (string, optional) — паттерн для фильтрации
- `language` (string, optional) — фильтровать по языку
- `limit` (number, optional) — лимит результатов

Схема:
```json
{
  "type": "object",
  "properties": {
    "path": { "type": "string", "description": "Path filter" },
    "pattern": { "type": "string", "description": "Pattern filter" },
    "language": { "type": "string", "description": "Language filter" },
    "limit": { "type": "number", "description": "Max results" }
  },
  "required": []
}
```

#### ntgraph_status

Статистика графа и состояние индекса. Возвращает статус с `nodeCount`, `edgeCount`, `fileCount`, `lastIndexedAt`, `isStale`.

Параметры: нет

Схема:
```json
{
  "type": "object",
  "properties": {},
  "required": []
}
```

Включает:
- Основные метрики: узлы, ребра, файлы
- Секцию staleness: список pending файлов (added/modified/deleted)
- Предупреждение о несоответствии worktree (worktree mismatch warning), если обнаружено

### Константы

- `MAX_OUTPUT_LENGTH = 15000` — макс длина вывода (символы)
- `MAX_INPUT_LENGTH = 10_000` — макс длина входных строк
- `MAX_PATH_LENGTH = 4_096` — макс длина путей
- `MAX_NOTES = 4` — макс заметок в explore
- `MAX_SCAN = 8` — макс сканирований в explore
- `MAX_HOPS = 7` — макс шагов в flow BFS
- `MAX_BRIDGE = 1` — макс мостов в flow BFS
- `CLASSY = ['method', 'function', 'route']` — виды узлов для polymorphic detection
- `MIN_IMPL = 8` — минимальное количество реализаций для polymorphic detection
- `MIN_SUPPORT = 2` — минимальная поддержка для polymorphic detection
- `SAMPLE = 40` — размер выборки для polymorphic detection
- `ENTRY_SCORE = 10` — балл для entry point
- `CONNECTED_SCORE = 3` — балл для connected node
- `PERIPHERAL_SCORE = 1` — балл для peripheral node
- `ALPHA = 0.25` — коэффициент для Random-Walk-with-Restart
- `ITERATIONS = 25` — итерации для Random-Walk-with-Restart
- `DEFAULT_CATCHUP_GATE_TIMEOUT_MS = 3000` — таймаут catch-up gate
- `CONTAINER_NODE_KINDS` — виды узлов для структурного outline
- `RUST_PATH_PREFIXES` — префиксы путей Rust
- `TINY_REPO_FILE_THRESHOLD = 500` — порог для tiny репозиториев
- `TINY_REPO_CORE_TOOLS` — набор инструментов для tiny репозиториев
- `FILE_SECTION_PREFIX = '**\`'` — префикс секции файла
- `DEFAULT_MCP_TOOLS = new Set(['explore'])` — инструменты по умолчанию

### Адаптивный бюджет

`getExploreOutputBudget(fileCount)` — бюджет вывода, масштабируемый по размеру проекта:
- < 150 файлов: totalChars=13000, maxFiles=4, charsPerFile=3800
- < 500 файлов: totalChars=18000, maxFiles=5, charsPerFile=3800
- < 5000 файлов: totalChars=24000, maxFiles=8, charsPerFile=4000
- < 15000 файлов: totalChars=24000, maxFiles=10, charsPerFile=4000
- >= 15000 файлов: totalChars=24000, maxFiles=12, charsPerFile=4000

Возвращаемый объект `IExploreOutputBudget` содержит:
- `totalChars` — общий лимит символов
- `maxFiles` — макс файлов
- `charsPerFile` — лимит на файл
- `maxNodes` — макс узлов
- `maxCodeBlocks` — макс блоков кода
- `maxCodeBlockSize` — макс размер блока кода
- `maxEdges` — макс ребер
- `maxEdgesPerRelationshipKind` — макс ребер на вид отношения
- `gapThreshold` — порог пропуска
- `maxSymbolsInFileHeader` — макс символов в заголовке файла
- `includeRelationships` — включать отношения
- `includeAdditionalFiles` — включать дополнительные файлы
- `includeCompletenessSignal` — включать сигнал полноты
- `includeBudgetNote` — включать заметку о бюджете
- `excludeLowValueFiles` — исключать low-value файлы

### Переменные окружения

- `NTGRAPH_MCP_TOOLS` — allowlist инструментов для экспорта (через запятую)
- `NTGRAPH_MCP_MODE` — режим работы: `direct`, `proxy`, `daemon`
- `NTGRAPH_MCP_SOCKET` — путь к Unix socket для daemon режима
- `NTGRAPH_MCP_IDLE_TIMEOUT` — таймаут бездействия для daemon режима (мс)
- `NTGRAPH_MCP_VERSION` — версия для handshake
- `NTGRAPH_EXPLORE_LINENUMS` — toggle номеров строк в выводе explore
- `NTGRAPH_ADAPTIVE_EXPLORE` — toggle адаптивного размерирования в explore
- `NTGRAPH_CATCHUP_GATE_TIMEOUT_MS` — таймаут catch-up gate (мс)
- `NTGRAPH_WATCH_DEBOUNCE_MS` — debounce файлового наблюдателя (мс)
- `NTGRAPH_RANK_NO_MULTITERM` — toggle multi-term ранжирования

### Обработка ошибок

- `NotIndexedError` — проект не проиндексирован; возвращается `textResult()` (SUCCESS, БЕЗ `isError`) — критически важно НЕ устанавливать `isError`. Сигнализирует агенту попробовать другой подход.
- `PathRefusalError` — отказ по безопасности; возвращается `errorResult()` (с `isError: true`). Сигнализирует агенту остановиться.
- Общие ошибки БД — логирование и возврат пустых результатов
- `errorResult()` / `textResult()` — helper методы для формирования результатов
- Семантика "stop trying" vs "work around": `NotIndexedError` означает "попробуй другой подход", `PathRefusalError` означает "остановись"

### Протокол MCP

- JSON-RPC 2.0 формат
- Session management через JSON-RPC 2.0
- Initialize handshake: клиент отправляет `initialize`, сервер отвечает capabilities и `NTGRAPH_MCP_VERSION`
- Tool registration: сервер регистрирует инструменты через `tools/list`
- Roots/list handling: сервер обрабатывает `roots/list` для определения projectRoot
- `tools/list` и `tools/call` методы
- `getStaticTools()` — статический список инструментов без engine для pre-init `tools/list`
- `DEFAULT_MCP_TOOLS` — только `explore` по умолчанию
- `NTGRAPH_MCP_TOOLS` env var — allowlist инструментов через переменную окружения
- Tiny-repo tool gating — проекты < 500 файлов получают только 3 инструмента (TINY_REPO_CORE_TOOLS)

## Референсные файлы

При реализации каждого модуля ниже смотри указанный файл референсного кода.
**Важно:** код писать новый, с нашими именами (ntgraph_*, NtGraphDb и т.д.).
Методы и алгоритмы можно использовать как образец.

| Наш файл | Референсный файл |
|---|---|
| `src/mcp/ntgraph/ToolHandler.ts` | `ref/contents/codegraph/src/mcp/tool-handler.ts` |
| `src/mcp/ntgraph/Engine.ts` | `ref/contents/codegraph/src/mcp/engine.ts` |
| `src/mcp/ntgraph/Tools.ts` | `ref/contents/codegraph/src/mcp/tools.ts` |
| `src/mcp/ntgraph/Handlers.ts` | `ref/contents/codegraph/src/mcp/handlers.ts` |
| `src/mcp/ntgraph/Errors.ts` | `ref/contents/codegraph/src/mcp/errors.ts` |
| `src/mcp/ntgraph/Budget.ts` | `ref/contents/codegraph/src/mcp/budget.ts` |

## Типы данных

### IToolDefinition

```typescript
export interface IToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, IPropertySchema>;
    required?: string[];
  };
}
```

### IPropertySchema

```typescript
export interface IPropertySchema {
  type: string;
  description: string;
  default?: unknown;
  items?: IPropertySchema;
  enum?: string[];
}
```

### IToolResult

```typescript
export interface IToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}
```

### IExploreOutputBudget

```typescript
export interface IExploreOutputBudget {
  totalChars: number;
  maxFiles: number;
  charsPerFile: number;
  maxNodes: number;
  maxCodeBlocks: number;
  maxCodeBlockSize: number;
  maxEdges: number;
  maxEdgesPerRelationshipKind: number;
  gapThreshold: number;
  maxSymbolsInFileHeader: number;
  includeRelationships: boolean;
  includeAdditionalFiles: boolean;
  includeCompletenessSignal: boolean;
  includeBudgetNote: boolean;
  excludeLowValueFiles: boolean;
}
```

### IPendingFile

```typescript
export interface IPendingFile {
  path: string;
  changeType: 'added' | 'modified' | 'deleted';
}
```

### IWorktreeIndexMismatch

```typescript
export interface IWorktreeIndexMismatch {
  expected: string;
  actual: string;
}
```

## Архитектура

### Структура модуля

```
src/mcp/
ntgraph/
    index.ts              — точка экспорта
    ToolHandler.ts        — ToolHandler (определения + обработчики)
    Engine.ts             — MCPEngine (общее состояние, lazy init)
    Tools.ts              — определения инструментов (IToolDefinition[])
    Handlers.ts           — обработчики инструментов
    Errors.ts             — ошибки (NotIndexedError, PathRefusalError)
    Budget.ts             — адаптивный бюджет
```

### Класс ToolHandler

ToolHandler — dispatch layer. Сессии делегируют через него. Содержит определения инструментов и их обработчики.

```typescript
export class ToolHandler {
  constructor();
  getTools(): IToolDefinition[];
  async execute(toolName: string, params: Record<string, unknown>): Promise<IToolResult>;
  getNtGraph(startPath: string): NtGraphDb;
  groupDefinitions(nodes: INode[]): Map<string, INode[]>;
  validateString(value: unknown, name: string, maxLength: number): string;
  validateOptionalPath(value: unknown, name: string): string | null;
  withWorktreeNotice(text: string, startPath: string): string;
  withStalenessNotice(text: string, startPath: string): string;
  awaitCatchUpGate(): Promise<void>;
  freshen(startPath: string): void;
  closeAll(): void;
  setCatchUpGate(promise: Promise<void>): void;
  getDefaultProjectHint(): string | null;
  setDefaultProjectHint(hint: string): void;
  toolAllowlist(): Set<string>;
  isToolAllowed(toolName: string): boolean;
  getTools(): IToolDefinition[];
  findAllSymbols(symbol: string, options?: FindSymbolsOptions): { nodes: INode[]; note: string };
}
```

Методы:
- `constructor()`: инициализация без engine, независимый dispatch layer
- `execute()`: центральная диспетчеризация с catch-up gate, проверкой allowlist, валидацией, cross-cutting notices
- `getNtGraph()`: разрешение проекта с walk-up, кэшированием, проверкой пути, `freshen()`
- `groupDefinitions()`: группировка совпадений по `(filePath, qualifiedName)`
- `validateString()`: централизованная валидация строки по длине (MAX_INPUT_LENGTH)
- `validateOptionalPath()`: централизованная валидация опционального пути (MAX_PATH_LENGTH)
- `withWorktreeNotice()`: cross-cutting аннотация несоответствия worktree
- `withStalenessNotice()`: cross-cutting аннотация устаревания файлов
- `awaitCatchUpGate()`: time-boxed gate на послеоткрытие reconcile
- `freshen()`: лечение замененных соединений БД
- `closeAll()`: очистка кэшированных соединений
- `setCatchUpGate()`: регистрация catch-up promise (только для engine)
- `toolAllowlist()`: разрешение allowlist из `NTGRAPH_MCP_TOOLS`
- `isToolAllowed()`: проверка, допущен ли инструмент
- `getTools()`: динамический список инструментов с budget-aware описаниями, tiny-repo gating
- `findAllSymbols()`: критический helper для callers/callees/impact/explore

### Класс MCPEngine

MCPEngine — shared state между сессиями. Один engine, много сессий. Использует `initPromise` для lazy initialization.

```typescript
export class MCPEngine {
  constructor(opts?: MCPEngineOptions);

  async ensureInitialized(searchFrom: string): Promise<void>;
  retryInitializeSync(searchFrom: string): void;
  setProjectPathHint(projectRoot: string): void;
  catchUpSync(): void;
  stop(): void;
  getToolHandler(): ToolHandler;
}
```

Методы:
- `constructor`: принимает опциональный флаг watch, обнаруживает проект лениво
- `ensureInitialized`: асинхронная инициализация с shared `initPromise` для безопасности при конкурентном доступе
- `retryInitializeSync`: синхронный повтор для проектов, появившихся после старта
- `setProjectPathHint`: установка подсказки пути проекта из CLI флага
- `catchUpSync`: догоняющая синхронизация с one-shot gate
- `stop`: закрывает все кэшированные соединения
- `getToolHandler`: возвращает ToolHandler для диспетчеризации инструментов

MCPSession отсутствует в референсе. Сессии используют shared state + `initPromise` напрямую.

### Управление сессиями

- `MCPEngine` как shared state — один engine, много сессий
- `ToolHandler` как dispatch layer — сессии делегируют через него
- `initPromise` паттерн для безопасности при конкурентной инициализации
- `closed` флаг для graceful shutdown
- `watcherStarted` idempotency guard

## Детали реализации

### Регистрация инструментов

Определения инструментов в `Tools.ts` как массив `IToolDefinition[]`:

```typescript
const tools: IToolDefinition[] = [
  {
    name: 'ntgraph_search',
    description: 'Search code symbols by keyword',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        kinds: { type: 'array', items: { type: 'string' }, description: 'Filter by node kinds' },
        limit: { type: 'number', description: 'Max results', default: 10 },
        projectPath: { type: 'string', description: 'Project path for cross-project queries' },
      },
      required: ['query'],
    },
  },
  {
    name: 'ntgraph_node',
    description: 'Get info about a symbol or file',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Symbol name or file path' },
        includeCode: { type: 'boolean', description: 'Include source code' },
        includeCallers: { type: 'boolean', description: 'Include callers' },
        includeCallees: { type: 'boolean', description: 'Include callees' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'ntgraph_explore',
    description: 'Explore codebase with natural language',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural language query' },
        maxFiles: { type: 'number', description: 'Max files to show' },
        maxCodeBlockSize: { type: 'number', description: 'Max code block size' },
        projectPath: { type: 'string', description: 'Project path for cross-project queries' },
      },
      required: ['query'],
    },
  },
  {
    name: 'ntgraph_impact',
    description: 'Analyze impact radius of a symbol',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Symbol name' },
        file: { type: 'string', description: 'File path for disambiguation' },
        depth: { type: 'number', description: 'Depth (default 2)', default: 2 },
        projectPath: { type: 'string', description: 'Project path for cross-project queries' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'ntgraph_callers',
    description: 'Find callers of a function/method',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Symbol name' },
        file: { type: 'string', description: 'File path for disambiguation' },
        limit: { type: 'number', description: 'Max results', default: 20 },
        projectPath: { type: 'string', description: 'Project path for cross-project queries' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'ntgraph_callees',
    description: 'Find callees of a function/method',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Symbol name' },
        file: { type: 'string', description: 'File path for disambiguation' },
        limit: { type: 'number', description: 'Max results', default: 20 },
        projectPath: { type: 'string', description: 'Project path for cross-project queries' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'ntgraph_files',
    description: 'List files in the project',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path filter' },
        pattern: { type: 'string', description: 'Pattern filter' },
        language: { type: 'string', description: 'Language filter' },
        limit: { type: 'number', description: 'Max results' },
      },
      required: [],
    },
  },
  {
    name: 'ntgraph_status',
    description: 'Graph statistics and index status',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
];
```

### Обработчики инструментов

Обработчики в `Handlers.ts`, маппятся в ToolHandler.execute().

#### ntgraph_search

1. Валидация входных данных через `validateString(query, 'query', MAX_INPUT_LENGTH)`
2. Поиск через `QueryBuilder.searchNodes(query, { kinds, limit })`
3. FTS5-поиск с BM25 ранжированием
4. LIKE-фоллбэк для camelCase, если FTS5 не дал результатов
5. Fuzzy-фоллбэк для опечаток, если LIKE не дал результатов
6. Форматирование результатов (имя, вид, файл, строки)
7. Ограничение MAX_OUTPUT_LENGTH с усечением и заметкой

#### ntgraph_node

1. Валидация через `validateString(symbol, 'symbol', MAX_INPUT_LENGTH)`
2. Определение режима: если `symbol` — путь к файлу (содержит `/` или расширение), режим файла; иначе режим символа
3. Режим символа: поиск узла по имени через `QueryBuilder.getNodesByName(symbol)`
4. Режим символа: если `includeCode`: извлечение кода через `ContextBuilder.getCode(nodeId)`
5. Режим символа: если `includeCallers`: получение вызывающих через `GraphTraverser.getCallers(nodeId)`
6. Режим символа: если `includeCallees`: получение вызываемых через `GraphTraverser.getCallees(nodeId)`
7. Режим файла: чтение файла из БД
8. Форматирование результатов

#### ntgraph_explore

Полный 18-шаговый алгоритм handleExplore:

1. **Валидация входных данных**: `validateString(query, 'query', MAX_INPUT_LENGTH)`
2. **Проверка индексации**: если проект не проиндексирован, вернуть `NotIndexedError` → `textResult` без `isError`
3. **Получение бюджета вывода**: `getExploreOutputBudget(fileCount)` по размеру проекта
4. **Извлечение символов из запроса**: парсинг query на named symbols
5. **Точное совпадение символов**: `findNodesByExactName` для каждого извлечённого символа
6. **FTS-поиск для каждого термина**: FTS5-запрос для каждого термина из запроса
7. **LIKE-фоллбэк для camelCase**: LIKE-запрос для camelCase разбиения
8. **Fuzzy-фоллбэк для опечаток**: fuzzy-поиск для терминов с опечатками
9. **Вставка glue nodes**: добавление соединительных узлов между найденными результатами
10. **Random-Walk-with-Restart**: `alpha=0.25`, `25 итераций` для ранжирования релевантности файлов
11. **Скоринг**: `entry=10`, `connected=3`, `peripheral=1`
12. **Исключение low-value файлов**: жесткое исключение тестов, specs, icons, i18n
13. **Blast radius анализ**: `buildBlastRadiusSection()` для entry символов
14. **Flow BFS**: поиск цепочек вызовов между named символами, `MAX_HOPS=7`, `MAX_BRIDGE=1`
15. **Dynamic boundaries**: `buildDynamicBoundaries()`, `MAX_NOTES=4`, `MAX_SCAN=8`
16. **Polymorphic detection**: `buildPolymorphicBoundaries()`, `CLASSY` kinds, `MIN_IMPL=8`, `MIN_SUPPORT=2`, `SAMPLE=40`
17. **Source rendering**: решение whole-file vs clustering
18. **Oversize spine windowing**: оконирование для больших методов

#### ntgraph_impact

1. Валидация через `validateString(symbol, 'symbol', MAX_INPUT_LENGTH)`
2. Поиск узла по имени через `findAllSymbols()`
3. Multi-definition per-definition радиус воздействия
4. Радиус воздействия через `GraphTraverser.getImpactRadius(nodeId, depth)`
5. Дедупликация merged узлов/ребер
6. Форматирование результатов
7. Ограничение MAX_OUTPUT_LENGTH

#### ntgraph_callers

1. Валидация через `validateString(symbol, 'symbol', MAX_INPUT_LENGTH)`
2. Поиск узла по имени через `findAllSymbols()`
3. Multi-definition группировка вывода
4. Вызывающие через `GraphTraverser.getCallers(nodeId)`
5. Извлечение edge label через `edgeLabel()`
6. Заметка фильтра, когда file filter не совпадает
7. Форматирование результатов
8. Ограничение MAX_OUTPUT_LENGTH

#### ntgraph_callees

1. Валидация через `validateString(symbol, 'symbol', MAX_INPUT_LENGTH)`
2. Поиск узла по имени через `findAllSymbols()`
3. Multi-definition группировка вывода
4. Вызываемые через `GraphTraverser.getCallees(nodeId)`
5. Извлечение edge label через `edgeLabel()`
6. Заметка фильтра, когда file filter не совпадает
7. Форматирование результатов
8. Ограничение MAX_OUTPUT_LENGTH

#### ntgraph_files

1. Получение файлов через `QueryBuilder.getAllFiles()`
2. Фильтрация по `path` (если указано)
3. Фильтрация по `pattern` (если указано)
4. Фильтрация по `language` (если указано)
5. Ограничение по `limit` (если указано)
6. Форматирование результатов

#### ntgraph_status

1. Получение статистики через `QueryBuilder.getStats()`
2. Возврат объекта с `nodeCount`, `edgeCount`, `fileCount`, `lastIndexedAt`, `isStale`
3. Получение pending файлов через `getPendingFiles()`
4. Проверка worktree mismatch
5. Форматирование результатов с секцией staleness и предупреждениями
6. `formatStaleFooter(pendingFiles)` для pending файлов

### Валидация входных данных

- `MAX_INPUT_LENGTH = 10_000` — макс длина строк (query, symbol)
- `MAX_PATH_LENGTH = 4_096` — макс длина путей (projectPath)
- `MAX_OUTPUT_LENGTH = 15_000` — макс длина вывода
- `validateString()` / `validateOptionalPath()` в ToolHandler для централизованной валидации

### Форматирование результатов

- Markdown для большинства инструментов
- Ограничение MAX_OUTPUT_LENGTH с усечением и заметкой
- `textResult()` — успешный результат без `isError`
- `errorResult()` — ошибка с `isError: true`

## Вспомогательные функции

- `getExploreOutputBudget(fileCount)` — адаптивный бюджет вывода по размеру проекта
- `validateString(value, name, maxLength)` — централизованная валидация строки
- `validateOptionalPath(value, name)` — централизованная валидация опционального пути
- `numberSourceLines(content: string)` — префикс номеров строк
- `fileSectionHeader(filePath: string)` — заголовок секции файла
- `formatStaleBanner(filePath: string)` — баннер устаревания файла
- `formatStaleFooter(pendingFiles: IPendingFile[])` — футер pending файлов
- `formatDegradedBanner(reason: string)` — баннер деградации
- `lastQualifierPart(symbol: string)` — извлечение квалифицированного символа
- `exploreLineNumbersEnabled()` — проверка env флага `NTGRAPH_EXPLORE_LINENUMS`
- `adaptiveExploreEnabled()` — проверка env флага `NTGRAPH_ADAPTIVE_EXPLORE`
- `resolveCatchUpGateTimeoutMs()` — разрешение таймаута из `NTGRAPH_CATCHUP_GATE_TIMEOUT_MS`
- `parseDebounceEnv()` — парсинг debounce env с clamping
- `detectDynamicDispatch(node, traverser)` — определение динамической диспетчеризации (callback/event)

## Динамическая диспетчеризация

- `synthEdgeNote()` — описание синтезированных ребер (callback, event-emitter, react-render, jsx-render, vue-handler, interface-impl, closure-collection, fn-pointer-dispatch, goframe-route)
- `buildDynamicBoundaries()` — сканирование disconnected symbol bodies на диспетчеризациях
- `buildPolymorphicBoundaries()` — обнаружение interface/registry диспетчеризации из графа
- `boundaryCandidates()` — shortlisting runtime целей для dispatch keys
- `scanDynamicDispatch` импорт для `detectDynamicDispatch`

## Интеграция с файловым наблюдателем

- File watcher для обнаружения изменений в файлах проекта
- Инкрементальная синхронизация при изменениях файлов
- Pending file tracking: список изменённых файлов до следующей синхронизации
- Staleness annotations: аннотация устаревших результатов
- `watch()` метод с `onSyncComplete`, `onSyncError`, `onDegraded` callback
- `watchDisabledReason()` — проверка возможности наблюдения
- `getPendingFiles()` — список pending файлов для staleness
- `isWatcherDegraded()` / `getWatcherDegradedReason()` — состояние деградации
- Debounce override через `NTGRAPH_WATCH_DEBOUNCE_MS`

## Cross-cutting заботы

- Per-file staleness аннотация: пересечение текста ответа с pending файлами
- Worktree mismatch аннотация
- Whole-index degradation banner
- Generated file down-ranking в результатах поиска
- Config leaf node security exclusion (никогда не рендерить секреты)
- Логирование: структурированное логирование для отладки
- Метрики: замеры времени выполнения инструментов
- Таймауты: ограничение времени выполнения через таймауты

## Шаблоны кэширования

- `projectCache: Map<string, NtGraphDb>` — кэш соединений БД по projectRoot
- `worktreeMismatchCache: Map<string, IWorktreeIndexMismatch | null>` — кэш несоответствия worktree
- Ключ кэша: пара `(startPath, indexRoot)`, не только startPath

## Ленивая загрузка

- `require()` паттерн: NtGraphDb НЕ загружается при import, только при выполнении инструмента
- Пример:
```typescript
function loadNtGraph(): typeof NtGraphDb {
  const NtGraphDb = require('./NtGraphDb');
  return NtGraphDb;
}
```

## Интеграция с текущим MCP-кодом

- `MCPManager.callTool()` маппится на `ToolHandler.execute()`
- `MCPToolAdapter` адаптирует ntgraph инструменты в `ITool`
- Жизненный цикл `NtGraphDb` управляется через `getNtGraph()` → open, cache, close
- `findNearestNtGraphRoot()` разрешает проекты через walk-up до ближайшего `.ntgraph/`
- `projectCache` в `ToolHandler` предотвращает дублирование соединений БД
- `freshen()` обнаруживает замененные `.ntgraph/` директории и перезапускает соединения

## Интеграция с текущим кодом

### Добавление инструментов в MCP-сервер

Текущий MCP-сервер расширит свои инструменты на граф-ориентированные:
- `ntgraph_search` — поиск символов
- `ntgraph_node` — информация о символе
- `ntgraph_explore` — исследование
- `ntgraph_impact` — радиус воздействия
- `ntgraph_callers` — вызывающие
- `ntgraph_callees` — вызываемые
- `ntgraph_files` — файлы
- `ntgraph_status` — статистика

### Интеграция с текущим поиском

`CodebaseSearch.search()` может использовать `ntgraph_search` как дополнение:
- Графовый поиск через FTS5 + граф
- Семантический поиск через VectorStore (остается как дополнение)

### Интеграция с Фазой 3

- `GraphTraverser` — для обхода графа
- `ReferenceResolver` — для разрешения ссылок
- `ContextBuilder` — для построения контекста

## Требования к качеству

### SOLID

- Single Responsibility: каждый обработчик отвечает только за свой инструмент, Engine — только за состояние, ToolHandler — только за диспетчеризацию
- Open/Closed: новые инструменты добавляются без изменения Engine (регистрация через массив)
- Liskov Substitution: обработчики инструментов реализуют общий интерфейс
- Interface Segregation: узкие интерфейсы для Engine, ToolHandler, Tools
- Dependency Inversion: инструменты зависят от интерфейсов (QueryBuilder, GraphTraverser), а не от конкретных реализаций

### Безопасность

- Валидация всех входных данных (длина строк, типы)
- Защита от path traversal (валидация путей)
- Ограничение размера вывода (MAX_OUTPUT_LENGTH)
- Обработка ошибок (try/catch в каждом обработчике)
- Не возвращать секреты из конфигурационных файлов

### Оптимизация

- Ленивая загрузка NtGraphDb (require() только при первом вызове инструмента)
- Кэширование результатов поиска (LRU)
- Batch-запросы для узлов и ребер
- Ограничение глубины обхода (depth) для предотвращения OOM

## Сценарии тестирования

1. **ntgraph_search с FTS5-поиском**: запрос с ключевыми словами, FTS5 возвращает результаты с BM25 ранжированием
2. **ntgraph_search с LIKE-фоллбэком**: FTS5 не дал результатов, LIKE-запрос для camelCase разбиения
3. **ntgraph_search с fuzzy-фоллбэком**: LIKE не дал результатов, fuzzy-поиск для опечаток
4. **ntgraph_node с includeCode**: поиск символа с включением исходного кода
5. **ntgraph_node с includeCallers**: поиск символа с включением вызывающих
6. **ntgraph_node с includeCallees**: поиск символа с включением вызываемых
7. **ntgraph_explore с небольшим проектом (< 150 файлов)**: бюджет 13K символов, 4 файла, 3.8K на файл
8. **ntgraph_explore с большим проектом (> 5000 файлов)**: бюджет 24K символов, 8-12 файлов, 4K на файл
9. **ntgraph_files с фильтром по языку**: фильтрация файлов по языку программирования
10. **ntgraph_files с фильтром по паттерну**: фильтрация файлов по glob-паттерну
11. **ntgraph_status с актуальной индексацией**: возврат статистики с `isStale: false`
12. **ntgraph_status с устаревшей индексацией**: возврат статистики с `isStale: true` и pending файлами
13. **NotIndexedError — проект не проиндексирован**: возврат `textResult` без `isError`
14. **PathRefusalError — отказ по безопасности**: возврат `errorResult` с `isError: true`
15. **Валидация входных данных (MAX_INPUT_LENGTH)**: входная строка длиннее 10000 символов
16. **Ограничение размера вывода (MAX_OUTPUT_LENGTH)**: вывод длиннее 15000 символов, усечение с заметкой

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

1. Создать типы данных (IToolDefinition, IPropertySchema, IToolResult, IExploreOutputBudget, IPendingFile, IWorktreeIndexMismatch)
2. Создать константы (MAX_OUTPUT_LENGTH, MAX_INPUT_LENGTH, MAX_PATH_LENGTH, MAX_NOTES, MAX_SCAN, MAX_HOPS, MAX_BRIDGE, CLASSY, MIN_IMPL, MIN_SUPPORT, SAMPLE, ENTRY_SCORE, CONNECTED_SCORE, PERIPHERAL_SCORE, ALPHA, ITERATIONS)
3. Создать ошибки (Errors.ts: NotIndexedError, PathRefusalError)
4. Создать адаптивный бюджет (Budget.ts: getExploreOutputBudget)
5. Создать ToolHandler (ToolHandler.ts: конструктор, execute, getTools, валидация, кэширование)
6. Создать определения инструментов (Tools.ts: массив IToolDefinition[] для 8 инструментов)
7. Создать обработчики инструментов (Handlers.ts):
   - searchHandler — ntgraph_search
   - nodeHandler — ntgraph_node (символ + файл)
   - exploreHandler — ntgraph_explore (с полным 18-шаговым алгоритмом)
   - impactHandler — ntgraph_impact (multi-definition)
   - callersHandler — ntgraph_callers (multi-definition)
   - calleesHandler — ntgraph_callees (multi-definition)
   - filesHandler — ntgraph_files
   - statusHandler — ntgraph_status
8. Создать MCPEngine (Engine.ts: ensureInitialized, retryInitializeSync, setProjectPathHint, catchUpSync, stop, getToolHandler)
9. Создать точку экспорта (index.ts)
10. Написать unit-тесты для каждого обработчика (16 сценариев)
11. Написать интеграционные тесты для MCPEngine и ToolHandler
12. Интегрировать с текущим MCP-сервером (MCPManager.callTool → ToolHandler.execute)
13. Интегрировать с Фазой 3 (GraphTraverser, ReferenceResolver, ContextBuilder)

## Зависимости

- Фазы 1 (NtGraphDb, QueryBuilder) — для доступа к БД
- Фазы 2 (ExtractionOrchestrator) — для заполнения БД
- Фазы 3 (GraphTraverser, ReferenceResolver, ContextBuilder) — для графовых операций
- Текущая MCP-инфраструктура проекта
