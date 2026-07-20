import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { NtGraphDb } from './index'
import { QueryBuilder } from './QueryBuilder'
import { GraphTraverser } from './Traversal'
import { INode, IEdge, NodeKind, EdgeKind, Language } from './Types'
import * as os from 'os'
import * as fs from 'fs/promises'
import * as path from 'path'

function insertNode(
  qb: QueryBuilder,
  id: string,
  kind: NodeKind,
  name: string,
  filePath: string = 'src/test.ts',
  language: Language = 'typescript',
  startLine: number = 1,
  endLine: number = 10
): INode {
  const node: INode = {
    id, kind, name, qualifiedName: name, filePath, language,
    startLine, endLine, startColumn: 0, endColumn: 0, updatedAt: Date.now(),
  }
  qb.insertNode(node)
  return node
}

function insertEdge(qb: QueryBuilder, source: string, target: string, kind: EdgeKind, line?: number): IEdge {
  const edge: IEdge = { source, target, kind, line }
  qb.insertEdge(edge)
  return edge
}

describe("GraphTraverser", () => {
  let ntDb: NtGraphDb
  let qb: QueryBuilder
  let trav: GraphTraverser
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `ntgraph-trav-${Date.now()}-${Math.random()}`)
    await fs.mkdir(tmpDir, { recursive: true })
    const dbPath = path.join(tmpDir, 'test.db')
    ntDb = new NtGraphDb(dbPath)
    ntDb.initialize()
    qb = ntDb.queryBuilder
    trav = new GraphTraverser(qb)
  })

  afterEach(async () => {
    ntDb.close()
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  // ---- BFS-обход ----

  describe("BFS", () => {
    it("respects depth limit", () => {
      insertNode(qb, 'a', 'function', 'A')
      insertNode(qb, 'b', 'function', 'B')
      insertNode(qb, 'c', 'function', 'C')
      insertNode(qb, 'd', 'function', 'D')
      insertEdge(qb, 'a', 'b', 'calls')
      insertEdge(qb, 'b', 'c', 'calls')
      insertEdge(qb, 'c', 'd', 'calls')

      const subgraph = trav.traverseBFS('a', { maxDepth: 2 })
      const ids = [...subgraph.nodes.keys()]

      expect(ids).toContain('a')
      expect(ids).toContain('b')
      expect(ids).toContain('c')
      expect(ids).not.toContain('d')
    })

    it("filters by edgeKinds", () => {
      insertNode(qb, 'a', 'function', 'A')
      insertNode(qb, 'b', 'function', 'B')
      insertNode(qb, 'c', 'function', 'C')
      insertNode(qb, 'd', 'function', 'D')
      insertEdge(qb, 'a', 'b', 'calls')
      insertEdge(qb, 'a', 'c', 'contains')
      insertEdge(qb, 'a', 'd', 'references')

      const subgraph = trav.traverseBFS('a', { edgeKinds: ['calls'] })
      const ids = [...subgraph.nodes.keys()]

      expect(ids).toContain('a')
      expect(ids).toContain('b')
      expect(ids).not.toContain('c')
      expect(ids).not.toContain('d')
    })

    it("filters by nodeKinds", () => {
      insertNode(qb, 'a', 'class', 'A')
      insertNode(qb, 'b', 'function', 'B')
      insertNode(qb, 'c', 'method', 'C')
      insertEdge(qb, 'a', 'b', 'contains')
      insertEdge(qb, 'a', 'c', 'contains')

      const subgraph = trav.traverseBFS('a', { nodeKinds: ['function'] })
      const ids = [...subgraph.nodes.keys()]

      expect(ids).toContain('a')
      expect(ids).toContain('b')
      expect(ids).not.toContain('c')
    })

    it("respects limit", () => {
      insertNode(qb, 'center', 'function', 'Center')
      for (let i = 0; i < 10; i++) {
        insertNode(qb, `leaf-${i}`, 'function', `Leaf${i}`)
        insertEdge(qb, 'center', `leaf-${i}`, 'calls')
      }

      const subgraph = trav.traverseBFS('center', { limit: 5 })
      expect(subgraph.nodes.size).toBeLessThanOrEqual(5)
    })

    it("processes contains edges before calls at same level", () => {
      insertNode(qb, 'a', 'class', 'A')
      insertNode(qb, 'b', 'method', 'B')
      insertNode(qb, 'c', 'function', 'C')
      insertEdge(qb, 'a', 'c', 'calls')
      insertEdge(qb, 'a', 'b', 'contains')

      const subgraph = trav.traverseBFS('a')
      const edgeKinds = subgraph.edges.map(e => e.kind)

      const containsIdx = edgeKinds.indexOf('contains')
      const callsIdx = edgeKinds.indexOf('calls')
      expect(containsIdx).toBeLessThan(callsIdx)
    })

    it("resolves all neighbors in batch query", () => {
      insertNode(qb, 'center', 'function', 'Center')
      const leafIds: string[] = []
      for (let i = 0; i < 20; i++) {
        const id = `leaf-${i}`
        leafIds.push(id)
        insertNode(qb, id, 'function', `Leaf${i}`)
        insertEdge(qb, 'center', id, 'calls')
      }

      const subgraph = trav.traverseBFS('center')

      for (const id of leafIds) {
        expect(subgraph.nodes.has(id)).toBe(true)
      }
    })
  })

  // ---- DFS-обход ----

  describe("DFS", () => {
    it("respects depth limit", () => {
      insertNode(qb, 'a', 'function', 'A')
      insertNode(qb, 'b', 'function', 'B')
      insertNode(qb, 'c', 'function', 'C')
      insertNode(qb, 'd', 'function', 'D')
      insertEdge(qb, 'a', 'b', 'calls')
      insertEdge(qb, 'b', 'c', 'calls')
      insertEdge(qb, 'c', 'd', 'calls')

      const subgraph = trav.traverseDFS('a', { maxDepth: 2 })
      const ids = [...subgraph.nodes.keys()]

      expect(ids).toContain('a')
      expect(ids).toContain('b')
      expect(ids).toContain('c')
      expect(ids).not.toContain('d')
    })
  })

  // ---- Вызывающие / Вызываемые ----

  describe("Callers and Callees", () => {
    it("getCallers with recursion finds callers up to maxDepth", () => {
      insertNode(qb, 'a', 'function', 'A')
      insertNode(qb, 'b', 'function', 'B')
      insertNode(qb, 'c', 'function', 'C')
      insertEdge(qb, 'a', 'b', 'calls')
      insertEdge(qb, 'b', 'c', 'calls')

      const callers = trav.getCallers('c', 2)
      const callerIds = callers.map(({ node }) => node.id)

      expect(callerIds).toContain('b')
      expect(callerIds).toContain('a')
    })

    it("getCallees with recursion finds callees up to maxDepth", () => {
      insertNode(qb, 'a', 'function', 'A')
      insertNode(qb, 'b', 'function', 'B')
      insertNode(qb, 'c', 'function', 'C')
      insertEdge(qb, 'a', 'b', 'calls')
      insertEdge(qb, 'b', 'c', 'calls')

      const callees = trav.getCallees('a', 2)
      const calleeIds = callees.map(({ node }) => node.id)

      expect(calleeIds).toContain('b')
      expect(calleeIds).toContain('c')
    })

    it("getCallGraph includes callers and callees", () => {
      insertNode(qb, 'a', 'function', 'A')
      insertNode(qb, 'b', 'function', 'B')
      insertNode(qb, 'c', 'function', 'C')
      insertEdge(qb, 'a', 'b', 'calls')
      insertEdge(qb, 'b', 'c', 'calls')
      insertEdge(qb, 'c', 'b', 'calls')

      const graph = trav.getCallGraph('b', 1)
      const ids = [...graph.nodes.keys()]

      expect(ids).toContain('a')
      expect(ids).toContain('b')
      expect(ids).toContain('c')
    })

    it("instantiates edges included in callers and callees", () => {
      insertNode(qb, 'a', 'function', 'A')
      insertNode(qb, 'b', 'class', 'B')
      insertEdge(qb, 'a', 'b', 'instantiates')

      const callees = trav.getCallees('a', 1)
      expect(callees.some(({ node }) => node.id === 'b')).toBe(true)

      const callers = trav.getCallers('b', 1)
      expect(callers.some(({ node }) => node.id === 'a')).toBe(true)
    })
  })

  // ---- Иерархия типов ----

  describe("Type Hierarchy", () => {
    it("getTypeHierarchy finds ancestors and descendants", () => {
      insertNode(qb, 'a', 'class', 'A')
      insertNode(qb, 'b', 'class', 'B')
      insertNode(qb, 'c', 'class', 'C')
      insertNode(qb, 'd', 'class', 'D')

      insertEdge(qb, 'a', 'b', 'extends')
      insertEdge(qb, 'b', 'c', 'extends')
      insertEdge(qb, 'd', 'a', 'extends')

      const hierarchy = trav.getTypeHierarchy('a')
      const ids = [...hierarchy.nodes.keys()]

      expect(ids).toContain('a')
      expect(ids).toContain('b')
      expect(ids).toContain('c')
      expect(ids).toContain('d')
    })
  })

  // ---- Использование ----

  describe("Usages", () => {
    it("findUsages returns all references to a node", () => {
      insertNode(qb, 'target', 'function', 'Target')
      insertNode(qb, 'ref1', 'function', 'Ref1')
      insertNode(qb, 'ref2', 'function', 'Ref2')
      insertNode(qb, 'ref3', 'function', 'Ref3')

      insertEdge(qb, 'ref1', 'target', 'references')
      insertEdge(qb, 'ref2', 'target', 'references')
      insertEdge(qb, 'ref3', 'target', 'references')

      const usages = trav.findUsages('target')
      const usageIds = usages.map(({ node }) => node.id)

      expect(usageIds).toContain('ref1')
      expect(usageIds).toContain('ref2')
      expect(usageIds).toContain('ref3')
    })
  })

  // ---- Радиус воздействия ----

  describe("Impact Radius", () => {
    it("includes children of container at same depth", () => {
      insertNode(qb, 'cls', 'class', 'Cls')
      insertNode(qb, 'meth', 'method', 'Meth')
      insertNode(qb, 'caller', 'function', 'Caller')

      insertEdge(qb, 'cls', 'meth', 'contains')
      insertEdge(qb, 'caller', 'cls', 'calls')

      const impact = trav.getImpactRadius('cls', 3)
      const ids = [...impact.nodes.keys()]

      expect(ids).toContain('cls')
      expect(ids).toContain('meth')
      expect(ids).toContain('caller')
    })

    it("finds callers for function", () => {
      insertNode(qb, 'fn', 'function', 'Fn')
      insertNode(qb, 'caller', 'function', 'Caller')

      insertEdge(qb, 'caller', 'fn', 'calls')

      const impact = trav.getImpactRadius('fn', 3)
      const ids = [...impact.nodes.keys()]

      expect(ids).toContain('fn')
      expect(ids).toContain('caller')
    })

    it("excludes contains from incoming traversal", () => {
      insertNode(qb, 'cls', 'class', 'Cls')
      insertNode(qb, 'meth', 'method', 'Meth')

      insertEdge(qb, 'cls', 'meth', 'contains')

      const impact = trav.getImpactRadius('meth', 3)
      const ids = [...impact.nodes.keys()]

      expect(ids).toContain('meth')
      expect(ids).not.toContain('cls')
    })

    it("expands container children at same depth level", () => {
      insertNode(qb, 'cls', 'class', 'Cls')
      insertNode(qb, 'meth', 'method', 'Meth')
      insertNode(qb, 'caller1', 'function', 'Caller1')
      insertNode(qb, 'caller2', 'function', 'Caller2')

      insertEdge(qb, 'cls', 'meth', 'contains')
      insertEdge(qb, 'caller1', 'meth', 'calls')
      insertEdge(qb, 'caller2', 'caller1', 'calls')

      const impact = trav.getImpactRadius('cls', 2)
      const ids = [...impact.nodes.keys()]

      expect(ids).toContain('cls')
      expect(ids).toContain('meth')
      expect(ids).toContain('caller1')
      expect(ids).toContain('caller2')
    })
  })

  // ---- Поиск пути ----

  describe("Path Finding", () => {
    it("findPath returns shortest path between two nodes", () => {
      insertNode(qb, 'a', 'function', 'A')
      insertNode(qb, 'b', 'function', 'B')
      insertNode(qb, 'c', 'function', 'C')

      insertEdge(qb, 'a', 'b', 'calls')
      insertEdge(qb, 'b', 'c', 'calls')

      const pathResult = trav.findPath('a', 'c')

      expect(pathResult).not.toBeNull()
      expect(pathResult!.map(({ node }) => node.id)).toEqual(['a', 'b', 'c'])
    })

    it("findPath returns null when no path exists", () => {
      insertNode(qb, 'a', 'function', 'A')
      insertNode(qb, 'b', 'function', 'B')

      const pathResult = trav.findPath('a', 'b')

      expect(pathResult).toBeNull()
    })
  })

  // ---- Предки / Потомки ----

  describe("Ancestors and Children", () => {
    it("getAncestors returns ancestors from nearest to root", () => {
      insertNode(qb, 'a', 'class', 'A')
      insertNode(qb, 'b', 'method', 'B')
      insertNode(qb, 'c', 'function', 'C')

      insertEdge(qb, 'a', 'b', 'contains')
      insertEdge(qb, 'b', 'c', 'contains')

      const ancestors = trav.getAncestors('c')
      const ancestorIds = ancestors.map(n => n.id)

      expect(ancestorIds).toEqual(['b', 'a'])
    })

    it("getChildren returns all children of a node", () => {
      insertNode(qb, 'a', 'class', 'A')
      insertNode(qb, 'b', 'method', 'B')
      insertNode(qb, 'c', 'method', 'C')

      insertEdge(qb, 'a', 'b', 'contains')
      insertEdge(qb, 'a', 'c', 'contains')

      const children = trav.getChildren('a')
      const childIds = children.map(n => n.id)

      expect(childIds).toContain('b')
      expect(childIds).toContain('c')
    })

    it("getAncestors stops at cycle and does not loop infinitely", () => {
      insertNode(qb, 'a', 'class', 'A')
      insertNode(qb, 'b', 'class', 'B')

      insertEdge(qb, 'a', 'b', 'contains')
      insertEdge(qb, 'b', 'a', 'contains')

      const ancestors = trav.getAncestors('a')

      expect(ancestors.length).toBeGreaterThanOrEqual(1)
    })
  })
})
