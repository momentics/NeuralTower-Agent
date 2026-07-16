/**
 * Менеджер запросов к графу.
 *
 * Высокоуровневые запросы: контекст узла, подграф, связанные узлы,
 * метрики сложности, мёртвый код.
 */

import { QueryBuilder } from './QueryBuilder';
import { GraphTraverser } from './Traversal';
import { INode, IEdge, ISubgraph, Context, NodeKind, EdgeKind, IFileRecord } from './Types';

/**
 * Менеджер запросов к графу.
 */
export class GraphQueryManager {
  private qb: QueryBuilder;
  private traverser: GraphTraverser;

  constructor(qb: QueryBuilder) {
    this.qb = qb;
    this.traverser = new GraphTraverser(qb);
  }

  /**
   * Полный контекст узла.
   */
  getContext(nodeId: string): Context {
    const focal = this.qb.getNodeById(nodeId);

    if (!focal) {
      throw new Error(`Узел не найден: ${nodeId}`);
    }

    const ancestors = this.traverser.getAncestors(nodeId);
    const children = this.traverser.getChildren(nodeId);

    const incomingEdges = this.qb.getIncomingEdges(nodeId);
    const incomingRefs: Array<{ node: INode; edge: IEdge }> = [];
    for (const edge of incomingEdges) {
      if (edge.kind === 'contains') continue;
      const node = this.qb.getNodeById(edge.source);
      if (node) incomingRefs.push({ node, edge });
    }

    const outgoingEdges = this.qb.getOutgoingEdges(nodeId);
    const outgoingRefs: Array<{ node: INode; edge: IEdge }> = [];
    for (const edge of outgoingEdges) {
      if (edge.kind === 'contains') continue;
      const node = this.qb.getNodeById(edge.target);
      if (node) outgoingRefs.push({ node, edge });
    }

    const types: INode[] = [];
    const typeEdgeKinds: EdgeKind[] = ['type_of', 'returns'];
    for (const kind of typeEdgeKinds) {
      const typeEdges = this.qb.getOutgoingEdges(nodeId, [kind]);
      for (const edge of typeEdges) {
        const typeNode = this.qb.getNodeById(edge.target);
        if (typeNode && !types.some((t) => t.id === typeNode.id)) {
          types.push(typeNode);
        }
      }
    }

    const imports: IEdge[] = [];
    const fileNode = ancestors.find((a) => a.kind === 'file');
    if (fileNode) {
      const importEdges = this.qb.getOutgoingEdges(fileNode.id, ['imports']);
      for (const edge of importEdges) {
        const importNode = this.qb.getNodeById(edge.target);
        if (importNode) imports.push(edge);
      }
    }

    return {
      focal,
      ancestors,
      children,
      incomingRefs,
      outgoingRefs,
      types,
      imports,
    };
  }

  /**
   * Зависимости файла — файлы, от которых зависит данный.
   */
  getFileDependencies(filePath: string): string[] {
    return this.qb.getDependencyFilePaths(filePath);
  }

  /**
   * Обратные зависимости файла — файлы, зависящие от данного.
   */
  getFileDependents(filePath: string): string[] {
    return this.qb.getDependentFilePaths(filePath);
  }

  /**
   * Экспортируемые символы файла.
   */
  getExportedSymbols(filePath: string): INode[] {
    const nodes = this.qb.getNodesByFile(filePath);
    return nodes.filter((n) => n.isExported);
  }

  /**
   * Поиск символов по шаблону квалифицированного имени.
   */
  findByQualifiedName(pattern: string): INode[] {
    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');

    const regex = new RegExp(`^${regexPattern}$`);

    const allNodes: INode[] = [];
    const kinds: NodeKind[] = [
      'class', 'function', 'method', 'interface',
      'type_alias', 'variable', 'constant',
    ];

    for (const kind of kinds) {
      const nodes = this.qb.getNodesByKind(kind);
      for (const node of nodes) {
        if (regex.test(node.qualifiedName)) {
          allNodes.push(node);
        }
      }
    }

    return allNodes;
  }

  /**
   * Структура модуля — дерево файлов по директориям.
   */
  getModuleStructure(): Map<string, string[]> {
    const files = this.qb.getAllFiles();
    const structure = new Map<string, string[]>();

    for (const file of files) {
      const parts = file.path.split('/');
      const dir = parts.slice(0, -1).join('/') || '.';

      if (!structure.has(dir)) {
        structure.set(dir, []);
      }
      structure.get(dir)!.push(file.path);
    }

    return structure;
  }

  /**
   * Поиск циклических зависимостей.
   */
  findCircularDependencies(): string[][] {
    const files = this.qb.getAllFiles();
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const dfs = (filePath: string, path: string[]): void => {
      if (recursionStack.has(filePath)) {
        const cycleStart = path.indexOf(filePath);
        if (cycleStart !== -1) {
          cycles.push(path.slice(cycleStart));
        }
        return;
      }

      if (visited.has(filePath)) return;

      visited.add(filePath);
      recursionStack.add(filePath);

      const dependencies = this.getFileDependencies(filePath);
      for (const dep of dependencies) {
        dfs(dep, [...path, filePath]);
      }

      recursionStack.delete(filePath);
    };

    for (const file of files) {
      if (!visited.has(file.path)) {
        dfs(file.path, []);
      }
    }

    return cycles;
  }

  /**
   * Метрики сложности узла.
   */
  getNodeMetrics(nodeId: string): {
    incomingEdgeCount: number;
    outgoingEdgeCount: number;
    callCount: number;
    callerCount: number;
    childCount: number;
    depth: number;
  } {
    const incomingEdges = this.qb.getIncomingEdges(nodeId);
    const outgoingEdges = this.qb.getOutgoingEdges(nodeId);

    const callEdges = outgoingEdges.filter((e) => e.kind === 'calls');
    const callerEdges = incomingEdges.filter((e) => e.kind === 'calls');
    const containsEdges = outgoingEdges.filter((e) => e.kind === 'contains');

    const ancestors = this.traverser.getAncestors(nodeId);

    return {
      incomingEdgeCount: incomingEdges.length,
      outgoingEdgeCount: outgoingEdges.length,
      callCount: callEdges.length,
      callerCount: callerEdges.length,
      childCount: containsEdges.length,
      depth: ancestors.length,
    };
  }

  /**
   * Поиск мёртвого кода — узлы без входящих ссылок.
   */
  findDeadCode(kinds?: NodeKind[]): INode[] {
    const targetKinds = kinds || ['function', 'method', 'class'] as NodeKind[];
    const deadCode: INode[] = [];

    for (const kind of targetKinds) {
      const nodes = this.qb.getNodesByKind(kind);
      for (const node of nodes) {
        if (node.isExported) continue;

        const incomingEdges = this.qb.getIncomingEdges(node.id);
        const references = incomingEdges.filter((e) => e.kind !== 'contains');

        if (references.length === 0) {
          deadCode.push(node);
        }
      }
    }

    return deadCode;
  }

  /**
   * Подграф по фильтру.
   */
  getFilteredSubgraph(
    filter: (node: INode) => boolean,
    includeEdges: boolean = true
  ): ISubgraph {
    const nodes = new Map<string, INode>();
    const edges: IEdge[] = [];

    const kinds: NodeKind[] = [
      'file', 'module', 'class', 'struct', 'interface', 'trait',
      'function', 'method', 'variable', 'constant', 'enum', 'type_alias',
    ];

    for (const kind of kinds) {
      const kindNodes = this.qb.getNodesByKind(kind);
      for (const node of kindNodes) {
        if (filter(node)) {
          nodes.set(node.id, node);
        }
      }
    }

    if (includeEdges) {
      for (const nodeId of nodes.keys()) {
        const outgoing = this.qb.getOutgoingEdges(nodeId);
        for (const edge of outgoing) {
          if (nodes.has(edge.target)) {
            edges.push(edge);
          }
        }
      }
    }

    return { nodes, edges, roots: [] };
  }

  /**
   * Доступ к обходчику графа.
   */
  getTraverser(): GraphTraverser {
    return this.traverser;
  }
}
