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

Замороженный объект (`Object.freeze`) с PascalCase ключами и строчными значениями (18 значений):
`File: 'file'`, `Class: 'class'`, `Function: 'function'`, `Method: 'method'`,
`Property: 'property'`, `Field: 'field'`, `Interface: 'interface'`, `Struct: 'struct'`,
`Enum: 'enum'`, `TypeAlias: 'type_alias'`, `Constant: 'constant'`, `Variable: 'variable'`,
`Namespace: 'namespace'`, `Module: 'module'`, `Route: 'route'`, `Trait: 'trait'`,
`Protocol: 'protocol'`, `EnumMember: 'enum_member'`, `Parameter: 'parameter'`,
`Import: 'import'`, `Export: 'export'`, `Component: 'component'`.

### EdgeKind

11 значений: `contains`, `calls`, `imports`, `extends`, `implements`,
`references`, `type_of`, `returns`, `instantiates`, `overrides`, `decorates`, `exports`.

### ReferenceKind

Алиас типа: `EdgeKind | 'function_ref'`.

### Language

Замороженный массив (`Object.freeze`) с 41 значением:
`typescript`, `javascript`, `tsx`, `jsx`, `python`, `go`, `rust`, `java`,
`c`, `cpp`, `csharp`, `razor`, `php`, `ruby`, `swift`, `kotlin`, `dart`,
`svelte`, `vue`, `astro`, `liquid`, `pascal`, `scala`, `lua`, `luau`,
`objc`, `r`, `yaml`, `twig`, `xml`, `properties`, `unknown`, `html`,
`css`, `sql`, `json`, `markdown`, `shell`, `dockerfile`, `toml`, `ini`.

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
- `TypeScriptExtractor` — TypeScript/JavaScript
- `PythonExtractor` — Python
- `GoExtractor` — Go
- `RustExtractor` — Rust
- `JavaExtractor` — Java
- `CppExtractor` — C/C++
- `CSharpExtractor` — C#
- `DefaultExtractor` — fallback для неизвестных языков

---

## Модуль определения языка

Функции для определения языка файла по расширению и валидации.

| Функция | Возврат | Описание |
|---|---|---|
| `detectLanguage(filePath, content?)` | `Language` | Определение языка по расширению файла и shebang |
| `isSourceFile(filePath)` | `boolean` | Проверка на исходный файл (не бинарный, не генерируемый) |
| `isLanguageSupported(lang)` | `boolean` | Проверка поддержки языка (typescript, python, go, rust, java, cpp, c, csharp) |
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
| `requestParse(task)` | `Promise<IExtractionResult>` | Отправка задачи на парсинг |
| `recycleAll()` | `void` | Пересоздание всех idle воркеров |
| `destroy()` | `Promise<void>` | Уничтожение всех воркеров |
| `healthy` | `boolean` | Здоровье пула (крашей < 100) |
| `liveWorkers` | `number` | Количество живых воркеров |
| `sizeActual` | `number` | Реальный размер пула |

### Протокол сообщений

Main -> Worker:
- `{ type: 'load-grammars', languages: string[] }` — загрузка грамматик
- `{ type: 'parse', id: number, filePath: string, content: string, language: string, frameworkNames?: string[] }` — запрос на парсинг

Worker -> Main:
- `{ type: 'grammars-loaded' }` — подтверждение загрузки
- `{ type: 'parse-result', id: number, result: IExtractionResult }` — результат парсинга
- `{ type: 'parse-error', id: number, error: string }` — ошибка при парсинге

### Жизненный цикл

- Таймаут масштабируется по размеру файла: `PARSE_TIMEOUT_MS + (content.length / 100_000) * 10_000`
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
- `react.ts` — React
- `vue.ts` — Vue.js
- `python.ts` — Python/Django
- `laravel.ts` — Laravel
- `java.ts` — Java/Spring

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

## Модуль GeneratedDetection

Определение сгенерированных файлов для понижения ранга в поиске.

| Функция | Возврат | Описание |
|---|---|---|
| `isGeneratedFile(filePath)` | `boolean` | 19 шаблонов для генерируемых файлов (.pb.go, .generated.ts, .min.js и т.д.) |

---

## Модуль StripComments

Удаление комментариев из кода для повторного парсинга.

| Функция | Возврат | Описание |
|---|---|---|
| `stripCommentsForRegex(content, language)` | `string` | Удаление комментариев с сохранением позиций строк |

---

## Модуль PathAliases

Разрешение алиасов импортов (tsconfig paths и т.д.).

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

## Модуль PathAliases

Алиасы путей импорта из tsconfig.json / jsconfig.json.

| Функция | Возврат | Описание |
|---|---|---|
| `loadProjectAliases(projectRoot)` | `AliasMap \| null` | Загрузка алиасов |
| `applyAliases(importPath, aliases, projectRoot)` | `string[]` | Применение алиасов к пути импорта |

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
