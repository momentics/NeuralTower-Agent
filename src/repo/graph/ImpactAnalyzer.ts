/**
 * Анализ радиуса воздействия.
 *
 * Определяет все узлы, которые могут быть затронуты
 * изменениями в заданном узле.
 */

import type { QueryBuilder } from '../ntgraph/QueryBuilder';
import type { INode, IEdge, ISubgraph, EdgeKind } from '../ntgraph/Types';
import { CONTAINER_NODE_KINDS } from '../resolution/Constants';

/** Параметры анализа радиуса воздействия. */
export interface IImpactOptions {
  maxDepth?: number;
  edgeKinds?: EdgeKind[];
}

/** Результат анализа радиуса воздействия. */
export interface IImpactResult {
  subgraph: ISubgraph;
  impactedNodes: INode[];
  impactedFiles: string[];
  depthStats: Record<number, number>;
}

/**
 * Анализатор радиуса воздействия.
 */
export class ImpactAnalyzer {
  private qb: QueryBuilder;

  constructor(qb: QueryBuilder) {
    this.qb = qb;
  }

  /**
   * Оценка влияния узла — все узлы, которые могут быть затронуты изменениями.
   */
  analyze(nodeId: string, options: IImpactOptions = {}): IImpactResult {
    const maxDepth = options.maxDepth ?? 3;
    const focalNode = this.qb.getNodeById(nodeId);
    if (!focalNode) {
      return {
        subgraph: { nodes: new Map(), edges: [], roots: [] },
        impactedNodes: [],
        impactedFiles: [],
        depthStats: {},
      };
    }

    const nodes = new Map<string, INode>();
    const edges: IEdge[] = [];
    const depthStats: Record<number, number> = {};
    const visited = new Set<string>();

    nodes.set(focalNode.id, focalNode);
    depthStats[0] = 1;

    this.analyzeRecursive(nodeId, maxDepth, 0, nodes, edges, depthStats, visited);

    const impactedNodes = Array.from(nodes.values()).filter(n => n.id !== nodeId);
    const impactedFiles = Array.from(new Set(impactedNodes.map(n => n.filePath)));

    return {
      subgraph: { nodes, edges, roots: [nodeId] },
      impactedNodes,
      impactedFiles,
      depthStats,
    };
  }

  private analyzeRecursive(
    nodeId: string,
    maxDepth: number,
    currentDepth: number,
    nodes: Map<string, INode>,
    edges: IEdge[],
    depthStats: Record<number, number>,
    visited: Set<string>
  ): void {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    if (currentDepth >= maxDepth) return;

    const focalNode = this.qb.getNodeById(nodeId);
    if (focalNode) {
      // Контейнеры: обходим дочерние узлы на той же глубине
      if (CONTAINER_NODE_KINDS.has(focalNode.kind)) {
        const containsEdges = this.qb.getOutgoingEdges(nodeId, ['contains']);
        if (containsEdges.length > 0) {
          const children = new Map(
            this.qb.getNodesByIds(containsEdges.map((e) => e.target)).map(n => [n.id, n])
          );
          for (const edge of containsEdges) {
            const childNode = children.get(edge.target);
            if (childNode && !visited.has(childNode.id)) {
              nodes.set(childNode.id, childNode);
              edges.push(edge);
              depthStats[currentDepth] = (depthStats[currentDepth] ?? 0) + 1;
              this.analyzeRecursive(childNode.id, maxDepth, currentDepth, nodes, edges, depthStats, visited);
            }
          }
        }
      }
    }

    // Входящие рёбра (исключая contains)
    const incomingEdges = this.qb.getIncomingEdges(nodeId).filter((e) => e.kind !== 'contains');
    if (incomingEdges.length === 0) return;

    const sources = new Map(
      this.qb.getNodesByIds(incomingEdges.map((e) => e.source)).map(n => [n.id, n])
    );

    for (const edge of incomingEdges) {
      const sourceNode = sources.get(edge.source);
      if (!sourceNode) continue;

      edges.push(edge);
      if (!visited.has(sourceNode.id)) {
        nodes.set(sourceNode.id, sourceNode);
        depthStats[currentDepth + 1] = (depthStats[currentDepth + 1] ?? 0) + 1;
        this.analyzeRecursive(sourceNode.id, maxDepth, currentDepth + 1, nodes, edges, depthStats, visited);
      }
    }
  }
}
