# API: SQLite с FTS5

## Обзор

Модуль `ntgraph` предоставляет постоянное хранилище графа кода на базе SQLite с полнотекстовым поиском FTS5. Включает адаптер базы данных, построитель запросов и класс управления.

---

## Типы данных

### INode — Узел графа

Представляет символ кода: функцию, класс, переменную и т.д.

| Поле | Тип | Описание |
|---|---|---|
| `id` | `string` | Уникальный идентификатор |
| `kind` | `NodeKind` | Вид узла |
| `name` | `string` | Имя символа |
| `qualifiedName` | `string` | Квалифицированное имя |
| `filePath` | `string` | Путь к файлу |
| `language` | `string` | Язык программирования |
| `startLine` / `endLine` | `number` | Диапазон строк |
| `startColumn` / `endColumn` | `number` | Диапазон столбцов |
| `docstring` | `string?` | Документация |
| `signature` | `string?` | Подпись символа |
| `visibility` | `'public' \| 'private' \| 'protected' \| 'internal'?` | Видимость |
| `isExported` / `isAsync` / `isStatic` / `isAbstract` | `boolean?` | Флаги |
| `decorators` / `typeParameters` | `string[]?` | Декораторы и параметры типов |
| `returnType` | `string?` | Тип возвращаемого значения |
| `updatedAt` | `number` | Временная метка обновления |

### IEdge — Ребро графа

Связь между двумя узлами.

| Поле | Тип | Описание |
|---|---|---|
| `source` / `target` | `string` | ID исходного и целевого узлов |
| `kind` | `EdgeKind` | Вид связи |
| `metadata` | `Record<string, unknown>?` | Произвольные метаданные |
| `line` / `column` | `number?` | Позиция в коде |
| `provenance` | `string?` | Источник ребра |

### IFileRecord — Запись о файле

| Поле | Тип | Описание |
|---|---|---|
| `path` | `string` | Путь к файлу |
| `contentHash` | `string` | Хеш содержимого |
| `language` | `string` | Язык |
| `size` | `number` | Размер в байтах |
| `modifiedAt` / `indexedAt` | `number` | Временные метки |
| `nodeCount` | `number` | Количество узлов |
| `errors` | `IExtractionError[]?` | Ошибки извлечения |

### IUnresolvedReference — Неразрешенная ссылка

| Поле | Тип | Описание |
|---|---|---|
| `fromNodeId` | `string` | ID узла-источника |
| `referenceName` | `string` | Имя ссылки |
| `referenceKind` | `EdgeKind \| 'function_ref'` | Вид ссылки |
| `line` / `column` | `number` | Позиция |
| `filePath` / `language` | `string?` | Контекст файла |
| `candidates` | `string[]?` | Кандидаты на разрешение |

### ISearchResult — Результат поиска

| Поле | Тип | Описание |
|---|---|---|
| `node` | `INode` | Найденный узел |
| `score` | `number` | Оценка релевантности |
| `highlights` | `string[]?` | Подсветки совпадений |

### ISearchOptions — Параметры поиска

| Поле | Тип | Описание |
|---|---|---|
| `kinds` | `NodeKind[]?` | Фильтр по видам узлов |
| `languages` | `string[]?` | Фильтр по языкам |
| `includePatterns` / `excludePatterns` | `string[]?` | Паттерны включения/исключения |
| `pathFilters` / `nameFilters` | `string[]?` | Фильтры пути и имени |
| `limit` / `offset` | `number?` | Пагинация |
| `caseSensitive` | `boolean?` | Учет регистра |

### IGraphStats — Статистика графа

| Поле | Тип | Описание |
|---|---|---|
| `nodeCount` / `edgeCount` / `fileCount` | `number` | Количество узлов, ребер, файлов |
| `nodesByKind` | `Record<NodeKind, number>` | Узлы по видам |
| `edgesByKind` | `Record<EdgeKind, number>` | Ребра по видам |
| `filesByLanguage` | `Record<string, number>` | Файлы по языкам |
| `dbSizeBytes` | `number` | Размер БД |
| `lastUpdated` | `number` | Последнее обновление |

### IDominantFile — Доминирующий файл

| Поле | Тип | Описание |
|---|---|---|
| `filePath` | `string` | Путь к файлу |
| `edgeCount` | `number` | Количество ребер |
| `nextEdgeCount` | `number` | Количество ребер следующего файла |

### ISubgraph — Подграф

| Поле | Тип | Описание |
|---|---|---|
| `nodes` | `Map<string, INode>` | Узлы подграфа |
| `edges` | `IEdge[]` | Ребра подграфа |
| `roots` | `string[]` | Корневые узлы |
| `confidence` | `'high' \| 'low'?` | Достоверность |

### Context — Контекст узла

| Поле | Тип | Описание |
|---|---|---|
| `focal` | `INode` | Центральный узел |
| `ancestors` / `children` | `INode[]` | Предки и потомки |
| `incomingRefs` / `outgoingRefs` | `IEdge[]` | Входящие и исходящие ссылки |
| `types` / `imports` | `INode[]` / `IEdge[]` | Типы и импорты |

### TraversalOptions — Параметры обхода

| Поле | Тип | Описание |
|---|---|---|
| `maxDepth` | `number` | Максимальная глубина |
| `edgeKinds` / `nodeKinds` | `EdgeKind[]?` / `NodeKind[]?` | Фильтры |
| `direction` | `'outgoing' \| 'incoming' \| 'both'?` | Направление |
| `limit` | `number?` | Ограничение |
| `includeStart` | `boolean?` | Включать стартовый узел |

### ParsedQuery — Разобранный запрос

| Поле | Тип | Описание |
|---|---|---|
| `text` | `string` | Текст запроса |
| `kinds` / `languages` | `NodeKind[]` / `string[]` | Извлеченные фильтры |
| `pathFilters` / `nameFilters` | `string[]` | Извлеченные фильтры пути и имени |

### BuildContextOptions — Параметры построения контекста

| Поле | Тип | Описание |
|---|---|---|
| `maxNodes` / `maxCodeBlocks` | `number?` | Максимум узлов и блоков кода |
| `maxCodeBlockSize` | `number?` | Максимальный размер блока |
| `includeCode` | `boolean?` | Включать код |
| `format` | `string?` | Формат вывода |
| `searchLimit` / `traversalDepth` | `number?` | Лимит поиска и глубина обхода |
| `minScore` | `number?` | Минимальная оценка |

### TaskContext — Контекст задачи

| Поле | Тип | Описание |
|---|---|---|
| `query` | `string` | Запрос |
| `subgraph` | `Subgraph` | Подграф |
| `entryPoints` | `INode[]` | Точки входа |
| `codeBlocks` | `CodeBlock[]` | Блоки кода |
| `relatedFiles` | `string[]` | Связанные файлы |
| `summary` | `string` | Сводка |
| `stats` | `IGraphStats` | Статистика |

### IExtractionResult — Результат извлечения

| Поле | Тип | Описание |
|---|---|---|
| `nodes` | `INode[]` | Извлеченные узлы |
| `edges` | `IEdge[]` | Извлеченные ребра |
| `unresolvedReferences` | `IUnresolvedReference[]` | Неразрешенные ссылки |
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

### ISchemaVersion — Версия схемы

| Поле | Тип | Описание |
|---|---|---|
| `version` | `number` | Номер версии |
| `description` | `string` | Описание |
| `appliedAt` | `number` | Временная метка применения |

### CodeBlock — Блок кода

| Поле | Тип | Описание |
|---|---|---|
| `content` | `string` | Содержимое |
| `filePath` | `string` | Путь к файлу |
| `startLine` / `endLine` | `number` | Диапазон строк |
| `language` | `string` | Язык |
| `node` | `INode` | Связанный узел |

### FindRelevantContextOptions — Параметры поиска релевантного контекста

| Поле | Тип | Описание |
|---|---|---|
| `searchLimit` / `traversalDepth` | `number?` | Лимит поиска и глубина обхода |
| `maxNodes` | `number?` | Максимум узлов |
| `minScore` | `number?` | Минимальная оценка |
| `edgeKinds` / `nodeKinds` | `EdgeKind[]?` / `NodeKind[]?` | Фильтры |

### TaskInput — Входные данные задачи

```
type TaskInput = string | { title: string; description: string }
```

---

## Перечисления

### NodeKind

22 значения: `file`, `class`, `function`, `method`, `property`, `field`, `interface`, `struct`, `enum`, `type_alias`, `constant`, `variable`, `namespace`, `module`, `route`, `trait`, `protocol`, `enum_member`, `parameter`, `import`, `export`, `component`.

### EdgeKind

12 значений: `contains`, `calls`, `imports`, `extends`, `implements`, `references`, `type_of`, `returns`, `instantiates`, `overrides`, `decorates`, `exports`.

### Language

41 значение: `typescript`, `javascript`, `tsx`, `jsx`, `python`, `go`, `rust`, `java`, `c`, `cpp`, `csharp`, `razor`, `php`, `ruby`, `swift`, `kotlin`, `dart`, `svelte`, `vue`, `astro`, `liquid`, `pascal`, `scala`, `lua`, `luau`, `objc`, `r`, `yaml`, `twig`, `xml`, `properties`, `unknown`, `html`, `css`, `sql`, `json`, `markdown`, `shell`, `dockerfile`, `toml`, `ini`.

---

## Класс NtGraphDb

Основной класс управления базой данных графа.

### Конструктор

```
constructor(dbPath: string)
```

Принимает путь к файлу БД.

### Методы

| Метод | Возврат | Описание |
|---|---|---|
| `initialize()` | `void` | Создает БД в WAL-режиме, применяет PRAGMA, создает таблицы, индексы, FTS5 и триггеры |
| `close()` | `void` | Закрывает БД (идемпотентно) |
| `getStats()` | `IGraphStats` | Статистика графа |
| `getSize()` | `number` | Размер БД в байтах |

### Свойства

| Свойство | Тип | Описание |
|---|---|---|
| `queryBuilder` | `QueryBuilder` | Построитель запросов |

---

## Класс QueryBuilder

Построитель запросов с ленивой инициализацией prepared statements и LRU-кэшем узлов (1000 записей).

### Узлы

| Метод | Возврат | Описание |
|---|---|---|
| `insertNode(node: INode)` | `void` | Вставка узла (upsert через INSERT OR REPLACE) |
| `insertNodes(nodes: INode[])` | `void` | Пакетная вставка узлов в транзакции |
| `updateNode(node: INode)` | `void` | Обновление узла |
| `deleteNode(id: string)` | `void` | Удаление узла по ID |
| `deleteNodesByFile(filePath: string)` | `void` | Удаление всех узлов файла |
| `getNodeById(id: string)` | `INode \| null` | Поиск узла по ID |
| `getNodesByFile(filePath: string)` | `INode[]` | Узлы файла |
| `getNodesByKind(kind: NodeKind)` | `INode[]` | Узлы по виду |
| `getNodesByName(name: string)` | `INode[]` | Точный поиск по имени |
| `getNodesByQualifiedNameExact(qn: string)` | `INode[]` | Точный поиск по квалифицированному имени |
| `getNodesByLowerName(lowerName: string)` | `INode[]` | Поиск по нижнему регистру имени |
| `getAllNodes()` | `INode[]` | Все узлы |
| `iterateNodesByKind(kind: NodeKind)` | `Generator<INode>` | Ленивый итератор узлов вида, память O(1) |
| `getNodesByIds(ids: string[])` | `INode[]` | Пакетный поиск (чанки по 500) |
| `getExistingNodeIds(ids: string[])` | `Set<string>` | Существующие ID для валидации |

### Ребра

| Метод | Возврат | Описание |
|---|---|---|
| `insertEdge(edge: IEdge)` | `void` | Вставка ребра (INSERT OR IGNORE) |
| `insertEdges(edges: IEdge[])` | `void` | Пакетная вставка в транзакции |
| `getOutgoingEdges(source: string, kinds?: EdgeKind[], provenance?: string)` | `IEdge[]` | Исходящие ребра с фильтрами |
| `getIncomingEdges(target: string, kinds?: EdgeKind[])` | `IEdge[]` | Входящие ребра с фильтром видов |
| `deleteEdgesBySource(sourceId: string)` | `number` | Удаление по источнику, возвращает число удаленных |
| `deleteEdgesByTarget(targetId: string)` | `number` | Удаление по цели, возвращает число удаленных |
| `findEdgesBetweenNodes(nodeIds: string[], kinds?: EdgeKind[])` | `IEdge[]` | Ребра между заданными узлами |

### Файлы

| Метод | Возврат | Описание |
|---|---|---|
| `upsertFile(file: IFileRecord)` | `void` | Вставка или обновление файла |
| `getFileByPath(path: string)` | `IFileRecord \| null` | Поиск файла по пути |
| `getAllFiles()` | `IFileRecord[]` | Все файлы |
| `getStaleFiles(currentHashes?: Map<string, string>)` | `IFileRecord[]` | Устаревшие файлы для инкрементальной индексации |
| `getLastIndexedAt()` | `number \| null` | Последняя метка индексации |
| `getAllFilePaths()` | `string[]` | Все пути файлов |
| `getAllNodeNames()` | `string[]` | Все имена узлов |

### Поиск

| Метод | Возврат | Описание |
|---|---|---|
| `searchNodesFTS(query: string, options?: ISearchOptions)` | `ISearchResult[]` | Полнотекстовый поиск FTS5 с BM25 |
| `searchNodesLike(query: string, options?: ISearchOptions)` | `ISearchResult[]` | LIKE-поиск (фоллбэк, длина запроса >= 2) |
| `searchNodesFuzzy(query: string, options?: ISearchOptions)` | `ISearchResult[]` | Fuzzy-поиск (фоллбэк, длина >= 3) |
| `findNodesByExactName(name: string)` | `INode[]` | Точный поиск по имени |
| `findNodesByNameSubstring(sub: string, options?: ISearchOptions)` | `INode[]` | Поиск по подстроке имени |
| `searchAllByFilters(options?: ISearchOptions)` | `ISearchResult[]` | Поиск только по фильтрам без текста |

### Неразрешенные ссылки

| Метод | Возврат | Описание |
|---|---|---|
| `insertUnresolvedRef(ref: IUnresolvedReference)` | `void` | Вставка ссылки |
| `insertUnresolvedRefsBatch(refs: IUnresolvedReference[])` | `void` | Пакетная вставка |
| `deleteUnresolvedByNode(nodeId: string)` | `void` | Удаление по узлу |
| `getUnresolvedByName(name: string)` | `IUnresolvedReference[]` | Поиск по имени |
| `getUnresolvedReferences()` | `IUnresolvedReference[]` | Все ссылки |
| `getUnresolvedReferencesCount()` | `number` | Количество ссылок |
| `getUnresolvedReferencesBatch(offset: number, limit: number)` | `IUnresolvedReference[]` | Пагинированный запрос |
| `getUnresolvedReferencesByFiles(filePaths: string[])` | `IUnresolvedReference[]` | По файлам (чанки по 500) |
| `deleteResolvedReferences(fromNodeIds: string[])` | `void` | Удаление по ID узлов |
| `deleteSpecificResolvedReferences(refs: IUnresolvedReference[])` | `number` | Удаление конкретных ссылок |
| `clearUnresolvedReferences()` | `void` | Очистка всех ссылок |

### Метаданные

| Метод | Возврат | Описание |
|---|---|---|
| `getMetadata(key: string)` | `string \| null` | Значение по ключу |
| `setMetadata(key: string, value: string)` | `void` | Установка или обновление (upsert) |
| `getAllMetadata()` | `Map<string, string>` | Все метаданные |

### Аналитика

| Метод | Возврат | Описание |
|---|---|---|
| `getDominantFile()` | `IDominantFile \| null` | Файл с наибольшим числом ребер (порог 20) |
| `getTopRouteFile()` | `INode \| null` | Файл с наибольшим числом route-узлов |
| `getRoutingManifest()` | `INode[]` | Все route-узлы (лимит 40) |
| `getDependentFilePaths(filePath: string)` | `string[]` | Файлы, зависящие от данного |
| `getDependencyFilePaths(filePath: string)` | `string[]` | Файлы, от которых зависит данный |
| `getCrossFileIncomingEdgesWithTarget(filePath: string)` | `Array<{edge: IEdge, targetKind: string, targetName: string}>` | Входящие ребра из других файлов |

### Утилиты

| Метод | Возврат | Описание |
|---|---|---|
| `clear()` | `void` | Очистка всей БД |
| `clearCache()` | `void` | Очистка LRU-кэша |
| `getNodeAndEdgeCount()` | `{nodeCount: number, edgeCount: number}` | Количество узлов и ребер |
| `setProjectNameTokens(tokens: Set<string>)` | `void` | Токены имени проекта для подавления в поиске |
| `getProjectNameTokens()` | `string[]` | Получить токены имени проекта |

---

## SQL-схема

### Таблицы

| Таблица | Описание |
|---|---|
| `schema_versions` | Отслеживание версии схемы |
| `project_metadata` | Пары ключ-значение для метаданных проекта |
| `nodes` | Узлы графа |
| `edges` | Связи между узлами |
| `files` | Отслеживаемые файлы |
| `unresolved_refs` | Неразрешенные ссылки |
| `nodes_fts` | Виртуальная таблица FTS5 для полнотекстового поиска |

### Триггеры FTS5

Автоматическая синхронизация `nodes_fts` при изменении `nodes`:

- `nodes_ai` — после вставки узла добавляет запись в FTS
- `nodes_ad` — после удаления узла удаляет запись из FTS
- `nodes_au` — после обновления узла удаляет старую и вставляет новую запись в FTS

### Порядок PRAGMA (критичен)

1. `busy_timeout = 5000` — должен быть установлен первым
2. `foreign_keys = ON` — должен быть установлен до WAL-режима (включает ON DELETE CASCADE)
3. `journal_mode = WAL` — WAL-режим
4. `synchronous = NORMAL` — баланс между безопасностью и производительностью
5. `cache_size = -64000` — 64 МБ внутреннего кэша SQLite
6. `temp_store = MEMORY` — временные таблицы в памяти
7. `mmap_size = 268435456` — 256 МБ для кеширования данных в памяти ОС

---

## Маппинг типов

### ICodeChunk -> INode

| ICodeChunk | INode | Примечание |
|---|---|---|
| `filePath` | `filePath` | — |
| `nodeKind` | `kind` | Маппинг: class->class, function->function, method->method, interface->interface, type->type_alias, enum->enum, const->constant, block->variable, top_level->variable |
| `symbolName` | `name` | — |
| `content` | `signature` | — |
| `startLine` / `endLine` | `startLine` / `endLine` | — |

### IFtsResult -> ISearchResult

| IFtsResult | ISearchResult | Примечание |
|---|---|---|
| `chunk` | `node` | Через маппинг ICodeChunk -> INode |
| `score` | `score` | — |
| `matchCount` | `highlights` | Длина массива |

---

## Адаптер SQLite

Абстракция над `node:sqlite` (DatabaseSync).

### SqliteStatement

| Метод | Возврат | Описание |
|---|---|---|
| `run(...params)` | `void` | Выполнение без результата |
| `get(...params)` | `Row \| null` | Одна строка |
| `all(...params)` | `Row[]` | Все строки |
| `iterate(...params)` | `Iterator<Row>` | Ленивый итератор, память O(1) |

### SqliteDatabase

| Метод | Возврат | Описание |
|---|---|---|
| `prepare(sql)` | `SqliteStatement` | Создание prepared statement |
| `exec(sql)` | `void` | Выполнение SQL без результатов |
| `pragma(str, options?)` | `any` | Выполнение PRAGMA |
| `transaction(fn)` | `void` | Обертка функции в транзакцию |
| `close()` | `void` | Закрытие БД |

---

## Утилиты

### Строковые

| Функция | Возврат | Описание |
|---|---|---|
| `normalizeNameToken(raw: string)` | `string` | Приведение к нижнему регистру, фильтрация символов |
| `deriveProjectNameTokens(projectRoot: string)` | `Set<string>` | Токены из go.mod, package.json, имени директории |
| `getStemVariants(term: string)` | `string[]` | Варианты основы: -ing, -tion, -ment, -ies, -es, -s, -ed, -er |
| `extractSearchTerms(query: string)` | `string[]` | Разделение camelCase, PascalCase, snake_case, dot.notation |
| `unquote(s: string)` | `string` | Удаление внешних кавычек |
| `boundedEditDistance(a, b, maxDist)` | `number` | Расстояние Левенштейна с ранним выходом |

### Поиск

| Функция | Возврат | Описание |
|---|---|---|
| `kindBonus(kind: NodeKind)` | `number` | Бонус по виду узла |
| `nameMatchBonus(query, name)` | `number` | Бонус по совпадению имени |
| `scorePathRelevance(path, query)` | `number` | Релевантность пути |
| `isLowValueFile(path)` | `boolean` | Определение тестовых и генерируемых файлов |

### Парсер запросов

| Функция | Возврат | Описание |
|---|---|---|
| `parseQuery(raw: string)` | `ParsedQuery` | Разбор с префиксами kind:, lang:, path:, name: |

### Классификаторы файлов

| Функция | Возврат | Описание |
|---|---|---|
| `isTestFile(filePath)` | `boolean` | Проверка на тестовый файл |
| `isGeneratedFile(filePath)` | `boolean` | Проверка на генерируемый файл |
| `isDistinctiveIdentifier(token)` | `boolean` | Наличие подчеркивания, цифры или внутреннего заглавного символа |
| `isConfigLeafNode(node)` | `boolean` | Узел-константа YAML/properties |

### Безопасность путей

| Функция | Возврат | Описание |
|---|---|---|
| `validatePathWithinRoot(projectRoot, filePath)` | `void` | Проверка вложенности (лексическая + realpath) |
| `validateProjectPath(dirPath)` | `string \| null` | Отклонение системных директорий |
| `isWithinDir(child, parent)` | `boolean` | Проверка вложенности (нечувствительно к регистру на Windows) |

### Асинхронные утилиты

| Класс / Функция | Описание |
|---|---|
| `Mutex` | Асинхронный мьютекс с очередью ожидания |
| `FileLock` | Межпроцессная блокировка с отслеживанием PID и устареванием (2 минуты) |
| `processInBatches(items, batchSize, processor)` | Пакетная обработка с GC между батчами |
| `readFileInChunks` | Генератор постраничного чтения файлов |
| `debounce` / `throttle` | Дебаунсинг и троттлинг функций |

### Прочее

| Функция | Возврат | Описание |
|---|---|---|
| `rowToNode(row)` | `INode` | Конвертация строки БД в узел |
| `rowToEdge(row)` | `IEdge` | Конвертация строки БД в ребро |
| `rowToFileRecord(row)` | `IFileRecord` | Конвертация строки БД в запись файла |
| `safeJsonParse<T>(str, fallback)` | `T` | Безопасный парсинг JSON из SQLite |
| `clamp(value, min, max)` | `number` | Численное ограничение |
| `normalizePath(filePath)` | `string` | Нормализация с прямым слэшем |
| `getDatabasePath(projectRoot)` | `string` | Путь к БД по умолчанию |
| `estimateSize(obj)` | `number` | Оценка размера объекта в памяти |
| `MemoryMonitor` | Класс | Мониторинг памяти с callback при достижении порога |

---

## Миграции

Инфраструктура инкрементальных миграций схемы. Текущая версия: 5.

| Метод | Возврат | Описание |
|---|---|---|
| `needsMigration(db)` | `boolean` | Проверка необходимости миграции |
| `getPendingMigrations(db)` | `Migration[]` | Список ожидающих миграций |
| `getMigrationHistory(db)` | `Array<{version, appliedAt, description}>` | История примененных миграций |
| `recordMigration(db, version, description)` | `void` | Фиксация примененной миграции |

### Версии

| Версия | Изменения |
|---|---|
| v1 | Начальная схема: таблицы, индексы, FTS5, триггеры |
| v2 | Таблица project_metadata с updated_at; колонки file_path, language в unresolved_refs; provenance в edges |
| v3 | Выражение-индекс idx_nodes_lower_name |
| v4 | Удалены избыточные индексы idx_edges_source и idx_edges_target |
| v5 | Колонка nodes.return_type |

---

## Константы

| Константа | Значение | Описание |
|---|---|---|
| `DATABASE_FILENAME` | `'ntgraph.db'` | Имя файла БД |
| `FTS_OVER_FETCH_MULTIPLIER` | `5` | Множитель перегрузки FTS для пост-пересчета |
| `FTS_LIMIT_MIN` | `100` | Минимальный лимит выборки FTS |
| `FUZZY_MAX_DIST_SHORT` | `1` | Макс. расстояние для запросов до 4 символов |
| `FUZZY_MAX_DIST_DEFAULT` | `2` | Макс. расстояние для запросов свыше 4 символов |
| `EXACT_MATCH_SUPPLEMENT_LIMIT` | `20` | Лимит дополнения точных совпадений на термин |
| `DOMINANT_FILE_EDGE_THRESHOLD` | `20` | Порог ребер для доминирующего файла |
| `TOP_ROUTE_MIN_TOTAL` | `3` | Минимум маршрутов для getTopRouteFile |
| `TOP_ROUTE_MIN_CONCENTRATION` | `0.30` | Минимальная концентрация для getTopRouteFile |
| `ROUTING_MANIFEST_DEFAULT_LIMIT` | `40` | Лимит для getRoutingManifest |
| `FileLock_STALE_TIMEOUT_MS` | `120000` | Время устаревания блокировки (2 минуты) |
| `SQLITE_PARAM_CHUNK_SIZE` | `500` | Размер чанка для пакетных запросов |
| `FUZZY_FOLLOWUP_CAP` | `max(limit * 2, 50)` | Лимит дополнительных запросов в fuzzy-поиске |
| `FILTER_ONLY_OVER_FETCH_MULTIPLIER` | `5` | Множитель перегрузки для запросов только по фильтрам |
| `CONFIG_LEAF_LANGUAGES` | `Set('yaml', 'properties')` | Языки для leaf-конфигураций |
| `SENSITIVE_PATHS` | `Set('/proc', '/sys', '/dev', 'C:\Windows', ...)` | Системные директории для блокировки |
| `GENERATED_PATTERNS` | `RegExp[]` | 30+ паттернов для генерируемых файлов |
