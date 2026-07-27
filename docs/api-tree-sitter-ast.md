# API: Tree-sitter извлечение и разделение на основе AST

## Обзор

Модуль `extraction` предоставляет детерминированное извлечение кода на основе AST через tree-sitter. Каждый файл анализируется парсером, который выдаёт узлы и рёбра графа. Результаты сохраняются в SQLite-базу из [API SQLite FTS5](api-sqlite-fts5.md).

---

## Типы данных

### INode — Узел графа

Представляет символ кода: функцию, класс, переменную и т.д.

| Поле | Тип | Описание |
|---|---|---|
| `id` | `string` | Уникальный идентификатор (`sha256(filePath:kind:name:line)`) |
| `kind` | `NodeKind` | Вид узла |
| `name` | `string` | Имя символа |
| `qualifiedName` | `string` | Квалифицированное имя |
| `filePath` | `string` | Путь к файлу |
| `language` | `Language` | Язык программирования |
| `startLine` / `endLine` | `number` | Диапазон строк (1-indexed) |
| `startColumn` / `endColumn` | `number` | Диапазон столбцов (0-indexed) |
| `docstring` | `string?` | Документация |
| `signature` | `string?` | Подпись символа |
| `visibility` | `'public' \| 'private' \| 'protected' \| 'internal'?` | Видимость |
| `isExported` / `isAsync` / `isStatic` / `isAbstract` | `boolean?` | Флаги |
| `decorators` / `typeParameters` | `string[]?` | Декораторы и параметры типов |
| `returnType` | `string?` | Тип возвращаемого значения |
| `metadata` | `Record<string, unknown>?` | Произвольные метаданные |
| `updatedAt` | `number` | Временная метка обновления |

### IEdge — Ребро графа

Связь между двумя узлами.

| Поле | Тип | Описание |
|---|---|---|
| `source` / `target` | `string` | ID исходного и целевого узлов |
| `kind` | `EdgeKind` | Вид связи |
| `metadata` | `Record<string, unknown>?` | Произвольные метаданные |
| `line` / `column` | `number?` | Позиция в коде |
| `provenance` | `'tree-sitter' \| 'scip' \| 'heuristic'?` | Источник ребра |

### IFileRecord — Запись о файле

| Поле | Тип | Описание |
|---|---|---|
| `path` | `string` | Путь к файлу |
| `contentHash` | `string` | Хеш содержимого |
| `language` | `Language` | Язык |
| `size` | `number` | Размер в байтах |
| `modifiedAt` / `indexedAt` | `number` | Временные метки |
| `nodeCount` | `number` | Количество узлов |
| `errors` | `IExtractionError[]?` | Ошибки извлечения |

### IUnresolvedReference — Неразрешённая ссылка

| Поле | Тип | Описание |
|---|---|---|
| `fromNodeId` | `string` | ID узла-источника |
| `referenceName` | `string` | Имя ссылки |
| `referenceKind` | `ReferenceKind` | Вид ссылки |
| `line` / `column` | `number` | Позиция |
| `filePath` | `string?` | Контекст файла (денормализовано) |
| `language` | `Language?` | Контекст языка (денормализовано) |
| `candidates` | `string[]?` | Кандидаты на разрешение |
| `status` | `'pending' \| 'failed'?` | Статус разрешения |
| `nameTail` | `string?` | Остаток имени |
| `rowId` | `number?` | ID строки в БД |

### IExtractionResult — Результат извлечения

| Поле | Тип | Описание |
|---|---|---|
| `nodes` | `INode[]` | Извлечённые узлы |
| `edges` | `IEdge[]` | Извлечённые ребра |
| `unresolvedReferences` | `IUnresolvedReference[]` | Неразрешённые ссылки |
| `errors` | `IExtractionError[]` | Ошибки извлечения |
| `durationMs` | `number` | Время выполнения в мс |

### IExtractionError — Ошибка извлечения

| Поле | Тип | Описание |
|---|---|---|
| `message` | `string` | Сообщение об ошибке |
| `filePath` | `string` | Путь к файлу |
| `line` / `column` | `number?` | Позиция |
| `severity` | `'error' \| 'warning' \| 'info'` | Уровень |
| `code` | `'read_error' \| 'size_exceeded' \| 'parse_error' \| 'path_traversal'` | Код ошибки |

### IIndexProgress — Прогресс индексации

| Поле | Тип | Описание |
|---|---|---|
| `current` / `total` | `number` | Текущий / всего файлов |
| `file` | `string` | Обрабатываемый файл |
| `phase` | `'scanning' \| 'parsing' \| 'storing' \| 'resolving'` | Фаза |
| `durationMs` | `number` | Время выполнения |

### IIndexResult — Результат индексации

| Поле | Тип | Описание |
|---|---|---|
| `indexed` / `updated` / `removed` | `number` | Количество обработанных |
| `errors` | `IExtractionError[]` | Ошибки |
| `durationMs` | `number` | Время выполнения |

### ISyncResult — Результат синхронизации

| Поле | Тип | Описание |
|---|---|---|
| `added` / `updated` / `removed` | `number` | Количество обработанных |
| `errors` | `IExtractionError[]` | Ошибки |
| `durationMs` | `number` | Время выполнения |

### IResolutionResult — Результат разрешения ссылок

| Поле | Тип | Описание |
|---|---|---|
| `resolved` | `IResolvedRef[]` | Разрешённые ссылки |
| `unresolved` | `IUnresolvedReference[]` | Неразрешённые ссылки |
| `durationMs` | `number` | Время выполнения |

### IResolvedRef — Разрешённая ссылка

| Поле | Тип | Описание |
|---|---|---|
| `original` | `IUnresolvedReference` | Исходная ссылка |
| `targetNodeId` | `string` | ID целевого узла |
| `confidence` | `number` | Уверенность |
| `provenance` | `string` | Источник разрешения |

### ChunkResult — Результат чанка разрешения

| Поле | Тип | Описание |
|---|---|---|
| `resolved` | `IResolvedRef[]` | Разрешённые ссылки |
| `unresolved` | `IUnresolvedReference[]` | Неразрешённые ссылки |
| `deferredChain` | `IUnresolvedReference[]` | Отложенные цепные вызовы |
| `deferredThisMember` | `IUnresolvedReference[]` | Отложенные this-ссылки |
| `byMethod` | `Record<string, number>` | Счётчик по методам разрешения |

### SynthPassResult — Результат прохода синтеза

| Поле | Тип | Описание |
|---|---|---|
| `edges` | `IEdge[]` | Синтезированные рёбра |
| `ms` | `number` | Время выполнения в мс |

### IndexOptions — Параметры индексации

| Поле | Тип | Описание |
|---|---|---|
| `onProgress` | `(progress: IIndexProgress) => void?` | Callback прогресса |
| `signal` | `AbortSignal?` | Сигнал отмены |
| `ignoreDirs` | `ReadonlySet<string>?` | Игнорируемые директории |
| `ignorePatterns` | `string[]?` | Игнорируемые паттерны |
| `maxFileSize` | `number?` | Максимальный размер файла |
| `includeTests` | `boolean?` | Включать тесты |
| `frameworkNames` | `string[]?` | Имена фреймворков |

### IIndexAndResolveResult — Комбинированный результат

| Поле | Тип | Описание |
|---|---|---|
| `indexing` | `IIndexResult` | Результат индексации |
| `resolution` | `IResolutionResult` | Результат разрешения |
| `durationMs` | `number` | Общее время |

### IGraphStats — Статистика графа

| Поле | Тип | Описание |
|---|---|---|
| `nodeCount` / `edgeCount` / `fileCount` | `number` | Количество узлов, ребер, файлов |
| `nodesByKind` | `Record<NodeKind, number>` | Узлы по видам |
| `edgesByKind` | `Record<EdgeKind, number>` | Ребра по видам |
| `filesByLanguage` | `Record<string, number>` | Файлы по языкам |
| `dbSizeBytes` | `number` | Размер БД в байтах |
| `lastUpdated` | `number` | Временная метка последнего обновления |

---

## Перечисления

### NodeKind

Замороженный объект (`Object.freeze`) с PascalCase ключами и строчными значениями (22 значения):
`File: 'file'`, `Class: 'class'`, `Function: 'function'`, `Method: 'method'`,
`Property: 'property'`, `Field: 'field'`, `Interface: 'interface'`, `Struct: 'struct'`,
`Enum: 'enum'`, `TypeAlias: 'type_alias'`, `Constant: 'constant'`, `Variable: 'variable'`,
`Namespace: 'namespace'`, `Module: 'module'`, `Route: 'route'`, `Trait: 'trait'`,
`Protocol: 'protocol'`, `EnumMember: 'enum_member'`, `Parameter: 'parameter'`,
`Import: 'import'`, `Export: 'export'`, `Component: 'component'`.

### EdgeKind

12 значений: `contains`, `calls`, `imports`, `extends`, `implements`,
`references`, `type_of`, `returns`, `instantiates`, `overrides`, `decorates`, `exports`.

### ReferenceKind

Алиас типа: `EdgeKind | 'function_ref'`.

### Language

Замороженный массив (`Object.freeze`) с 43 значениями:
`typescript`, `javascript`, `tsx`, `jsx`, `python`, `go`, `rust`, `java`,
`c`, `cpp`, `csharp`, `razor`, `php`, `ruby`, `swift`, `kotlin`, `dart`,
`svelte`, `vue`, `astro`, `liquid`, `pascal`, `scala`, `lua`, `luau`,
`objc`, `r`, `yaml`, `twig`, `xml`, `properties`, `unknown`, `html`,
`css`, `sql`, `json`, `markdown`, `shell`, `dockerfile`, `toml`, `ini`, `cobol`,
`cfml`, `cfscript`, `arkts`.

---

## Класс ExtractionOrchestrator

Оркестратор индексации: сканирование, обнаружение фреймворков, парсинг через ParseWorkerPool,
хранение в SQLite, инкрементальная синхронизация.

### Конструктор

```
constructor(rootDir: string, db: NtGraphDb)
```

Принимает корневую директорию проекта и экземпляр базы данных.

### Методы

| Метод | Возврат | Описание |
|---|---|---|
| `indexAll(onProgress?, signal?, verbose?)` | `Promise<IIndexResult>` | Полная индексация: сканирование, обнаружение фреймворков, парсинг, хранение |
| `sync(onProgress?, signal?)` | `Promise<ISyncResult>` | Инкрементальная синхронизация с cooperative yield |
| `getChangedFiles()` | `{added, modified, removed, error?: boolean}` | Получение изменённых файлов через `git status --porcelain` |
| `hashContent(content)` | `string` | SHA256 хеширование содержимого |
| `resolveReferences(onProgress?, signal?)` | `Promise<IResolutionResult>` | Разрешение неразрешённых ссылок: по имени, квалифицированному имени, виду узла |
| `resolveAndPersistBatched(onProgress?, batchSize?)` | `Promise<IResolutionResult>` | Batch-разрешение с persist и synthesizeCallbackEdges. `onProgress` имеет подпись `(resolved: number, total: number) => void`, `batchSize` по умолчанию 5000 |
| `indexAndResolve(options?)` | `Promise<IIndexAndResolveResult>` | indexAll + resolveAndPersistBatched |
| `buildContextForQuery(query, options?)` | `Promise<ISubgraph>` | Построение контекста для AI-запроса |
| `getStats()` | `Promise<IGraphStats>` | Получение статистики графа из БД |

### Алгоритм indexAll()

1. Сканирование файлов (с учётом игнорируемых паттернов, размера, бинарности)
2. Для каждого файла: определение языка и извлечение AST через экстрактор
3. Сохранение результата через storeExtractionResult()
4. Отслеживание прогресса через onProgress
5. Поддержка AbortSignal — проверка перед каждым файлом, очистка при отмене
6. Фреймворк-экстракция и postExtract

### Алгоритм sync()

1. git status --porcelain --no-renames для обнаружения изменённых файлов
2. Для каждого изменённого файла: stat (размер, mtime) как префильтр
3. Сравнение по хешу содержимого только если stat изменился
4. Переизвлечение изменённых файлов, удаление удалённых
5. Кооперативная отдача каждые SYNC_RECONCILE_YIELD_INTERVAL файлов

---

## Интерфейс IExtractor

Контракт для экстракторов языков.

| Метод | Возврат | Описание |
|---|---|---|
| `extract(content, filePath, frameworkNames?)` | `IExtractionResult` | Извлечь узлы, рёбра и ссылки из содержимого файла |
| `getLanguage()` | `Language` | Язык экстрактора |
| `getSupportedExtensions()` | `string[]` | Поддерживаемые расширения файлов |

### Класс ExtractorBase

Базовый абстрактный класс для экстракторов.

| Метод | Возврат | Описание |
|---|---|---|
| `nodeId(filePath, kind, name, line)` | `string` | Генерация ID узла: `sha256(filePath:kind:name:line)` |
| `createNode(filePath, kind, name, startLine, endLine, startColumn, endColumn, opts)` | `INode` | Создание узла графа |
| `createEdge(source, target, kind, opts?)` | `IEdge` | Создание ребра графа |
| `createUnresolvedRef(fromNodeId, referenceName, referenceKind, line, column, filePath?, candidates?)` | `IUnresolvedReference` | Создание неразрешённой ссылки |
| `createError(message, filePath, severity, code, line?, column?)` | `IExtractionError` | Создание ошибки извлечения |
| `extractDocstring(content, startLine)` | `string?` | Извлечение docstring из комментариев |
| `splitStringArray(str)` | `string[]` | Нормализация строковых литералов в массив |
| `flushFnRefCandidates(sameFileFunctionNames, importedNames)` | `IUnresolvedReference[]` | Фиксация кандидатов function-ref |
| `captureFnRefCandidates(container)` | `void` | Захват function-ref кандидатов из контейнера AST |

---

## Подбор экстрактора

Экстракторы выбираются из приватной карты `EXTRACTOR_MAP` (ленивая инициализация).
Для неподдерживаемых языков возвращается `DefaultExtractor`. Публичный API — функция
`extractFromSource` в модуле `tree-sitter`.

Доступные экстракторы:
- `TypeScriptExtractor` — TypeScript/JavaScript (.ts, .tsx, .js, .jsx)
- `PythonExtractor` — Python (.py, .pyi)
- `GoExtractor` — Go (.go)
- `RustExtractor` — Rust (.rs)
- `JavaExtractor` — Java (.java)
- `CppExtractor` — C/C++ (.c, .cpp, .cc, .cxx, .h, .hpp, .hxx)
- `CSharpExtractor` — C# (.cs)
- `KotlinExtractor` — Kotlin (.kt, .kts)
- `SwiftExtractor` — Swift (.swift)
- `VueExtractor` — Vue (.vue)
- `AstroExtractor` — Astro (.astro)
- `SvelteExtractor` — Svelte (.svelte)
- `LiquidExtractor` — Liquid (.liquid)
- `RazorExtractor` — Razor (.razor, .cshtml)
- `PhpExtractor` — PHP (.php)
- `RubyExtractor` — Ruby (.rb)
- `CfmlExtractor` — CFML (.cfm, .cfc)
- `DfmExtractor` — DFM (.dfm)
- `MybatisExtractor` — MyBatis XML mapper (.xml)
- `DefaultExtractor` — fallback для неизвестных языков

---

## Модуль определения языка

Функции для определения языка файла по расширению и валидации.

| Функция | Возврат | Описание |
|---|---|---|
| `detectLanguage(filePath, content?)` | `Language` | Определение языка по расширению файла и shebang |
| `isSourceFile(filePath)` | `boolean` | Проверка на исходный файл (не бинарный, не генерируемый) |
| `isLanguageSupported(lang)` | `boolean` | Проверка поддержки языка |
| `isFileLevelOnlyLanguage(lang)` | `boolean` | Язык без символьной структуры (yaml, properties, xml) |
| `isGrammarLoaded(lang)` | `boolean` | Проверка загрузки грамматики |
| `getSupportedLanguages()` | `string[]` | Список поддерживаемых языков |
| `loadExtensionOverrides(rootDir)` | `void` | Загрузка кастомных маппингов из `ntgraph.json` |

---

## Модуль грамматик

Управление WASM-грамматиками tree-sitter.

| Функция | Возврат | Описание |
|---|---|---|
| `initGrammars()` | `Promise<void>` | Инициализация WASM-рантайма |
| `loadGrammarsForLanguages(languages)` | `Promise<void>` | Загрузка грамматик для заданных языков |
| `loadAllGrammars()` | `Promise<void>` | Загрузка всех доступных грамматик |
| `loadGrammar(language)` | `Promise<any>` | Загрузка грамматики с LRU-кэшем (макс 50) |
| `getGrammarVariant(language, filePath)` | `Promise<any>` | Вариант грамматики (tsx/ts для TS, c/cpp для .h) |
| `getGrammarName(language)` | `string` | Имя npm-пакета грамматики |
| `isGrammarCached(language)` | `boolean` | Проверка кэша грамматики |

---

## Пул воркеров (ParseWorkerPool)

Мульти-поточный пул для парсинга файлов через worker_threads.

### Конструктор

```
constructor(opts: ParseWorkerPoolOptions)
```

Параметры: `languages`, `size`, `workerScriptPath`, `recycleInterval?`, `parseTimeoutMs?`, `createWorker?`, `log?`.

### Методы

| Метод | Возврат | Описание |
|---|---|---|
| `prewarm()` | `void` | Предзапуск всего пула заранее |
| `requestParse(task)` | `Promise<IExtractionResult>` | Отправка задачи на парсинг |
| `recycleAll()` | `void` | Пересоздание всех idle воркеров |
| `destroy()` | `Promise<void>` | Уничтожение всех воркеров |
| `healthy` | `boolean` | Здоровье пула (крашей < 100) |
| `liveWorkers` | `number` | Количество живых воркеров |
| `size` | `number` | Размер пула |

### Протокол сообщений

Main -> Worker:
- `{ type: 'load-grammars', languages: string[] }` — загрузка грамматик
- `{ type: 'parse', id: number, filePath: string, content: string, language: string, frameworkNames?: string[] }` — запрос на парсинг

Worker -> Main:
- `{ type: 'grammars-loaded' }` — подтверждение загрузки
- `{ type: 'parse-result', id: number, result: IExtractionResult }` — результат парсинга
- `{ type: 'parse-error', id: number, error: string }` — ошибка при парсинге

### Жизненный цикл

- Lazy growth: воркеры спавнятся по мере необходимости (throttling MAX_CONCURRENT_SPAWN = 2)
- Двухфазный таймаут: базовый таймер → mark `timerExpired` → hard kill (×3 base) → убить воркер
- Поздний результат: если результат пришёл до hard kill, принимается
- Пересоздание воркера каждые 250 файлов (WASM линейная память не сжимается)
- Восстановление после краша: `onWorkerGone()` -> `spawnOne()`
- In-process fallback: парсинг на основном потоке при недоступности worker_threads
- Бюджет крашей: 100 — после исчерпания пул больше не возрождает воркеры

### Функции

| Функция | Возврат | Описание |
|---|---|---|
| `resolveParsePoolSize(envVal?, cpuCount)` | `number` | Размер пула (max 16, по умолчанию min(8, cpuCount - 1)) |
| `resolveParseTimeoutMs(envVal?)` | `number` | Таймаут парсинга из окружения |

---

## Пул воркеров разрешения (ResolverPool)

Пул worker-потоков для параллельного разрешения ссылок. Каждый воркер открывает
БД только для чтения на собственном подключении и размещает полный ReferenceResolver.
Основной поток разбивает батч на чанки, распределяет по пулу и принимает
результаты последовательно в порядке чанков.

### Создание

| Метод | Возврат | Описание |
|---|---|---|
| `ResolverPool.tryCreate(dbPath, projectRoot)` | `ResolverPool \| null` | Создаёт пул при наличии ресурсов |
| `ResolverPool.resolvePoolSize(opts)` | `number \| null` | Размер пула из CPU и памяти |
| `ResolverPool.worthParallel(batchLength)` | `boolean` | Стоит ли распределять батч |
| `minRefsForPool()` | `number` | Минимум ссылок для пула (150000) |

### Методы

| Метод | Возврат | Описание |
|---|---|---|
| `ready()` | `Promise<void>` | Ожидание готовности всех воркеров |
| `resolveBatch(refs)` | `Promise<ChunkResult>` | Разрешение ссылок через пул (агрегация deferredChain, deferredThisMember, byMethod) |
| `runSynthPass(passName)` | `Promise<SynthPassResult>` | Запуск прохода синтеза на наименее занятом воркере |
| `recycleWorkers()` | `Promise<void>` | Переработка всех воркеров: закрытие и reopening БД, rebind QueryBuilder |
| `destroy()` | `Promise<void>` | Уничтожение всех воркеров |

### Протокол сообщений воркера

Main -> Worker:
- `{ type: 'open', dbPath, projectRoot }` — открытие БД
- `{ type: 'resolve', id, refs }` — разрешение ссылок
- `{ type: 'synth', id, pass }` — проход синтеза
- `{ type: 'recycle', id }` — переработка соединения
- `{ type: 'close' }` — закрытие

Worker -> Main:
- `{ type: 'ready' }` — готовность
- `{ type: 'result', id, resolved, unresolved, deferredChain, deferredThisMember, byMethod }` — результат разрешения
- `{ type: 'synth-result', id, edges, ms }` — результат синтеза
- `{ type: 'recycled', id }` — подтверждение переработки
- `{ type: 'error', id?, message }` — ошибка

---

## StoreWriter

Клиент на основном потоке для store-worker. Используется ТОЛЬКО на пути массовой
индексации с чистой БД: bundle отправляются в порядке файлов, воркер применяет
их в порядке поступления, поэтому назначение rowid идентично хранению на основном
потоке. Аварийное отключение: CODEGRAPH_NO_STORE_WORKER=1.

### Методы

| Метод | Возврат | Описание |
|---|---|---|
| `ready()` | `Promise<void>` | Ожидание готовности воркера |
| `send(bundle)` | `void` | Отправка bundle одного файла |
| `waitBelow(limit)` | `Promise<void>` | Backpressure: разрешается, когда un-acked bundle меньше limit |
| `drain()` | `Promise<void>` | Разрешается, когда все bundle применены |
| `close()` | `Promise<void>` | Закрытие соединения воркера с БД |

### StoreBundle

| Поле | Тип | Описание |
|---|---|---|
| `nodes` | `INode[]` | Узлы файла |
| `edges` | `IEdge[]` | Рёбра файла |
| `refs` | `IUnresolvedReference[]` | Ссылки файла |
| `file` | `IFileRecord` | Запись файла |

### finalizeStoreBundle

Валидация/денормализация bundle перед storeFileBundle: узлы без обязательных
полей отбрасываются, рёбра должны соединять вставленные узлы, ссылки
денормализуются filePath/language.

---

## MemoryBudget

Запас памяти для определения размера пула рабочих — cgroup-честный на Linux,
reclaim-честный на macOS.

| Функция | Возврат | Описание |
|---|---|---|
| `cgroupMemoryAvailable()` | `number \| null` | Доступный запас под лимитом памяти cgroup (v2 затем v1), null при отсутствии ограничений |
| `darwinMemoryAvailable()` | `number \| null` | Reclaimable-inclusive доступная память на macOS через vm_stat |
| `memoryBudgetBytes()` | `number` | Бюджет: меньший из свободной памяти и запаса cgroup |

---

## Модуль валидации путей

Защита от path traversal и нормализация путей.

| Функция | Возврат | Описание |
|---|---|---|
| `validatePathWithinRoot(rootDir, relativePath, options?)` | `void` | Проверка вложенности пути внутри корня (лексическая + realpath); бросает ошибку `path_traversal` |
| `normalizePath(filePath)` | `string` | Нормализация путей (разделители, `..` и т.д.) |
| `isBinaryFile(content)` | `boolean` | Проверка на бинарный файл (нулевой байт или >30% непечатных) |
| `isTooLarge(size)` | `boolean` | Превышает ли размер MAX_FILE_SIZE (1 МБ) |
| `resolveRelativePath(filePath, projectRoot)` | `string` | Относительный путь от корня проекта |
| `shouldIndexFile(filePath, ignoreDirs?, ignorePatterns?)` | `boolean` | Фильтрация по игнорируемым директориям и паттернам |

---

## Модуль обнаружения вложенных репозиториев

Поиск и классификация вложенных `.git` директорий.

| Функция | Возврат | Описание |
|---|---|---|
| `discoverEmbeddedRepoRoots(projectRoot)` | `Promise<string[]>` | Рекурсивный поиск вложенных репозиториев (глубина до 4, лимит 2000 директорий) |
| `classifyGitDir(absDir)` | `'embedded' \| 'worktree' \| 'none'` | Классификация `.git` директории |
| `findNestedGitRepos(absDir, relPrefix)` | `string[]` | BFS-поиск вложенных git репозиториев |
| `findIgnoredEmbeddedRepos(repoDir)` | `string[]` | Поиск вложенных репозиториев в gitignored директориях |

---

## Модуль разрешения ссылок (ReferenceResolver)

Координатор всех стратегий разрешения ссылок. 3-проходное разрешение.

### Стратегии разрешения (в порядке приоритета)

| Стратегия | Функция | Описание |
|---|---|---|
| 0 | `matchByFilePath` | Совпадение по пути файла (#include "X.h") |
| 1 | `resolveFramework` | Фреймворк-специфичное разрешение |
| 2 | `resolveRazorUsing` | Razor/Blazor @using |
| 3 | `resolveJvmImport` | JVM FQN импорт |
| 4 | `resolveViaImport` | Разрешение через импорты |
| 5 | `matchByQualifiedName` | Разрешение по квалифицированному имени |
| 5.05 | `matchMethodCall` | Разрешение вызова метода (receiver.method()) |
| 5.1 | `matchReference` | Сопоставление по имени (с findBestMatch scoring) |
| 6 | `matchFunctionRef` | Функции как значения (callback-регистрации) |
| 7 | `resolveThisMemberFnRef` | this.<member> разрешение |
| 8 | `matchFuzzy` | Нечёткое совпадение (case-insensitive fallback) |

### 3-проходное разрешение

1. **Основной проход** — стандартное разрешение через все стратегии выше
2. **Цепные вызовы** — `matchDottedCallChain`, `matchScopedCallChain`, `matchCppCallChain`
3. **Отложенные this-ссылки** — BFS по супертипам

---

## Модуль сопоставления по имени (NameMatcher)

### Языковые семейства

`LANGUAGE_FAMILIES` определяет cross-family фильтрацию. Семейства:
- **javascript**: typescript, javascript, tsx, jsx, arkts, svelte, vue, astro
- **jvm**: java, kotlin, scala
- **c**: c, cpp, objc
- **dotnet**: csharp, razor
- **lua**: lua, luau
- **cfml**: cfml, cfscript
- **Одиночные**: python, go, rust, php, ruby, swift, dart, pascal, r

### Функции сопоставления

| Функция | Описание |
|---|---|
| `matchByFilePath(ref, context)` | Разрешение по пути файла (#include "X.h", #import "Foo.h") |
| `matchReference(ref, context)` | Сопоставление по имени с findBestMatch scoring для нескольких кандидатов |
| `matchFuzzy(ref, context)` | Case-insensitive fallback через getNodesByLowerName |
| `matchMethodCall(ref, context)` | Вызов метода: receiver.method() — 4 стратегии (inferable receiver, Go 2-hop, direct class, capitalized) |
| `matchFunctionRef(ref, context)` | Функциональные ссылки (callback-регистрации) с same-file preference |
| `matchDottedCallChain(ref, context)` | Цепные вызовы: Foo().bar() — factory chain + CONSTRUCTS_VIA_BARE_CALL |
| `matchScopedCallChain(ref, context)` | Cепные вызовы Rust: Foo::bar() |
| `matchCppCallChain(ref, context)` | Цепные вызовы C++: TypeName::method().method2() |
| `matchByQualifiedName(ref, context)` | Квалифицированное имя: Foo::bar или Foo.bar |

### Инференс типа получателя

| Функция | Описание |
|---|---|
| `inferLocalReceiverType(receiverName, ref, context)` | Инференс из локальных переменных (scope boundary, PHP $this->prop, PATTERN_MEMO кэш) |
| `inferCppReceiverType(receiverName, ref, context)` | C++ специфичный инференс (header scan, normalizeCppTypeName) |
| `localReceiverTypePatternsCached(language, r)` | Кэшированный доступ к паттернам (PATTERN_MEMO, cap 8192) |

### Поддерживаемые языки инференса

typescript, javascript, tsx, jsx, arkts, python, java, kotlin, csharp, swift, rust, go, ruby, scala, dart, php, lua, luau, r, pascal, cfml, cfscript

### Вспомогательные функции

| Функция | Описание |
|---|---|
| `sameLanguageFamily(lang1, lang2)` | Сравнение языковых семейств |
| `crossesKnownFamily(lang1, lang2)` | Проверка пересечения известных семейств |
| `resolveMethodOnType(typeName, methodName, ref, context, ...)` | Разрешение метода по типу с supertype walk (BFS, глубина до 4) |
| `preferCallSiteFile(nodes, callSiteFile)` | Сортировка: сначала узлы из файла вызова |
| `isLexicallyReachable(candidate, ref, context)` | Проверка лексической достижимости |
| `normalizeInferredTypeName(raw)` | Нормализация выражения типа к простому имени |

---

## Модуль обнаружения фреймворков

Определение фреймворков проекта для выбора стратегий разрешения ссылок.

| Функция | Возврат | Описание |
|---|---|---|
| `detectFrameworks(context)` | `IFrameworkResolver[]` | Обнаружение фреймворков по контексту разрешения |
| `getApplicableFrameworks(detected, language)` | `IFrameworkResolver[]` | Фильтрация по языку |
| `getAllFrameworkResolvers()` | `IFrameworkResolver[]` | Все зарегистрированные резолверы |
| `getFrameworkResolver(name)` | `IFrameworkResolver \| undefined` | Резолвер по имени |
| `registerFrameworkResolver(resolver)` | `void` | Регистрация резолвера |

### Резолверы фреймворков

Реализации в `src/repo/resolution/fw-resolvers/`:
- `express.ts` — Express.js
- `nestjs.ts` — NestJS
- `react.ts` — React/Next.js
- `vue.ts` — Vue.js
- `python.ts` — Python/Django/Flask
- `laravel.ts` — Laravel
- `java.ts` — Java/Spring
- `astro.ts` — Astro
- `svelte.ts` — SvelteKit
- `rust.ts` — Rust (Actix, Axum, Rocket)
- `ruby.ts` — Ruby on Rails
- `goframe.ts` — GoFrame
- `drupal.ts` — Drupal
- `fabric.ts` — Fabric.js (Canvas)
- `go.ts` — Go (Gin, Echo, Chi, gorilla/mux)
- `play.ts` — Play Framework (Java/Scala)
- `swift.ts` — SwiftUI/UIKit
- `terraform.ts` — Terraform

Дополнительно: `SwiftObjcBridge.ts` — мост Swift ↔ Objective-C.

---

## Класс ScopeIgnore

Управление игнорированием файлов с поддержкой вложенных репозиториев и glob-паттернов.

### Конструктор

```
constructor(baseDir: string, embeddedRepoRoots: string[])
```

### Методы

| Метод | Возврат | Описание |
|---|---|---|
| `shouldIgnore(filePath)` | `boolean` | Следует ли игнорировать файл |
| `addPattern(pattern)` | `void` | Добавить пользовательский паттерн игнорирования |

---

## Сканирование файлов

Асинхронное перечисление файлов с cooperative yield.

| Функция | Возврат | Описание |
|---|---|---|
| `scanDirectory(rootDir, options?)` | `Promise<string[]>` | Сканирование с git (быстрый) или обходом ФС (fallback) |
| `getGitVisibleFiles(rootDir)` | `Set<string> \| null` | `git ls-files` (tracked + untracked); null если git недоступен |
| `walkDirectory(rootDir, currentDir, files, ...)` | `Promise<void>` | Рекурсивный обход с per-directory .gitignore и symlink cycle detection |

---

## Обработка .gitignore

Чтение и валидация .gitignore файлов.

| Функция | Возврат | Описание |
|---|---|---|
| `readGitignorePatterns(giPath)` | `string[]` | Чтение паттернов из .gitignore с обработкой не-UTF-8 и некорректных строк |
| `isValidUtf8(buf)` | `boolean` | Проверка UTF-8 для .gitignore файлов |
| `matchGitignorePattern(filePath, pattern)` | `boolean` | Сопоставление пути с gitignore-паттерном |

---

## Парсинг через tree-sitter

Точка входа для извлечения из файла.

| Функция | Возврат | Описание |
|---|---|---|
| `extractFromSource(filePath, content, language, frameworkNames?)` | `IExtractionResult` | Парсинг файла через tree-sitter: AST-обход, извлечение узлов, ребер и ссылок |

---

## Генерация ID узлов

ID узла: `sha256(filePath:kind:name:line)`. Гарантирует уникальность и детерминизм.

---

## Извлечение ребер

Ребра извлекаются во время обхода AST:

| Вид | Описание |
|---|---|
| `contains` | Родитель содержит ребенка (file->class->method) |
| `calls` | Вызовы функций/методов (по узлам CallExpression) |
| `imports` | Импорты (по узлам ImportDeclaration) |
| `exports` | Экспорты символов |
| `extends` | Наследование (по узлам ClassDeclaration с extends) |
| `implements` | Реализация интерфейса |
| `references` | Общие ссылки на символы |
| `type_of` | Тип переменной/параметра |
| `returns` | Тип возврата функции |
| `instantiates` | Создание экземпляра класса |
| `overrides` | Переопределение метода |
| `decorates` | Декораторы |

---

## Модуль FunctionRef

Захват функций-обратных вызовов, передаваемых как аргументы.

| Тип | Описание |
|---|---|
| `FnRefCandidate` | Кандидат функции-ссылки: `name`, `line`, `column`, `mode: CaptureMode`, `explicitRef: boolean`, `skipGate?: boolean` |
| `CaptureMode` | `'args' \| 'rhs' \| 'value' \| 'list' \| 'varinit'` |
| `FN_REF_SPECS` | Карта правил захвата по языкам: c, cpp, objc, typescript, tsx, javascript, jsx, python, go, rust, java, kotlin, csharp, php, ruby, swift, scala, dart, lua, luau, pascal |
| `captureFnRefCandidates(container, rule: CaptureRule, spec: FnRefSpec)` | Захват кандидатов из контейнера AST |

---

## CfnptrSynthesizer

Синтез указателей на функции в C/C++. Связывает регистрации функций через
таблицы инициализации и присваивания с диспетчеризацией `recv->field(...)`.
Обрабатывает массивы указателей на функции без struct.

| Функция | Возврат | Описание |
|---|---|---|
| `synthesizeCfnptrEdges(queries, context)` | `IEdge[]` | Основной вход — синтез рёбер диспетчеризации указателей на функции |

---

## GoframeSynthesizer

Синтез рёбер GoFrame: route → controller-method. Ключ соединения — ТИП ЗАПРОСА
в сигнатуре обработчика.

| Функция | Возврат | Описание |
|---|---|---|
| `synthesizeGoframeEdges(queries, context, onYield?)` | `IEdge[]` | Синтез рёбер GoFrame |

---

## CallbackSynthesizer

Синтез callback-рёбер для фреймворков с динамической диспетчеризацией.

| Функция | Возврат | Описание |
|---|---|---|
| `synthesizeCallbackEdges(queries, context)` | `IEdge[]` | Синтез callback-рёбер |

---

## Модуль GeneratedDetection

Определение сгенерированных файлов для понижения ранга в поиске.

| Функция | Возврат | Описание |
|---|---|---|
| `isGeneratedFile(filePath)` | `boolean` | Шаблоны для генерируемых файлов (.pb.go, .generated.ts, .min.js и т.д.) |

---

## Модуль StripComments

Удаление комментариев из кода для повторного парсинга.

| Функция | Возврат | Описание |
|---|---|---|
| `stripCommentsForRegex(content, language)` | `string` | Удаление комментариев с сохранением позиций строк |

---

## Модуль PathAliases

Разрешение алиасов импортов (tsconfig paths и т.д.).

| Функция | Возврат | Описание |
|---|---|---|
| `loadProjectAliases(projectRoot)` | `AliasMap \| null` | Загрузка алиасов |
| `applyAliases(importPath, aliases, projectRoot)` | `string[]` | Применение алиасов к пути импорта |

---

## Модуль GoModule

Чтение go.mod для определения пути модуля.

| Функция | Возврат | Описание |
|---|---|---|
| `loadGoModule(projectRoot)` | `GoModule \| null` | Чтение go.mod из корня проекта |

| Тип | Описание |
|---|---|
| `GoModule` | `modulePath: string`, `rootDir: string` |

---

## Модуль WorkspacePackages

Разрешение импортов в monorepo: чтение workspaces из package.json и pnpm-workspace.yaml.

| Функция | Возврат | Описание |
|---|---|---|
| `loadWorkspacePackages(projectRoot)` | `WorkspacePackages \| null` | Загрузка пакетов workspace |
| `resolveWorkspaceImport(importPath, ws)` | `string \| null` | Разрешение workspace-импорта |

| Тип | Описание |
|---|---|
| `WorkspacePackages` | `byName: Map<string, string>`, `entryByName?: Map<string, string>` |

---

## Константы

| Константа | Значение | Описание |
|---|---|---|
| `FILE_IO_BATCH_SIZE` | `10` | Параллельное чтение файлов |
| `SYNC_YIELD_INTERVAL` | `1000` | Интервал cooperative yield при синхронизации |
| `SYNC_RECONCILE_YIELD_INTERVAL` | `1000` | Интервал уступки event loop при sync |
| `SCAN_YIELD_INTERVAL` | `100` | Интервал cooperative yield при сканировании |
| `PARSE_TIMEOUT_MS` | `10_000` | Базовый таймаут парсинга (10 секунд) |
| `PARSE_TIMEOUT_PER_10KB` | `10_000` | Доп. таймаут на каждые 10 КБ |
| `WORKER_RECYCLE_INTERVAL` | `250` | Интервал пересоздания worker-потока |
| `MAX_FILE_SIZE` | `1_048_576` | Максимальный размер файла для индексации (1 МБ) |
| `EMBEDDED_REPO_SEARCH_DEPTH` | `4` | Глубина поиска вложенных репозиториев |
| `EMBEDDED_REPO_SEARCH_ENTRIES` | `2000` | Лимит директорий при поиске вложенных репозиториев |
| `DEFAULT_IGNORE_DIRS` | `ReadonlySet<string>` | Директории по умолчанию для игнорирования (60+) |
| `DEFAULT_IGNORE_PATTERNS` | `string[]` | Паттерны игнорирования по умолчанию |
| `EXTRACTION_VERSION` | `number` | Версия схемы извлечения |
| `DEFAULT_YIELD_BUDGET_MS` | `250` | Бюджет кооперативной уступки управления |
| `SQLITE_PARAM_CHUNK_SIZE` | `500` | Размер чанка для batch-запросов SQLite |
| `LRU_CACHE_SIZE` | `1000` | Размер LRU-кэша узлов |
| `AMBIGUOUS_NAME_CEILING` | `500` | Порог неоднозначности имени (настраивается через `CODEGRAPH_AMBIGUOUS_NAME_CEILING`) |
| `PATTERN_MEMO_CAP` | `8192` | Максимальный размер кэша паттернов инференса |
| `MIN_SEGMENT_CHARS` | `2` | Минимальная длина сегмента имени |
| `MAX_SEGMENT_CHARS` | `32` | Максимальная длина сегмента имени |
| `MAX_SEGMENTS_PER_NAME` | `12` | Максимальное число сегментов на имя |
| `MAX_PROSE_CANDIDATES` | `16` | Максимум кандидатов прозы |
| `MIN_PROSE_CHARS` | `4` | Минимальная длина слова прозы |
| `MAX_PROSE_CHARS` | `24` | Максимальная длина слова прозы |
| `DOMINANT_FILE_EDGE_THRESHOLD` | `20` | Минимальное число рёбер для доминирующего файла |
| `TOP_ROUTE_MIN_TOTAL` | `3` | Минимальное общее число маршрутов |
| `TOP_ROUTE_MIN_CONCENTRATION` | `0.30` | Минимальная концентрация для getTopRouteFile |
| `ROUTING_MANIFEST_DEFAULT_LIMIT` | `40` | Дефолтный лимит для getRoutingManifest |
| `FTS_LIMIT_MIN` | `100` | Минимальный лимит выборки FTS |
| `FTS_OVER_FETCH_MULTIPLIER` | `5` | FTS загружает в 5 раз больше для пост-пересчёта |
| `FILTER_ONLY_OVER_FETCH_MULTIPLIER` | `5` | Запросы только по фильтрам загружают в 5 раз больше |
| `EXACT_MATCH_SUPPLEMENT_LIMIT` | `20` | Лимит на термин для точного дополнения по имени |
| `FUZZY_MAX_DIST_SHORT` | `1` | Макс. расстояние редактирования для запросов <= 4 символов |
| `FUZZY_MAX_DIST_DEFAULT` | `2` | Макс. расстояние для запросов > 4 символов |
| `MAX_HOPS` | `6` | Максимальное число шагов в цепочке вызовов |
| `DEFAULT_CACHE_LIMIT` | `5_000` | Дефолтный лимит кэша |
| `MIN_PARALLEL_BATCH` | `1000` | Минимальный размер батча для параллельного разрешения |
| `CHUNK_SIZE` | `500` | Размер чанка для распределения |
