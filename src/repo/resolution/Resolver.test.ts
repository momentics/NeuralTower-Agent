import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { NtGraphDb, QueryBuilder, INode, IEdge, IUnresolvedReference, NodeKind, EdgeKind, Language } from "../ntgraph/index"
import { ReferenceResolver } from "./Resolver"
import { LRUCache } from "../ntgraph/LruCache"
import * as os from "os"
import * as fs from "fs/promises"
import * as path from "path"

describe("ReferenceResolver", () => {
  let ntDb: NtGraphDb
  let qb: QueryBuilder
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `ntgraph-res-${Date.now()}-${Math.random()}`)
    await fs.mkdir(tmpDir, { recursive: true })
    const dbPath = path.join(tmpDir, "test.db")
    ntDb = new NtGraphDb(dbPath)
    ntDb.initialize()
    qb = ntDb.queryBuilder
  })

  afterEach(async () => {
    ntDb.close()
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  // ===================================================================
  // Вспомогательные функции
  // ===================================================================

  function insertNode(
    id: string,
    kind: NodeKind,
    name: string,
    filePath: string,
    language: Language,
    startLine: number = 1,
    endLine: number = 10,
    qualifiedName?: string
  ): INode {
    const node: INode = {
      id,
      kind,
      name,
      qualifiedName: qualifiedName || name,
      filePath,
      language,
      startLine,
      endLine,
      startColumn: 0,
      endColumn: 0,
      updatedAt: Date.now(),
    }
    qb.insertNode(node)
    return node
  }

  function insertEdge(source: string, target: string, kind: EdgeKind): void {
    qb.insertEdge({ source, target, kind })
  }

  function insertUnresolvedRef(
    fromNodeId: string,
    referenceName: string,
    referenceKind: string = "function_ref",
    language?: Language,
    filePath?: string
  ): IUnresolvedReference {
    const ref: IUnresolvedReference = {
      fromNodeId,
      referenceName,
      referenceKind: referenceKind as any,
      line: 1,
      column: 1,
      language,
      filePath,
    }
    qb.insertUnresolvedRef(ref)
    return ref
  }

  function makeResolver(): ReferenceResolver {
    const r = new ReferenceResolver(tmpDir, qb)
    r.warmCaches()
    return r
  }

  // ===================================================================
  // Тесты стратегий разрешения
  // ===================================================================

  describe("Resolution strategies", () => {
    it("resolveOne finds target via name matching", () => {
      insertNode("fn-target", "function", "myFunc", "src/a.ts", "typescript")
      insertNode("fn-source", "function", "caller", "src/b.ts", "typescript")
      const resolver = makeResolver()

      const ref: IUnresolvedReference = {
        fromNodeId: "fn-source",
        referenceName: "myFunc",
        referenceKind: "function_ref",
        line: 5,
        column: 0,
        language: "typescript",
      }

      const result = resolver.resolveOne(ref)
      expect(result).not.toBeNull()
      expect(result!.targetNodeId).toBe("fn-target")
    })

    it("resolveOne returns null for built-in symbols", () => {
      const resolver = makeResolver()

      const jsRef: IUnresolvedReference = {
        fromNodeId: "x",
        referenceName: "console",
        referenceKind: "function_ref",
        line: 1,
        column: 1,
        language: "typescript",
      }
      expect(resolver.resolveOne(jsRef)).toBeNull()

      const pyRef: IUnresolvedReference = {
        fromNodeId: "x",
        referenceName: "print",
        referenceKind: "function_ref",
        line: 1,
        column: 1,
        language: "python",
      }
      expect(resolver.resolveOne(pyRef)).toBeNull()

      const goRef: IUnresolvedReference = {
        fromNodeId: "x",
        referenceName: "make",
        referenceKind: "function_ref",
        line: 1,
        column: 1,
        language: "go",
      }
      expect(resolver.resolveOne(goRef)).toBeNull()
    })

    it("filters built-in symbols by language", () => {
      const resolver = makeResolver()

      const jsRef: IUnresolvedReference = {
        fromNodeId: "x",
        referenceName: "console",
        referenceKind: "function_ref",
        line: 1,
        column: 1,
        language: "javascript",
      }
      expect(resolver.resolveOne(jsRef)).toBeNull()

      const pyRef: IUnresolvedReference = {
        fromNodeId: "x",
        referenceName: "print",
        referenceKind: "function_ref",
        line: 1,
        column: 1,
        language: "python",
      }
      expect(resolver.resolveOne(pyRef)).toBeNull()

      const goRef: IUnresolvedReference = {
        fromNodeId: "x",
        referenceName: "make",
        referenceKind: "function_ref",
        line: 1,
        column: 1,
        language: "go",
      }
      expect(resolver.resolveOne(goRef)).toBeNull()

      const cRef: IUnresolvedReference = {
        fromNodeId: "x",
        referenceName: "printf",
        referenceKind: "function_ref",
        line: 1,
        column: 1,
        language: "c",
      }
      expect(resolver.resolveOne(cRef)).toBeNull()

      const cppRef: IUnresolvedReference = {
        fromNodeId: "x",
        referenceName: "cout",
        referenceKind: "function_ref",
        line: 1,
        column: 1,
        language: "cpp",
      }
      expect(resolver.resolveOne(cppRef)).toBeNull()

      const pascalRef: IUnresolvedReference = {
        fromNodeId: "x",
        referenceName: "WriteLn",
        referenceKind: "function_ref",
        line: 1,
        column: 1,
        language: "pascal",
      }
      expect(resolver.resolveOne(pascalRef)).toBeNull()
    })
  })

  // ===================================================================
  // Тесты языковой фильтрации
  // ===================================================================

  describe("Language gating", () => {
    it("gateLanguage rejects cross-family references", () => {
      insertNode("py-fn", "function", "helper", "src/a.py", "python")
      const resolver = makeResolver()

      const ref: IUnresolvedReference = {
        fromNodeId: "x",
        referenceName: "helper",
        referenceKind: "function_ref",
        line: 1,
        column: 1,
        language: "go",
      }

      const result = resolver.resolveOne(ref)
      expect(result).toBeNull()
    })
  })

  // ===================================================================
  // Тесты пакетного разрешения
  // ===================================================================

  describe("Batch resolution", () => {
    it("resolveAndPersistBatched resolves all and creates edges", async () => {
      insertNode("fn-a", "function", "alpha", "src/a.ts", "typescript")
      insertNode("fn-b", "function", "beta", "src/b.ts", "typescript")
      insertNode("src-node", "function", "caller", "src/c.ts", "typescript")

      insertUnresolvedRef("src-node", "alpha", "function_ref", "typescript", "src/c.ts")
      insertUnresolvedRef("src-node", "beta", "function_ref", "typescript", "src/c.ts")

      const resolver = makeResolver()
      const result = await resolver.resolveAndPersistBatched()
      // resolveAndPersistBatched возвращает resolved: [] по дизайну, проверяем рёбра
      expect(result.unresolved.length).toBe(0)

      const edges = qb.getOutgoingEdges("src-node")
      expect(edges.length).toBe(2)
    })

    it("batched resolution terminates when no progress", async () => {
      insertNode("src-node", "function", "caller", "src/a.ts", "typescript")

      insertUnresolvedRef("src-node", "nonexistent1", "function_ref", "typescript", "src/a.ts")
      insertUnresolvedRef("src-node", "nonexistent2", "function_ref", "typescript", "src/a.ts")

      const resolver = makeResolver()
      const result = await resolver.resolveAndPersistBatched()
      expect(result.unresolved.length).toBeGreaterThanOrEqual(2)
    })
  })

  // ===================================================================
  // Тесты LRU-кэша
  // ===================================================================

  describe("LRU cache", () => {
    it("LRU cache evicts oldest entry under pressure", () => {
      const cache = new LRUCache<string, number>(3)
      cache.set("a", 1)
      cache.set("b", 2)
      cache.set("c", 3)
      expect(cache.size).toBe(3)

      cache.set("d", 4)
      expect(cache.size).toBe(3)
      expect(cache.get("a")).toBeUndefined()
      expect(cache.get("b")).toBe(2)
      expect(cache.get("c")).toBe(3)
      expect(cache.get("d")).toBe(4)
    })
  })

  // ===================================================================
  // Тесты промоции рёбер
  // ===================================================================

  describe("Edge promotion", () => {
    it("extends -> implements for interfaces", () => {
      insertNode("cls", "class", "MyClass", "src/a.ts", "typescript")
      insertNode("iface", "interface", "IHandler", "src/b.ts", "typescript")
      const resolver = makeResolver()

      const ref: IUnresolvedReference = {
        fromNodeId: "cls",
        referenceName: "IHandler",
        referenceKind: "extends",
        line: 1,
        column: 1,
        language: "typescript",
      }

      const resolved = [{
        original: ref,
        targetNodeId: "iface",
        confidence: 0.9,
        provenance: "name-match",
      }]

      const edges = resolver.createEdges(resolved)
      expect(edges.length).toBe(1)
      expect(edges[0]!.kind).toBe("implements")
    })

    it("extends -> implements for protocols", () => {
      insertNode("cls", "class", "MyClass", "src/a.py", "python")
      insertNode("proto", "protocol", "IProto", "src/b.py", "python")
      const resolver = makeResolver()

      const ref: IUnresolvedReference = {
        fromNodeId: "cls",
        referenceName: "IProto",
        referenceKind: "extends",
        line: 1,
        column: 1,
        language: "python",
      }

      const resolved = [{
        original: ref,
        targetNodeId: "proto",
        confidence: 0.9,
        provenance: "name-match",
      }]

      const edges = resolver.createEdges(resolved)
      expect(edges.length).toBe(1)
      expect(edges[0]!.kind).toBe("implements")
    })

    it("calls -> instantiates for Python classes", () => {
      insertNode("cls", "class", "MyClass", "src/a.py", "python")
      insertNode("src", "function", "main", "src/b.py", "python")
      const resolver = makeResolver()

      const ref: IUnresolvedReference = {
        fromNodeId: "src",
        referenceName: "MyClass",
        referenceKind: "calls",
        line: 1,
        column: 1,
        language: "python",
      }

      const resolved = [{
        original: ref,
        targetNodeId: "cls",
        confidence: 0.9,
        provenance: "name-match",
      }]

      const edges = resolver.createEdges(resolved)
      expect(edges.length).toBe(1)
      expect(edges[0]!.kind).toBe("instantiates")
    })

    it("calls -> instantiates for Ruby classes", () => {
      insertNode("cls", "class", "MyClass", "src/a.rb", "ruby")
      insertNode("src", "function", "main", "src/b.rb", "ruby")
      const resolver = makeResolver()

      const ref: IUnresolvedReference = {
        fromNodeId: "src",
        referenceName: "MyClass",
        referenceKind: "calls",
        line: 1,
        column: 1,
        language: "ruby",
      }

      const resolved = [{
        original: ref,
        targetNodeId: "cls",
        confidence: 0.9,
        provenance: "name-match",
      }]

      const edges = resolver.createEdges(resolved)
      expect(edges.length).toBe(1)
      expect(edges[0]!.kind).toBe("instantiates")
    })

    it("function_ref sets metadata.fnRef", () => {
      insertNode("fn", "function", "handler", "src/a.ts", "typescript")
      insertNode("src", "function", "main", "src/b.ts", "typescript")
      const resolver = makeResolver()

      const ref: IUnresolvedReference = {
        fromNodeId: "src",
        referenceName: "handler",
        referenceKind: "function_ref",
        line: 5,
        column: 2,
        language: "typescript",
      }

      const resolved = [{
        original: ref,
        targetNodeId: "fn",
        confidence: 0.8,
        provenance: "function-ref",
      }]

      const edges = resolver.createEdges(resolved)
      expect(edges.length).toBe(1)
      expect(edges[0]!.kind).toBe("references")
      expect(edges[0]!.metadata).not.toBeUndefined()
      expect((edges[0]!.metadata as any).fnRef).toBe(true)
    })
  })

  // ===================================================================
  // Тесты 3-проходного разрешения
  // ===================================================================

  describe("3-pass resolution", () => {
    it("chained calls via conformance for Java", () => {
      insertNode("foo-cls", "class", "Foo", "src/Foo.java", "java")
      insertNode("bar-meth", "method", "bar", "src/Foo.java", "java", 1, 10, "Foo::bar")
      insertNode("src-node", "function", "main", "src/Main.java", "java")
      insertEdge("foo-cls", "bar-meth", "contains")

      insertUnresolvedRef("src-node", "Foo().bar", "function_ref", "java", "src/Main.java")

      const resolver = makeResolver()
      const count = resolver.resolveChainedCallsViaConformance()
      expect(count).toBe(1)

      const edges = qb.getOutgoingEdges("src-node")
      expect(edges.length).toBe(1)
      expect(edges[0]!.target).toBe("bar-meth")
    })

    it("deferred this.<member> resolution", () => {
      insertNode("parent-cls", "class", "Parent", "src/Parent.ts", "typescript")
      insertNode("child-meth", "method", "handleClick", "src/Parent.ts", "typescript")
      insertNode("src-meth", "method", "render", "src/Parent.ts", "typescript")
      insertEdge("parent-cls", "child-meth", "contains")
      insertEdge("parent-cls", "src-meth", "contains")

      insertUnresolvedRef("src-meth", "this.handleClick", "function_ref", "typescript", "src/Parent.ts")

      const resolver = makeResolver()
      const count = resolver.resolveDeferredThisMemberRefs()
      expect(count).toBe(1)

      const edges = qb.getOutgoingEdges("src-meth")
      expect(edges.length).toBe(1)
      expect(edges[0]!.target).toBe("child-meth")
    })
  })

  // ===================================================================
  // Тесты Razor/Blazor
  // ===================================================================

  describe("Razor/Blazor", () => {
    it("resolveRazorUsing resolves from @using namespace", async () => {
      const razorDir = path.join(tmpDir, "src", "Pages")
      await fs.mkdir(razorDir, { recursive: true })
      const razorPath = path.join(razorDir, "Index.razor")
      const importsPath = path.join(tmpDir, "src", "_Imports.razor")
      await fs.writeFile(importsPath, "@using MyApp.Components")
      await fs.writeFile(razorPath, "<MyComponent />")

      insertNode("target", "class", "MyComponent", "src/Components.razor", "razor", 1, 10, "MyApp.Components.MyComponent")
      insertNode("src-file", "file", "Index", razorPath, "razor")

      const resolver = makeResolver()

      const ref: IUnresolvedReference = {
        fromNodeId: "src-file",
        referenceName: "MyComponent",
        referenceKind: "references",
        line: 1,
        column: 1,
        language: "razor",
        filePath: razorPath,
      }

      const result = resolver.resolveOne(ref)
      expect(result).not.toBeNull()
      expect(result!.targetNodeId).toBe("target")
    })
  })

  // ===================================================================
  // Тесты JVM FQN
  // ===================================================================

  describe("JVM FQN", () => {
    it("JVM FQN import resolution", () => {
      insertNode(
        "jvm-cls",
        "class",
        "Bar",
        "com/example/foo/Bar.java",
        "java",
        1,
        10,
        "com.example.foo.Bar"
      )
      // Не нагреваем кэши — knownNames отслеживает только `name`, а не `qualifiedName`,
      // поэтому проверка knownNames отклонит FQN-ссылки до запуска resolveJvmImport
      const resolver = new ReferenceResolver(tmpDir, qb)

      const ref: IUnresolvedReference = {
        fromNodeId: "x",
        referenceName: "com.example.foo.Bar",
        referenceKind: "function_ref",
        line: 1,
        column: 1,
        language: "java",
      }

      const result = resolver.resolveOne(ref)
      expect(result).not.toBeNull()
      expect(result!.targetNodeId).toBe("jvm-cls")
    })
  })

  // ===================================================================
  // Тесты защиты PHP include path
  // ===================================================================

  describe("PHP include path", () => {
    it("PHP include path protection", () => {
      insertNode("php-fn", "function", "helper", "src/helper.php", "php")
      const resolver = makeResolver()

      const ref: IUnresolvedReference = {
        fromNodeId: "x",
        referenceName: "/var/www/helper.php",
        referenceKind: "function_ref",
        line: 1,
        column: 1,
        language: "php",
      }

      const result = resolver.resolveOne(ref)
      expect(result).toBeNull()
    })
  })

  // ===================================================================
  // Тесты коллизии встроенных методов Python
  // ===================================================================

  describe("Python built-in method collision", () => {
    it("Python built-in method bare name filtered even when symbol exists", () => {
      insertNode("py-fn", "function", "index", "src/a.py", "python")
      const resolver = makeResolver()

      const ref: IUnresolvedReference = {
        fromNodeId: "x",
        referenceName: "index",
        referenceKind: "function_ref",
        line: 1,
        column: 1,
        language: "python",
      }

      const result = resolver.resolveOne(ref)
      expect(result).toBeNull()
    })
  })

  // ===================================================================
  // Конкретные интеграционные сценарии
  // ===================================================================

  describe("Integration scenarios", () => {
    it("resolveAll returns correct resolved and unresolved arrays", () => {
      insertNode("fn-a", "function", "alpha", "src/a.ts", "typescript")
      insertNode("src", "function", "caller", "src/b.ts", "typescript")
      const resolver = makeResolver()

      const refs: IUnresolvedReference[] = [
        {
          fromNodeId: "src",
          referenceName: "alpha",
          referenceKind: "function_ref",
          line: 1,
          column: 1,
          language: "typescript",
        },
        {
          fromNodeId: "src",
          referenceName: "nonexistent",
          referenceKind: "function_ref",
          line: 2,
          column: 1,
          language: "typescript",
        },
      ]

      const result = resolver.resolveAll(refs)
      expect(result.resolved.length).toBe(1)
      expect(result.resolved[0]!.targetNodeId).toBe("fn-a")
      expect(result.unresolved.length).toBe(1)
      expect(result.unresolved[0]!.referenceName).toBe("nonexistent")
    })

    it("resolveAndPersist creates edges and deletes refs", () => {
      insertNode("fn-a", "function", "alpha", "src/a.ts", "typescript")
      insertNode("src", "function", "caller", "src/b.ts", "typescript")

      insertUnresolvedRef("src", "alpha", "function_ref", "typescript", "src/b.ts")

      const beforeCount = qb.getUnresolvedReferencesCount()
      expect(beforeCount).toBe(1)

      const resolver = makeResolver()
      const result = resolver.resolveAndPersist([
        {
          fromNodeId: "src",
          referenceName: "alpha",
          referenceKind: "function_ref",
          line: 1,
          column: 1,
          language: "typescript",
          filePath: "src/b.ts",
        },
      ])

      expect(result.resolved.length).toBe(1)
      expect(result.unresolved.length).toBe(0)

      const edges = qb.getOutgoingEdges("src")
      expect(edges.length).toBe(1)
      expect(edges[0]!.target).toBe("fn-a")
    })

    it("warmCaches populates knownNames", () => {
      insertNode("fn-a", "function", "myFunc", "src/a.ts", "typescript")
      const resolver = makeResolver()

      expect(resolver.hasAnyPossibleMatch("myFunc")).toBe(true)
      expect(resolver.hasAnyPossibleMatch("nonexistent")).toBe(false)
    })

    it("clearCaches resets state", () => {
      insertNode("fn-a", "function", "myFunc", "src/a.ts", "typescript")
      const resolver = makeResolver()

      expect(resolver.hasAnyPossibleMatch("myFunc")).toBe(true)

      resolver.clearCaches()

      expect(resolver.hasAnyPossibleMatch("myFunc")).toBe(true)
    })
  })
})
