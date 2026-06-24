/**
 * Тесты Utils.
 *
 * Проверяют: конвертеры строк БД, строковые утилиты, парсер запросов,
 * классификаторы файлов, безопасность путей, boundedEditDistance,
 * асинхронные утилиты, мониторинг памяти.
 */

import { describe, it, expect } from "vitest"
import {
  rowToNode,
  rowToEdge,
  rowToFileRecord,
  safeJsonParse,
  normalizeNameToken,
  getStemVariants,
  extractSearchTerms,
  unquote,
  boundedEditDistance,
  kindBonus,
  nameMatchBonus,
  scorePathRelevance,
  isLowValueFile,
  isTestFile,
  isGeneratedFile,
  isDistinctiveIdentifier,
  isConfigLeafNode,
  parseQuery,
  normalizePath,
  clamp,
  Mutex,
  FileLock,
  MemoryMonitor,
  estimateSize,
  debounce,
  throttle,
} from "./Utils"

describe("Utils", () => {
  // ---- Конвертеры ----

  it("rowToNode converts snake_case to camelCase", () => {
    const row = {
      id: "n1",
      kind: "function",
      name: "hello",
      qualified_name: "hello",
      file_path: "src/main.ts",
      language: "typescript",
      start_line: 1,
      end_line: 5,
      start_column: 0,
      end_column: 10,
      docstring: null,
      signature: "function hello()",
      visibility: null,
      is_exported: 1,
      is_async: 0,
      is_static: 0,
      is_abstract: 0,
      decorators: null,
      type_parameters: null,
      return_type: null,
      updated_at: 123,
    }
    const node = rowToNode(row)
    expect(node.id).toBe("n1")
    expect(node.kind).toBe("function")
    expect(node.filePath).toBe("src/main.ts")
    expect(node.isExported).toBe(true)
    expect(node.isAsync).toBe(false)
    expect(node.signature).toBe("function hello()")
  })

  it("rowToEdge converts snake_case to camelCase", () => {
    const row = {
      id: 1,
      source: "n1",
      target: "n2",
      kind: "calls",
      metadata: '{"foo":"bar"}',
      line: 10,
      col: 5,
      provenance: "lsp",
    }
    const edge = rowToEdge(row)
    expect(edge.source).toBe("n1")
    expect(edge.target).toBe("n2")
    expect(edge.kind).toBe("calls")
    expect(edge.metadata).toEqual({ foo: "bar" })
    expect(edge.line).toBe(10)
    expect(edge.column).toBe(5)
  })

  it("rowToFileRecord converts snake_case to camelCase", () => {
    const row = {
      path: "src/main.ts",
      content_hash: "abc",
      language: "typescript",
      size: 100,
      modified_at: 123,
      indexed_at: 456,
      node_count: 5,
      errors: null,
    }
    const record = rowToFileRecord(row)
    expect(record.path).toBe("src/main.ts")
    expect(record.contentHash).toBe("abc")
    expect(record.nodeCount).toBe(5)
  })

  it("safeJsonParse returns fallback on invalid JSON", () => {
    expect(safeJsonParse(null, "default")).toBe("default")
    expect(safeJsonParse("not json", "default")).toBe("default")
    expect(safeJsonParse('{"a":1}', "default")).toEqual({ a: 1 })
  })

  // ---- Строковые утилиты ----

  it("normalizeNameToken lowercases and strips non-alphanumeric", () => {
    expect(normalizeNameToken("Hello_World!")).toBe("helloworld")
  })

  it("getStemVariants generates suffix variants", () => {
    const variants = getStemVariants("handling")
    expect(variants).toContain("handling")
    expect(variants).toContain("handl")
  })

  it("getStemVariants handles -ies special case", () => {
    const variants = getStemVariants("cities")
    expect(variants).toContain("cit")
    expect(variants).toContain("city")
  })

  it("extractSearchTerms splits camelCase", () => {
    const terms = extractSearchTerms("handleRequest")
    expect(terms).toContain("handle")
    expect(terms).toContain("request")
  })

  it("extractSearchTerms splits snake_case", () => {
    const terms = extractSearchTerms("handle_request")
    expect(terms).toContain("handle")
    expect(terms).toContain("request")
  })

  it("extractSearchTerms splits dot notation", () => {
    const terms = extractSearchTerms("User.getName")
    expect(terms).toContain("user")
    expect(terms).toContain("get")
    expect(terms).toContain("name")
  })

  it("unquote removes surrounding quotes", () => {
    expect(unquote('"hello"')).toBe("hello")
    expect(unquote("hello")).toBe("hello")
  })

  it("boundedEditDistance returns correct distance", () => {
    expect(boundedEditDistance("kitten", "sitting", 5)).toBe(3)
    expect(boundedEditDistance("abc", "abc", 1)).toBe(0)
  })

  it("boundedEditDistance early exits on maxDist exceeded", () => {
    expect(boundedEditDistance("aaaa", "bbbb", 1)).toBeGreaterThan(1)
  })

  // ---- Поиск ----

  it("kindBonus returns higher for functions", () => {
    expect(kindBonus("function")).toBe(10)
    expect(kindBonus("method")).toBe(10)
    expect(kindBonus("class")).toBe(8)
    expect(kindBonus("file")).toBe(3)
  })

  it("nameMatchBonus gives exact match highest score", () => {
    expect(nameMatchBonus("hello", "hello")).toBe(30)
    expect(nameMatchBonus("hello", "helloWorld")).toBe(20)
    expect(nameMatchBonus("hello", "sayHello")).toBe(10)
    expect(nameMatchBonus("hello", "goodbye")).toBe(0)
  })

  it("scorePathRelevance gives score for matching path", () => {
    const score = scorePathRelevance("src/handle.ts", "handle", new Set())
    expect(score).toBeGreaterThan(0)
  })

  it("scorePathRelevance penalizes low value files", () => {
    const score = scorePathRelevance("src/test/handle.ts", "handle", new Set())
    expect(score).toBeLessThan(0)
  })

  it("scorePathRelevance ignores project name tokens", () => {
    const score = scorePathRelevance("src/neural.ts", "neural", new Set(["neural"]))
    expect(score).toBe(0)
  })

  // ---- Классификаторы ----

  it("isLowValueFile detects test files", () => {
    expect(isLowValueFile("src/__tests__/main.ts")).toBe(true)
    expect(isLowValueFile("src/main.test.ts")).toBe(true)
    expect(isLowValueFile("src/main.ts")).toBe(false)
  })

  it("isTestFile detects test patterns", () => {
    expect(isTestFile("src/main.test.ts")).toBe(true)
    expect(isTestFile("src/main.spec.ts")).toBe(true)
    expect(isTestFile("src/utils_test.go")).toBe(true)
    expect(isTestFile("src/utils_test.py")).toBe(true)
    expect(isTestFile("src/test_main.py")).toBe(true)
    expect(isTestFile("src/main.ts")).toBe(false)
  })

  it("isGeneratedFile detects generated patterns", () => {
    expect(isGeneratedFile("src/generated/code.ts")).toBe(true)
    expect(isGeneratedFile("src/foo.pb.ts")).toBe(true)
    expect(isGeneratedFile("src/.next/app.js")).toBe(true)
    expect(isGeneratedFile("src/main.ts")).toBe(false)
  })

  it("isDistinctiveIdentifier detects special identifiers", () => {
    expect(isDistinctiveIdentifier("get_user")).toBe(true)
    expect(isDistinctiveIdentifier("user2")).toBe(true)
    expect(isDistinctiveIdentifier("getUser")).toBe(true)
    expect(isDistinctiveIdentifier("hello")).toBe(false)
  })

  it("isConfigLeafNode detects YAML/properties constants", () => {
    const yamlNode = { kind: "constant", language: "yaml" } as any
    expect(isConfigLeafNode(yamlNode)).toBe(true)
    const tsNode = { kind: "constant", language: "typescript" } as any
    expect(isConfigLeafNode(tsNode)).toBe(false)
  })

  // ---- Парсер запросов ----

  it("parseQuery extracts kind filter", () => {
    const result = parseQuery("kind:function hello")
    expect(result.kinds).toContain("function")
    expect(result.text).toBe("hello")
  })

  it("parseQuery extracts lang filter", () => {
    const result = parseQuery("lang:typescript hello")
    expect(result.languages).toContain("typescript")
    expect(result.text).toBe("hello")
  })

  it("parseQuery extracts path filter", () => {
    const result = parseQuery("path:src hello")
    expect(result.pathFilters).toContain("src")
    expect(result.text).toBe("hello")
  })

  it("parseQuery extracts name filter", () => {
    const result = parseQuery("name:hello world")
    expect(result.nameFilters).toContain("hello")
    expect(result.text).toBe("world")
  })

  it("parseQuery handles quoted values", () => {
    const result = parseQuery('kind:"function,method" hello')
    expect(result.kinds).toContain("function")
    expect(result.kinds).toContain("method")
  })

  it("parseQuery skips unknown fields", () => {
    const result = parseQuery("unknown:foo hello")
    expect(result.text).toBe("unknown:foo hello")
  })

  it("parseQuery skips empty values", () => {
    const result = parseQuery("kind: hello")
    expect(result.kinds.length).toBe(0)
    expect(result.text).toBe("hello")
  })

  // ---- Пути ----

  it("normalizePath converts backslashes to forward slashes", () => {
    expect(normalizePath("src\\main.ts")).toBe("src/main.ts")
    expect(normalizePath("src//main.ts")).toBe("src/main.ts")
  })

  // ---- Числовые утилиты ----

  it("clamp clamps value to range", () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-5, 0, 10)).toBe(0)
    expect(clamp(15, 0, 10)).toBe(10)
  })

  // ---- Асинхронные утилиты ----

  it("Mutex serializes access", async () => {
    const mutex = new Mutex()
    let order: number[] = []
    const release = await mutex.acquire()
    order.push(1)
    expect(mutex.isLocked()).toBe(true)
    release()
    expect(mutex.isLocked()).toBe(false)

    const p1 = mutex.withLock(async () => {
      order.push(2)
      await new Promise((r) => setTimeout(r, 50))
      order.push(3)
    })
    const p2 = mutex.withLock(async () => {
      order.push(4)
    })
    await Promise.all([p1, p2])
    expect(order.indexOf(2)).toBeLessThan(order.indexOf(4))
  })

  it("FileLock acquires and releases", async () => {
    const lock = new FileLock("/tmp/ntgraph-test-lock")
    const acquired = await lock.acquire()
    expect(acquired).toBe(true)
    lock.release()
  })

  it("FileLock prevents double acquire", async () => {
    const lock = new FileLock("/tmp/ntgraph-test-lock2")
    await lock.acquire()
    const lock2 = new FileLock("/tmp/ntgraph-test-lock2")
    const acquired = await lock2.acquire()
    expect(acquired).toBe(false)
    lock.release()
  })

  // ---- Память ----

  it("estimateSize returns positive for objects", () => {
    expect(estimateSize({ a: 1, b: "hello" })).toBeGreaterThan(0)
  })

  it("estimateSize returns 0 for null", () => {
    expect(estimateSize(null)).toBe(0)
  })

  it("MemoryMonitor triggers on threshold", () => {
    let triggered = false
    const monitor = new MemoryMonitor(1, () => {
      triggered = true
    })
    monitor.check()
    expect(triggered).toBe(true)
  })

  it("MemoryMonitor reset allows re-check", () => {
    let count = 0
    const monitor = new MemoryMonitor(1, () => {
      count++
    })
    monitor.check()
    monitor.check()
    expect(count).toBe(1)
    monitor.reset()
    monitor.check()
    expect(count).toBe(2)
  })

  // ---- Дебаунс / троттлинг ----

  it("debounce delays execution", async () => {
    let called = false
    const fn = debounce(() => {
      called = true
    }, 50)
    fn()
    expect(called).toBe(false)
    await new Promise((r) => setTimeout(r, 60))
    expect(called).toBe(true)
  })

  it("throttle limits execution rate", () => {
    let count = 0
    const fn = throttle(() => {
      count++
    }, 50)
    fn()
    fn()
    fn()
    expect(count).toBe(1)
  })
})
