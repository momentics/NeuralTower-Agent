# API: SQLite с FTS5

## Обзор

Модуль `ntgraph` предоставляет постоянное хранилище графа кода на базе SQLite с полнотекстовым поиском FTS5. Включает адаптер базы данных, построитель запросов, класс FTS-поиска, обходчик графа и менеджера запросов.

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
| `referenceKind` | `ReferenceKind` | Вид ссылки (`EdgeKind \| 'function_ref'`) |
| `line` / `column` | `number` | Позиция |
| `filePath` / `language` | `string?` / `Language?` | Контекст файла |
| `candidates` | `string[]?` | Кандидаты на разрешение |
| `status` | `'pending' \| 'failed'?` | Статус разрешения |
| `nameTail` | `string?` | Остаток имени (для частичного совпадения) |
| `rowId` | `number?` | ID строки в БД |

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
| `includePatterns` / `excludePatterns` | `string[]?` | Шаблоны включения/исключения |
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
| `dbSizeBytes` | `number` | Размер БД в байтах |
| `lastUpdated` | `number` | Последнее обновление |

### IDominantFile — Доминирующий файл

| Поле | Тип | Описание |
|---|---|---|
| `filePath` | `string` | Путь к файлу |
| `edgeCount` | `number` | Количество ребер |
| `nextEdgeCount` | `number` | Количество ребер следующего файла |

### ITopRouteFile — Файл с наибольшей концентрацией route-узлов

| Поле | Тип | Описание |
|---|---|---|
| `filePath` | `string` | Путь к файлу |
| `routeCount` | `number` | Количество route-узлов в файле |
| `totalRoutes` | `number` | Общее количество route-узлов |

### IRoutingManifest — Манифест маршрутизации

| Поле | Тип | Описание |
|---|---|---|
| `entries` | `INode[]` | Route-узлы |
| `topHandlerFile` | `string \| null` | Файл с наибольшим числом обработчиков |
| `topHandlerFileCount` | `number` | Число обработчиков в topHandlerFile |
| `totalRoutes` | `number` | Общее количество маршрутов |

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
| `incomingRefs` | `Array<{ node: INode; edge: IEdge }>` | Входящие ссылки с узлами |
| `outgoingRefs` | `Array<{ node: INode; edge: IEdge }>` | Исходящие ссылки с узлами |
| `types` | `INode[]` | Типы |
| `imports` | `IEdge[]` | Импорты |

### ITraversalOptions — Параметры обхода

| Поле | Тип | Описание |
|---|---|---|
| `maxDepth` | `number?` | Максимальная глубина |
| `edgeKinds` / `nodeKinds` | `EdgeKind[]?` / `NodeKind[]?` | Фильтры |
| `direction` | `'outgoing' \| 'incoming' \| 'both'?` | Направление |
| `limit` | `number?` | Ограничение |
| `includeStart` | `boolean?` | Включать стартовый узел |

### ParsedQuery — Разобранный запрос

| Поле | Тип | Описание |
|---|---|---|
| `text` | `string` | Текст запроса |
| `kinds` / `languages` | `NodeKind[]` / `string[]` | Извлечённые фильтры |
| `pathFilters` / `nameFilters` | `string[]` | Извлечённые фильтры пути и имени |

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
| `nodes` | `INode[]` | Извлечённые узлы |
| `edges` | `IEdge[]` | Извлечённые ребра |
| `unresolvedReferences` | `IUnresolvedReference[]` | Неразрешённые ссылки |
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

### Migration — Миграция схемы

| Поле | Тип | Описание |
|---|---|---|
| `version` | `number` | Номер версии |
| `description` | `string` | Описание |
| `up` | `(db: SqliteDatabase) => void` | Функция обновления |

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

Объединяет `IGraphQueryContext` и `IFileContext`. Методы:

**От IGraphQueryContext:**
`getNodeById`, `getNodesByKind`, `getNodesByQualifiedName`, `getNodesByLowerName`, `getSupertypes`, `getChildren`, `getAncestors`, `getIncomingEdges`, `getOutgoingEdges`.

**От IFileContext:**
`getNodesByFile`, `getNodesByName`, `getImportMappings`, `getReExports`, `getFileContent`, `getFilePathFromNodeId`, `getLanguageFromNodeId`, `getDetectedFrameworks`, `getAllFiles`, `iterateNodesByKind?`, `getFileLines?`, `getMethodMatches?`, `getSupertypesByName?`, `getProjectAliases?`, `getGoModule?`, `getWorkspacePackages?`, `listDirectories?`, `getCppIncludeDirs?`.

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

### IReExport — Повторный экспорт из модуля

Дискриминированный союз:

```
type IReExport =
  | { kind: 'named'; exportedName: string; originalName: string; source: string }
  | { kind: 'wildcard'; source: string }
```

### IAliasMap — Карта псевдонимов импортов

```
interface IAliasMap { [alias: string]: string[] }
```

### IGoModule — Информация о Go-модуле

| Поле | Тип | Описание |
|---|---|---|
| `modulePath` | `string` | Путь модуля |
| `goVersion` | `string` | Версия Go |
| `dependencies` | `Map<string, string>` | Зависимости |

> Примечание: фактическая реализация `GoModule` в `GoModule.ts` содержит `modulePath` и `rootDir`.

### IWorkspacePackages — Пакеты workspace (monorepo)

| Поле | Тип | Описание |
|---|---|---|
| `packages` | `Map<string, string>` | Пакеты по путям |
| `workspaces` | `string[]` | Пути рабочих пространств |

> Примечание: фактическая реализация `WorkspacePackages` в `WorkspacePackages.ts` содержит `byName: Map<string, string>` и `entryByName?: Map<string, string>`.

### IImportMapping — Сопоставление импорта с файлом

| Поле | Тип | Описание |
|---|---|---|
| `localName` | `string` | Локальное имя |
| `exportedName` | `string` | Экспортируемое имя |
| `source` | `string` | Источник |
| `isDefault` | `boolean` | По умолчанию |
| `isNamespace` | `boolean` | Пространство имён |
| `resolvedPath` | `string?` | Разрешённый путь |

### IFrameworkResolver — Разрешатель фреймворков

| Поле | Тип | Описание |
|---|---|---|
| `name` | `string` | Имя фреймворка |
| `languages` | `Language[]?` | Языки (если не указан — все) |
| `detect(context)` | `boolean` | Определение применимости резолвера к проекту |
| `resolve(ref, context)` | `IResolvedRef \| null` | Разрешить ссылку |
| `claimsReference?(name)` | `boolean?` | Пропуск ссылки через pre-filter |
| `extract?(filePath, content)` | `IFrameworkExtractionResult?` | Экстракция фреймворк-узлов |
| `postExtract?(context)` | `INode[]?` | Кросс-файловая финализация |

### IFrameworkExtractionResult — Результат фреймворк-экстракции

| Поле | Тип | Описание |
|---|---|---|
| `nodes` | `INode[]` | Фреймворк-узлы (маршруты и т.д.) |
| `references` | `IUnresolvedReference[]` | Фреймворк-ссылки |

### IFrameworkExtractionResult — Результат фреймворк-экстракции

| Поле | Тип | Описание |
|---|---|---|
| `nodes` | `INode[]` | Фреймворк-узлы (маршруты и т.д.) |
| `references` | `IUnresolvedReference[]` | Фреймворк-ссылки |

### IGraphQueryContext — Контекст графовых запросов

| Метод | Возврат | Описание |
|---|---|---|
| `getNodeById(id)` | `INode \| null` | Узел по ID |
| `getNodesByKind(kind)` | `INode[]` | Узлы по виду |
| `getNodesByQualifiedName(qn)` | `INode[]` | Узлы по квалифицированному имени |
| `getNodesByLowerName(lowerName)` | `INode[]` | Узлы по нижнему регистру |
| `getSupertypes(nodeId)` | `INode[]` | Супертипы |
| `getChildren(nodeId)` | `INode[]` | Дочерние узлы |
| `getAncestors(nodeId)` | `INode[]` | Предки |
| `getIncomingEdges(nodeId)` | `IEdge[]` | Входящие рёбра |
| `getOutgoingEdges(nodeId)` | `IEdge[]` | Исходящие рёбра |

### IFileContext — Контекст файловых запросов

| Метод | Возврат | Описание |
|---|---|---|
| `getNodesByFile(filePath)` | `INode[]` | Узлы файла |
| `getNodesByName(name)` | `INode[]` | Узлы по имени |
| `getImportMappings(filePath)` | `IImportMapping[]` | Маппинги импорта |
| `getReExports(filePath, language?)` | `IReExport[]` | Re-export |
| `getFileContent(filePath)` | `string \| null` | Содержимое файла |
| `getFilePathFromNodeId(nodeId)` | `string \| null` | Путь файла по ID узла |
| `getLanguageFromNodeId(nodeId)` | `Language \| null` | Язык по ID узла |
| `getDetectedFrameworks()` | `string[]` | Обнаруженные фреймворки |
| `getAllFiles()` | `string[]` | Все файлы |
| `iterateNodesByKind?(kind)` | `IterableIterator<INode>?` | Ленивый итератор |
| `getFileLines?(filePath)` | `string[] \| null?` | Строки файла |
| `getMethodMatches?(typeName, methodName, language)` | `INode[]?` | Методы по типу и имени |
| `getSupertypesByName?(typeName, language)` | `string[]?` | Супертипы по имени |
| `getProjectAliases?()` | `IAliasMap \| null?` | Алиасы проекта |
| `getGoModule?()` | `IGoModule \| null?` | Go-модуль |
| `getWorkspacePackages?()` | `IWorkspacePackages \| null?` | Пакеты workspace |
| `listDirectories?(relativePath)` | `string[]?` | Директории |
| `getCppIncludeDirs?()` | `string[]?` | C++ include-директории |

---

## Перечисления

### NodeKind

Frozen-объект с PascalCase ключами и lowercase значениями. 18 значений:
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

Frozen-массив. 41 значение: `typescript`, `javascript`, `tsx`, `jsx`, `python`,
`go`, `rust`, `java`, `c`, `cpp`, `csharp`, `razor`, `php`, `ruby`, `swift`,
`kotlin`, `dart`, `svelte`, `vue`, `astro`, `liquid`, `pascal`, `scala`, `lua`,
`luau`, `objc`, `r`, `yaml`, `twig`, `xml`, `properties`, `unknown`, `html`,
`css`, `sql`, `json`, `markdown`, `shell`, `dockerfile`, `toml`, `ini`.

---

## Класс QueryBuilder

Построитель запросов с ленивой инициализацией подготовленных запросов и LRU-кэшем узлов (1000 записей). Все операции синхронны (SQLite DatabaseSync).

### Конструктор

```
constructor(db: SqliteDatabase)
```

### Узлы

| Метод | Возврат | Описание |
|---|---|---|
| `insertNode(node)` | `void` | Вставка узла (INSERT OR REPLACE — идемпотентный upsert) |
| `insertNodes(nodes)` | `void` | Пакетная вставка узлов в транзакции + вставка сегментов имён |
| `updateNode(node)` | `void` | Обновление узла |
| `deleteNode(id)` | `void` | Удаление узла по ID |
| `deleteNodesByFile(filePath)` | `number` | Удаление всех узлов файла и связанных рёбер, возвращает число удалённых |
| `getNodeById(id)` | `INode \| null` | Поиск узла по ID (с LRU-кэшем) |
| `getNodesByIds(ids)` | `Map<string, INode>` | Пакетный поиск (чанки по 500, с кэш-хитами, порядок = порядок входного массива) |
| `getExistingNodeIds(ids)` | `Set<string>` | Существующие идентификаторы для проверки |
| `getNodesByFile(filePath)` | `INode[]` | Узлы файла |
| `getNodesByKind(kind)` | `INode[]` | Узлы по виду |
| `iterateNodesByKind(kind)` | `IterableIterator<INode>` | Ленивый итератор узлов вида, память O(1) |
| `getAllNodes()` | `INode[]` | Все узлы |
| `getNodesByName(name)` | `INode[]` | Точный поиск по имени |
| `getNodesByQualifiedNameExact(qn)` | `INode[]` | Точный поиск по квалифицированному имени |
| `getNodesByLowerName(lowerName)` | `INode[]` | Поиск по нижнему регистру имени |
| `getNodesByNamePrefix(prefix, limit?)` | `INode[]` | Range scan по idx_nodes_name (по префиксу имени) |
| `iterateNodesByLanguageWithDecorator(language, decorator)` | `IterableIterator<INode>` | Ленивый итератор узлов с языком и декоратором |

### Ребра

| Метод | Возврат | Описание |
|---|---|---|
| `insertEdge(edge)` | `void` | Вставка ребра (INSERT OR IGNORE — дубли пропускаются) |
| `insertEdges(edges)` | `void` | Пакетная вставка в транзакции с проверкой узлов |
| `getOutgoingEdges(source, kinds?, provenance?)` | `IEdge[]` | Исходящие рёбра с фильтрами |
| `getIncomingEdges(target, kinds?)` | `IEdge[]` | Входящие рёбра с фильтром видов |
| `deleteEdgesBySource(sourceId)` | `number` | Удаление по источнику, возвращает число удалённых |
| `deleteEdgesByTarget(targetId)` | `number` | Удаление по цели, возвращает число удалённых |
| `findEdgesBetweenNodes(nodeIds, kinds?)` | `IEdge[]` | Рёбра между заданными узлами |

### Файлы

| Метод | Возврат | Описание |
|---|---|---|
| `upsertFile(file)` | `void` | Вставка или обновление файла (ON CONFLICT DO UPDATE) |
| `deleteFile(filePath)` | `void` | Удаление файла и его узлов |
| `getFileByPath(path)` | `IFileRecord \| null` | Поиск файла по пути |
| `getAllFiles()` | `IFileRecord[]` | Все файлы |
| `getStaleFiles(currentHashes)` | `IFileRecord[]` | Устаревшие файлы (хеш изменился, currentHashes обязателен) |
| `getLastIndexedAt()` | `number \| null` | Последняя метка индексации |
| `getAllFilePaths()` | `string[]` | Все пути файлов |
| `getAllNodeNames()` | `string[]` | Все имена узлов |
| `getDistinctFileLanguages()` | `Set<string>` | Отличные языки из таблицы файлов |

### Словарь сегментов имён

| Метод | Возврат | Описание |
|---|---|---|
| `isSegmentableKind(kind)` | `boolean` | Вид узла вносит имя в словарь (file и import исключены) |
| `clearNameSegmentVocab()` | `void` | Очистка словаря сегментов имён |
| `isNameSegmentVocabEmpty()` | `boolean` | Пуст ли словарь сегментов |
| `getDistinctNodeNames(limit, offset)` | `string[]` | Страница отличных имён сегментируемых узлов |
| `insertNameSegmentsBatch(names)` | `void` | Вставка сегментов пакета имён в транзакции |
| `getSegmentCoOccurrence(variants, minWords, limit)` | `Array<{name, matches}>` | Имена, чьи сегменты покрывают не менее minWords слов |
| `getSegmentNameCounts(segments)` | `Map<string, number>` | Число отличных имён для каждого сегмента |
| `getNamesForSegment(segment, limit)` | `string[]` | Имена, содержащие заданный сегмент |

### Поиск

| Метод | Возврат | Описание |
|---|---|---|
| `searchNodes(query, options?)` | `ISearchResult[]` | Основной поиск: FTS5 → LIKE → Fuzzy (через FtsSearch). Парсит фильтры `kind:`, `lang:`, `path:`, `name:` из запроса |
| `searchNodesFTS(query, options?)` | `ISearchResult[]` | Прямой вызов FtsSearch.search |
| `searchNodesLike(query, options?)` | `ISearchResult[]` | LIKE-фоллбэк (через FtsSearch) |
| `searchNodesFuzzy(query, options?)` | `ISearchResult[]` | Fuzzy-фоллбэк (через FtsSearch) |
| `findNodesByExactName(names, options?)` | `ISearchResult[]` | Точный поиск по множеству имён с бонусом за совпадение местоположения |
| `findNodesByNameSubstring(sub, options?)` | `INode[]` | LIKE-поиск по подстроке имени. Options: `excludePrefix?: boolean` — исключить точное совпадение префикса |
| `searchAllByFilters(options)` | `ISearchResult[]` | Поиск только по фильтрам без текста. Принимает `{ kinds?: NodeKind[]; languages?: string[]; limit: number }` |

### Неразрешённые ссылки

| Метод | Возврат | Описание |
|---|---|---|
| `insertUnresolvedRef(ref)` | `void` | Вставка ссылки |
| `insertUnresolvedRefsBatch(refs)` | `void` | Пакетная вставка |
| `deleteUnresolvedByNode(nodeId)` | `void` | Удаление по узлу |
| `getUnresolvedByName(name)` | `IUnresolvedReference[]` | Поиск по имени |
| `getUnresolvedReferences()` | `IUnresolvedReference[]` | Все ссылки |
| `getUnresolvedReferencesCount()` | `number` | Количество ссылок |
| `getUnresolvedReferencesBatch(offset, limit)` | `IUnresolvedReference[]` | Пагинированный запрос (только status='pending') |
| `getUnresolvedReferencesBatchAfter(afterRowId, limit)` | `IUnresolvedReference[]` | Keyset-пагинация по rowid |
| `getUnresolvedReferencesByFiles(filePaths)` | `IUnresolvedReference[]` | По файлам (чанки по 500, только pending) |
| `deleteResolvedReferences(fromNodeIds)` | `void` | Удаление по ID узлов |
| `deleteSpecificResolvedReferences(refs)` | `number` | Удаление конкретных ссылок |
| `markReferencesFailed(refs)` | `number` | Пометить ссылки как failed с name_tail |
| `markReferencesFailedByRowIds(refs)` | `number` | Пометить по точным row id |
| `getRetryableFailedReferences(names, perNameCeiling?)` | `IUnresolvedReference[]` | Кандидаты на перезапуск |
| `deleteReferencesByRowIds(rowIds)` | `number` | Удаление по точным row id |
| `getNodeNamesByFiles(filePaths)` | `string[]` | Отличные имена узлов в заданных файлах |
| `clearUnresolvedReferences()` | `void` | Очистка всех ссылок |

### Метаданные

| Метод | Возврат | Описание |
|---|---|---|
| `getMetadata(key)` | `string \| null` | Значение по ключу |
| `setMetadata(key, value)` | `void` | Установка или обновление (upsert) |
| `getAllMetadata()` | `Record<string, string>` | Все метаданные (объект, не Map) |

### Аналитика

| Метод | Возврат | Описание |
|---|---|---|
| `getDominantFile()` | `IDominantFile \| null` | Файл с наибольшим числом внутренних рёбер (порог 20) |
| `getTopRouteFile()` | `ITopRouteFile \| null` | Файл с наибольшей концентрацией route-узлов (структурированный результат) |
| `getRoutingManifest(limit?)` | `IRoutingManifest \| null` | Манифест маршрутизации: route-узлы + статистика обработчиков |
| `getDependentFilePaths(filePath)` | `string[]` | Файлы, зависящие от данного |
| `getDependencyFilePaths(filePath)` | `string[]` | Файлы, от которых зависит данный |
| `getCrossFileIncomingEdgesWithTarget(filePath)` | `Array<{edge, targetKind, targetName}>` | Входящие межфайловые рёбра |
| `getNodeAndEdgeCount()` | `{nodeCount, edgeCount}` | Количество узлов и ребер |
| `getStats()` | `IGraphStats` (без `dbSizeBytes`) | Статистика графа. `dbSizeBytes` добавляется в `NtGraphDb.getStats()` |

### Утилиты

| Метод | Возврат | Описание |
|---|---|---|
| `clear()` | `void` | Очистка всей БД (unresolved_refs → edges → nodes → files) |
| `clearCache()` | `void` | Очистка LRU-кэша |
| `rebind(db: SqliteDatabase)` | `void` | Замена подключения, сброс prepared statements |
| `storeFileBundle(bundle: {nodes, edges, refs, file})` | `void` | Хранение пакета файла в одной транзакции |
| `setProjectNameTokens(tokens: Set<string>)` | `void` | Токены имени проекта для исключения из поиска |
| `getProjectNameTokens()` | `string[]` | Получить токены имени проекта |
| `getFtsSearch()` | `FtsSearch` | Экземпляр FtsSearch (ленивая инициализация) |

---

## Класс NtGraphDb

Главный класс модуля. Инкапсулирует подключение к БД, PRAGMA в строгом порядке, FileLock, Mutex, MemoryMonitor и WAL-клапан.

### Конструктор

```
constructor(dbPath: string)
```

### Методы

| Метод | Возврат | Описание |
|---|---|---|
| `initialize()` | `void` | Инициализация: PRAGMA, миграции, создание QueryBuilder и FtsSearch |
| `close()` | `void` | Закрытие БД |
| `runMaintenance()` | `void` | PRAGMA optimize + wal_checkpoint(PASSIVE) |
| `enableWalValve(verbose?)` | `void` | Включить WAL-клапан для массовой индексации |
| `disableWalValve()` | `void` | Отключить WAL-клапан |
| `foldWalNow()` | `Promise<void>` | Принудительный чекпоинт WAL между фазами |
| `getSize()` | `number` | Размер БД в байтах |
| `getStats()` | `IGraphStats & { dbSizeBytes: number }` | Статистика графа с размером БД |
| `queryBuilder` | `QueryBuilder` | Прямой доступ к QueryBuilder |
| `getDatabase()` | `SqliteDatabase` | Прямой доступ к базе данных |
| `getSchemaVersion()` | `number` | Текущая версия схемы |
| `needsReindex()` | `boolean` | Требуется ли переиндексация из-за изменения версии экстракции |
| `getMigrationHistory()` | `ISchemaVersion[]` | История миграций |
| `getProjectRoot()` | `string` | Корень проекта |
| `getProjectNameTokens()` | `string[]` | Токены имени проекта |
| `getFtsSearch()` | `FtsSearch` | Прямой доступ к FtsSearch |

### Асинхронные методы (с FileLock)

| Метод | Возврат | Описание |
|---|---|---|
| `insertNode(node)` | `Promise<void>` | Вставка узла с файловой блокировкой |
| `updateNode(node)` | `Promise<void>` | Обновление узла с файловой блокировкой |
| `deleteNode(id)` | `Promise<void>` | Удаление узла с файловой блокировкой |
| `insertEdge(edge)` | `Promise<void>` | Вставка ребра с файловой блокировкой |
| `upsertFile(file)` | `Promise<void>` | Upsert файла с файловой блокировкой |
| `deleteFile(filePath)` | `Promise<void>` | Удаление файла с файловой блокировкой |
| `insertNodesBatch(nodes)` | `Promise<void>` | Пакетная вставка узлов с FileLock, Mutex, MemoryMonitor и чанками |
| `insertEdgesBatch(edges)` | `Promise<void>` | Пакетная вставка рёбер с FileLock, Mutex и чанками |

### Синхронные методы (без блокировки)

| Метод | Возврат | Описание |
|---|---|---|
| `insertNodes(nodes)` | `void` | Пакетная вставка узлов |
| `insertEdges(edges)` | `void` | Пакетная вставка рёбер |
| `deleteNodesByFile(filePath)` | `number` | Удаление узлов файла |
| `getNodeById(id)` | `INode \| null` | Узел по ID |
| `getNodesByIds(ids)` | `Map<string, INode>` | Пакетный поиск узлов (Map) |
| `getNodesByFile(filePath)` | `INode[]` | Узлы файла |
| `getNodesByKind(kind)` | `INode[]` | Узлы по виду |
| `iterateNodesByKind(kind)` | `IterableIterator<INode>` | Ленивый итератор узлов вида |
| `getAllNodes()` | `INode[]` | Все узлы |
| `getNodesByName(name)` | `INode[]` | Узлы по имени |
| `getNodesByQualifiedNameExact(qn)` | `INode[]` | Узлы по квалифицированному имени |
| `getNodesByLowerName(lowerName)` | `INode[]` | Узлы по нижнему регистру имени |
| `getOutgoingEdges(sourceId, kinds?, provenance?)` | `IEdge[]` | Исходящие рёбра |
| `getIncomingEdges(targetId, kinds?)` | `IEdge[]` | Входящие рёбра |
| `deleteEdgesBySource(sourceId)` | `number` | Удаление рёбер по источнику |
| `deleteEdgesByTarget(targetId)` | `number` | Удаление рёбер по цели |
| `getFileByPath(path)` | `IFileRecord \| null` | Файл по пути |
| `getAllFiles()` | `IFileRecord[]` | Все файлы |
| `getLastIndexedAt()` | `number \| null` | Последняя метка индексации |
| `getStaleFiles(currentHashes?)` | `IFileRecord[]` | Устаревшие файлы |
| `getAllFilePaths()` | `string[]` | Все пути файлов |
| `getAllNodeNames()` | `string[]` | Все имена узлов |
| `getDominantFile()` | `IDominantFile \| null` | Доминирующий файл |
| `getTopRouteFile()` | `ITopRouteFile \| null` | Файл с наибольшей концентрацией route-узлов |
| `getRoutingManifest(limit?)` | `IRoutingManifest \| null` | Манифест маршрутизации |
| `getDependentFilePaths(filePath)` | `string[]` | Файлы, зависящие от данного |
| `getDependencyFilePaths(filePath)` | `string[]` | Файлы, от которых зависит данный |
| `getCrossFileIncomingEdgesWithTarget(filePath)` | `Array<{edge, targetKind, targetName}>` | Входящие межфайловые рёбра |
| `findEdgesBetweenNodes(nodeIds, kinds?)` | `IEdge[]` | Рёбра между узлами |
| `insertUnresolvedRef(ref)` | `void` | Вставка неразрешённой ссылки |
| `insertUnresolvedRefsBatch(refs)` | `void` | Пакетная вставка |
| `deleteUnresolvedByNode(nodeId)` | `void` | Удаление по узлу |
| `getUnresolvedByName(name)` | `IUnresolvedReference[]` | Ссылки по имени |
| `getUnresolvedReferences()` | `IUnresolvedReference[]` | Все ссылки |
| `getUnresolvedReferencesCount()` | `number` | Количество ссылок |
| `getUnresolvedReferencesBatch(offset, limit)` | `IUnresolvedReference[]` | Пагинированный запрос |
| `getUnresolvedReferencesByFiles(filePaths)` | `IUnresolvedReference[]` | Ссылки по файлам |
| `clearUnresolvedReferences()` | `void` | Очистка всех ссылок |
| `deleteResolvedReferences(fromNodeIds)` | `void` | Удаление по ID узлов |
| `deleteSpecificResolvedReferences(refs)` | `number` | Удаление конкретных ссылок |
| `search(query, options?)` | `ISearchResult[]` | Основной поиск |
| `findNodesByExactName(names, options?)` | `ISearchResult[]` | Точный поиск по множеству имён |
| `findNodesByNameSubstring(sub, options?)` | `INode[]` | LIKE-поиск по подстроке |
| `getMetadata(key)` | `string \| null` | Метаданные по ключу |
| `setMetadata(key, value)` | `void` | Установка метаданных |
| `getAllMetadata()` | `Map<string, string>` | Все метаданные |
| `getNodeAndEdgeCount()` | `{nodeCount, edgeCount}` | Количество узлов и ребер |
| `clear()` | `void` | Очистка всей БД |
| `clearCache()` | `void` | Очистка LRU-кэша |

---

## Класс FtsSearch

Трёхуровневый FTS-поиск: FTS5 → LIKE → Fuzzy. BM25 с весами, over-fetch x5, rescoring, exact-match supplement, экранирование спецсимволов.

### Конструктор

```
constructor(db: SqliteDatabase)
```

### Методы

| Метод | Возврат | Описание |
|---|---|---|
| `search(query, options?)` | `ISearchResult[]` | Полный поиск с fallback. Парсит поле-квалифицированные фильтры: `kind:`, `lang:`, `path:`, `name:`. Фильтры из options имеют приоритет. При отсутствии текста — поиск по фильтрам без FTS |
| `searchFTS(query, options)` | `ISearchResult[]` | FTS5-поиск с BM25, веса: name=20, qualified_name=5, docstring=1, signature=2 |
| `searchLike(query, options?)` | `ISearchResult[]` | LIKE-фоллбэк: точное=1.0, startsWith=0.9, contains=0.8, qualified=0.7, else=0.5 |
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

## Класс GraphTraverser

Обход графа кода: BFS, DFS, поиск вызывающих/вызываемых функций, иерархия типов, поиск путей, оценка влияния.

### Конструктор

```
constructor(qb: QueryBuilder)
```

### Методы

| Метод | Возврат | Описание |
|---|---|---|
| `traverseBFS(startId, options?)` | `ISubgraph` | Обход в ширину |
| `traverseDFS(startId, options?)` | `ISubgraph` | Обход в глубину |
| `getCallers(nodeId, maxDepth?)` | `Array<{node, edge}>` | Вызывающие функции/методы |
| `getCallees(nodeId, maxDepth?)` | `Array<{node, edge}>` | Вызываемые функции/методы |
| `getCallGraph(nodeId, depth?)` | `ISubgraph` | Граф вызовов (вызывающие + вызываемые) |
| `getTypeHierarchy(nodeId)` | `ISubgraph` | Иерархия типов (предки + потомки) |
| `findUsages(nodeId)` | `Array<{node, edge}>` | Все использования символа |
| `getImpactRadius(nodeId, maxDepth?)` | `ISubgraph` | Оценка влияния узла |
| `findPath(fromId, toId, edgeKinds?)` | `Array<{node, edge}> \| null` | Кратчайший путь между узлами |
| `getAncestors(nodeId)` | `INode[]` | Предки по contains |
| `getChildren(nodeId)` | `INode[]` | Дочерние узлы по contains |

---

## Класс GraphQueryManager

Высокоуровневые запросы к графу: контекст узла, зависимости, мёртвый код, метрики сложности.

### Конструктор

```
constructor(qb: QueryBuilder)
```

### Методы

| Метод | Возврат | Описание |
|---|---|---|
| `getContext(nodeId)` | `Context` | Полный контекст узла |
| `getFileDependencies(filePath)` | `string[]` | Файлы, от которых зависит данный |
| `getFileDependents(filePath)` | `string[]` | Файлы, зависящие от данного |
| `getExportedSymbols(filePath)` | `INode[]` | Экспортируемые символы файла |
| `findByQualifiedName(pattern)` | `INode[]` | Поиск по шаблону квалифицированного имени (* и ?) |
| `getModuleStructure()` | `Map<string, string[]>` | Дерево файлов по директориям |
| `findCircularDependencies()` | `string[][]` | Циклические зависимости |
| `getNodeMetrics(nodeId)` | `{incomingEdgeCount, outgoingEdgeCount, callCount, callerCount, childCount, depth}` | Метрики сложности узла |
| `findDeadCode(kinds?)` | `INode[]` | Узлы без входящих ссылок (неэкспортируемые) |
| `getFilteredSubgraph(filter, includeEdges?)` | `ISubgraph` | Подграф по фильтру |
| `getTraverser()` | `GraphTraverser` | Доступ к обходчику графа |

---

## Класс ImpactAnalyzer

Анализ радиуса воздействия: определяет все узлы, которые могут быть затронуты изменениями в заданном узле.

### Конструктор

```
constructor(qb: QueryBuilder)
```

### Методы

| Метод | Возврат | Описание |
|---|---|---|
| `analyze(nodeId, options?)` | `IImpactResult` | Оценка влияния узла с глубиной по умолчанию 3. Возвращает подграф, затронутые узлы, файлы и статистику по глубинам |

### IImpactResult

| Поле | Тип | Описание |
|---|---|---|
| `subgraph` | `ISubgraph` | Подграф влияния |
| `impactedNodes` | `INode[]` | Затронутые узлы (без фокального) |
| `impactedFiles` | `string[]` | Затронутые файлы |
| `depthStats` | `Record<number, number>` | Количество узлов на каждой глубине |

### IImpactOptions

| Поле | Тип | Описание |
|---|---|---|
| `maxDepth` | `number?` | Максимальная глубина (по умолчанию 3) |
| `edgeKinds` | `EdgeKind[]?` | Фильтр видов рёбер |

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
| `unresolved_refs` | Неразрешённые ссылки |
| `nodes_fts` | Виртуальная таблица FTS5 для полнотекстового поиска |
| `name_segment_vocab` | Словарь сегментов имён для поиска символов по словам |

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
| `idx_edges_identity` | Уникальный: (source, target, kind, IFNULL(line, -1), IFNULL(col, -1)) — предотвращает дубликаты |
| `idx_files_language` | По языку файла |
| `idx_files_modified_at` | По времени модификации |
| `idx_unresolved_from_node` | По узлу-источнику |
| `idx_unresolved_name` | По имени ссылки |
| `idx_unresolved_file_path` | По пути файла |
| `idx_unresolved_from_name` | Комбинированный: узел + имя |
| `idx_unresolved_status` | По статусу разрешения |
| `idx_unresolved_failed_tail` | По name_tail WHERE status = 'failed' |

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
| `run(...params)` | `{ changes: number; lastInsertRowid: number \| bigint }` | Выполнение, возвращает число изменённых строк и lastInsertRowid |
| `get(...params)` | `any` | Одна строка |
| `all(...params)` | `any[]` | Все строки |
| `iterate(...params)` | `IterableIterator<any>` | Ленивый итератор, память O(1) |

### SqliteDatabase

| Метод / Свойство | Возврат | Описание |
|---|---|---|
| `prepare(sql)` | `SqliteStatement` | Создание подготовленного запроса |
| `exec(sql)` | `void` | Выполнение SQL без результатов |
| `pragma(str, options?)` | `any` | Выполнение PRAGMA |
| `transaction(fn)` | `(...args) => T` | Выполнение функции в транзакции |
| `close()` | `void` | Закрытие БД |
| `runMaintenance()` | `void` | PRAGMA optimize + wal_checkpoint(PASSIVE) |
| `getWalSizeBytes()` | `number` | Размер WAL-файла в байтах |
| `checkpointWalPassive()` | `{ busy, log, checkpointed } \| null` | Пассивный чекпоинт WAL |
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
| `extractSearchTerms(query, options?)` | `string[]` | Разделение camelCase, PascalCase, snake_case, точечная нотация |
| `unquote(s)` | `string` | Удаление внешних кавычек |
| `boundedEditDistance(a, b, maxDist)` | `number` | Расстояние Левенштейна с ранним выходом |
| `splitIdentifierSegments(name)` | `string[]` | Разбиение имени символа на сегменты-слова |
| `normalizeProseWord(word)` | `string` | Нормализация слова прозы (нижний регистр + удаление диакритики) |
| `extractProseCandidates(prompt)` | `string[]` | Кандидаты из прозы для поиска в словаре сегментов |
| `segmentLookupVariants(word)` | `string[]` | Варианты поиска для слова прозы |

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
| `isDistinctiveIdentifier(token)` | `boolean` | Наличие подчёркивания, цифры или заглавной буквы внутри слова |
| `isConfigLeafNode(node)` | `boolean` | Узел-константа YAML/properties |

### Безопасность путей

| Функция | Возврат | Описание |
|---|---|---|
| `isWithinDir(child, parent)` | `boolean` | Проверка вложенности (нечувствительно к регистру на Windows) |
| `validatePathWithinRoot(projectRoot, filePath)` | `boolean` | Проверка вложенности (лексическая + realpath), возвращает `true` если путь внутри корня |
| `validateProjectPath(dirPath)` | `string \| null` | Отклонение системных директорий |

### Классификаторы файлов

| Функция | Возврат | Описание |
|---|---|---|
| `isBinaryFile(content: Buffer)` | `boolean` | Проверка на бинарный файл (нулевой байт или >30% непечатных) |
| `isTooLarge(size)` | `boolean` | Превышает ли размер MAX_FILE_SIZE (1 МБ) |
| `resolveRelativePath(filePath, projectRoot)` | `string` | Относительный путь от корня проекта |

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
| `processInBatches(items, batchSize, processor, onBatchComplete?)` | Пакетная обработка со сборкой мусора между партиями |
| `readFileInChunks(filePath, chunkSize?)` | Генератор постраничного чтения файлов |
| `debounce(fn, delay)` | Отложенный вызов функций |
| `throttle(fn, interval)` | Ограничение частоты вызовов |

### Память

| Класс / Функция | Описание |
|---|---|
| `estimateSize(obj)` | Приблизительная оценка размера объекта в памяти |
| `MemoryMonitor` | Мониторинг памяти с обратным вызовом при достижении порога |

---

## Сопоставление ссылок (NameMatcher)

Стратегии разрешения ссылок по имени.

### Функции

| Функция | Возврат | Описание |
|---|---|---|
| `matchReference(ref, context)` | `IResolvedRef \| null` | Точное совпадение по имени (без import-узлов, с языковым фильтром, лексической достижимостью, порогом неоднозначности) |
| `matchFunctionRef(ref, context)` | `IResolvedRef \| null` | Функциональные ссылки (callback-регистрации) |
| `matchByQualifiedName(ref, context)` | `IResolvedRef \| null` | Разрешение по квалифицированному имени (Foo::bar) |
| `matchDottedCallChain(ref, context)` | `IResolvedRef \| null` | Цепные вызовы через `.` (Foo().bar()) |
| `matchScopedCallChain(ref, context)` | `IResolvedRef \| null` | Цепные вызовы через `::` (Rust: Foo::bar()) |
| `matchByFilePath(ref, context)` | `IResolvedRef \| null` | Разрешение по пути файла (#include "X.h") |
| `isLexicallyReachable(candidate, ref, context)` | `boolean` | Проверка лексической достижимости |
| `sameLanguageFamily(a, b)` | `boolean` | Сравнивает языковые семейства |
| `isKnownLanguageFamily(lang)` | `boolean` | Принадлежность к известному многоязыковому семейству |
| `crossesKnownFamily(a, b)` | `boolean` | Пересечение двух разных известных семейств |
| `preferCallSiteFile(nodes, callSiteFile)` | `INode[]` | Сортировка: сначала узлы из файла вызова |
| `resolveMethodOnType(typeName, methodName, ...)` | `IResolvedRef \| null` | Разрешение метода по типу с supertype walk |
| `inferLocalReceiverType(receiverName, ref, context)` | `string \| null` | Инференс типа получателя из локальных переменных |
| `normalizeInferredTypeName(raw)` | `string \| null` | Нормализация выражения типа |

### Константы

| Константа | Описание |
|---|---|
| `AMBIGUOUS_NAME_CEILING` | Порог неоднозначности (500, настраивается через CODEGRAPH_AMBIGUOUS_NAME_CEILING) |
| `LANGUAGE_FAMILIES` | Семейства: jvm (java/kotlin/scala), web (ts/js/tsx/jsx), c (c/cpp/objc), dotnet (csharp/razor) |

---

## Класс ScopeIgnore

Класс для управления игнорированием файлов с поддержкой вложенных репозиториев и glob-шаблонов.

### Конструктор

```
constructor(baseDir: string, embeddedRepoRoots: string[])
```

### Методы

| Метод | Возврат | Описание |
|---|---|---|
| `shouldIgnore(filePath)` | `boolean` | Следует ли игнорировать файл |
| `addPattern(pattern)` | `void` | Добавить пользовательский шаблон игнорирования |

---

## Класс WalCheckpointValve

Регулятор WAL-чекпоинтов — ограничивает рост журнала при массовой индексации. Предотвращает разрастание WAL-файла до нескольких ГБ.

### Конструктор

```
constructor(db: SqliteDatabase, softMb?: number, intervalMs?: number, log?: (msg: string) => void)
```

`softMb` по умолчанию читается из `CODEGRAPH_WAL_VALVE_MB` или 256 МБ. `intervalMs` по умолчанию 2000 мс.

### Методы

| Метод | Возврат | Описание |
|---|---|---|
| `start()` | `void` | Запуск наблюдения за WAL (идемпотентно) |
| `stop()` | `void` | Остановка наблюдения |
| `check()` | `void` | Один опрос: пассивный чекпоинт при превышении мягкого порога |
| `backpressure()` | `Promise<void> \| null` | Обратное давление записи при превышении жёсткого лимита |
| `drain()` | `Promise<void>` | Ожидание завершения всех чекпоинтов и пауз |
| `foldNow()` | `Promise<void>` | Принудительный бэкфилл WAL на границе фаз |

---

## Класс LRUCache

LRU-кэш с ограниченным размером. Использует Map для отслеживания порядка доступа.

### Конструктор

```
constructor(max: number)
```

Бросает ошибку, если `max <= 0`.

### Методы

| Метод | Возврат | Описание |
|---|---|---|
| `get(key)` | `V \| undefined` | Получение значения (перемещает в конец) |
| `set(key, value)` | `void` | Установка значения (эвиция старейшего при переполнении) |
| `has(key)` | `boolean` | Проверка наличия |
| `delete(key)` | `boolean` | Удаление элемента |
| `clear()` | `void` | Очистка кэша |
| `size` | `number` | Текущее количество элементов |

---

## Миграции

Инфраструктура инкрементальных миграций схемы. Текущая версия: 8.

| Метод | Возврат | Описание |
|---|---|---|
| `needsMigration(db)` | `boolean` | Проверка необходимости миграции |
| `getPendingMigrations(db)` | `Migration[]` | Список ожидающих миграций |
| `getMigrationHistory(db)` | `ISchemaVersion[]` | История применённых миграций |
| `recordMigration(db, version, description)` | `void` | Фиксация применённой миграции |
| `applyMigrations(db)` | `void` | Применение всех ожидающих миграций |
| `runMigrations(db, fromVersion)` | `void` | Применение миграций начиная с версии |
| `getCurrentVersion(db)` | `number` | Текущая версия схемы из БД |

### Версии

| Версия | Изменения |
|---|---|
| v1 | Начальная схема: все таблицы, индексы, FTS5, триггеры |
| v7 | Добавлена таблица name_segment_vocab для поиска символов по словам |
| v8 | Добавлены status и name_tail в unresolved_refs для отслеживания статуса разрешения |

---

## Константы

| Константа | Значение | Описание |
|---|---|---|
| `DATABASE_FILENAME` | `'ntgraph.db'` | Имя файла БД |
| `FTS_OVER_FETCH_MULTIPLIER` | `5` | Множитель перегрузки FTS для пост-пересчёта |
| `FTS_LIMIT_MIN` | `100` | Минимальный лимит выборки FTS |
| `FUZZY_MAX_DIST_SHORT` | `1` | Макс. расстояние для запросов до 4 символов |
| `FUZZY_MAX_DIST_DEFAULT` | `2` | Макс. расстояние для запросов свыше 4 символов |
| `EXACT_MATCH_SUPPLEMENT_LIMIT` | `20` | Лимит дополнения точных совпадений на термин |
| `DOMINANT_FILE_EDGE_THRESHOLD` | `20` | Порог ребер для доминирующего файла |
| `TOP_ROUTE_MIN_TOTAL` | `3` | Минимум маршрутов для getTopRouteFile |
| `TOP_ROUTE_MIN_CONCENTRATION` | `0.30` | Минимальная концентрация для getTopRouteFile |
| `ROUTING_MANIFEST_DEFAULT_LIMIT` | `40` | Лимит для getRoutingManifest |
| `FileLock_STALE_TIMEOUT_MS` | `120000` | Время устаревания блокировки (2 минуты) |
| `SQLITE_PARAM_CHUNK_SIZE` | `500` | Размер блока для пакетных запросов |
| `LRU_CACHE_SIZE` | `1000` | Размер LRU-кэша узлов |
| `FILTER_ONLY_OVER_FETCH_MULTIPLIER` | `5` | Множитель перегрузки для запросов только по фильтрам |
| `CONFIG_LEAF_LANGUAGES` | `Set('yaml', 'properties')` | Языки для конечных конфигураций |
| `SENSITIVE_PATHS` | `Set('/proc', '/sys', '/dev', 'C:\Windows', 'C:\Program Files', 'C:\ProgramData')` | Системные директории для блокировки |
| `MAX_FILE_SIZE` | `1048576` | Максимальный размер файла для индексации (1 МБ) |
| `WORKER_RECYCLE_INTERVAL` | `250` | Интервал пересоздания рабочего потока |
| `PARSE_TIMEOUT_MS` | `10000` | Базовый таймаут парсинга (10 секунд) |
| `PARSE_TIMEOUT_PER_10KB` | `10000` | Дополнительный таймаут на каждые 10 КБ |
| `FILE_IO_BATCH_SIZE` | `10` | Размер партии для чтения файлов |
| `SCAN_YIELD_INTERVAL` | `100` | Интервал кооперативной уступки управления при сканировании |
| `SYNC_YIELD_INTERVAL` | `1000` | Интервал кооперативной уступки управления при синхронизации |
| `SYNC_RECONCILE_YIELD_INTERVAL` | `1000` | Интервал уступки цикла событий при синхронизации |
| `DEFAULT_YIELD_BUDGET_MS` | `250` | Бюджет кооперативной уступки управления |
| `EMBEDDED_REPO_SEARCH_DEPTH` | `4` | Глубина поиска вложенных репозиториев |
| `EMBEDDED_REPO_SEARCH_ENTRIES` | `2000` | Лимит директорий при поиске вложенных репозиториев |
| `DEFAULT_IGNORE_DIRS` | `ReadonlySet<string>` | Директории по умолчанию для игнорирования (60+) |
| `DEFAULT_IGNORE_PATTERNS` | `string[]` | Шаблоны игнорирования по умолчанию |
