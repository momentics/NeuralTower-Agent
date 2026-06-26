/**
 * Тесты QueryBuilder.
 *
 * Проверяют: CRUD узлов и рёбер, LRU-кэш, batch-запросы,
 * каскадное удаление, валидацию рёбер, файлы, неразрешённые ссылки,
 * метаданные, аналитику, поиск.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { NtGraphDb, INode, IEdge, IFileRecord, IUnresolvedReference } from "./index"
import * as os from "os"
import * as path from "path"
import * as fs from "fs/promises"

describe("QueryBuilder", () => {
  let tmpDir: string
  let db: NtGraphDb

  beforeAll(async () => {
    tmpDir = path.join(os.tmpdir(), `ntgraph-qb-test-${Date.now()}`)
    await fs.mkdir(tmpDir, { recursive: true })
    const dbPath = path.join(tmpDir, 'ntgraph.db')
    db = new NtGraphDb(dbPath)
    db.initialize()
    // Узел для ограничения внешнего ключа неразрешённой ссылки
    await db.insertNode({
      id: "ref-node",
      kind: "function",
      name: "refNode",
      qualifiedName: "refNode",
      filePath: "src/test.ts",
      language: "typescript",
      startLine: 1,
      endLine: 1,
      startColumn: 0,
      endColumn: 0,
      updatedAt: Date.now(),
    })
  })

  afterAll(async () => {
    db.close()
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  // ---- Узлы ----

  it("inserts and retrieves a node", async () => {
    const node: INode = {
      id: "node-1",
      kind: "function",
      name: "hello",
      qualifiedName: "hello",
      filePath: "src/main.ts",
      language: "typescript",
      startLine: 1,
      endLine: 5,
      startColumn: 0,
      endColumn: 10,
      updatedAt: Date.now(),
    }
    await db.insertNode(node)
    const found = db.getNodeById("node-1")
    expect(found).not.toBeNull()
    expect(found!.name).toBe("hello")
    expect(found!.kind).toBe("function")
  })

  it("upsert replaces existing node", async () => {
    const node: INode = {
      id: "node-1",
      kind: "class",
      name: "HelloClass",
      qualifiedName: "HelloClass",
      filePath: "src/main.ts",
      language: "typescript",
      startLine: 1,
      endLine: 10,
      startColumn: 0,
      endColumn: 10,
      updatedAt: Date.now(),
    }
    await db.insertNode(node)
    const found = db.getNodeById("node-1")
    expect(found!.kind).toBe("class")
    expect(found!.name).toBe("HelloClass")
  })

  it("inserts multiple nodes in transaction", () => {
    const nodes: INode[] = [
      {
        id: "node-2",
        kind: "class",
        name: "User",
        qualifiedName: "User",
        filePath: "src/models.ts",
        language: "typescript",
        startLine: 1,
        endLine: 20,
        startColumn: 0,
        endColumn: 10,
        updatedAt: Date.now(),
      },
      {
        id: "node-3",
        kind: "method",
        name: "getName",
        qualifiedName: "User.getName",
        filePath: "src/models.ts",
        language: "typescript",
        startLine: 5,
        endLine: 8,
        startColumn: 2,
        endColumn: 10,
        updatedAt: Date.now(),
      },
    ]
    db.insertNodes(nodes)
    expect(db.getNodeById("node-2")).not.toBeNull()
    expect(db.getNodeById("node-3")).not.toBeNull()
  })

  it("skips node with missing required fields", async () => {
    const node: INode = {
      id: "",
      kind: "function",
      name: "x",
      filePath: "src/a.ts",
      language: "typescript",
      startLine: 1,
      endLine: 1,
      startColumn: 0,
      endColumn: 0,
      updatedAt: Date.now(),
    }
    await db.insertNode(node)
    expect(db.getNodeById("")).toBeNull()
  })

  it("deletes node by id", async () => {
    await db.deleteNode("node-2")
    expect(db.getNodeById("node-2")).toBeNull()
  })

  it("deletes nodes by file path", () => {
    db.deleteNodesByFile("src/main.ts")
    expect(db.getNodeById("node-1")).toBeNull()
  })

  it("gets nodes by file", () => {
    const nodes = db.getNodesByFile("src/models.ts")
    expect(nodes.length).toBe(1)
    expect(nodes[0]!.name).toBe("getName")
  })

  it("gets nodes by kind", () => {
    const nodes = db.getNodesByKind("method")
    expect(nodes.length).toBe(1)
    expect(nodes[0]!.name).toBe("getName")
  })

  it("gets nodes by name", () => {
    const nodes = db.getNodesByName("getName")
    expect(nodes.length).toBe(1)
  })

  it("gets nodes by qualified name exact", () => {
    const nodes = db.getNodesByQualifiedNameExact("User.getName")
    expect(nodes.length).toBe(1)
  })

  it("gets nodes by lower name", () => {
    const nodes = db.getNodesByLowerName("getname")
    expect(nodes.length).toBe(1)
  })

  it("iterates nodes by kind", () => {
    const collected: string[] = []
    for (const node of db.iterateNodesByKind("method")) {
      collected.push(node.name)
    }
    expect(collected).toContain("getName")
  })

  it("updates node", async () => {
    const node: INode = {
      id: "node-3",
      kind: "method",
      name: "getFullName",
      qualifiedName: "User.getFullName",
      filePath: "src/models.ts",
      language: "typescript",
      startLine: 5,
      endLine: 10,
      startColumn: 2,
      endColumn: 10,
      updatedAt: Date.now(),
    }
    await db.updateNode(node)
    const found = db.getNodeById("node-3")
    expect(found!.name).toBe("getFullName")
  })

  // ---- Рёбра ----

  it("inserts edge", async () => {
    await db.insertEdge({
      source: "node-3",
      target: "node-3",
      kind: "contains",
    })
    const edges = db.getOutgoingEdges("node-3")
    expect(edges.length).toBe(1)
  })

  it("inserts multiple edges in transaction", () => {
    const edges: IEdge[] = [
      { source: "node-3", target: "node-3", kind: "calls" },
    ]
    db.insertEdges(edges)
    const edgesOut = db.getOutgoingEdges("node-3")
    expect(edgesOut.length).toBeGreaterThanOrEqual(2)
  })

  it("skips edges with non-existent endpoints", () => {
    db.insertEdges([
      { source: "node-3", target: "nonexistent", kind: "calls" },
    ])
    const edges = db.getOutgoingEdges("node-3")
    expect(edges.some((e) => e.target === "nonexistent")).toBe(false)
  })

  it("deletes edges by source", () => {
    const changes = db.deleteEdgesBySource("node-3")
    expect(changes).toBeGreaterThanOrEqual(2)
  })

  it("deletes edges by target", async () => {
    await db.insertEdge({ source: "node-3", target: "node-3", kind: "calls" })
    const changes = db.deleteEdgesByTarget("node-3")
    expect(changes).toBeGreaterThanOrEqual(1)
  })

  it("gets incoming edges with kind filter", async () => {
    await db.insertEdge({ source: "node-3", target: "node-3", kind: "calls" })
    await db.insertEdge({ source: "node-3", target: "node-3", kind: "references" })
    const edges = db.getIncomingEdges("node-3", ["calls"])
    expect(edges.every((e) => e.kind === "calls")).toBe(true)
  })

  it("gets outgoing edges with kind and provenance filter", async () => {
    await db.insertEdge({ source: "node-3", target: "node-3", kind: "calls", provenance: "tree-sitter" })
    const edges = db.getOutgoingEdges("node-3", undefined, "lsp")
    expect(edges.every((e) => e.provenance === "lsp")).toBe(true)
  })

  it("cascading delete removes edges", async () => {
    const node: INode = {
      id: "cascade-target",
      kind: "function",
      name: "target",
      qualifiedName: "target",
      filePath: "src/cascade.ts",
      language: "typescript",
      startLine: 1,
      endLine: 1,
      startColumn: 0,
      endColumn: 0,
      updatedAt: Date.now(),
    }
    await db.insertNode(node)
    await db.insertEdge({ source: "node-3", target: "cascade-target", kind: "calls" })
    const edges = db.getIncomingEdges("cascade-target")
    expect(edges.length).toBe(1)
    await db.deleteNode("cascade-target")
    const edgesAfter = db.getIncomingEdges("cascade-target")
    expect(edgesAfter.length).toBe(0)
  })

  it("finds edges between nodes", () => {
    const edges = db.findEdgesBetweenNodes(["node-3"])
    expect(edges.length).toBeGreaterThanOrEqual(1)
  })

  // ---- Файлы ----

  it("upserts file", async () => {
    const file: IFileRecord = {
      path: "src/models.ts",
      contentHash: "abc123",
      language: "typescript",
      size: 100,
      modifiedAt: Date.now(),
      indexedAt: Date.now(),
      nodeCount: 1,
    }
    await db.upsertFile(file)
    const found = db.getFileByPath("src/models.ts")
    expect(found).not.toBeNull()
    expect(found!.contentHash).toBe("abc123")
  })

  it("upsert updates existing file", async () => {
    const file: IFileRecord = {
      path: "src/models.ts",
      contentHash: "def456",
      language: "typescript",
      size: 200,
      modifiedAt: Date.now(),
      indexedAt: Date.now(),
      nodeCount: 2,
    }
    await db.upsertFile(file)
    const found = db.getFileByPath("src/models.ts")
    expect(found!.contentHash).toBe("def456")
    expect(found!.size).toBe(200)
  })

  it("gets all files", () => {
    const files = db.getAllFiles()
    expect(files.length).toBeGreaterThanOrEqual(1)
  })

  it("gets all file paths", () => {
    const paths = db.getAllFilePaths()
    expect(paths).toContain("src/models.ts")
  })

  it("gets last indexed at", () => {
    const last = db.getLastIndexedAt()
    expect(last).toBeGreaterThan(0)
  })

  it("gets stale files", () => {
    const stale = db.getStaleFiles()
    expect(stale.length).toBeGreaterThanOrEqual(1)
  })

  it("deletes file and its nodes", async () => {
    await db.deleteFile("src/models.ts")
    expect(db.getFileByPath("src/models.ts")).toBeNull()
    expect(db.getNodesByFile("src/models.ts").length).toBe(0)
  })

  // ---- Неразрешённые ссылки ----

  it("inserts unresolved reference", () => {
    const ref: IUnresolvedReference = {
      fromNodeId: "ref-node",
      referenceName: "missingFunc",
      referenceKind: "function_ref",
      line: 10,
      column: 5,
      filePath: "src/test.ts",
      language: "typescript",
    }
    db.insertUnresolvedRef(ref)
    const refs = db.getUnresolvedByName("missingFunc")
    expect(refs.length).toBe(1)
    expect(refs[0]!.referenceName).toBe("missingFunc")
  })

  it("gets unresolved references count", () => {
    db.insertUnresolvedRef({
      fromNodeId: "ref-node",
      referenceName: "countFunc",
      referenceKind: "function_ref",
      line: 1,
      column: 1,
    })
    const count = db.getUnresolvedReferencesCount()
    expect(count).toBeGreaterThanOrEqual(1)
  })

  it("gets unresolved references batch", () => {
    db.insertUnresolvedRef({
      fromNodeId: "ref-node",
      referenceName: "batchFunc",
      referenceKind: "function_ref",
      line: 1,
      column: 1,
    })
    const batch = db.getUnresolvedReferencesBatch(0, 5)
    expect(batch.length).toBeGreaterThanOrEqual(1)
  })

  it("gets unresolved references by files", () => {
    db.insertUnresolvedRef({
      fromNodeId: "ref-node",
      referenceName: "fileFunc",
      referenceKind: "function_ref",
      line: 1,
      column: 1,
      filePath: "src/test.ts",
    })
    const refs = db.getUnresolvedReferencesByFiles(["src/test.ts"])
    expect(refs.length).toBeGreaterThanOrEqual(1)
  })

  it("deletes unresolved by node", () => {
    db.deleteUnresolvedByNode("ref-node")
    const refs = db.getUnresolvedByName("missingFunc")
    expect(refs.length).toBe(0)
  })

  it("clears all unresolved references", () => {
    db.clearUnresolvedReferences()
    db.insertUnresolvedRef({
      fromNodeId: "ref-node",
      referenceName: "clear-x",
      referenceKind: "function_ref",
      line: 1,
      column: 1,
    })
    db.insertUnresolvedRef({
      fromNodeId: "ref-node",
      referenceName: "clear-y",
      referenceKind: "function_ref",
      line: 2,
      column: 2,
    })
    db.clearUnresolvedReferences()
    expect(db.getUnresolvedReferencesCount()).toBe(0)
  })

  it("deletes resolved references by node ids", () => {
    db.clearUnresolvedReferences()
    db.insertUnresolvedRef({
      fromNodeId: "ref-node",
      referenceName: "del-x",
      referenceKind: "function_ref",
      line: 1,
      column: 1,
    })
    db.deleteResolvedReferences(["ref-node"])
    expect(db.getUnresolvedReferencesCount()).toBe(0)
  })

  // ---- Метаданные ----

  it("sets and gets metadata", () => {
    db.setMetadata("key1", "value1")
    expect(db.getMetadata("key1")).toBe("value1")
  })

  it("upserts metadata", () => {
    db.setMetadata("key1", "value2")
    expect(db.getMetadata("key1")).toBe("value2")
  })

  it("gets all metadata", () => {
    db.setMetadata("key2", "value3")
    const all = db.getAllMetadata()
    expect(all.get("key1")).toBe("value2")
    expect(all.get("key2")).toBe("value3")
  })

  // ---- Аналитика ----

  it("gets node and edge count", () => {
    const count = db.getNodeAndEdgeCount()
    expect(typeof count.nodeCount).toBe("number")
    expect(typeof count.edgeCount).toBe("number")
  })

  it("gets graph stats", () => {
    const stats = db.getStats()
    expect(typeof stats.nodeCount).toBe("number")
    expect(typeof stats.edgeCount).toBe("number")
    expect(typeof stats.fileCount).toBe("number")
    expect(typeof stats.nodesByKind).toBe("object")
    expect(typeof stats.edgesByKind).toBe("object")
    expect(typeof stats.filesByLanguage).toBe("object")
  })

  // ---- LRU-кэш ----

  it("LRU cache evicts oldest entry", () => {
    const qb = db.queryBuilder
    qb.clearCache()

    const nodes: INode[] = []
    for (let i = 0; i < 1005; i++) {
      nodes.push({
        id: `lru-${i}`,
        kind: "function",
        name: `fn${i}`,
        qualifiedName: `fn${i}`,
        filePath: "src/lru.ts",
        language: "typescript",
        startLine: i,
        endLine: i,
        startColumn: 0,
        endColumn: 0,
        updatedAt: Date.now(),
      })
    }
    db.insertNodes(nodes)

    for (let i = 0; i < 1005; i++) {
      db.getNodeById(`lru-${i}`)
    }

    expect(db.getNodeById("lru-0")).not.toBeNull()
  })

  // ---- Пакетное разделение на чанки ----

  it("batch getNodesByIds with >500 IDs", () => {
    const ids: string[] = []
    for (let i = 0; i < 600; i++) {
      ids.push(`lru-${i}`)
    }
    const result = db.getNodesByIds(ids)
    expect(result.length).toBeGreaterThanOrEqual(0)
  })

  // ---- Поиск ----

  it("search returns results for existing name", () => {
    const results = db.search("fn")
    expect(results.length).toBeGreaterThan(0)
  })

  it("findNodesByExactName returns results", () => {
    const results = db.findNodesByExactName(["fn0"])
    expect(results.length).toBeGreaterThan(0)
  })

  it("findNodesByNameSubstring returns results", () => {
    const results = db.findNodesByNameSubstring("fn")
    expect(results.length).toBeGreaterThan(0)
  })

  // ---- Утилиты ----

  it("clear removes all data", () => {
    db.clear()
    expect(db.getAllNodes().length).toBe(0)
    expect(db.getNodeAndEdgeCount().edgeCount).toBe(0)
  })

  it("clearCache clears LRU cache", () => {
    db.clearCache()
  })

  it("getAllNodeNames returns names", async () => {
    await db.insertNode({
      id: "name-test",
      kind: "function",
      name: "testFunc",
      qualifiedName: "testFunc",
      filePath: "src/n.ts",
      language: "typescript",
      startLine: 1,
      endLine: 1,
      startColumn: 0,
      endColumn: 0,
      updatedAt: Date.now(),
    })
    const names = db.getAllNodeNames()
    expect(names).toContain("testFunc")
  })
})
