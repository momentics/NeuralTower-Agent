/**
 * Обход графа кода.
 *
 * BFS, DFS, поиск вызывающих/вызываемых функций, иерархия типов,
 * поиск путей, оценка влияния.
 */

import { QueryBuilder } from './QueryBuilder';
import { INode, IEdge, ISubgraph, ITraversalOptions, NodeKind, EdgeKind } from './Types';

const DEFAULT_OPTIONS: Required<ITraversalOptions> = {
  maxDepth: Infinity,
  edgeKinds: [],
  nodeKinds: [],
  direction: 'outgoing',
  limit: 1000,
  includeStart: true,
};

interface TraversalStep {
  node: INode;
  edge: IEdge | null;
  depth: number;
}

/**
 * Обходчик графа для BFS и DFS.
 */
export class GraphTraverser {
  private qb: QueryBuilder;

  constructor(qb: QueryBuilder) {
    this.qb = qb;
  }

  /**
   * Обход графа в ширину (BFS).
   */
  traverseBFS(startId: string, options: ITraversalOptions = {}): ISubgraph {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const startNode = this.qb.getNodeById(startId);

    if (!startNode) {
      return { nodes: new Map(), edges: [], roots: [] };
    }

    const nodes = new Map<string, INode>();
    const edges: IEdge[] = [];
    const visited = new Set<string>();
    const enqueued = new Set<string>([startNode.id]);
    const seenEdges = new Set<string>();
    const edgeKey = (e: IEdge) =>
      `${e.source}|${e.target}|${e.kind}|${e.line ?? -1}|${e.column ?? -1}`;
    const queue: TraversalStep[] = [{ node: startNode, edge: null, depth: 0 }];

    if (opts.includeStart) {
      nodes.set(startNode.id, startNode);
    }

    while (queue.length > 0 && nodes.size < opts.limit) {
      const step = queue.shift()!;
      const { node, depth } = step;

      if (visited.has(node.id)) continue;
      visited.add(node.id);

      if (depth >= opts.maxDepth) continue;

      const adjacentEdges = this.getAdjacentEdges(node.id, opts.direction, opts.edgeKinds);
      adjacentEdges.sort((a, b) => {
        const priority = (e: IEdge) => e.kind === 'contains' ? 0 : e.kind === 'calls' ? 1 : 2;
        return priority(a) - priority(b);
      });

      const wantIds = adjacentEdges
        .map((e) => (e.source === node.id ? e.target : e.source))
        .filter((id) => !visited.has(id) && !enqueued.has(id));
      const neighborNodes = wantIds.length > 0
        ? this.qb.getNodesByIds(wantIds)
        : new Map<string, INode>();

      for (const adjEdge of adjacentEdges) {
        const nextNodeId = adjEdge.source === node.id ? adjEdge.target : adjEdge.source;
        const nextNode = neighborNodes.get(nextNodeId) ?? nodes.get(nextNodeId);
        if (!nextNode) continue;

        if (opts.nodeKinds && opts.nodeKinds.length > 0 && !opts.nodeKinds.includes(nextNode.kind)) {
          continue;
        }

        if (!visited.has(nextNodeId) && !enqueued.has(nextNodeId)) {
          if (nodes.size >= opts.limit) continue;
          enqueued.add(nextNodeId);
          nodes.set(nextNode.id, nextNode);
          queue.push({ node: nextNode, edge: adjEdge, depth: depth + 1 });
        }

        const ek = edgeKey(adjEdge);
        if (!seenEdges.has(ek)) {
          seenEdges.add(ek);
          edges.push(adjEdge);
        }
      }
    }

    return { nodes, edges, roots: [startId] };
  }

  /**
   * Обход графа в глубину (DFS).
   */
  traverseDFS(startId: string, options: ITraversalOptions = {}): ISubgraph {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const startNode = this.qb.getNodeById(startId);

    if (!startNode) {
      return { nodes: new Map(), edges: [], roots: [] };
    }

    const nodes = new Map<string, INode>();
    const edges: IEdge[] = [];
    const visited = new Set<string>();

    if (opts.includeStart) {
      nodes.set(startNode.id, startNode);
    }

    this.dfsRecursive(startNode, 0, opts, nodes, edges, visited);

    return { nodes, edges, roots: [startId] };
  }

  private dfsRecursive(
    node: INode,
    depth: number,
    opts: Required<ITraversalOptions>,
    nodes: Map<string, INode>,
    edges: IEdge[],
    visited: Set<string>
  ): void {
    if (visited.has(node.id) || nodes.size >= opts.limit || depth >= opts.maxDepth) {
      return;
    }

    visited.add(node.id);

    const adjacentEdges = this.getAdjacentEdges(node.id, opts.direction, opts.edgeKinds);

    const wantIds = adjacentEdges
      .map((e) => (e.source === node.id ? e.target : e.source))
      .filter((id) => !visited.has(id));
    const neighborNodes = wantIds.length > 0
      ? this.qb.getNodesByIds(wantIds)
      : new Map<string, INode>();

    for (const edge of adjacentEdges) {
      if (nodes.size >= opts.limit) break;

      const nextNodeId = edge.source === node.id ? edge.target : edge.source;
      if (visited.has(nextNodeId)) continue;

      const nextNode = neighborNodes.get(nextNodeId);
      if (!nextNode) continue;

      if (opts.nodeKinds && opts.nodeKinds.length > 0 && !opts.nodeKinds.includes(nextNode.kind)) {
        continue;
      }

      nodes.set(nextNode.id, nextNode);
      edges.push(edge);

      this.dfsRecursive(nextNode, depth + 1, opts, nodes, edges, visited);
    }
  }

  private getAdjacentEdges(
    nodeId: string,
    direction: 'outgoing' | 'incoming' | 'both',
    edgeKinds?: EdgeKind[]
  ): IEdge[] {
    const kinds = edgeKinds && edgeKinds.length > 0 ? edgeKinds : undefined;

    if (direction === 'outgoing') {
      return this.qb.getOutgoingEdges(nodeId, kinds);
    } else if (direction === 'incoming') {
      return this.qb.getIncomingEdges(nodeId, kinds);
    } else {
      const outgoing = this.qb.getOutgoingEdges(nodeId, kinds);
      const incoming = this.qb.getIncomingEdges(nodeId, kinds);
      return [...outgoing, ...incoming];
    }
  }

  /**
   * Находит все вызывающие функции/методы.
   */
  getCallers(nodeId: string, maxDepth: number = 1): Array<{ node: INode; edge: IEdge }> {
    const result: Array<{ node: INode; edge: IEdge }> = [];
    const visited = new Set<string>();

    this.getCallersRecursive(nodeId, maxDepth, 0, result, visited);

    return result;
  }

  private getCallersRecursive(
    nodeId: string,
    maxDepth: number,
    currentDepth: number,
    result: Array<{ node: INode; edge: IEdge }>,
    visited: Set<string>
  ): void {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    if (currentDepth >= maxDepth) return;

    const incomingEdges = this.qb.getIncomingEdges(nodeId, ['calls', 'references', 'imports', 'instantiates']);
    if (incomingEdges.length === 0) return;

    const sourceIds = incomingEdges.map((e) => e.source);
    const callerNodes = this.qb.getNodesByIds(sourceIds);

    for (const edge of incomingEdges) {
      const callerNode = callerNodes.get(edge.source);
      if (callerNode && !visited.has(callerNode.id)) {
        result.push({ node: callerNode, edge });
        this.getCallersRecursive(callerNode.id, maxDepth, currentDepth + 1, result, visited);
      }
    }
  }

  /**
   * Находит все вызываемые функции/методы.
   */
  getCallees(nodeId: string, maxDepth: number = 1): Array<{ node: INode; edge: IEdge }> {
    const result: Array<{ node: INode; edge: IEdge }> = [];
    const visited = new Set<string>();

    this.getCalleesRecursive(nodeId, maxDepth, 0, result, visited);

    return result;
  }

  private getCalleesRecursive(
    nodeId: string,
    maxDepth: number,
    currentDepth: number,
    result: Array<{ node: INode; edge: IEdge }>,
    visited: Set<string>
  ): void {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    if (currentDepth >= maxDepth) return;

    const outgoingEdges = this.qb.getOutgoingEdges(nodeId, ['calls', 'references', 'imports', 'instantiates']);
    if (outgoingEdges.length === 0) return;

    const targetIds = outgoingEdges.map((e) => e.target);
    const calleeNodes = this.qb.getNodesByIds(targetIds);

    for (const edge of outgoingEdges) {
      const calleeNode = calleeNodes.get(edge.target);
      if (calleeNode && !visited.has(calleeNode.id)) {
        result.push({ node: calleeNode, edge });
        this.getCalleesRecursive(calleeNode.id, maxDepth, currentDepth + 1, result, visited);
      }
    }
  }

  /**
   * Граф вызовов (вызывающие и вызываемые).
   */
  getCallGraph(nodeId: string, depth: number = 2): ISubgraph {
    const focalNode = this.qb.getNodeById(nodeId);
    if (!focalNode) {
      return { nodes: new Map(), edges: [], roots: [] };
    }

    const nodes = new Map<string, INode>();
    const edges: IEdge[] = [];

    nodes.set(focalNode.id, focalNode);

    const callers = this.getCallers(nodeId, depth);
    for (const { node, edge } of callers) {
      nodes.set(node.id, node);
      edges.push(edge);
    }

    const callees = this.getCallees(nodeId, depth);
    for (const { node, edge } of callees) {
      nodes.set(node.id, node);
      edges.push(edge);
    }

    return { nodes, edges, roots: [nodeId] };
  }

  /**
   * Иерархия типов для класса/интерфейса.
   */
  getTypeHierarchy(nodeId: string): ISubgraph {
    const focalNode = this.qb.getNodeById(nodeId);
    if (!focalNode) {
      return { nodes: new Map(), edges: [], roots: [] };
    }

    const nodes = new Map<string, INode>();
    const edges: IEdge[] = [];

    nodes.set(focalNode.id, focalNode);

    this.getTypeAncestors(nodeId, nodes, edges, new Set());
    this.getTypeDescendants(nodeId, nodes, edges, new Set());

    return { nodes, edges, roots: [nodeId] };
  }

  private getTypeAncestors(
    nodeId: string,
    nodes: Map<string, INode>,
    edges: IEdge[],
    visited: Set<string>
  ): void {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);

    const outgoingEdges = this.qb.getOutgoingEdges(nodeId, ['extends', 'implements']);
    if (outgoingEdges.length === 0) return;
    const parents = this.qb.getNodesByIds(outgoingEdges.map((e) => e.target));

    for (const edge of outgoingEdges) {
      const parentNode = parents.get(edge.target);
      if (parentNode && !nodes.has(parentNode.id)) {
        nodes.set(parentNode.id, parentNode);
        edges.push(edge);
        this.getTypeAncestors(parentNode.id, nodes, edges, visited);
      }
    }
  }

  private getTypeDescendants(
    nodeId: string,
    nodes: Map<string, INode>,
    edges: IEdge[],
    visited: Set<string>
  ): void {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);

    const incomingEdges = this.qb.getIncomingEdges(nodeId, ['extends', 'implements']);
    if (incomingEdges.length === 0) return;
    const children = this.qb.getNodesByIds(incomingEdges.map((e) => e.source));

    for (const edge of incomingEdges) {
      const childNode = children.get(edge.source);
      if (childNode && !nodes.has(childNode.id)) {
        nodes.set(childNode.id, childNode);
        edges.push(edge);
        this.getTypeDescendants(childNode.id, nodes, edges, visited);
      }
    }
  }

  /**
   * Находит все использования символа.
   */
  findUsages(nodeId: string): Array<{ node: INode; edge: IEdge }> {
    const result: Array<{ node: INode; edge: IEdge }> = [];

    const incomingEdges = this.qb.getIncomingEdges(nodeId);
    if (incomingEdges.length === 0) return result;

    const sources = this.qb.getNodesByIds(incomingEdges.map((e) => e.source));
    for (const edge of incomingEdges) {
      const sourceNode = sources.get(edge.source);
      if (sourceNode) result.push({ node: sourceNode, edge });
    }

    return result;
  }

  /**
   * Оценка влияния узла — все узлы, которые могут быть затронуты изменениями.
   */
  getImpactRadius(nodeId: string, maxDepth: number = 3): ISubgraph {
    const focalNode = this.qb.getNodeById(nodeId);
    if (!focalNode) {
      return { nodes: new Map(), edges: [], roots: [] };
    }

    const nodes = new Map<string, INode>();
    const edges: IEdge[] = [];
    const visited = new Set<string>();

    nodes.set(focalNode.id, focalNode);

    this.getImpactRecursive(nodeId, maxDepth, 0, nodes, edges, visited);

    return { nodes, edges, roots: [nodeId] };
  }

  private getImpactRecursive(
    nodeId: string,
    maxDepth: number,
    currentDepth: number,
    nodes: Map<string, INode>,
    edges: IEdge[],
    visited: Set<string>
  ): void {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    if (currentDepth >= maxDepth) return;

    const focalNode = this.qb.getNodeById(nodeId);
    if (focalNode) {
      const containerKinds = new Set(['class', 'interface', 'struct', 'trait', 'protocol', 'module', 'enum']);
      if (containerKinds.has(focalNode.kind)) {
        const containsEdges = this.qb.getOutgoingEdges(nodeId, ['contains']);
        if (containsEdges.length > 0) {
          const children = this.qb.getNodesByIds(containsEdges.map((e) => e.target));
          for (const edge of containsEdges) {
            const childNode = children.get(edge.target);
            if (childNode && !visited.has(childNode.id)) {
              nodes.set(childNode.id, childNode);
              edges.push(edge);
              this.getImpactRecursive(childNode.id, maxDepth, currentDepth, nodes, edges, visited);
            }
          }
        }
      }
    }

    const incomingEdges = this.qb.getIncomingEdges(nodeId).filter((e) => e.kind !== 'contains');
    if (incomingEdges.length === 0) return;
    const sources = this.qb.getNodesByIds(incomingEdges.map((e) => e.source));

    for (const edge of incomingEdges) {
      const sourceNode = sources.get(edge.source);
      if (!sourceNode) continue;

      edges.push(edge);
      if (!visited.has(sourceNode.id)) {
        nodes.set(sourceNode.id, sourceNode);
        this.getImpactRecursive(sourceNode.id, maxDepth, currentDepth + 1, nodes, edges, visited);
      }
    }
  }

  /**
   * Находит кратчайший путь между двумя узлами.
   */
  findPath(
    fromId: string,
    toId: string,
    edgeKinds: EdgeKind[] = []
  ): Array<{ node: INode; edge: IEdge | null }> | null {
    const fromNode = this.qb.getNodeById(fromId);
    const toNode = this.qb.getNodeById(toId);

    if (!fromNode || !toNode) {
      return null;
    }

    const visited = new Set<string>();
    const queue: Array<{ nodeId: string; path: Array<{ node: INode; edge: IEdge | null }> }> = [
      { nodeId: fromId, path: [{ node: fromNode, edge: null }] },
    ];

    while (queue.length > 0) {
      const { nodeId, path } = queue.shift()!;

      if (nodeId === toId) {
        return path;
      }

      if (visited.has(nodeId)) continue;
      visited.add(nodeId);

      const outgoingEdges = this.qb.getOutgoingEdges(
        nodeId,
        edgeKinds.length > 0 ? edgeKinds : undefined
      );
      if (outgoingEdges.length === 0) continue;

      const wantIds = outgoingEdges
        .map((e) => e.target)
        .filter((id) => !visited.has(id));
      const nextNodes = wantIds.length > 0
        ? this.qb.getNodesByIds(wantIds)
        : new Map<string, INode>();

      for (const edge of outgoingEdges) {
        if (!visited.has(edge.target)) {
          const nextNode = nextNodes.get(edge.target);
          if (nextNode) {
            queue.push({
              nodeId: edge.target,
              path: [...path, { node: nextNode, edge }],
            });
          }
        }
      }
    }

    return null;
  }

  /**
   * Предки узла по contains (от ближайшего родителя к корню).
   */
  getAncestors(nodeId: string): INode[] {
    const ancestors: INode[] = [];
    const visited = new Set<string>();
    let currentId = nodeId;

    while (true) {
      if (visited.has(currentId)) break;
      visited.add(currentId);

      const containingEdges = this.qb.getIncomingEdges(currentId, ['contains']);

      const firstEdge = containingEdges[0];
      if (!firstEdge) break;

      const parentNode = this.qb.getNodeById(firstEdge.source);
      if (parentNode) {
        ancestors.push(parentNode);
        currentId = parentNode.id;
      } else {
        break;
      }
    }

    return ancestors;
  }

  /**
   * Дочерние узлы по contains.
   */
  getChildren(nodeId: string): INode[] {
    const containsEdges = this.qb.getOutgoingEdges(nodeId, ['contains']);
    if (containsEdges.length === 0) return [];

    const childNodes = this.qb.getNodesByIds(containsEdges.map((e) => e.target));
    const children: INode[] = [];
    for (const edge of containsEdges) {
      const childNode = childNodes.get(edge.target);
      if (childNode) children.push(childNode);
    }
    return children;
  }
}
