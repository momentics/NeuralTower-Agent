import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NtGraphDb, QueryBuilder } from '../ntgraph/index';
import { ImpactAnalyzer } from './ImpactAnalyzer';
import { INode, IEdge, NodeKind, EdgeKind, Language } from '../ntgraph/Types';
import * as os from 'os';
import * as fs from 'fs/promises';
import * as path from 'path';

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
  };
  qb.insertNode(node);
  return node;
}

function insertEdge(qb: QueryBuilder, source: string, target: string, kind: EdgeKind, line?: number): IEdge {
  const edge: IEdge = { source, target, kind, line };
  qb.insertEdge(edge);
  return edge;
}

describe("ImpactAnalyzer", () => {
  let ntDb: NtGraphDb;
  let qb: QueryBuilder;
  let analyzer: ImpactAnalyzer;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `ntgraph-impact-${Date.now()}-${Math.random()}`);
    await fs.mkdir(tmpDir, { recursive: true });
    const dbPath = path.join(tmpDir, 'test.db');
    ntDb = new NtGraphDb(dbPath);
    ntDb.initialize();
    qb = ntDb.queryBuilder;
    analyzer = new ImpactAnalyzer(qb);
  });

  afterEach(async () => {
    ntDb.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("includes children of container at same depth", () => {
    insertNode(qb, 'cls', 'class', 'Cls');
    insertNode(qb, 'meth', 'method', 'Meth');
    insertNode(qb, 'caller', 'function', 'Caller');

    insertEdge(qb, 'cls', 'meth', 'contains');
    insertEdge(qb, 'caller', 'cls', 'calls');

    const result = analyzer.analyze('cls', { maxDepth: 3 });
    const ids = [...result.subgraph.nodes.keys()];

    expect(ids).toContain('cls');
    expect(ids).toContain('meth');
    expect(ids).toContain('caller');
  });

  it("finds callers for function", () => {
    insertNode(qb, 'fn', 'function', 'Fn');
    insertNode(qb, 'caller', 'function', 'Caller');

    insertEdge(qb, 'caller', 'fn', 'calls');

    const result = analyzer.analyze('fn', { maxDepth: 3 });
    const ids = [...result.subgraph.nodes.keys()];

    expect(ids).toContain('fn');
    expect(ids).toContain('caller');
  });

  it("excludes contains from incoming traversal", () => {
    insertNode(qb, 'cls', 'class', 'Cls');
    insertNode(qb, 'meth', 'method', 'Meth');

    insertEdge(qb, 'cls', 'meth', 'contains');

    const result = analyzer.analyze('meth', { maxDepth: 3 });
    const ids = [...result.subgraph.nodes.keys()];

    expect(ids).toContain('meth');
    expect(ids).not.toContain('cls');
  });

  it("expands container children at same depth and finds callers of children", () => {
    insertNode(qb, 'cls', 'class', 'Cls');
    insertNode(qb, 'meth', 'method', 'Meth');
    insertNode(qb, 'caller', 'function', 'Caller');
    insertNode(qb, 'methCaller', 'function', 'MethCaller');

    insertEdge(qb, 'cls', 'meth', 'contains');
    insertEdge(qb, 'caller', 'cls', 'calls');
    insertEdge(qb, 'methCaller', 'meth', 'calls');

    const result = analyzer.analyze('cls', { maxDepth: 3 });
    const ids = [...result.subgraph.nodes.keys()];

    expect(ids).toContain('cls');
    expect(ids).toContain('meth');
    expect(ids).toContain('caller');
    expect(ids).toContain('methCaller');
  });

  it("result contains impactedNodes, impactedFiles, depthStats", () => {
    insertNode(qb, 'cls', 'class', 'Cls', 'src/a.ts');
    insertNode(qb, 'meth', 'method', 'Meth', 'src/a.ts');
    insertNode(qb, 'caller', 'function', 'Caller', 'src/b.ts');

    insertEdge(qb, 'cls', 'meth', 'contains');
    insertEdge(qb, 'caller', 'cls', 'calls');

    const result = analyzer.analyze('cls', { maxDepth: 3 });

    expect(result.impactedNodes.map(n => n.id)).toContain('meth');
    expect(result.impactedNodes.map(n => n.id)).toContain('caller');
    expect(result.impactedNodes.map(n => n.id)).not.toContain('cls');

    expect(result.impactedFiles).toContain('src/a.ts');
    expect(result.impactedFiles).toContain('src/b.ts');

    expect(result.depthStats[0]).toBeGreaterThanOrEqual(1);
  });

  it("returns empty result for nonexistent node", () => {
    const result = analyzer.analyze('nonexistent', { maxDepth: 3 });

    expect(result.subgraph.nodes.size).toBe(0);
    expect(result.impactedNodes).toEqual([]);
    expect(result.impactedFiles).toEqual([]);
    expect(result.depthStats).toEqual({});
  });

  it("respects maxDepth limit", () => {
    insertNode(qb, 'a', 'function', 'A');
    insertNode(qb, 'b', 'function', 'B');
    insertNode(qb, 'c', 'function', 'C');
    insertNode(qb, 'd', 'function', 'D');

    insertEdge(qb, 'b', 'a', 'calls');
    insertEdge(qb, 'c', 'b', 'calls');
    insertEdge(qb, 'd', 'c', 'calls');

    const result = analyzer.analyze('a', { maxDepth: 2 });
    const ids = [...result.subgraph.nodes.keys()];

    expect(ids).toContain('a');
    expect(ids).toContain('b');
    expect(ids).toContain('c');
    expect(ids).not.toContain('d');
  });
});
