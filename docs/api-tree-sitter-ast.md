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

### IUnresolvedReference — Неразрешенная ссылка

| Поле | Тип | Описание |
|---|---|---|
| `fromNodeId` | `string` | ID узла-источника |
| `referenceName` | `string` | Имя ссылки |
| `referenceKind` | `ReferenceKind` | Вид ссылки |
| `line` / `column` | `number` | Позиция |
| `filePath` | `string?` | Контекст файла (денормализовано) |
| `language` | `Language?` | Контекст языка (денормализовано) |
| `candidates` | `string[]?` | Кандидаты на разрешение |

### IExtractionResult — Результат извлечения

| Поле | Тип | Описание |
|---|---|---|
| `nodes` | `INode[]` | Извлеченные узлы |
| `edges` | `IEdge[]` | Извлеченные рёбра |
| `unresolvedReferences` | `IUnresolvedReference[]` | Неразрешенные ссылки |
| `errors` | `IExtractionError[]` | Ошибки извлечения |
| `durationMs` | `number` | Время выполнения (в мс) |

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

### IGraphStats — Статистика графа

| Поле | Тип | Описание |
|---|---|---|
| `nodeCount` / `edgeCount` / `fileCount` | `number` | Количество узлов, рёбер, файлов |
| `nodesByKind` | `Record<NodeKind, number>` | Узлы по видам |
| `edgesByKind` | `Record<EdgeKind, number>` | Рёбра по видам |
| `filesByLanguage` | `Record<string, number>` | Файлы по языкам |
| `dbSizeBytes` | `number` | Размер БД в байтах |
| `lastUpdated` | `number` | Временная метка последнего обновления |

---

## Перечисления

### NodeKind

22 значения: `file`, `class`, `function`, `method`, `property`, `field`, `interface`, `struct`, `enum`, `type_alias`, `constant`, `variable`, `namespace`, `module`, `route`, `trait`, `protocol`, `enum_member`, `parameter`, `import`, `export`, `component`.

### EdgeKind

12 значений: `contains`, `calls`, `imports`, `extends`, `implements`, `references`, `type_of`, `returns`, `instantiates`, `overrides`, `decorates`, `exports`.

### ReferenceKind

Алиас типа: `EdgeKind | 'function_ref'`.

### Language

39 значений: `typescript`, `javascript`, `tsx`, `jsx`, `python`, `go`, `rust`, `java`, `c`, `cpp`, `csharp`, `razor`, `php`, `ruby`, `swift`, `kotlin`, `dart`, `svelte`, `vue`, `astro`, `liquid`, `pascal`, `scala`, `lua`, `luau`, `objc`, `r`, `yaml`, `twig`, `xml`, `properties`, `unknown`, `html`, `css`, `sql`, `json`, `markdown`, `shell`, `dockerfile`, `toml`, `ini`.

---

## Класс ExtractionOrchestrator

Оркестратор индексации: сканирование, обнаружение фреймворков, парсинг через рабочий поток, хранение в SQLite, инкрементальная синхронизация.

### Конструктор

```
constructor(rootDir: string, db: NtGraphDb, scopeIgnore?: ScopeIgnore)
```

Принимает корневую директорию проекта, экземпляр базы данных и опционально готовый ScopeIgnore.

### Методы

| Метод | Возврат | Описание |
|---|---|---|
| `indexAll(onProgress?, signal?, verbose?)` | `Promise<IIndexResult>` | Полная индексация: сканирование, обнаружение фреймворков, парсинг, хранение |
| `indexFiles(filePaths)` | `Promise<IIndexResult>` | Индексация заданного списка файлов |
| `indexFile(relativePath)` | `Promise<IExtractionResult>` | Индексация одного файла |
| `indexFileWithContent(relativePath, content, stats)` | `Promise<IExtractionResult>` | Индексация с содержимым файла (для пакетного чтения) |
| `sync(onProgress?)` | `Promise<ISyncResult>` | Инкрементальная синхронизация с кооперативной уступкой управления |
| `getChangedFiles()` | `{added, modified, removed}` | Получение измененных файлов через `git status --porcelain` |
| `extractFile(relativePath)` | `IFileRecord \| undefined` | Извлечение данных файла из БД |
| `removeFile(relativePath)` | `void` | Удаление данных файла из БД (каскад FK) |
| `storeExtractionResult(fileRecord, result)` | `void` | Хранение результатов: 10-шаговый алгоритм (хеш-проверка, снимок межфайловых рёбер, удаление, фильтрация, вставка узлов и рёбер, восстановление межфайловых рёбер, unresolved refs, вставка или обновление записи о файле) |
| `hashContent(content)` | `string` | SHA256 хеширование содержимого |
| `buildDetectionContext(files)` | `IResolutionContext` | Построение контекста для обнаружения фреймворков |
| `ensureDetectedFrameworks(files?)` | `string[]` | Кешированное обнаружение фреймворков |
| `getGraphStats()` | `Promise<IGraphStats>` | Получение статистики графа из БД |

### Алгоритм storeExtractionResult()

1. Проверка хеша содержимого — возврат без изменений при совпадении
2. Снимок входящих межфайловых рёбер перед удалением
3. Удаление существующих данных файла (каскад FK)
4. Фильтрация узлов по обязательным полям
5. Вставка узлов (INSERT OR REPLACE)
6. Фильтрация рёбер через `getExistingNodeIds()`
7. Вставка рёбер (INSERT OR IGNORE)
8. Восстановление входящих межфайловых рёбер по `(filePath, kind, name)`
9. Пакетная вставка неразрешённых ссылок
10. Вставка или обновление записи о файле

---

## Интерфейс IExtractor

Контракт для экстракторов языков.

| Метод | Возврат | Описание |
|---|---|---|
| `extract(content, filePath, frameworkNames?)` | `IExtractionResult` | Извлечь узлы, рёбра и ссылки из содержимого файла |
| `getLanguage()` | `Language` | Язык экстрактора |
| `getSupportedExtensions()` | `string[]` | Поддерживаемые расширения файлов |

---

## Функция extractorFor

Подбор экстрактора для заданного языка. Возвращает `DefaultExtractor` для неподдерживаемых языков.

```
extractorFor(language: Language): IExtractor
```

---

## Модуль определения языка

Функции для определения языка файла по расширению и валидации.

| Функция | Возврат | Описание |
|---|---|---|
| `detectLanguage(filePath)` | `Language` | Определение языка по расширению файла |
| `isSourceFile(filePath)` | `boolean` | Проверка на исходный файл (не бинарный, не генерируемый) |
| `isLanguageSupported(lang)` | `boolean` | Проверка поддержки языка |
| `isFileLevelOnlyLanguage(lang)` | `boolean` | Язык без символьной структуры (yaml, properties, xml) |
| `isGrammarLoaded(lang)` | `boolean` | Проверка загрузки грамматики |
| `getSupportedLanguages()` | `string[]` | Список поддерживаемых языков |
| `loadExtensionOverrides(rootDir)` | `void` | Загрузка пользовательских сопоставлений из `ntgraph.json` |
| `getSupportedExtensions()` | `string[]` | Список поддерживаемых расширений файлов |

---

## Модуль грамматик

Управление WASM-грамматиками tree-sitter.

| Функция | Возврат | Описание |
|---|---|---|
| `initGrammars()` | `void` | Инициализация WASM-рантайма |
| `loadGrammarsForLanguages(languages)` | `void` | Загрузка грамматик для заданных языков |
| `loadAllGrammars()` | `void` | Загрузка всех доступных грамматик |

---

## Рабочий поток

Рабочий поток для парсинга файлов с управлением жизненным циклом, таймаутом и восстановлением после сбоя.

### Протокол сообщений

Main -> Worker:
- `{ type: 'load-grammars', languages: string[] }` — загрузка грамматик
- `{ type: 'parse', id: number, filePath: string, content: string, frameworkNames: string[], language: string }` — запрос на парсинг

Worker -> Main:
- `{ type: 'grammars-loaded' }` — подтверждение загрузки
- `{ type: 'parse-result', id: number, result: IExtractionResult }` — результат парсинга

### Методы управления рабочим потоком

| Метод | Возврат | Описание |
|---|---|---|
| `ensureWorker()` | `void` | Отложенный запуск рабочего потока с загрузкой грамматик |
| `recycleWorker()` | `void` | Пересоздание рабочего потока (после `WORKER_RECYCLE_INTERVAL` файлов) |
| `rejectAllPending(reason)` | `void` | Отклонение всех ожидающих запросов при сбое рабочего потока |

### Вспомогательные функции

| Функция | Возврат | Описание |
|---|---|---|
| `stripComments(content)` | `string` | Удаление комментариев из кода (для повторного парсинга) |
| `getParseTimeout(fileSize)` | `number` | Вычисление таймаута парсинга по размеру файла |

### Жизненный цикл рабочего потока

- `pendingParses: Map<number, {resolve, reject, timeout}>` — карта ожидающих запросов с таймерами
- Таймаут масштабируется по размеру файла: `PARSE_TIMEOUT_MS + (fileSize / 10_000) * 10_000`
- Пересоздание рабочего потока каждые 250 файлов (WASM линейная память не сжимается)
- Восстановление после сбоя: `rejectAllPending()` -> `ensureWorker()` -> повторная попытка
- Резервный парсинг в основном потоке при недоступности рабочих потоков

### Логика повторных попыток

- **Уровень 1**: Повторный парсинг с чистым рабочим потоком (`recycleWorker()`)
- **Уровень 2**: Повторный парсинг с удаленными комментариями (`stripComments()`)

---

## Модуль валидации путей

Защита от выхода за пределы директории и нормализация путей.

| Функция | Возврат | Описание |
|---|---|---|
| `validatePathWithinRoot(rootDir, filePath, options?)` | `boolean` | Проверка вложенности пути внутри корня (лексическая + по абсолютному пути) |
| `normalizePath(filePath)` | `string` | Нормализация путей (разделители, `..` и т.д.) |

---

## Модуль обнаружения вложенных репозиториев

Поиск и классификация вложенных `.git` директорий.

| Функция | Возврат | Описание |
|---|---|---|
| `discoverEmbeddedRepoRoots(rootDir)` | `string[]` | Рекурсивный поиск вложенных `.git` (глубина до 4, лимит 2000 директорий) |
| `classifyGitDir(absDir)` | `'embedded' \| 'worktree' \| 'none'` | Классификация `.git` директории |
| `findNestedGitRepos(absDir, relPrefix)` | `string[]` | Поиск в ширину вложенных git-репозиториев |
| `findIgnoredEmbeddedRepos(repoDir)` | `string[]` | Поиск вложенных репозиториев в директориях, игнорируемых git |

---

## Модуль обнаружения фреймворков

Определение фреймворков проекта для выбора стратегий разрешения ссылок.

| Функция | Возврат | Описание |
|---|---|---|
| `detectFrameworks(fileList)` | `string[]` | Определение фреймворков по списку файлов проекта |

---

## Класс ScopeIgnore

Управление игнорированием файлов с поддержкой вложенных репозиториев и glob-шаблонов.

### Конструктор

```
constructor(baseDir: string, embeddedRepoRoots: string[], extraPatterns?: string[])
```

### Методы

| Метод | Возврат | Описание |
|---|---|---|
| `shouldIgnore(filePath)` | `boolean` | Следует ли проигнорировать файл |
| `addPattern(pattern)` | `void` | Добавить пользовательский шаблон игнорирования |
| `addPatterns(patterns)` | `void` | Добавить несколько шаблонов игнорирования |

---

## Сканирование файлов

Асинхронное перечисление файлов с кооперативной уступкой управления.

| Функция | Возврат | Описание |
|---|---|---|
| `scanDirectoryAsync(rootDir)` | `AsyncIterable<string>` | Асинхронное сканирование с кооперативной уступкой управления каждые 100 файлов |
| `getGitVisibleFiles(rootDir)` | `string[]` | `git ls-files` с резервным обходом файловой системы |
| `scanDirectoryWalk(rootDir)` | `string[]` | Рекурсивный обход с .gitignore для каждой директории и обнаружением циклических ссылок |

---

## Обработка .gitignore

Чтение и валидация .gitignore файлов.

| Функция | Возврат | Описание |
|---|---|---|
| `readGitignorePatterns(giPath)` | `string[]` | Чтение шаблонов из .gitignore с обработкой не-UTF-8 и некорректных строк |
| `isValidUtf8(buf)` | `boolean` | Проверка UTF-8 для .gitignore файлов |

---

## Парсинг через tree-sitter

Точка входа для извлечения из файла.

| Функция | Возврат | Описание |
|---|---|---|
| `extractFromSource(filePath, content, language, frameworkNames?)` | `IExtractionResult` | Парсинг файла через tree-sitter: AST-обход, извлечение узлов, рёбер и ссылок |

---

## Генерация ID узлов

ID узла: `sha256(filePath:kind:name:line)`. Гарантирует уникальность и детерминизм.

---

## Извлечение рёбер

Рёбра извлекаются во время обхода AST:

| Вид | Описание |
|---|---|
| `contains` | Родитель содержит ребенка (file->class->method) |
| `calls` | Вызовы функций/методов (по узлам вызова) |
| `imports` | Импорты (по узлам импорта) |
| `extends` | Наследование (по узлам объявления класса с extends) |
| `implements` | Реализация интерфейса |
| `references` | Общие ссылки на символы |
| `type_of` | Тип переменной/параметра |
| `returns` | Тип возврата функции |
| `instantiates` | Создание экземпляра класса |
| `overrides` | Переопределение метода |
| `decorates` | Декораторы |

---

## Константы

| Константа | Значение | Описание |
|---|---|---|
| `FILE_IO_BATCH_SIZE` | `10` | Параллельное чтение файлов |
| `SYNC_RECONCILE_YIELD_INTERVAL` | `1000` | Интервал кооперативной уступки управления при синхронизации |
| `SCAN_YIELD_INTERVAL` | `100` | Интервал кооперативной уступки управления при сканировании |
| `PARSE_TIMEOUT_MS` | `10_000` | Базовый таймаут парсинга (10 секунд) |
| `PARSE_TIMEOUT_PER_10KB` | `10_000` | Дополнительный таймаут на каждые 10 КБ |
| `WORKER_RECYCLE_INTERVAL` | `250` | Интервал пересоздания рабочего потока |
| `MAX_FILE_SIZE` | `1048576` | Максимальный размер файла для индексации (1 МБ) |
| `EMBEDDED_REPO_SEARCH_DEPTH` | `4` | Глубина поиска вложенных репозиториев |
| `EMBEDDED_REPO_SEARCH_ENTRIES` | `2000` | Лимит директорий при поиске вложенных репозиториев |
| `REPO_ROOTS_CACHE_TTL` | `300_000` | Время жизни кэша корней репозиториев (5 мин) |
| `GO_MOD_CACHE_TTL` | `60_000` | Время жизни кэша Go-модулей (1 мин) |
| `DEFAULT_IGNORE_DIRS` | `ReadonlySet<string>` | Директории по умолчанию для игнорирования (60+) |
| `DEFAULT_IGNORE_PATTERNS` | `string[]` | Шаблоны игнорирования по умолчанию |
