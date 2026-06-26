# API: SQLite с FTS5

## Обзор

Модуль `ntgraph` предоставляет постоянное хранилище графа кода на базе SQLite с полнотекстовым поиском FTS5. Включает адаптер базы данных, построитель запросов, класс FTS-поиска и класс управления.

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
| `language` | `Language` | Язык программирования |
| `startLine` / `endLine` | `number` | Диапазон строк |
| `startColumn` / `endColumn` | `number` | Диапазон столбцов |
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
| `provenance` | `string?` | Источник ребра |

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
| `referenceKind` | `ReferenceKind` | Вид ссылки (`EdgeKind \| 'function_ref'`) |
| `line` / `column` | `number` | Позиция |
| `filePath` / `language` | `string?` / `Language?` | Контекст файла |
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
| `dbSizeBytes` | `number` | Размер БД (добавляется в NtGraphDb.getStats()) |
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
| `subgraph` | `ISubgraph` | Подграф |
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

### IResolutionContext — Контекст разрешения ссылок

Интерфейс для разрешения неразрешённых ссылок. Методы: `getNodesByFile`, `getNodesByName`, `getImportMappings`, `getReExports`, `getNodeById`, `getNodesByKind`, `getNodesByQualifiedName`, `getNodesByLowerName`, `getSupertypes`, `getChildren`, `getAncestors`, `getIncomingEdges`, `getOutgoingEdges`, `getFileContent`, `getFilePathFromNodeId`, `getLanguageFromNodeId`, `getDetectedFrameworks`, `getAllFiles`.

### IResolvedRef — Разрешённая ссылка

| Поле | Тип | Описание |
|---|---|---|
| `original` | `IUnresolvedReference` | Исходная ссылка |
| `targetNodeId` | `string` | ID целевого узла |
| `confidence` | `number` | Уверенность |
| `provenance` | `string` | Источник разрешения |

### IResolutionResult — Результат разрешения

| Поле | Тип | Описание |
|---|---|---|
| `resolved` | `IResolvedRef[]` | Разрешённые ссылки |
| `unresolved` | `IUnresolvedReference[]` | Неразрешённые ссылки |
| `durationMs` | `number` | Время выполнения |

### IReExport — Re-export из модуля

| Поле | Тип | Описание |
|---|---|---|
| `sourcePath` / `sourceName` | `string` | Источник |
| `language` | `Language` | Язык |

### IAliasMap — Карта алиасов импортов

```
type IAliasMap = { [alias: string]: string[] }
```

### IGoModule — Информация о Go-модуле

| Поле | Тип | Описание |
|---|---|---|
| `modulePath` / `goVersion` | `string` | Путь модуля и версия Go |
| `dependencies` | `Map<string, string>` | Зависимости |

### IWorkspacePackages — Пакеты workspace (monorepo)

| Поле | Тип | Описание |
|---|---|---|
| `packages` | `Map<string, string>` | Пакеты по путям |
| `workspaces` | `string[]` | Пути рабочих пространств |

### IImportMapping — Маппинг импорта на файл

| Поле | Тип | Описание |
|---|---|---|
| `sourcePath` / `sourceName` | `string` | Источник |
| `targetPath` / `targetName` | `string` | Цель |
| `language` | `Language` | Язык |

### IFrameworkResolver — Резолвер фреймворков

| Поле | Тип | Описание |
|---|---|---|
| `name` | `string` | Имя фреймворка |
| `resolve(ref, context)` | `IResolvedRef \| null` | Разрешить ссылку |
| `postExtract(context)` | `INode[]` | Пост-обработка |
| `claimsReference?(name)` | `boolean?` | Заявляет ли право на имя |

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

## Класс NtGraphDb

Основной класс управления базой данных графа.

### Конструктор

```
constructor(dbPath: string)
```

Принимает путь к файлу БД. Автоматически определяет корень проекта и токены имени проекта.

### Методы

| Метод | Возврат | Описание |
|---|---|---|
| `initialize()` | `void` | Создает БД в WAL-режиме, применяет PRAGMA, создает таблицы, индексы, FTS5 и триггеры |
| `close()` | `void` | Закрывает БД (идемпотентно) |
| `runMaintenance()` | `void` | PRAGMA optimize + wal_checkpoint(PASSIVE) |
| `getStats()` | `IGraphStats & { dbSizeBytes: number }` | Статистика графа с размером БД |
| `getSize()` | `number` | Размер БД в байтах |
| `getDatabase()` | `SqliteDatabase` | Прямой доступ к БД |
| `getFtsSearch()` | `FtsSearch` | Прямой доступ к FtsSearch |
| `getSchemaVersion()` | `number` | Текущая версия схемы |
| `getMigrationHistory()` | `ISchemaVersion[]` | История миграций |
| `getProjectRoot()` | `string` | Корень проекта |
| `getProjectNameTokens()` | `string[]` | Токены имени проекта |
| `clear()` | `void` | Очистка всей БД |
| `clearCache()` | `void` | Очистка LRU-кэша |
| `getNodeAndEdgeCount()` | `{nodeCount, edgeCount}` | Количество узлов и ребер |

### Узлы

| Метод | Возврат | Описание |
|---|---|---|
| `insertNode(node)` | `Promise<void>` | Вставка узла (с FileLock) |
| `insertNodes(nodes)` | `void` | Пакетная вставка узлов в транзакции |
| `insertNodesBatch(nodes)` | `Promise<void>` | Пакетная вставка с FileLock, Mutex, MemoryMonitor, чанки |
| `updateNode(node)` | `Promise<void>` | Обновление узла (с FileLock) |
| `deleteNode(id)` | `Promise<void>` | Удаление узла (с FileLock) |
| `deleteNodesByFile(filePath)` | `number` | Удаление всех узлов файла, возвращает число удаленных |
| `getNodeById(id)` | `INode \| null` | Поиск узла по ID |
| `getNodesByIds(ids)` | `INode[]` | Пакетный поиск (чанки по 500) |
| `getNodesByFile(filePath)` | `INode[]` | Узлы файла |
| `getNodesByKind(kind)` | `INode[]` | Узлы по виду |
| `iterateNodesByKind(kind)` | `IterableIterator<INode>` | Ленивый итератор узлов вида |
| `getAllNodes()` | `INode[]` | Все узлы |
| `getNodesByName(name)` | `INode[]` | Точный поиск по имени |
| `getNodesByQualifiedNameExact(qn)` | `INode[]` | Точный поиск по квалифицированному имени |
| `getNodesByLowerName(lowerName)` | `INode[]` | Поиск по нижнему регистру имени |
| `getDominantFile()` | `IDominantFile \| null` | Файл с наибольшим числом ребер |
| `getTopRouteFile()` | `INode \| null` | Файл с наибольшим числом route-узлов |
| `getRoutingManifest(limit?)` | `INode[]` | Все route-узлы |
| `getDependentFilePaths(filePath)` | `string[]` | Файлы, зависящие от данного |
| `getDependencyFilePaths(filePath)` | `string[]` | Файлы, от которых зависит данный |
| `getCrossFileIncomingEdgesWithTarget(filePath)` | `Array<{edge, targetKind, targetName}>` | Входящие межфайловые ребра |
| `findEdgesBetweenNodes(nodeIds, kinds?)` | `IEdge[]` | Ребра между заданными узлами |

### Ребра

| Метод | Возврат | Описание |
|---|---|---|
| `insertEdge(edge)` | `Promise<void>` | Вставка ребра (с FileLock) |
| `insertEdges(edges)` | `void` | Пакетная вставка в транзакции |
| `insertEdgesBatch(edges)` | `Promise<void>` | Пакетная вставка с FileLock, Mutex, чанки |
| `getOutgoingEdges(source, kinds?, provenance?)` | `IEdge[]` | Исходящие ребра с фильтрами |
| `getIncomingEdges(target, kinds?)` | `IEdge[]` | Входящие ребра с фильтром видов |
| `deleteEdgesBySource(sourceId)` | `number` | Удаление по источнику |
| `deleteEdgesByTarget(targetId)` | `number` | Удаление по цели |

### Файлы

| Метод | Возврат | Описание |
|---|---|---|
| `upsertFile(file)` | `Promise<void>` | Вставка или обновление файла (с FileLock) |
| `deleteFile(filePath)` | `Promise<void>` | Удаление файла и его узлов (с FileLock) |
| `getFileByPath(path)` | `IFileRecord \| null` | Поиск файла по пути |
| `getAllFiles()` | `IFileRecord[]` | Все файлы |
| `getStaleFiles(currentHashes?)` | `IFileRecord[]` | Устаревшие файлы для инкрементальной индексации |
| `getLastIndexedAt()` | `number \| null` | Последняя метка индексации |
| `getAllFilePaths()` | `string[]` | Все пути файлов |
| `getAllNodeNames()` | `string[]` | Все имена узлов |

### Поиск

| Метод | Возврат | Описание |
|---|---|---|
| `search(query, options?)` | `ISearchResult[]` | Основной поиск через QueryBuilder.searchNodes (FTS5 → LIKE → Fuzzy) |
| `findNodesByExactName(names, options?)` | `ISearchResult[]` | Точный поиск по множеству имён |
| `findNodesByNameSubstring(sub, options?)` | `INode[]` | Поиск по подстроке имени (опция excludePrefix) |

### Неразрешенные ссылки

| Метод | Возврат | Описание |
|---|---|---|
| `insertUnresolvedRef(ref)` | `void` | Вставка ссылки |
| `insertUnresolvedRefsBatch(refs)` | `void` | Пакетная вставка |
| `deleteUnresolvedByNode(nodeId)` | `void` | Удаление по узлу |
| `getUnresolvedByName(name)` | `IUnresolvedReference[]` | Поиск по имени |
| `getUnresolvedReferences()` | `IUnresolvedReference[]` | Все ссылки |
| `getUnresolvedReferencesCount()` | `number` | Количество ссылок |
| `getUnresolvedReferencesBatch(offset, limit)` | `IUnresolvedReference[]` | Пагинированный запрос |
| `getUnresolvedReferencesByFiles(filePaths)` | `IUnresolvedReference[]` | По файлам (чанки по 500) |
| `deleteResolvedReferences(fromNodeIds)` | `void` | Удаление по ID узлов |
| `deleteSpecificResolvedReferences(refs)` | `number` | Удаление конкретных ссылок |
| `clearUnresolvedReferences()` | `void` | Очистка всех ссылок |

### Метаданные

| Метод | Возврат | Описание |
|---|---|---|
| `getMetadata(key)` | `string \| null` | Значение по ключу |
| `setMetadata(key, value)` | `void` | Установка или обновление (upsert) |
| `getAllMetadata()` | `Map<string, string>` | Все метаданные |

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
| `insertNode(node)` | `void` | Вставка узла (upsert через INSERT OR REPLACE) |
| `insertNodes(nodes)` | `void` | Пакетная вставка узлов в транзакции |
| `updateNode(node)` | `void` | Обновление узла |
| `deleteNode(id)` | `void` | Удаление узла по ID |
| `deleteNodesByFile(filePath)` | `number` | Удаление всех узлов файла, возвращает число удаленных |
| `getNodeById(id)` | `INode \| null` | Поиск узла по ID |
| `getNodesByIds(ids)` | `INode[]` | Пакетный поиск (чанки по 500) |
| `getExistingNodeIds(ids)` | `Set<string>` | Существующие ID для валидации |
| `getNodesByFile(filePath)` | `INode[]` | Узлы файла |
| `getNodesByKind(kind)` | `INode[]` | Узлы по виду |
| `iterateNodesByKind(kind)` | `IterableIterator<INode>` | Ленивый итератор узлов вида, память O(1) |
| `getAllNodes()` | `INode[]` | Все узлы |
| `getNodesByName(name)` | `INode[]` | Точный поиск по имени |
| `getNodesByQualifiedNameExact(qn)` | `INode[]` | Точный поиск по квалифицированному имени |
| `getNodesByLowerName(lowerName)` | `INode[]` | Поиск по нижнему регистру имени |

### Ребра

| Метод | Возврат | Описание |
|---|---|---|
| `insertEdge(edge)` | `void` | Вставка ребра (INSERT OR IGNORE) |
| `insertEdges(edges)` | `void` | Пакетная вставка в транзакции с проверкой узлов |
| `getOutgoingEdges(source, kinds?, provenance?)` | `IEdge[]` | Исходящие ребра с фильтрами |
| `getIncomingEdges(target, kinds?)` | `IEdge[]` | Входящие ребра с фильтром видов |
| `deleteEdgesBySource(sourceId)` | `number` | Удаление по источнику, возвращает число удаленных |
| `deleteEdgesByTarget(targetId)` | `number` | Удаление по цели, возвращает число удаленных |
| `findEdgesBetweenNodes(nodeIds, kinds?)` | `IEdge[]` | Ребра между заданными узлами |

### Файлы

| Метод | Возврат | Описание |
|---|---|---|
| `upsertFile(file)` | `void` | Вставка или обновление файла |
| `deleteFile(filePath)` | `void` | Удаление файла и его узлов |
| `getFileByPath(path)` | `IFileRecord \| null` | Поиск файла по пути |
| `getAllFiles()` | `IFileRecord[]` | Все файлы |
| `getStaleFiles(currentHashes?)` | `IFileRecord[]` | Устаревшие файлы для инкрементальной индексации |
| `getLastIndexedAt()` | `number \| null` | Последняя метка индексации |
| `getAllFilePaths()` | `string[]` | Все пути файлов |
| `getAllNodeNames()` | `string[]` | Все имена узлов |

### Поиск

| Метод | Возврат | Описание |
|---|---|---|
| `searchNodes(query, options?)` | `ISearchResult[]` | Основной поиск: FTS5 → LIKE → Fuzzy (через FtsSearch) |
| `searchNodesFTS(query, options?)` | `ISearchResult[]` | FTS5-поиск напрямую (через FtsSearch) |
| `searchNodesLike(query, options?)` | `ISearchResult[]` | LIKE-фоллбэк (через FtsSearch) |
| `searchNodesFuzzy(query, options?)` | `ISearchResult[]` | Fuzzy-фоллбэк (через FtsSearch) |
| `findNodesByExactName(names, options?)` | `ISearchResult[]` | Точный поиск по множеству имён с co-location boost |
| `findNodesByNameSubstring(sub, options?)` | `INode[]` | Поиск по подстроке имени (опция excludePrefix) |
| `searchAllByFilters(options)` | `ISearchResult[]` | Поиск только по фильтрам без текста |

### Неразрешенные ссылки

| Метод | Возврат | Описание |
|---|---|---|
| `insertUnresolvedRef(ref)` | `void` | Вставка ссылки |
| `insertUnresolvedRefsBatch(refs)` | `void` | Пакетная вставка |
| `deleteUnresolvedByNode(nodeId)` | `void` | Удаление по узлу |
| `getUnresolvedByName(name)` | `IUnresolvedReference[]` | Поиск по имени |
| `getUnresolvedReferences()` | `IUnresolvedReference[]` | Все ссылки |
| `getUnresolvedReferencesCount()` | `number` | Количество ссылок |
| `getUnresolvedReferencesBatch(offset, limit)` | `IUnresolvedReference[]` | Пагинированный запрос |
| `getUnresolvedReferencesByFiles(filePaths)` | `IUnresolvedReference[]` | По файлам (чанки по 500) |
| `deleteResolvedReferences(fromNodeIds)` | `void` | Удаление по ID узлов |
| `deleteSpecificResolvedReferences(refs)` | `number` | Удаление конкретных ссылок |
| `clearUnresolvedReferences()` | `void` | Очистка всех ссылок |

### Метаданные

| Метод | Возврат | Описание |
|---|---|---|
| `getMetadata(key)` | `string \| null` | Значение по ключу |
| `setMetadata(key, value)` | `void` | Установка или обновление (upsert) |
| `getAllMetadata()` | `Map<string, string>` | Все метаданные |

### Аналитика

| Метод | Возврат | Описание |
|---|---|---|
| `getDominantFile()` | `IDominantFile \| null` | Файл с наибольшим числом ребер (порог 20) |
| `getTopRouteFile()` | `INode \| null` | Файл с наибольшим числом route-узлов |
| `getRoutingManifest(limit?)` | `INode[]` | Все route-узлы (лимит 40) |
| `getDependentFilePaths(filePath)` | `string[]` | Файлы, зависящие от данного |
| `getDependencyFilePaths(filePath)` | `string[]` | Файлы, от которых зависит данный |
| `getCrossFileIncomingEdgesWithTarget(filePath)` | `Array<{edge, targetKind, targetName}>` | Входящие межфайловые ребра |
| `getNodeAndEdgeCount()` | `{nodeCount, edgeCount}` | Количество узлов и ребер |
| `getStats()` | `{nodeCount, edgeCount, fileCount, nodesByKind, edgesByKind, filesByLanguage, lastUpdated}` | Статистика графа |

### Утилиты

| Метод | Возврат | Описание |
|---|---|---|
| `clear()` | `void` | Очистка всей БД |
| `clearCache()` | `void` | Очистка LRU-кэша |
| `setProjectNameTokens(tokens)` | `void` | Токены имени проекта для подавления в поиске |
| `getProjectNameTokens()` | `string[]` | Получить токены имени проекта |
| `getFtsSearch()` | `FtsSearch` | Экземпляр FtsSearch |

---

## Класс FtsSearch

Трёхуровневый FTS-поиск: FTS5 → LIKE → Fuzzy, BM25 с весами, over-fetch x5, rescoring, exact-match supplement, экранирование спецсимволов.

### Методы

| Метод | Возврат | Описание |
|---|---|---|
| `search(query, options?)` | `ISearchResult[]` | Полный поиск с fallback (FTS5 → LIKE → Fuzzy) |
| `searchFTS(query, options)` | `ISearchResult[]` | FTS5-поиск с BM25, весовая схема: name=20, qualified_name=5, docstring=1, signature=2 |
| `searchLike(query, options?)` | `ISearchResult[]` | LIKE-фоллбэк |
| `searchFuzzy(query, options?)` | `ISearchResult[]` | Fuzzy-фоллбэк через bounded edit distance |
| `buildFtsQuery(query)` | `string \| null` | Построение FTS5-запроса с экранированием спецсимволов |
| `setProjectNameTokens(tokens)` | `void` | Токены имени проекта |

### Параметры IFtsSearchOptions

| Поле | Тип | Описание |
|---|---|---|
| `kinds` | `NodeKind[]?` | Фильтр по видам узлов |
| `languages` | `string[]?` | Фильтр по языкам |
| `limit` / `offset` | `number?` | Пагинация |
| `pathFilters` / `nameFilters` | `string[]?` | Фильтры пути и имени |

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

### Индексы

| Индекс | Описание |
|---|---|
| `idx_nodes_kind` | По виду узла |
| `idx_nodes_name` | По имени узла |
| `idx_nodes_qualified_name` | По квалифицированному имени |
| `idx_nodes_file_path` | По пути файла |
| `idx_nodes_language` | По языку |
| `idx_nodes_file_line` | Комбинированный: путь + строка |
| `idx_nodes_lower_name` | По имени в нижнем регистре (выражение) |
| `idx_edges_kind` | По виду ребра |
| `idx_edges_source_kind` | Комбинированный: источник + вид |
| `idx_edges_target_kind` | Комбинированный: цель + вид |
| `idx_edges_provenance` | По источнику ребра |
| `idx_files_language` | По языку файла |
| `idx_files_modified_at` | По времени модификации |
| `idx_unresolved_from_node` | По узлу-источнику |
| `idx_unresolved_name` | По имени ссылки |
| `idx_unresolved_file_path` | По пути файла |
| `idx_unresolved_from_name` | Комбинированный: узел + имя |

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

## Адаптер SQLite

Абстракция над `node:sqlite` (DatabaseSync).

### SqliteStatement

| Метод | Возврат | Описание |
|---|---|---|
| `run(...params)` | `{ changes: number; lastInsertRowid: number \| bigint }` | Выполнение, возвращает число измененных строк и lastInsertRowid |
| `get(...params)` | `any` | Одна строка |
| `all(...params)` | `any[]` | Все строки |
| `iterate(...params)` | `IterableIterator<any>` | Ленивый итератор, память O(1) |

### SqliteDatabase

| Метод / Свойство | Возврат | Описание |
|---|---|---|
| `prepare(sql)` | `SqliteStatement` | Создание prepared statement |
| `exec(sql)` | `void` | Выполнение SQL без результатов |
| `pragma(str, options?)` | `any` | Выполнение PRAGMA |
| `transaction(fn)` | `(...args) => T` | Обертка функции в транзакцию |
| `close()` | `void` | Закрытие БД |
| `runMaintenance()` | `void` | PRAGMA optimize + wal_checkpoint(PASSIVE) |
| `open` | `boolean` | Флаг открытости БД |

---

## Утилиты

### Конвертеры

| Функция | Возврат | Описание |
|---|---|---|
| `rowToNode(row)` | `INode` | Конвертация строки БД в узел |
| `rowToEdge(row)` | `IEdge` | Конвертация строки БД в ребро |
| `rowToFileRecord(row)` | `IFileRecord` | Конвертация строки БД в запись файла |
| `safeJsonParse<T>(str, fallback)` | `T` | Безопасный парсинг JSON из SQLite |

### Строковые

| Функция | Возврат | Описание |
|---|---|---|
| `normalizeNameToken(raw)` | `string` | Приведение к нижнему регистру, фильтрация символов |
| `deriveProjectNameTokens(projectRoot)` | `Set<string>` | Токены из go.mod, package.json, имени директории |
| `getStemVariants(term)` | `string[]` | Варианты основы: -ing, -tion, -ment, -ies, -es, -s, -ed, -er |
| `extractSearchTerms(query, options?)` | `string[]` | Разделение camelCase, PascalCase, snake_case, dot.notation |
| `unquote(s)` | `string` | Удаление внешних кавычек |
| `boundedEditDistance(a, b, maxDist)` | `number` | Расстояние Левенштейна с ранним выходом |

### Поиск

| Функция | Возврат | Описание |
|---|---|---|
| `kindBonus(kind)` | `number` | Бонус по виду узла |
| `nameMatchBonus(query, name)` | `number` | Бонус по совпадению имени |
| `scorePathRelevance(path, query, projectNameTokens?)` | `number` | Релевантность пути |
| `isLowValueFile(path)` | `boolean` | Определение тестовых и генерируемых файлов |

### Парсер запросов

| Функция | Возврат | Описание |
|---|---|---|
| `parseQuery(raw)` | `ParsedQuery` | Разбор с префиксами kind:, lang:, path:, name: |

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
| `isWithinDir(child, parent)` | `boolean` | Проверка вложенности (нечувствительно к регистру на Windows) |
| `validatePathWithinRoot(projectRoot, filePath)` | `boolean` | Проверка вложенности (лексическая + realpath) |
| `validateProjectPath(dirPath)` | `string \| null` | Отклонение системных директорий |

### Пути

| Функция | Возврат | Описание |
|---|---|---|
| `normalizePath(filePath)` | `string` | Нормализация с прямым слэшем |
| `getDatabasePath(projectRoot)` | `string` | Путь к БД по умолчанию |

### Числовые

| Функция | Возврат | Описание |
|---|---|---|
| `clamp(value, min, max)` | `number` | Численное ограничение |

### Асинхронные утилиты

| Класс / Функция | Описание |
|---|---|
| `Mutex` | Асинхронный мьютекс с очередью ожидания |
| `FileLock` | Межпроцессная блокировка с отслеживанием PID и устареванием (2 минуты) |
| `processInBatches(items, batchSize, processor, onBatchComplete?)` | Пакетная обработка с GC между батчами |
| `readFileInChunks(filePath, chunkSize?)` | Генератор постраничного чтения файлов |
| `debounce(fn, delay)` | Дебаунсинг функций |
| `throttle(fn, interval)` | Троттлинг функций |

### Память

| Класс / Функция | Описание |
|---|---|
| `estimateSize(obj)` | Приблизительная оценка размера объекта в памяти |
| `MemoryMonitor` | Мониторинг памяти с callback при достижении порога |

---

## Класс ScopeIgnore

Класс для управления игнорированием файлов с поддержкой вложенных репозиториев и glob-паттернов.

### Методы

| Метод | Возврат | Описание |
|---|---|---|
| `shouldIgnore(filePath)` | `boolean` | Следует ли игнорировать файл |
| `addPattern(pattern)` | `void` | Добавить пользовательский паттерн игнорирования |

---

## Миграции

Инфраструктура инкрементальных миграций схемы. Текущая версия: 1.

| Метод | Возврат | Описание |
|---|---|---|
| `needsMigration(db)` | `boolean` | Проверка необходимости миграции |
| `getPendingMigrations(db)` | `Migration[]` | Список ожидающих миграций |
| `getMigrationHistory(db)` | `ISchemaVersion[]` | История примененных миграций |
| `recordMigration(db, version, description)` | `void` | Фиксация примененной миграции |
| `applyMigrations(db)` | `void` | Применение всех ожидающих миграций |

### Версии

| Версия | Изменения |
|---|---|
| v1 | Начальная схема: все таблицы, индексы, FTS5, триггеры |

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
| `LRU_CACHE_SIZE` | `1000` | Размер LRU-кэша узлов |
| `FILTER_ONLY_OVER_FETCH_MULTIPLIER` | `5` | Множитель перегрузки для запросов только по фильтрам |
| `CONFIG_LEAF_LANGUAGES` | `Set('yaml', 'properties')` | Языки для leaf-конфигураций |
| `SENSITIVE_PATHS` | `Set('/proc', '/sys', '/dev', 'C:\Windows', 'C:\Program Files', 'C:\ProgramData')` | Системные директории для блокировки |
| `GENERATED_PATTERNS` | `RegExp[]` | 30+ паттернов для генерируемых файлов |
| `MAX_FILE_SIZE` | `1048576` | Максимальный размер файла для индексации (1 МБ) |
| `WORKER_RECYCLE_INTERVAL` | `250` | Интервал пересоздания worker-потока |
| `PARSE_TIMEOUT_MS` | `10000` | Базовый таймаут парсинга (10 секунд) |
| `PARSE_TIMEOUT_PER_10KB` | `10000` | Доп. таймаут на каждые 10 КБ |
| `FILE_IO_BATCH_SIZE` | `10` | Размер батча для чтения файлов |
| `SCAN_YIELD_INTERVAL` | `100` | Интервал cooperative yield при сканировании |
| `SYNC_YIELD_INTERVAL` | `1000` | Интервал cooperative yield при синхронизации |
| `SYNC_RECONCILE_YIELD_INTERVAL` | `1000` | Интервал уступки event loop при sync |
| `EMBEDDED_REPO_SEARCH_DEPTH` | `4` | Глубина поиска вложенных репозиториев |
| `EMBEDDED_REPO_SEARCH_ENTRIES` | `2000` | Лимит директорий при поиске вложенных репозиториев |
| `DEFAULT_IGNORE_DIRS` | `ReadonlySet<string>` | Директории по умолчанию для игнорирования |
| `DEFAULT_IGNORE_PATTERNS` | `string[]` | Паттерны игнорирования по умолчанию |
