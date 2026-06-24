# Фаза 2: Tree-sitter экстракция и AST-ориентированное разделение

## Обзор

Замена текущих эвристических чанкеров (LineChunker, TypeScriptChunker на основе регулярных выражений) на детерминированную AST-экстракцию через tree-sitter. Каждый файл анализируется парсером, который выдает узлы и ребра графа. Результаты сохраняются в SQLite-базу из Фазы 1.

## Текущее состояние

### Модули нашего репозитория

- `src/repo/Chunker.ts` — два чанкера: LineChunker (фиксированные блоки с перекрытием) и TypeScriptChunker (regex-парсинг классов, интерфейсов, функций, методов). Поддерживает только TypeScript/JS. Остальные языки — LineChunker.
- `src/repo/CodebaseChunker.ts` — оркестратор: читает файлы последовательно, выбирает чанкер по языку, собирает все фрагменты.
- `src/repo/ChunkTypes.ts` — типы ICodeChunk (id, filePath, content, startLine, endLine, nodeKind, symbolName, language и т.д.).
- `src/repo/FullTextSearch.ts` — in-memory BM25-подобный поиск (будет заменен в Фазе 1).
- `src/repo/CodebaseSearch.ts` — гибридный поиск (семантический + ключевые слова).

### Проблемы текущего подхода

- TypeScriptChunker использует регулярные выражения — некорректно обрабатывает строки с фигурными скобками, многострочные комментарии, вложенные конструкции
- LineChunker разрезает код по фиксированному числу строк — теряет семантику
- Только TypeScript/JS имеет структурный чанкер. Python, Go, Rust, Java и др. — линейный чанкер
- Чтение файлов последовательное, без параллелизма
- Нет связей между символами (вызовы, импорты, наследование)
- Нет детерминированных ID узлов (зависят от индекса чанка)

## Референсный код

### Типы узлов и ребер

Референс: `ref/contents/codegraph/src/types.ts`

NodeKind (22 вида):
- `file`, `module`, `class`, `struct`, `interface`, `trait`, `protocol`
- `function`, `method`, `property`, `field`, `variable`, `constant`
- `enum`, `enum_member`, `type_alias`, `namespace`, `parameter`
- `import`, `export`, `route`, `component`

EdgeKind (12 видов):
- `contains` — родитель содержит ребенка (file->class, class->method)
- `calls` — функция/метод вызывает другую
- `imports` — файл импортирует из другого
- `exports` — файл экспортирует символ
- `extends` — класс/интерфейс наследует
- `implements` — класс реализует интерфейс
- `references` — общая ссылка на символ
- `type_of` — переменная/параметр имеет тип
- `returns` — функция возвращает тип
- `instantiates` — создает экземпляр класса
- `overrides` — метод переопределяет родительский
- `decorates` — декоратор применен к символу

ReferenceKind:
```typescript
export type ReferenceKind = EdgeKind | 'function_ref';
```
`function_ref` — внутренний тип для function name, используемого как VALUE (callback registration).

Node (интерфейс):
```typescript
export interface INode {
  id: string;                              // sha256(filePath:kind:name:line)
  kind: NodeKind;
  name: string;
  qualifiedName: string;                   // "src/utils.ts::MathHelper.calculateTotal"
  filePath: string;
  language: Language;
  startLine: number;                       // 1-indexed
  endLine: number;
  startColumn: number;                     // 0-indexed
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
  returnType?: string;                     // нормализованный тип возврата
  updatedAt: number;
}
```

Edge (интерфейс):
```typescript
export interface IEdge {
  source: string;                          // ID исходного узла
  target: string;                          // ID целевого узла
  kind: EdgeKind;
  metadata?: Record<string, unknown>;
  line?: number;
  column?: number;
  provenance?: 'tree-sitter' | 'scip' | 'heuristic';
}
```

UnresolvedReference (интерфейс):
```typescript
export interface IUnresolvedReference {
  fromNodeId: string;
  referenceName: string;
  referenceKind: EdgeKind | 'function_ref';
  line: number;
  column: number;
  filePath?: string;                       // денормализовано для производительности
  language?: Language;
  candidates?: string[];
}
```

ExtractionResult (интерфейс):
```typescript
export interface IExtractionResult {
  nodes: INode[];
  edges: IEdge[];
  unresolvedReferences: IUnresolvedReference[];
  errors: IExtractionError[];
  durationMs: number;
}
```

ExtractionError (интерфейс):
```typescript
export interface IExtractionError {
  message: string;
  filePath: string;
  line?: number;
  column?: number;
  severity: 'error' | 'warning' | 'info';
  code: 'read_error' | 'size_exceeded' | 'parse_error' | 'path_traversal';
}
```

### Дополнительные интерфейсы

IIndexProgress — прогресс индексации:
```typescript
export interface IIndexProgress {
  current: number;                         // текущий файл
  total: number;                           // всего файлов
  file: string;                            // текущий файл
  phase: 'scanning' | 'parsing' | 'storing' | 'resolving';
  durationMs: number;                      // затраченное время
}
```

IIndexResult — результат индексации:
```typescript
export interface IIndexResult {
  indexed: number;                         // проиндексировано файлов
  updated: number;                         // обновлено файлов
  removed: number;                         // удалено файлов
  errors: IExtractionError[];
  durationMs: number;
}
```

ISyncResult — результат синхронизации:
```typescript
export interface ISyncResult {
  added: number;                           // добавлено файлов
  updated: number;                         // обновлено файлов
  removed: number;                         // удалено файлов
  errors: IExtractionError[];
  durationMs: number;
}
```

IFileRecord — запись о файле:
```typescript
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
```

IGraphStats — статистика графа:
```typescript
export interface IGraphStats {
  nodeCount: number;
  edgeCount: number;
  fileCount: number;
}
```

IResolutionContext — контекст разрешения ссылок, 18 методов:
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
  getIncomingEdges(nodeId: string): IEdge[];
  getOutgoingEdges(nodeId: string): IEdge[];
  getFileContent(filePath: string): string | null;
  getFilePathFromNodeId(nodeId: string): string | null;
  getLanguageFromNodeId(nodeId: string): Language | null;
  getDetectedFrameworks(): string[];
  getAllFiles(): string[];
}
```

IFrameworkResolver — разрешатель фреймворков:
```typescript
export interface IFrameworkResolver {
  name: string;
  resolve(ref: IUnresolvedReference, context: IResolutionContext): IResolvedRef | null;
  postExtract(context: IResolutionContext): INode[];
  claimsReference?(name: string): boolean;
}
```

IImportMapping — маппинг импорта:
```typescript
export interface IImportMapping {
  sourcePath: string;
  sourceName: string;
  targetPath: string;
  targetName: string;
  language: Language;
}
```

IResolvedRef — разрешенная ссылка:
```typescript
export interface IResolvedRef {
  original: IUnresolvedReference;
  targetNodeId: string;
  confidence: number;
  provenance: string;
}
```

IResolutionResult — результат разрешения:
```typescript
export interface IResolutionResult {
  resolved: IResolvedRef[];
  unresolved: IUnresolvedReference[];
  durationMs: number;
}
```

IReExport — ре-экспорт:
```typescript
export interface IReExport {
  sourcePath: string;
  sourceName: string;
  language: Language;
}
```

IAliasMap — карта алиасов из tsconfig/jsconfig:
```typescript
export interface IAliasMap {
  [alias: string]: string[];
}
```

IGoModule — информация о Go модуле:
```typescript
export interface IGoModule {
  modulePath: string;
  goVersion: string;
  dependencies: Map<string, string>;
}
```

IWorkspacePackages — workspace пакеты:
```typescript
export interface IWorkspacePackages {
  packages: Map<string, string>;
  workspaces: string[];
}
```

### ScopeIgnore

Класс для управления игнорированием файлов с поддержкой embedded repos:
```typescript
export class ScopeIgnore {
  constructor(baseDir: string, embeddedRepoRoots: string[]);
  shouldIgnore(filePath: string): boolean;
  addPattern(pattern: string): void;
}
```

### Subgraph и поиск (для Фазы 3, типы определяются в Фазе 1 и Фазе 3)

Типы импортируются из Фазы 1 и Фазы 3:
- `ISubgraph` — из Фазы 1 (`src/repo/ntgraph/Types.ts`): `nodes: Map<string, INode>`, `edges: IEdge[]`, `roots: string[]`, `confidence?: 'high' | 'low'`
- `ITraversalOptions` — из Фазы 3: `maxDepth?`, `edgeKinds?`, `nodeKinds?`, `direction?`, `limit?`, `includeStart?`
- `ISearchOptions` — из Фазы 1 (`src/repo/ntgraph/Types.ts`): `kinds?`, `languages?`, `includePatterns?`, `excludePatterns?`, `pathFilters?`, `nameFilters?`, `limit?`, `offset?`, `caseSensitive?`
- `ISearchResult` — из Фазы 1 (`src/repo/ntgraph/Types.ts`): `node: INode`, `score: number`, `highlights?: string[]`

### ExtractionOrchestrator

Референс: `ref/contents/codegraph/src/extraction/index.ts`

Константы:
- `FILE_IO_BATCH_SIZE = 10` — параллельное чтение файлов
- `SYNC_RECONCILE_YIELD_INTERVAL = 1000` — интервал уступки event loop при sync (каждые 1000 файлов)
- `SCAN_YIELD_INTERVAL = 100` — интервал уступки event loop при сканировании (каждые 100 файлов)
- `PARSE_TIMEOUT_MS = 10_000` — базовый таймаут парсинга одного файла (10с + 10с на каждые 10 КБ содержимого)
- `WORKER_RECYCLE_INTERVAL = 250` — пересоздание worker через каждые 250 файлов (WASM память не сжимается)
- `MAX_FILE_SIZE = 1024 * 1024` — 1 МБ, пропускать файлы больше этого размера
- `EMBEDDED_REPO_SEARCH_DEPTH = 4` — глубина поиска вложенных .git
- `EMBEDDED_REPO_SEARCH_ENTRIES = 2000` — лимит на число директорий при поиске вложенных репозиториев

Методы:
- `indexAll(onProgress?, signal?, verbose?)` — полная индексация
- `indexFiles(filePaths)` — индексация списка файлов
- `indexFile(relativePath)` — индексация одного файла
- `indexFileWithContent(relativePath, content, stats)` — индексация с содержимым файла (для batch-чтения)
- `sync(onProgress?)` — инкрементальная синхронизация с cooperative yield
- `getChangedFiles()` — получение измененных файлов через `git status --porcelain`
- `storeExtractionResult(fileRecord, result)` — хранение результатов (10-шаговый алгоритм, см. ниже)
- `hashContent(content: string): string` — SHA256 хеширование содержимого
- `buildDetectionContext(files: string[])` — строит ResolutionContext для framework detection
- `ensureDetectedFrameworks(files?: string[])` — кеширует framework detection

### Алгоритм индексации

1. **Сканирование**: `scanDirectoryAsync()` перечисляет файлы через `git ls-files` (быстрый путь) или обход файловой системы (фоллбэк). Cooperative yield каждые 100 файлов через `setImmediate`.
2. **Обнаружение фреймворков**: `detectFrameworks()` определяется один раз по списку файлов через `buildDetectionContext()` -> `ResolutionContext`. Результат (`frameworkNames: string[]`) передаётся в каждый extract call.
3. **Загрузка грамматик**: `initGrammars()` инициализирует WASM-рантайм, `loadGrammarsForLanguages()` загружает только нужные грамматики.
4. **Парсинг (Worker Thread)**: Worker thread для освобождения основного потока. Worker пересоздается каждые 250 файлов (WASM линейная память не сжимается). Батч I/O: файлы читаются группами по 10 через `Promise.all`, затем передаются в `indexFileWithContent()`.
5. **Хранение (Main Thread)**: SQLite не потокобезопасен, все записи на основном потоке. `storeExtractionResult()` (см. ниже).
6. **Повторная попытка**: файлы, упавшие из-за WASM memory corruption, повторно парсятся с чистым worker, затем с удаленными комментариями.
7. **Abort signal**: Проверка `signal?.aborted` после сканирования, перед каждой итерацией batch, Worker terminate в finally.

### Алгоритм storeExtractionResult()

Самый сложный метод оркестратора. Критическая деталь: ID узла — `sha256(filePath:kind:name:line)`. Любой сдвиг строк меняет все ID. Метод выполняет 10 шагов:

1. **Проверка content hash** — если хеш совпадает с существующим FileRecord, возврат без изменений. Нет необходимости пересоздавать узлы и ребра.
2. **Снимок cross-file incoming ребер ПЕРЕД удалением** — через `getCrossFileIncomingEdgesWithTarget()` сохранить все incoming ребра из других файлов с метаданными цели (kind, name). Это необходимо, потому что после удаления данные о целях будут потеряны. Сохраняются объекты вида `{edge: IEdge, targetName: string, targetKind: NodeKind}`.
3. **Удаление существующих данных файла** — `deleteFile()` удаляет узлы и ребра файла каскадом через FK ON DELETE CASCADE. Все ребра, связанные с удаляемыми узлами, также удаляются автоматически.
4. **Фильтрация узлов** — проверка обязательных полей: `id`, `kind`, `name`, `filePath`, `language`, `startLine`, `endLine`. Узлы без обязательных полей отбрасываются.
5. **Вставка узлов** — `insertNodes()` с INSERT OR REPLACE. Операция идемпотентна: если узел с таким же ID уже существует, он будет заменён.
6. **Фильтрация ребер** — через `getExistingNodeIds()` проверяются source и target каждого ребра. Ребра на несуществующие узлы отбрасываются. Это предотвращает вставку ребер на узлы, которые не были добавлены (например, из-за фильтрации на шаге 4).
7. **Вставка ребер** — `insertEdges()` с INSERT OR IGNORE. Дубликаты ребер пропускаются без ошибок.
8. **Восстановление cross-file incoming ребер** — для каждого сохранённого ребра из шага 2 выполняется поиск цели по `(filePath, kind, name)` в новых узлах файла. Если цель найдена, ребро восстанавливается с новым ID цели. Если цель не найдена (символ удалён или переименован), ребро отбрасывается.
9. **Вставка unresolved references** — `insertUnresolvedRefsBatch()` добавляет неразрешённые ссылки batch-ом. Денормализует `filePath` и `language` из fromNodeId для производительности.
10. **Upsert FileRecord** — `upsertFile()` с INSERT OR REPLACE обновляет метаданные файла: path, contentHash, language, size, modifiedAt, indexedAt, nodeCount, errors.

### QueryBuilder методы

Класс `QueryBuilder` из `../db/queries` — методы, необходимые для хранения:
```typescript
export class QueryBuilder {
  getNodesByFile(filePath: string): INode[];
  deleteNodesByFile(filePath: string): number;
  getExistingNodeIds(ids: string[]): Set<string>;
  getCrossFileIncomingEdgesWithTarget(filePath: string): Array<{edge: IEdge, targetName: string, targetKind: NodeKind}>;
  getStaleFiles(): IFileRecord[];
  getFileByPath(path: string): IFileRecord | null;
  upsertFile(file: IFileRecord): void;
  getAllFiles(): IFileRecord[];
  insertUnresolvedRef(ref: IUnresolvedReference): void;
  insertUnresolvedRefsBatch(refs: IUnresolvedReference[]): void;
  getUnresolvedByName(name: string): IUnresolvedReference[];
  insertNodes(nodes: INode[]): void;
  insertEdges(edges: IEdge[]): void;
}
```

## Референсные файлы

При реализации каждого модуля ниже смотри указанный файл референсного кода.
**Важно:** код писать новый, с нашими именами (NtGraphDb, ntgraph и т.д.).
Методы и алгоритмы можно использовать как образец.

| Наш файл | Референсный файл |
|---|---|
| `src/repo/extraction/Orchestrator.ts` | `ref/contents/codegraph/src/extraction/index.ts` |
| `src/repo/ntgraph/Types.ts` | `ref/contents/codegraph/src/types.ts` |

## Архитектура

### Структура модуля

```
src/repo/
  extraction/
    index.ts                — точка экспорта
    Orchestrator.ts         — ExtractionOrchestrator
    ParserWorker.ts         — Worker thread для парсинга
    LanguageDetector.ts     — определение языка по расширению
    Grammars.ts             — загрузка tree-sitter грамматик
    ExtractorBase.ts        — базовый класс экстрактора
    extractors/
      TypeScript.ts         — экстрактор для TypeScript/JavaScript
      Python.ts             — экстрактор для Python
      Go.ts                 — экстрактор для Go
      Rust.ts               — экстрактор для Rust
      Java.ts               — экстрактор для Java
      Cpp.ts                — экстрактор для C/C++
      CSharp.ts             — экстрактор для C#
      Default.ts            — экстрактор по умолчанию (минимальный)
```

### Класс ExtractionOrchestrator

```typescript
export class ExtractionOrchestrator {
  constructor(rootDir: string, db: NtGraphDb);

  async indexAll(
    onProgress?: (progress: IIndexProgress) => void,
    signal?: AbortSignal,
    verbose?: boolean
  ): Promise<IIndexResult>;

  async indexFiles(filePaths: string[]): Promise<IIndexResult>;

  async indexFile(relativePath: string): Promise<IExtractionResult>;

  async indexFileWithContent(
    relativePath: string,
    content: string,
    stats: { size: number; mtimeMs: number }
  ): Promise<IExtractionResult>;

  async sync(
    onProgress?: (progress: IIndexProgress) => void
  ): Promise<ISyncResult>;

  getChangedFiles(): { added: string[]; modified: string[]; removed: string[] };

  storeExtractionResult(
    fileRecord: IFileRecord,
    result: IExtractionResult
  ): void;

  hashContent(content: string): string;

  buildDetectionContext(files: string[]): IResolutionContext;

  ensureDetectedFrameworks(files?: string[]): string[];
}
```

### Интерфейс экстрактора

```typescript
export interface IExtractor {
  extract(content: string, filePath: string, frameworkNames?: string[]): IExtractionResult;
  getLanguage(): string;
  getSupportedExtensions(): string[];
}
```

### Worker thread

Worker thread для парсинга файлов. Протокол сообщений:

Main -> Worker:
- `{ type: 'load-grammars', languages: string[] }` — загрузка грамматик
- `{ type: 'parse', id: number, filePath: string, content: string, frameworkNames: string[], language: string }` — запрос на парсинг

Worker -> Main:
- `{ type: 'grammars-loaded' }` — подтверждение загрузки грамматик
- `{ type: 'parse-result', id: number, result: IExtractionResult }` — результат парсинга

### Жизненный цикл Worker thread

- `pendingParses: Map<number, { resolve, reject, timeout }>` — карта ожидающих запросов. Каждый запрос имеет уникальный числовой ID и хранит resolve/reject функции для Promise, а также таймер timeout для отмены при превышении времени.
- `ensureWorker()` — ленивый спавн worker с загрузкой грамматик. Создаёт worker только при первом parse-запросе. Если worker уже существует и работает, возвращает его.
- `recycleWorker()` — принудительное пересоздание worker после `WORKER_RECYCLE_INTERVAL` (250) файлов. WASM линейная память не сжимается, поэтому после 250 файлов worker пересоздаётся для предотвращения утечек памяти.
- `rejectAllPending(reason)` — отклонение всех ожидающих запросов при краше worker. Перебирает `pendingParses` и вызывает `reject` для каждого запроса с причиной.
- In-process fallback: если worker threads недоступны (например, в тестовой среде или ограниченных окружениях), парсинг выполняется на основном потоке напрямую через `extractFromSource` с `loadGrammarsForLanguages`.

### Таймаут Worker thread

- Масштабируемый по размеру файла: `PARSE_TIMEOUT_MS + (fileSize / 10_000) * 10_000`. Базовый таймаут 10 секунд + 10 секунд на каждые 10 КБ содержимого. Например, файл 50 КБ получит таймаут 60 секунд.
- Каждый parse-запрос имеет свой таймер, который создаётся при отправке запроса в worker.
- При таймауте: reject FIRST (отклонение Promise с таймаут-ошибкой), затем `worker.terminate().catch(() => {})` (fire-and-forget завершение worker).
- Таймер отменяется при успешном завершении парсинга (получении `parse-result` от worker).

### Восстановление после краша Worker

- `on('exit')` — обработка неожиданного завершения worker. Если код завершения не 0 и есть pending парсы, вызывается `rejectAllPending()` с причиной и worker пересоздаётся через `ensureWorker()`.
- `on('error')` — обработка ошибок worker (например, не удалось запустить скрипт). Вызывается `rejectAllPending()` для всех ожидающих запросов.
- Автоматическое пересоздание worker: после `rejectAllPending()` worker создаётся заново через `ensureWorker()`, грамматики загружаются повторно.
- Повторная попытка всех pending запросов: после пересоздания worker все ранее ожидавшие запросы отправляются повторно.

## Детали реализации

### Определение языка

Функция `detectLanguage(filePath)`:
- По расширению файла (`.ts` -> `typescript`, `.py` -> `python`, и т.д.)
- Поддержка 33+ языков (см. LANGUAGES в референсе)

Функция `isSourceFile(filePath)`:
- Проверяет, является ли файл исходным (не бинарным, не генерированным)

Функция `isLanguageSupported(lang)`:
- Если язык не поддерживается, возвращается пустой результат без ошибок

### Языки только на уровне файлов

Функция `isFileLevelOnlyLanguage(lang)`:
- Для yaml, properties, xml — файлов без символьной структуры
- Эти языки не имеют символьной структуры, только узел `file`
- Тем не менее отслеживаются как `file` узлы для полноты графа

### Двойная грамматика для .h файлов

- `.h` файлы по умолчанию определяются как `c`, но могут быть C++ заголовками
- Загружаются обе грамматики: `c` и `cpp`
- Сначала парсинг с грамматикой `c`. Если парсинг не удался (ошибка или слишком много ошибок в AST), пробуем парсинг с грамматикой `cpp`
- Это позволяет корректно обрабатывать C++ заголовки в C-проектах и наоборот

### Переопределение расширений

Функция `loadExtensionOverrides(rootDir)`:
- Загрузка `ntgraph.json` из корня проекта для кастомных маппингов расширений на языки
- Позволяет добавить поддержку новых языков без модификации кода
- Формат: `{"extensions": {".myext": "mylanguage"}}`
- Переопределяет стандартный маппинг из `detectLanguage()`

### Валидация путей

Функция `validatePathWithinRoot(rootDir, relativePath, { allowSymlinkEscape })`:
- Защита от path traversal атак
- Проверяет, что `filePath` находится внутри `rootDir`
- Опция `allowSymlinkEscape` для symlink (по умолчанию `false`)

Функция `normalizePath`:
- Нормализация путей (разделители, `..` и т.д.)

### Игнорируемые директории

`DEFAULT_IGNORE_DIRS` — набор директорий, исключаемых по умолчанию (60+):
- JS/TS: `node_modules`, `bower_components`, `.next`, `.nuxt`, `.vite`, `dist`, `build`, `out`
- Python: `__pycache__`, `.venv`, `venv`, `.mypy_cache`, `.pytest_cache`
- Rust: `target`
- .NET: `obj`
- JVM: `.gradle`
- Swift: `.build`, `Pods`, `DerivedData`
- Общий: `.cache`, `vendor`, `coverage`

`DEFAULT_IGNORE_PATTERNS` — глобы поверх директорий:
- `*.egg-info/`, `cmake-build-*/`, `bazel-*/`

### Сканирование файлов

`scanDirectoryAsync(rootDir)` — async-вариант с cooperative yield каждые `SYNC_RECONCILE_YIELD_INTERVAL` файлов через `setImmediate`.

Git fast path:
- `getGitVisibleFiles()` — `git ls-files` с fallback на filesystem walk
- Поддержка embedded repos и submodules

Filesystem fallback:
- `scanDirectoryWalk()` — рекурсивный обход с:
  - Per-directory .gitignore parsing
  - Symlink cycle detection через `visitedDirs` Set
  - Scoped ignore matchers

### Обнаружение вложенных репозиториев

- `discoverEmbeddedRepoRoots(rootDir)` — рекурсивный поиск вложенных `.git` директорий с глубиной до `EMBEDDED_REPO_SEARCH_DEPTH` (4) и лимитом `EMBEDDED_REPO_SEARCH_ENTRIES` (2000) директорий
- `classifyGitDir(absDir)` — классификация `.git` директории: `'embedded'` (вложенный репозиторий), `'worktree'` (git worktree, пропускается), `'none'` (не git)
- `findNestedGitRepos(absDir, relPrefix)` — BFS-поиск вложенных git репозиториев с ограничением по глубине и числу директорий
- `findIgnoredEmbeddedRepos(repoDir)` — поиск вложенных репозиториев в gitignored директориях (например, `vendor/` в Go)

### Обработка .gitignore

Функция `readGitignorePatterns(giPath)`:
- Не-UTF-8 файл (DLP-encryption) — skip целиком с предупреждением
- Uncompilable pattern — drop только плохую строку

Функция `isValidUtf8(buf: Buffer)`:
- Проверка UTF-8 для .gitignore файлов

### Особые случаи .gitignore

- Пустые строки — пропускаются
- Строки, начинающиеся с `#` — комментарии, пропускаются
- Двойные `!!` — отмена игнорирования (negation pattern)
- Отрицательные паттерны (начинающиеся с `!`) — отменяют предыдущие игнор-паттерны
- Не-UTF-8 файлы .gitignore пропускаются целиком с предупреждением (возможная DLP-encryption)
- Некорректные паттерны отбрасываются только на уровне строки — остальные паттерны обрабатываются нормально
- Это предотвращает падение индексации из-за проблемного .gitignore

### Парсинг через tree-sitter

Функция `extractFromSource(filePath, content, language, frameworkNames)`:
- Точка входа для каждого файла
- Используется напрямую в in-process fallback

Каждый экстрактор:
1. Получает WASM-грамматику для своего языка
2. Парсит содержимое файла в AST
3. Обходит AST и извлекает узлы (Node) и ребра (Edge)
4. Для неразрешенных ссылок создает UnresolvedReference

### Генерация ID узлов

ID узла: `sha256(filePath:kind:name:line)`. Гарантирует уникальность и детерминизм.

### Извлечение узлов

Для каждого языка экстрактор определяет:
- Топ-уровневые конструкции (классы, функции, типы)
- Вложенные конструкции (методы, свойства внутри классов)
- Импорты и экспорты
- Связи между узлами (contains, calls, imports и т.д.)

### Извлечение ребер

Ребра извлекаются во время обхода AST:
- `contains`: родительский узел -> дочерний (file->class->method)
- `calls`: вызовы функций/методов (по узлам CallExpression)
- `imports`: импорты (по узлам ImportDeclaration)
- `exports`: экспорты
- `extends`: наследование (по узлам ClassDeclaration с extends)
- `implements`: реализация (по узлам ClassDeclaration с implements)
- `references`: общие ссылки на символы
- `type_of`: тип переменной/параметра
- `returns`: тип возврата функции
- `instantiates`: создание экземпляра класса
- `overrides`: переопределение метода
- `decorates`: декораторы

### Методы ResolutionContext

Интерфейс `IResolutionContext` предоставляет 18 методов для разрешения ссылок:

- `getNodesByFile(filePath: string): INode[]` — все узлы в файле
- `getNodesByName(name: string): INode[]` — узлы по точному имени
- `getImportMappings(filePath: string): IImportMapping[]` — маппинги импортов файла
- `getReExports(filePath: string): IReExport[]` — ре-экспорты файла
- `getNodeById(id: string): INode | null` — узел по ID
- `getNodesByKind(kind: NodeKind): INode[]` — узлы по типу
- `getNodesByQualifiedName(qualifiedName: string): INode[]` — узлы по квалифицированному имени
- `getNodesByLowerName(lowerName: string): INode[]` — узлы по имени без учёта регистра
- `getSupertypes(nodeId: string): INode[]` — супертипы узла (extends/implements)
- `getChildren(nodeId: string): INode[]` — дочерние узлы
- `getAncestors(nodeId: string): INode[]` — родительские узлы (включая корневой)
- `getIncomingEdges(nodeId: string): IEdge[]` — входящие ребра узла
- `getOutgoingEdges(nodeId: string): IEdge[]` — исходящие ребра узла
- `getFileContent(filePath: string): string | null` — чтение содержимого файла
- `getFilePathFromNodeId(nodeId: string): string | null` — путь файла по ID узла
- `getLanguageFromNodeId(nodeId: string): Language | null` — язык по ID узла
- `getDetectedFrameworks(): string[]` — обнаруженные фреймворки проекта
- `getAllFiles(): string[]` — все файлы проекта

### Обнаружение фреймворков

Функция `detectFrameworks(fileList: string[]): string[]`:
- Определяет фреймворки по списку файлов проекта
- Вызывается один раз перед индексацией
- Результат кешируется в `ensureDetectedFrameworks()`
- Сбрасывается при каждом `indexAll`
- Используется для выбора экстракторов и стратегий разрешения ссылок
- Примеры: React (по наличию JSX файлов), Express (по `express` в зависимостях), Spring Boot (по аннотациям)

### Инкрементальная синхронизация

Метод `sync(onProgress?)`:
1. `getChangedFiles()` — получение измененных файлов через `git status --porcelain --no-renames`
2. (size, mtime) stat pre-filter — быстрый фильтр без чтения файлов
3. Content hash compare — только если stat изменился
4. Cooperative yield каждые `SYNC_RECONCILE_YIELD_INTERVAL` (1000) файлов через `setImmediate`
5. Loads only grammars for changed files

### Логика повторных попыток

2 уровня retry для файлов, упавших из-за WASM memory corruption:

- **Уровень 1**: Повторный парсинг с чистым worker. Вызывается `recycleWorker()` для пересоздания worker с чистой WASM памятью, затем повторный парсинг того же файла.
- **Уровень 2**: Повторный парсинг с удаленными комментариями. Для файлов с 90%+ комментариев комментарии удаляются функцией `stripComments()` (номера строк сохраняются), затем парсинг повторно.
- Файлы с ошибками не блокируют индексацию — ошибки накапливаются и возвращаются в IndexResult.

### Обработка AbortSignal

- Проверка `signal?.aborted` перед каждым файлом в `indexAll` и `sync`
- Проверки после сканирования и перед каждой итерацией batch
- Отмена всех pending парсингов при AbortSignal — вызов `rejectAllPending()` с причиной отмены
- Worker terminate в finally — worker всегда завершается при выходе из функции, даже при отмене
- Graceful shutdown worker при отмене — worker завершается через `terminate()` в finally-блоке
- AbortSignal передаётся через всю цепочку вызовов для корректной отмены

### Обработка ошибок

- `IExtractionError` с полями: message, filePath, line, column, severity, code
- Коды ошибок: `read_error`, `size_exceeded`, `parse_error`, `path_traversal`
- 2-level retry для WASM memory corruption (см. выше)
- .gitignore edge cases: пустые строки пропускаются, комментарии пропускаются, двойные `!!` обрабатываются как negation
- Файлы с ошибками не блокируют индексацию — ошибки накапливаются и возвращаются в IndexResult

### Re-exports из index.ts

```typescript
// Экстракция
export { extractFromSource } from './tree-sitter';

// Языки
export {
  detectLanguage,
  isSourceFile,
  isLanguageSupported,
  isGrammarLoaded,
  getSupportedLanguages,
  isFileLevelOnlyLanguage,
} from './LanguageDetector';

// Грамматики
export {
  initGrammars,
  loadGrammarsForLanguages,
  loadAllGrammars,
} from './Grammars';
```

## Интеграция с текущим кодом

### Замена CodebaseChunker

`CodebaseChunker.chunkAll()` будет заменен на `ExtractionOrchestrator.indexAll()`:
- Вместо последовательного чтения — батч I/O по 10 файлов
- Вместо regex-парсинга — tree-sitter AST
- Вместо ICodeChunk[] — INode[] + IEdge[] в SQLite

### Маппинг ChunkNodeKind -> NodeKind

Текущий `ChunkNodeKind` (9 видов) расширяется до `NodeKind` (22 вида):
- `file` -> `file`
- `class` -> `class`
- `interface` -> `interface`
- `function` -> `function`
- `method` -> `method`
- `property` -> `property`
- `variable` -> `variable`
- `import` -> `import`
- `type_alias` -> `type_alias`
- Новые: `struct`, `trait`, `protocol`, `field`, `constant`, `enum`, `enum_member`, `namespace`, `parameter`, `export`, `route`, `component`

### Маппинг ICodeChunk -> INode

При переходе от старого чанкера к новому:
- `ICodeChunk.filePath` -> `INode.filePath`
- `ICodeChunk.nodeKind` -> `INode.kind`
- `ICodeChunk.symbolName` -> `INode.name`
- `ICodeChunk.content` -> `INode.signature`

### Маппинг ICodebaseChunker -> ExtractionOrchestrator

- `ICodebaseChunker.chunkAll()` -> `ExtractionOrchestrator.indexAll()`
- `ICodebaseChunker.chunkFile()` -> `ExtractionOrchestrator.indexFile()`

### Маппинг ICodeChunk -> IExtractionResult

- `ICodeChunk[]` -> `INode[]` + `IEdge[]` + `IUnresolvedReference[]`
- Старый подход возвращал плоский массив чанков
- Новый подход возвращает структурированный граф с узлами, ребрами и неразрешёнными ссылками

### Сохранение обратной совместимости

Интерфейс `ICodebaseChunker` будет сохранен, но реализация будет использовать ExtractionOrchestrator:
- `chunkAll()` -> `indexAll()`
- `chunkFile()` -> `indexFile()`

### Интеграция с Фазой 1

ExtractionOrchestrator использует NtGraphDb из Фазы 1 для хранения узлов, ребер и файлов. QueryBuilder используется для всех операций с базой данных: вставка узлов, ребер, unresolved references, upsert FileRecord, удаление узлов файла, получение cross-file incoming ребер.

## Требования к качеству

### SOLID

- Single Responsibility: каждый экстрактор отвечает только за свой язык, Orchestrator — только за координацию, Worker — только за парсинг
- Open/Closed: новые языки добавляются через новый экстрактор без изменения Orchestrator (регистрация через Map)
- Liskov Substitution: экстракторы реализуют IExtractor и взаимозаменяемы
- Interface Segregation: IExtractor, IExtractionResult, IIndexProgress — узкие интерфейсы
- Dependency Inversion: Orchestrator зависит от IExtractor, а не от конкретных экстракторов

### Безопасность

- Валидация filePath (защита от path traversal через `validatePathWithinRoot`)
- Ограничение размера файла (MAX_FILE_SIZE = 1 МБ)
- Таймаут парсинга (PARSE_TIMEOUT_MS + масштабирование по размеру)
- Обработка ошибок WASM (пересоздание worker, retry)
- Корректное закрытие worker (finally-блоки)
- Предотвращение утечек памяти: пересоздание worker каждые 250 файлов, кэш грамматик с ограничением
- Symlink cycle detection при filesystem walk

### Оптимизация

- Параллельное чтение файлов: O(N/B) вместо O(N) (B = FILE_IO_BATCH_SIZE = 10)
- Worker thread: парсинг не блокирует основной поток
- Batch-вставка в SQLite: транзакции для групп узлов и ребер
- Кэш грамматик: грамматики загружаются один раз и переиспользуются
- Инкрементальная синхронизация: `sync()` обрабатывает только измененные файлы
- Cooperative yield: уступка event loop каждые 100 файлов (scan) и каждые 1000 файлов (sync)
- Content hash check: пропуск неизмененных файлов без парсинга

## Сценарии тестирования

### Парсинг по языкам

1. **Парсинг TypeScript файла с классами, методами, импортами** — файл с классами, содержащими методы, свойства, декораторы; импорты из других файлов; экспорты символов. Проверка: все узлы извлечены, ребра `contains`, `calls`, `imports`, `exports` корректны.

2. **Парсинг Python файла с функциями, классами, импортами** — файл с функциями на уровне модуля, классами с методами, импортами из других модулей. Проверка: узлы `function`, `class`, `method`, `import` извлечены, ребра `contains`, `calls`, `imports` корректны.

3. **Парсинг Go файла с функциями, методами, импортами** — файл с функциями, методами (рецепторы), импортами пакетов. Проверка: узлы `function`, `method`, `import` извлечены, ребра `contains`, `calls`, `imports` корректны.

4. **Парсинг Rust файла с модулями, функциями, структурами** — файл с модулями, функциями, структурами, трейтами. Проверка: узлы `module`, `function`, `struct`, `trait` извлечены, ребра `contains`, `calls`, `implements` корректны.

5. **Парсинг Java файла с классами, методами, импортами** — файл с классами, методами, аннотациями, импортами. Проверка: узлы `class`, `method`, `import` извлечены, ребра `contains`, `calls`, `imports`, `extends` корректны.

6. **Парсинг C++ файла с классами, функциями, импортами** — файл с классами, функциями, #include. Проверка: узлы `class`, `function`, `import` извлечены, ребра `contains`, `calls`, `imports` корректны.

7. **Парсинг C# файла с классами, методами, импортами** — файл с классами, методами, using-директивами. Проверка: узлы `class`, `method`, `import` извлечены, ребра `contains`, `calls`, `imports` корректны.

### Обработка ошибок

8. **Обработка файла с WASM memory corruption (2-level retry)** — файл вызывает ошибку в WASM. Уровень 1: пересоздание worker и повторный парсинг. Уровень 2: удаление комментариев и повторный парсинг. Проверка: файл обработан или ошибка добавлена в результат без блокировки индексации.

9. **Обработка файла размером > MAX_FILE_SIZE** — файл больше 1 МБ. Проверка: файл пропущен, ошибка `size_exceeded` добавлена в результат.

10. **Обработка файла с path traversal** — путь содержит `../` за пределами rootDir. Проверка: валидация отклонила путь, ошибка `path_traversal` добавлена в результат.

### Инкрементальная синхронизация

11. **Инкрементальная синхронизация с измененными файлами** — файл изменен (новый content hash). Проверка: `sync()` обнаружил изменение через `getChangedFiles()`, файл реиндексирован, узлы и ребра обновлены.

12. **Инкрементальная синхронизация с удаленными файлами** — файл удален из репозитория. Проверка: `sync()` обнаружил удаление, узлы и ребра файла удалены из БД.

13. **Инкрементальная синхронизация с добавленными файлами** — новый файл добавлен в репозиторий. Проверка: `sync()` обнаружил добавление, файл проиндексирован, узлы и ребра добавлены в БД.

### Worker lifecycle

14. **Worker пересоздание каждые WORKER_RECYCLE_INTERVAL файлов** — после 250 файлов worker пересоздан. Проверка: `recycleWorker()` вызван, новый worker запущен, грамматики загружены повторно.

15. **AbortSignal отмена индексации** — AbortSignal отменён во время индексации. Проверка: `rejectAllPending()` вызван, worker завершен, индексация остановлена без ошибок.

### Cross-file ребра

16. **Cross-file edge preservation при повторной индексации** — файл A ссылается на символ в файле B. Файл B реиндексирован (сдвиг строк изменил ID узлов). Проверка: ребра из A в B восстановлены через поиск по `(filePath, kind, name)`.

### Worker lifecycle test

- Создание worker при первом запросе через `ensureWorker()`
- Пересоздание worker после `WORKER_RECYCLE_INTERVAL` файлов через `recycleWorker()`
- Корректное закрытие worker в finally-блоке

### Cross-file edge preservation test

- Ребра между файлами сохраняются при повторной индексации файла
- Сдвиг строк в целевом файле -> ребра перерешаются корректно
- Переименование символа в целевом файле -> ребро удаляется корректно

### Embedded repo discovery test

- Обнаружение вложенных `.git` директорий на глубину до 4 уровней
- Корректная классификация: embedded vs worktree vs none
- Поиск в gitignored директориях

### Retry logic test

- Повторные попытки при WASM memory corruption: уровень 1 (чистый worker), уровень 2 (без комментариев)
- Файл, упавший на уровне 1, проходит на уровне 2
- Файл, упавший на обоих уровнях, не блокирует индексацию

### Sync incremental test

- `sync()` обрабатывает только измененные файлы
- mtime/size не изменились -> пропуск
- Содержимое изменилось, но mtime тот же -> реиндексация
- Файл удалён с диска -> удаление из БД

### .gitignore parsing test

- Не-UTF-8 .gitignore -> пропуск с предупреждением
- Некорректный паттерн -> отбрасывание только плохой строки
- Пустые строки -> пропуск
- Комментарии (строки с `#`) -> пропуск
- Двойные `!!` -> negation pattern

### Path traversal protection test

- `validatePathWithinRoot` блокирует выход за rootDir
- Атака через `../` в пути -> ошибка path_traversal

### Batch I/O test

- Чтение файлов батчами по 10 через `Promise.all`
- Корректная обработка ошибок чтения отдельных файлов

### Content hash skip test

- Одинаковый hash пропускает повторную индексацию
- Разный hash -> полная реиндексация файла

### Framework detection test

- Обнаружение React по JSX файлам
- Обнаружение Express по зависимостям
- Кеширование результата через `ensureDetectedFrameworks()`

### Language detection test

- Определение языка по расширению файла
- `.h` файлы -> двойная грамматика (c + cpp)
- Неподдерживаемые расширения -> пустой результат

### Extraction error handling test

- Ошибки не блокируют индексацию
- Ошибки накапливаются и возвращаются в IndexResult

### File size limit test

- Файлы > 1 МБ пропускаются с ошибкой `size_exceeded`

### Parse timeout test

- Таймаут при парсинге больших файлов
- Таймаут масштабируется по размеру файла

### Worker crash recovery test

- Восстановление после краша worker
- Отклонение всех pending запросов при краше
- Пересоздание worker и повторная попытка

### Abort signal test

- Отмена индексации через AbortSignal
- Корректное завершение worker при отмене
- Остановка чтения файлов при отмене

## Методы QueryBuilder, необходимые для Фазы 2

Полный список методов `QueryBuilder` для Фазы 2:

- `insertNode(node: INode): void` — вставка одного узла (INSERT OR REPLACE)
- `insertNodes(nodes: INode[]): void` — batch-вставка узлов в транзакции
- `insertEdge(edge: IEdge): void` — вставка одного ребра (INSERT OR IGNORE)
- `insertEdges(edges: IEdge[]): void` — batch-вставка ребер в транзакции
- `deleteNodesByFile(filePath: string): number` — удаление всех узлов и ребер файла, возвращает количество удалённых узлов
- `getNodesByFile(filePath: string): INode[]` — получение всех узлов файла
- `getExistingNodeIds(ids: string[]): Set<string>` — валидация ребер: возвращает множество ID, которые существуют в БД
- `getCrossFileIncomingEdgesWithTarget(filePath: string): Array<{edge: IEdge, targetKind: NodeKind, targetName: string}>` — получение cross-file incoming ребер с метаданными цели для восстановления после реиндексации
- `upsertFile(file: IFileRecord): void` — upsert FileRecord (INSERT OR REPLACE)
- `getFileByPath(filePath: string): IFileRecord | null` — получение FileRecord по пути
- `getAllFiles(): IFileRecord[]` — получение всех FileRecord
- `getStaleFiles(): IFileRecord[]` — файлы с измененным content hash
- `insertUnresolvedRef(ref: IUnresolvedReference): void` — вставка одной неразрешённой ссылки
- `insertUnresolvedRefsBatch(refs: IUnresolvedReference[]): void` — вставка неразрешённых ссылок batch-ом в транзакции
- `getUnresolvedByName(name: string): IUnresolvedReference[]` — неразрешённые ссылки по имени

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

1. Создать типы данных (IExtractionResult, IExtractionError, IIndexProgress, IIndexResult, ISyncResult, IFileRecord, IGraphStats, IResolutionContext, IResolvedRef, IResolutionResult, IReExport, IAliasMap, IGoModule, IWorkspacePackages, IImportMapping, IFrameworkResolver, ISubgraph, ITraversalOptions, ISearchOptions, ISearchResult, ScopeIgnore)
2. Создать базовый класс экстрактора (ExtractorBase.ts)
3. Создать экстрактор для TypeScript/JavaScript (Extractors/TypeScript.ts)
4. Создать экстракторы для Python, Go, Rust, Java (Extractors/)
5. Создать экстракторы для C/C++, C# (Extractors/)
6. Создать экстрактор по умолчанию (Extractors/Default.ts)
7. Создать модуль определения языка (LanguageDetector.ts) с `detectLanguage`, `isSourceFile`, `isLanguageSupported`, `isFileLevelOnlyLanguage`, `loadExtensionOverrides`
8. Создать модуль загрузки грамматик (Grammars.ts) с `initGrammars`, `loadGrammarsForLanguages`, `loadAllGrammars`, `isGrammarLoaded`, `getSupportedLanguages`
9. Создать Worker thread (ParserWorker.ts) с lifecycle management, timeout, crash recovery, retry
10. Создать модуль path validation (validatePathWithinRoot, normalizePath)
11. Создать модуль embedded repo discovery (discoverEmbeddedRepoRoots, classifyGitDir, findNestedGitRepos)
12. Создать модуль framework detection (detectFrameworks, buildDetectionContext)
13. Создать ExtractionOrchestrator (Orchestrator.ts) с `indexAll`, `indexFiles`, `indexFile`, `indexFileWithContent`, `sync`, `getChangedFiles`, `storeExtractionResult`, `hashContent`, `ensureDetectedFrameworks`
14. Создать точку экспорта (index.ts) с re-exports
15. Написать unit-тесты для каждого экстрактора
16. Написать unit-тесты для Worker lifecycle
17. Написать unit-тесты для cross-file edge preservation
