import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { NtGraphDb, INode, IEdge } from "../ntgraph/index"
import { GraphTraverser } from "../ntgraph/Traversal"
import { ContextBuilder } from "../context/Builder"
import { formatContextAsMarkdown } from "../context/Formatter"
import { LOW_CONFIDENCE_MARKER } from "../context/Markers"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"

const createNode = (id: string, kind: INode["kind"], name: string, filePath = "src/test.ts"): INode => ({
  id,
  kind,
  name,
  qualifiedName: name,
  filePath,
  language: "typescript",
  startLine: 1,
  endLine: 5,
  startColumn: 0,
  endColumn: 10,
  updatedAt: Date.now(),
})

describe("Phase 3 Integration", () => {
  let db: NtGraphDb
  let traverser: GraphTraverser
  let builder: ContextBuilder

  beforeEach(() => {
    db = new NtGraphDb(":memory:")
    db.initialize()
    traverser = new GraphTraverser(db.queryBuilder)
    builder = new ContextBuilder(db.getProjectRoot(), db.queryBuilder, traverser)
  })

  afterEach(() => {
    db.close()
  })

  describe("Full pipeline: index → resolve → search", () => {
    it("inserts nodes and edges, then finds relevant context via ContextBuilder", async () => {
      db.insertNodes([
        createNode("n1", "function", "processData"),
        createNode("n2", "class", "DataProcessor"),
        createNode("n3", "method", "transform"),
      ])
      db.insertEdges([
        { source: "n2", target: "n3", kind: "contains" },
        { source: "n1", target: "n2", kind: "calls" },
      ])

      const results = db.findNodesByExactName(["processData"])
      expect(results.length).toBeGreaterThan(0)
      expect(results[0]!.node.name).toBe("processData")

      const subgraph = await builder.findRelevantContext("processData")
      expect(subgraph.nodes.size).toBeGreaterThan(0)
    })
  })

  describe("Graph traversal with entry points", () => {
    it("BFS from A reaches B and C via calls edges", () => {
      db.insertNodes([
        createNode("a", "function", "A"),
        createNode("b", "function", "B"),
        createNode("c", "function", "C"),
      ])
      db.insertEdges([
        { source: "a", target: "b", kind: "calls" },
        { source: "b", target: "c", kind: "calls" },
      ])

      const result = traverser.traverseBFS("a", { maxDepth: 2, includeStart: false })

      expect(result.nodes.has("b")).toBe(true)
      expect(result.nodes.has("c")).toBe(true)
      expect(result.nodes.has("a")).toBe(false)
    })

    it("BFS respects depth limit", () => {
      db.insertNodes([
        createNode("a", "function", "A"),
        createNode("b", "function", "B"),
        createNode("c", "function", "C"),
      ])
      db.insertEdges([
        { source: "a", target: "b", kind: "calls" },
        { source: "b", target: "c", kind: "calls" },
      ])

      const result = traverser.traverseBFS("a", { maxDepth: 1, includeStart: false })

      expect(result.nodes.has("b")).toBe(true)
      expect(result.nodes.has("c")).toBe(false)
    })

    it("BFS respects edgeKinds filter", () => {
      db.insertNodes([
        createNode("a", "function", "A"),
        createNode("b", "function", "B"),
        createNode("c", "function", "C"),
      ])
      db.insertEdges([
        { source: "a", target: "b", kind: "calls" },
        { source: "b", target: "c", kind: "references" },
      ])

      const result = traverser.traverseBFS("a", { maxDepth: 2, edgeKinds: ["calls"], includeStart: false })

      expect(result.nodes.has("b")).toBe(true)
      expect(result.nodes.has("c")).toBe(false)
    })
  })

  describe("Context building with code extraction", () => {
    it("extracts code blocks for nodes in subgraph", async () => {
      const tmpDir = path.join(os.tmpdir(), `nt-integration-${Date.now()}`)
      fs.mkdirSync(tmpDir, { recursive: true })
      const testFilePath = path.join(tmpDir, "test.ts")
      fs.writeFileSync(testFilePath, "function hello() {\n  return 42;\n}")

      db.insertNodes([
        createNode("n1", "function", "hello", testFilePath),
      ])

      const subgraph = traverser.traverseBFS("n1", { includeStart: true })
      const blocks = builder["extractCodeBlocks"](subgraph, 5, 1500)

      expect(blocks.length).toBeGreaterThan(0)
      expect(blocks[0]!.node.name).toBe("hello")
      expect(blocks[0]!.filePath).toBe(testFilePath)

      fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    it("returns empty blocks when maxBlocks is zero", async () => {
      db.insertNodes([
        createNode("n1", "function", "hello"),
      ])

      const subgraph = traverser.traverseBFS("n1", { includeStart: true })
      const blocks = builder["extractCodeBlocks"](subgraph, 0, 1500)

      expect(blocks.length).toBe(0)
    })
  })

  describe("Import resolution to definitions", () => {
    it("resolveImportsToDefinitions follows imports edge from import node to target", () => {
      db.insertNodes([
        createNode("imp1", "import", "DataProcessor"),
        createNode("cls1", "class", "DataProcessor"),
      ])
      db.insertEdges([
        { source: "imp1", target: "cls1", kind: "imports" },
      ])

      const results = db.findNodesByExactName(["DataProcessor"])
      expect(results.length).toBeGreaterThan(0)

      const importResults = results.filter((r) => r.node.kind === "import")
      expect(importResults.length).toBeGreaterThan(0)

      const resolved = builder["resolveImportsToDefinitions"](results)
      const hasClass = resolved.some((r) => r.node.kind === "class")
      expect(hasClass).toBe(true)
    })

    it("passes through non-import nodes unchanged", () => {
      db.insertNodes([
        createNode("cls1", "class", "DataProcessor"),
      ])

      const results = db.findNodesByExactName(["DataProcessor"])
      const resolved = builder["resolveImportsToDefinitions"](results)
      expect(resolved.length).toBe(results.length)
    })
  })

  describe("Type hierarchy expansion", () => {
    it("getTypeHierarchy returns both parent and child from child node", () => {
      db.insertNodes([
        createNode("base", "class", "BaseClass"),
        createNode("child", "class", "ChildClass"),
      ])
      db.insertEdges([
        { source: "child", target: "base", kind: "extends" },
      ])

      const hierarchy = traverser.getTypeHierarchy("child")

      expect(hierarchy.nodes.has("child")).toBe(true)
      expect(hierarchy.nodes.has("base")).toBe(true)
      expect(hierarchy.edges.length).toBeGreaterThan(0)
    })

    it("getTypeHierarchy handles empty graph", () => {
      const hierarchy = traverser.getTypeHierarchy("nonexistent")
      expect(hierarchy.nodes.size).toBe(0)
      expect(hierarchy.edges.length).toBe(0)
    })
  })

  describe("Low confidence handoff", () => {
    it("buildLowConfidenceNote generates note for generic entry points", () => {
      const genericNodes: INode[] = [
        createNode("n1", "function", "get"),
        createNode("n2", "function", "set"),
      ]

      const note = builder["buildLowConfidenceNote"](genericNodes)
      expect(note).toContain(LOW_CONFIDENCE_MARKER)
    })

    it("buildLowConfidenceNote returns empty string for specific entry points", () => {
      const specificNodes: INode[] = [
        createNode("n1", "function", "processData"),
      ]

      const note = builder["buildLowConfidenceNote"](specificNodes)
      expect(note).toBe("")
    })

    it("buildLowConfidenceNote returns empty string for empty entry points", () => {
      const note = builder["buildLowConfidenceNote"]([])
      expect(note).toBe("")
    })

    it("formatContextAsMarkdown includes low confidence marker when confidence is low", () => {
      const node: INode = createNode("n1", "function", "hello")
      const context = {
        query: "get set init",
        subgraph: {
          nodes: new Map<string, INode>([["n1", node]]),
          edges: [],
          roots: ["n1"],
          confidence: "low" as const,
        },
        entryPoints: [node],
        codeBlocks: [],
        relatedFiles: ["src/test.ts"],
        summary: "Found 1 node",
        stats: {
          nodeCount: 1,
          edgeCount: 0,
          fileCount: 1,
          nodesByKind: { function: 1 } as Record<string, number>,
          edgesByKind: {} as Record<string, number>,
          filesByLanguage: {},
          dbSizeBytes: 0,
          lastUpdated: Date.now(),
        },
      }

      const output = formatContextAsMarkdown(context)
      expect(output).toContain(LOW_CONFIDENCE_MARKER)
    })
  })
})
