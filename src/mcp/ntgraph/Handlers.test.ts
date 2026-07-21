/**
 * Тесты обработчиков MCP-инструментов ntgraph.
 *
 * Проверяют: search, node, explore, impact, callers, callees,
 * files, status обработчики, адаптивный бюджет, валидацию,
 * ошибки NotIndexedError и PathRefusalError, усечение вывода,
 * и ограничения tiny-репозиториев.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { NtGraphDb } from "../../repo/ntgraph/index"
import type { INode, IEdge, IFileRecord, IGraphStats } from "../../repo/ntgraph/Types"
import {
  searchHandler,
  nodeHandler,
  exploreHandler,
  impactHandler,
  callersHandler,
  calleesHandler,
  filesHandler,
  statusHandler,
  validateString,
} from "./Handlers"
import {
  NotIndexedError,
  PathRefusalError,
  textResult,
  errorResult,
  MAX_OUTPUT_LENGTH,
  MAX_INPUT_LENGTH,
  TINY_REPO_FILE_THRESHOLD,
  TINY_REPO_CORE_TOOLS,
} from "./Errors"
import { getExploreOutputBudget } from "./Budget"

// =============================================================================
// Создание мок-базы данных
// =============================================================================

function createMockDb(): NtGraphDb {
  const nodes = new Map<string, INode>()
  const edges = new Map<string, IEdge[]>()
  const files: IFileRecord[] = []

  const db = {
    getNodesByName: function(name: string): INode[] {
      const result: INode[] = []
      for (const n of nodes.values()) {
        if (n.name.includes(name) || name.includes(n.name)) result.push(n)
      }
      return result
    },
    getNodeById: function(id: string): INode | null {
      return nodes.get(id) || null
    },
    getOutgoingEdges: function(nodeId: string): IEdge[] {
      return edges.get(nodeId) || []
    },
    getIncomingEdges: function(nodeId: string): IEdge[] {
      const result: IEdge[] = []
      for (const [, edgeList] of edges) {
        for (const e of edgeList) {
          if (e.target === nodeId) result.push(e)
        }
      }
      return result
    },
    getAllFiles: function(): IFileRecord[] {
      return files
    },
    getStats: function(): IGraphStats {
      const nodesByKind: Record<string, number> = {}
      const edgesByKind: Record<string, number> = {}
      const filesByLanguage: Record<string, number> = {}
      for (const n of nodes.values()) {
        nodesByKind[n.kind] = (nodesByKind[n.kind] || 0) + 1
      }
      let edgeCount = 0
      for (const [, edgeList] of edges) {
        for (const e of edgeList) {
          edgesByKind[e.kind] = (edgesByKind[e.kind] || 0) + 1
          edgeCount++
        }
      }
      for (const f of files) {
        filesByLanguage[f.language] = (filesByLanguage[f.language] || 0) + 1
      }
      return {
        nodeCount: nodes.size,
        edgeCount,
        fileCount: files.length,
        nodesByKind,
        edgesByKind,
        filesByLanguage,
        dbSizeBytes: 0,
        lastUpdated: Date.now(),
      }
    },
    getNodesByKind: function() { return [] },
    getNodesByQualifiedNameExact: function() { return [] },
    getUnresolvedReferences: function() { return [] },
    insertNode: function() {},
    insertEdge: function() {},
    insertNodes: function() {},
    insertEdges: function() {},
    insertUnresolvedRefsBatch: function() {},
    close: function() {},
    initialize: function() {},
    queryBuilder: {},
  }

  return db as unknown as NtGraphDb
}

// =============================================================================
// Создание тестовых узлов
// =============================================================================

function createNode(overrides: Partial<INode> = {}): INode {
  return {
    id: `node-${Math.random().toString(36).slice(2)}`,
    kind: 'function',
    name: 'testFunc',
    qualifiedName: 'testFunc',
    filePath: 'src/test.ts',
    language: 'typescript',
    startLine: 1,
    endLine: 10,
    startColumn: 0,
    endColumn: 10,
    updatedAt: Date.now(),
    ...overrides,
  }
}

function createEdge(source: string, target: string, kind: string = 'calls'): IEdge {
  return { source, target, kind: kind as any, line: 5 }
}

function createFile(overrides: Partial<IFileRecord> = {}): IFileRecord {
  return {
    path: 'src/test.ts',
    contentHash: 'abc123',
    language: 'typescript',
    size: 1024,
    modifiedAt: Date.now(),
    indexedAt: Date.now(),
    nodeCount: 1,
    ...overrides,
  }
}

// =============================================================================
// searchHandler
// =============================================================================

describe("searchHandler", () => {
  let db: NtGraphDb

  beforeEach(() => {
    db = createMockDb()
  })

  it("находит узлы по ключевому слову", () => {
    const node = createNode({ name: 'authenticate', id: 'n1' })
    vi.spyOn(db, 'getNodesByName').mockImplementation(() => [node])

    const result = searchHandler(db, { query: 'auth' })

    expect(result.isError).toBeUndefined()
    expect(result.content[0].text).toContain('authenticate')
    expect(result.content[0].text).toContain('function')
  })

  it("фильтрует по виду узла", () => {
    const fnNode = createNode({ name: 'auth', kind: 'function', id: 'n1' })
    const classNode = createNode({ name: 'auth', kind: 'class', id: 'n2' })
    vi.spyOn(db, 'getNodesByName').mockImplementation(() => [fnNode, classNode])

    const result = searchHandler(db, { query: 'auth', kind: 'class' })

    expect(result.content[0].text).toContain('class')
    expect(result.content[0].text).not.toContain('function')
  })

  it("ограничивает количество результатов", () => {
    const nodes = Array.from({ length: 20 }, (_, i) =>
      createNode({ name: `func${i}`, id: `n${i}` })
    )
    vi.spyOn(db, 'getNodesByName').mockImplementation(() => nodes)

    const result = searchHandler(db, { query: 'func', limit: 5 })

    expect(result.content[0].text).toContain('Найдено 5 из 20')
  })

  it("возвращает сообщение при отсутствии результатов", () => {
    vi.spyOn(db, 'getNodesByName').mockImplementation(() => [])

    const result = searchHandler(db, { query: 'nonexistent' })

    expect(result.content[0].text).toContain('Совпадений не найдено')
  })

  it("возвращает ошибку при невалидном запросе", () => {
    const result = searchHandler(db, { query: 123 })

    expect(result.isError).toBe(true)
  })
})

// =============================================================================
// nodeHandler — символный режим
// =============================================================================

describe("nodeHandler symbol mode", () => {
  let db: NtGraphDb

  beforeEach(() => {
    db = createMockDb()
  })

  it("находит символ и возвращает информацию", () => {
    const node = createNode({ name: 'myFunc', id: 'n1', filePath: 'src/myFunc.ts' })
    vi.spyOn(db, 'getNodesByName').mockImplementation(() => [node])

    const result = nodeHandler(db, '/project', { symbol: 'myFunc' })

    expect(result.isError).toBeUndefined()
    expect(result.content[0].text).toContain('myFunc')
    expect(result.content[0].text).toContain('function')
    expect(result.content[0].text).toContain('src/myFunc.ts')
  })

  it("возвращает сообщение при отсутствии символа", () => {
    vi.spyOn(db, 'getNodesByName').mockImplementation(() => [])

    const result = nodeHandler(db, '/project', { symbol: 'nonexistent' })

    expect(result.content[0].text).toContain('Символ не найден')
  })

  it("дизамбигуирует по строке", () => {
    const node1 = createNode({ name: 'foo', id: 'n1', startLine: 1, endLine: 5 })
    const node2 = createNode({ name: 'foo', id: 'n2', startLine: 10, endLine: 15 })
    vi.spyOn(db, 'getNodesByName').mockImplementation(() => [node1, node2])

    const result = nodeHandler(db, '/project', { symbol: 'foo', line: 12 })

    expect(result.content[0].text).toContain('foo')
  })
})

// =============================================================================
// nodeHandler — файловый режим
// =============================================================================

describe("nodeHandler file mode", () => {
  let db: NtGraphDb

  beforeEach(() => {
    db = createMockDb()
  })

  it("возвращает сообщение при отсутствии файла", () => {
    vi.spyOn(db, 'getAllFiles').mockImplementation(() => [])

    const result = nodeHandler(db, '/project', { file: 'nonexistent.ts' })

    expect(result.content[0].text).toContain('Файл не найден')
  })

  it("требует file или symbol", () => {
    vi.spyOn(db, 'getAllFiles').mockImplementation(() => [])

    const result = nodeHandler(db, '/project', {})

    expect(result.content[0].text).toContain('Укажите')
  })
})

// =============================================================================
// exploreHandler
// =============================================================================

describe("exploreHandler", () => {
  let db: NtGraphDb

  beforeEach(() => {
    db = createMockDb()
  })

  it("возвращает сообщение при отсутствии результатов", () => {
    vi.spyOn(db, 'getNodesByName').mockImplementation(() => [])
    vi.spyOn(db, 'getAllFiles').mockImplementation(() => [])

    const result = exploreHandler(db, '/project', { query: 'nonexistent' })

    expect(result.content[0].text).toContain('Совпадений не найдено')
  })

  it("применяет бюджет для малого проекта (< 150 файлов)", () => {
    const node = createNode({ name: 'auth', id: 'n1', filePath: 'src/auth.ts' })
    vi.spyOn(db, 'getNodesByName').mockImplementation(() => [node])
    const smallFiles = Array.from({ length: 100 }, (_, i) =>
      createFile({ path: `src/file${i}.ts` })
    )
    vi.spyOn(db, 'getAllFiles').mockImplementation(() => smallFiles)

    const result = exploreHandler(db, '/project', { query: 'auth' })

    expect(result.isError).toBeUndefined()
  })

  it("применяет бюджет для большого проекта (> 5000 файлов)", () => {
    const node = createNode({ name: 'auth', id: 'n1', filePath: 'src/auth.ts' })
    vi.spyOn(db, 'getNodesByName').mockImplementation(() => [node])
    const bigFiles = Array.from({ length: 6000 }, (_, i) =>
      createFile({ path: `src/file${i}.ts` })
    )
    vi.spyOn(db, 'getAllFiles').mockImplementation(() => bigFiles)

    const result = exploreHandler(db, '/project', { query: 'auth' })

    expect(result.isError).toBeUndefined()
  })
})

// =============================================================================
// impactHandler
// =============================================================================

describe("impactHandler", () => {
  let db: NtGraphDb

  beforeEach(() => {
    db = createMockDb()
  })

  it("возвращает радиус воздействия символа", () => {
    const target = createNode({ name: 'targetFunc', id: 'n1' })
    const caller = createNode({ name: 'callerFunc', id: 'n2' })
    const incomingEdge = createEdge('n2', 'n1', 'calls')

    vi.spyOn(db, 'getNodesByName').mockImplementation(() => [target])
    vi.spyOn(db, 'getNodeById').mockImplementation((id: string) => {
      if (id === 'n2') return caller
      return null
    })
    vi.spyOn(db, 'getIncomingEdges').mockImplementation(() => [incomingEdge])
    vi.spyOn(db, 'getOutgoingEdges').mockImplementation(() => [])

    const result = impactHandler(db, { symbol: 'targetFunc' })

    expect(result.isError).toBeUndefined()
    expect(result.content[0].text).toContain('targetFunc')
  })

  it("возвращает сообщение при отсутствии символа", () => {
    vi.spyOn(db, 'getNodesByName').mockImplementation(() => [])

    const result = impactHandler(db, { symbol: 'nonexistent' })

    expect(result.content[0].text).toContain('Символ не найден')
  })
})

// =============================================================================
// callersHandler
// =============================================================================

describe("callersHandler", () => {
  let db: NtGraphDb

  beforeEach(() => {
    db = createMockDb()
  })

  it("возвращает список вызывающих", () => {
    const target = createNode({ name: 'targetFunc', id: 'n1' })
    const caller = createNode({ name: 'callerFunc', id: 'n2' })
    const incomingEdge = createEdge('n2', 'n1', 'calls')

    vi.spyOn(db, 'getNodesByName').mockImplementation(() => [target])
    vi.spyOn(db, 'getNodeById').mockImplementation((id: string) => {
      if (id === 'n2') return caller
      return null
    })
    vi.spyOn(db, 'getIncomingEdges').mockImplementation(() => [incomingEdge])

    const result = callersHandler(db, { symbol: 'targetFunc' })

    expect(result.isError).toBeUndefined()
    expect(result.content[0].text).toContain('callerFunc')
  })

  it("ограничивает количество результатов", () => {
    const target = createNode({ name: 'targetFunc', id: 'n1' })
    const caller = createNode({ name: 'callerFunc', id: 'n2' })
    const incomingEdge = createEdge('n2', 'n1', 'calls')

    vi.spyOn(db, 'getNodesByName').mockImplementation(() => [target])
    vi.spyOn(db, 'getNodeById').mockImplementation((id: string) => {
      if (id === 'n2') return caller
      return null
    })
    vi.spyOn(db, 'getIncomingEdges').mockImplementation(() => [incomingEdge])

    const result = callersHandler(db, { symbol: 'targetFunc', limit: 1 })

    expect(result.isError).toBeUndefined()
  })
})

// =============================================================================
// calleesHandler
// =============================================================================

describe("calleesHandler", () => {
  let db: NtGraphDb

  beforeEach(() => {
    db = createMockDb()
  })

  it("возвращает список вызываемых", () => {
    const target = createNode({ name: 'callerFunc', id: 'n1' })
    const callee = createNode({ name: 'calleeFunc', id: 'n2' })
    const outgoingEdge = createEdge('n1', 'n2', 'calls')

    vi.spyOn(db, 'getNodesByName').mockImplementation(() => [target])
    vi.spyOn(db, 'getNodeById').mockImplementation((id: string) => {
      if (id === 'n2') return callee
      return null
    })
    vi.spyOn(db, 'getOutgoingEdges').mockImplementation(() => [outgoingEdge])

    const result = calleesHandler(db, { symbol: 'callerFunc' })

    expect(result.isError).toBeUndefined()
    expect(result.content[0].text).toContain('calleeFunc')
  })
})

// =============================================================================
// filesHandler
// =============================================================================

describe("filesHandler", () => {
  let db: NtGraphDb

  beforeEach(() => {
    db = createMockDb()
  })

  it("фильтрует файлы по языку через pattern", () => {
    const files = [
      createFile({ path: 'src/a.ts', language: 'typescript' }),
      createFile({ path: 'src/b.js', language: 'javascript' }),
      createFile({ path: 'src/c.py', language: 'python' }),
    ]
    vi.spyOn(db, 'getAllFiles').mockImplementation(() => files)

    const result = filesHandler(db, { pattern: '*.ts', format: 'flat' })

    expect(result.content[0].text).toContain('a.ts')
    expect(result.content[0].text).not.toContain('b.js')
    expect(result.content[0].text).not.toContain('c.py')
  })

  it("возвращает иерархическое дерево в формате tree", () => {
    const files = [
      createFile({ path: 'src/a.ts' }),
      createFile({ path: 'src/b/c.ts' }),
      createFile({ path: 'src/b/d.ts' }),
    ]
    vi.spyOn(db, 'getAllFiles').mockImplementation(() => files)

    const result = filesHandler(db, { format: 'tree' })

    expect(result.content[0].text).toContain('src/')
    expect(result.content[0].text).toContain('b/')
  })

  it("фильтрует файлы по пути", () => {
    const files = [
      createFile({ path: 'src/a.ts' }),
      createFile({ path: 'lib/b.ts' }),
    ]
    vi.spyOn(db, 'getAllFiles').mockImplementation(() => files)

    const result = filesHandler(db, { path: 'src', format: 'flat' })

    expect(result.content[0].text).toContain('src/a.ts')
    expect(result.content[0].text).not.toContain('lib/b.ts')
  })

  it("группирует файлы по расширению", () => {
    const files = [
      createFile({ path: 'a.ts', language: 'typescript' }),
      createFile({ path: 'b.ts', language: 'typescript' }),
      createFile({ path: 'c.js', language: 'javascript' }),
    ]
    vi.spyOn(db, 'getAllFiles').mockImplementation(() => files)

    const result = filesHandler(db, { format: 'grouped' })

    expect(result.content[0].text).toContain('ts')
    expect(result.content[0].text).toContain('js')
  })
})

// =============================================================================
// statusHandler
// =============================================================================

describe("statusHandler", () => {
  let db: NtGraphDb

  beforeEach(() => {
    db = createMockDb()
  })

  it("возвращает статистику при свежем индексе", () => {
    vi.spyOn(db, 'getStats').mockImplementation(() => ({
      nodeCount: 1,
      edgeCount: 1,
      fileCount: 1,
      nodesByKind: { function: 1 },
      edgesByKind: { calls: 1 },
      filesByLanguage: { typescript: 1 },
      dbSizeBytes: 0,
      lastUpdated: Date.now(),
    }))

    const result = statusHandler(db)

    expect(result.isError).toBeUndefined()
    expect(result.content[0].text).toContain('Статистика индекса')
    expect(result.content[0].text).toContain('1')
  })

  it("возвращает статистику при устаревшем индексе", () => {
    vi.spyOn(db, 'getStats').mockImplementation(() => ({
      nodeCount: 10,
      edgeCount: 20,
      fileCount: 5,
      nodesByKind: {},
      edgesByKind: {},
      filesByLanguage: {},
      dbSizeBytes: 0,
      lastUpdated: Date.now(),
    }))

    const result = statusHandler(db)

    expect(result.isError).toBeUndefined()
    expect(result.content[0].text).toContain('Статистика индекса')
  })
})

// =============================================================================
// NotIndexedError
// =============================================================================

describe("NotIndexedError", () => {
  it("возвращает textResult без isError при NotIndexedError", () => {
    const err = new NotIndexedError()
    const result = textResult(err.message)

    expect(result.isError).toBeUndefined()
    expect(result.content[0].text).toContain('Индекс не доступен')
  })

  it("searchHandler возвращает ошибку при обращении к неинициализированной БД", () => {
    const result = searchHandler({} as any, { query: 'test' })

    expect(result.isError).toBe(true)
  })
})

// =============================================================================
// PathRefusalError
// =============================================================================

describe("PathRefusalError", () => {
  it("возвращает errorResult с isError: true при PathRefusalError", () => {
    const err = new PathRefusalError()
    const result = errorResult(err.message)

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Отказ по безопасности')
  })
})

// =============================================================================
// validateString
// =============================================================================

describe("validateString", () => {
  it("возвращает строку для валидного ввода", () => {
    const result = validateString('hello', 'query', 100)
    expect(result).toBe('hello')
  })

  it("бросает ошибку для нестрокового ввода", () => {
    expect(() => validateString(123, 'query', 100)).toThrow()
  })

  it("бросает ошибку для строки длиннее MAX_INPUT_LENGTH", () => {
    const longString = 'a'.repeat(MAX_INPUT_LENGTH + 1)
    expect(() => validateString(longString, 'query', MAX_INPUT_LENGTH)).toThrow()
  })

  it("возвращает строку при длине равной MAX_INPUT_LENGTH", () => {
    const exactString = 'a'.repeat(MAX_INPUT_LENGTH)
    const result = validateString(exactString, 'query', MAX_INPUT_LENGTH)
    expect(result.length).toBe(MAX_INPUT_LENGTH)
  })

  it("проверяет MAX_INPUT_LENGTH = 10000", () => {
    expect(MAX_INPUT_LENGTH).toBe(10000)
  })
})

// =============================================================================
// Output size limit
// =============================================================================

describe("MAX_OUTPUT_LENGTH truncation", () => {
  let db: NtGraphDb

  beforeEach(() => {
    db = createMockDb()
  })

  it("усекает вывод и добавляет заметку", () => {
    const longName = 'a'.repeat(500)
    const nodes = Array.from({ length: 50 }, (_, i) =>
      createNode({ name: `${longName}func${i}`, id: `n${i}` })
    )
    vi.spyOn(db, 'getNodesByName').mockImplementation(() => nodes)

    const result = searchHandler(db, { query: 'a' })

    expect(result.content[0].text.length).toBeLessThanOrEqual(MAX_OUTPUT_LENGTH + 50)
    if (result.content[0].text.length > MAX_OUTPUT_LENGTH) {
      expect(result.content[0].text).toContain('усечён')
    }
  })

  it("проверяет MAX_OUTPUT_LENGTH = 15000", () => {
    expect(MAX_OUTPUT_LENGTH).toBe(15000)
  })
})

// =============================================================================
// getExploreOutputBudget
// =============================================================================

describe("getExploreOutputBudget", () => {
  it("возвращает бюджет 13K для проекта < 150 файлов", () => {
    const budget = getExploreOutputBudget(100)

    expect(budget.maxOutputChars).toBe(13000)
    expect(budget.defaultMaxFiles).toBe(4)
    expect(budget.maxCharsPerFile).toBe(3800)
    expect(budget.gapThreshold).toBe(7)
    expect(budget.maxSymbolsInFileHeader).toBe(5)
    expect(budget.maxEdgesPerRelationshipKind).toBe(4)
    expect(budget.includeRelationships).toBe(false)
    expect(budget.includeAdditionalFiles).toBe(false)
    expect(budget.includeCompletenessSignal).toBe(false)
    expect(budget.includeBudgetNote).toBe(false)
    expect(budget.excludeLowValueFiles).toBe(true)
  })

  it("возвращает бюджет 18K для проекта 150–499 файлов", () => {
    const budget = getExploreOutputBudget(300)

    expect(budget.maxOutputChars).toBe(18000)
    expect(budget.defaultMaxFiles).toBe(5)
    expect(budget.gapThreshold).toBe(8)
    expect(budget.includeRelationships).toBe(false)
    expect(budget.excludeLowValueFiles).toBe(true)
  })

  it("возвращает бюджет 24K для проекта 500–4999 файлов", () => {
    const budget = getExploreOutputBudget(1000)

    expect(budget.maxOutputChars).toBe(24000)
    expect(budget.defaultMaxFiles).toBe(8)
    expect(budget.maxCharsPerFile).toBe(6500)
    expect(budget.gapThreshold).toBe(12)
    expect(budget.includeRelationships).toBe(true)
    expect(budget.includeAdditionalFiles).toBe(true)
    expect(budget.includeCompletenessSignal).toBe(true)
    expect(budget.includeBudgetNote).toBe(true)
    expect(budget.excludeLowValueFiles).toBe(false)
  })

  it("возвращает бюджет 24K для проекта >= 5000 файлов", () => {
    const budget = getExploreOutputBudget(6000)

    expect(budget.maxOutputChars).toBe(24000)
    expect(budget.defaultMaxFiles).toBe(8)
    expect(budget.maxCharsPerFile).toBe(7000)
    expect(budget.gapThreshold).toBe(15)
    expect(budget.maxSymbolsInFileHeader).toBe(15)
    expect(budget.maxEdgesPerRelationshipKind).toBe(15)
    expect(budget.includeRelationships).toBe(true)
    expect(budget.includeAdditionalFiles).toBe(true)
    expect(budget.excludeLowValueFiles).toBe(false)
  })

  it("возвращает правильный бюджет на границе 150", () => {
    const below = getExploreOutputBudget(149)
    const at = getExploreOutputBudget(150)

    expect(below.maxOutputChars).toBe(13000)
    expect(at.maxOutputChars).toBe(18000)
  })

  it("возвращает правильный бюджет на границе 500", () => {
    const below = getExploreOutputBudget(499)
    const at = getExploreOutputBudget(500)

    expect(below.maxOutputChars).toBe(18000)
    expect(at.maxOutputChars).toBe(24000)
  })

  it("возвращает правильный бюджет на границе 5000", () => {
    const below = getExploreOutputBudget(4999)
    const at = getExploreOutputBudget(5000)

    expect(below.maxCharsPerFile).toBe(6500)
    expect(at.maxCharsPerFile).toBe(7000)
    expect(below.gapThreshold).toBe(12)
    expect(at.gapThreshold).toBe(15)
  })
})

// =============================================================================
// Tiny-repo tool gating
// =============================================================================

describe("Tiny-repo tool gating", () => {
  it("TINY_REPO_FILE_THRESHOLD = 500", () => {
    expect(TINY_REPO_FILE_THRESHOLD).toBe(500)
  })

  it("TINY_REPO_CORE_TOOLS содержит только 3 инструмента", () => {
    expect(TINY_REPO_CORE_TOOLS.size).toBe(3)
    expect(TINY_REPO_CORE_TOOLS.has('ntgraph_explore')).toBe(true)
    expect(TINY_REPO_CORE_TOOLS.has('ntgraph_search')).toBe(true)
    expect(TINY_REPO_CORE_TOOLS.has('ntgraph_node')).toBe(true)
  })

  it("TINY_REPO_CORE_TOOLS не содержит ntgraph_files", () => {
    expect(TINY_REPO_CORE_TOOLS.has('ntgraph_files')).toBe(false)
  })

  it("TINY_REPO_CORE_TOOLS не содержит ntgraph_impact", () => {
    expect(TINY_REPO_CORE_TOOLS.has('ntgraph_impact')).toBe(false)
  })

  it("TINY_REPO_CORE_TOOLS не содержит ntgraph_callers", () => {
    expect(TINY_REPO_CORE_TOOLS.has('ntgraph_callers')).toBe(false)
  })
})
