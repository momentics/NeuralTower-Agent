/**
 * ContextBuilder — построение контекста для AI-задач.
 *
 * Конвейер:
 * 1. Парсинг входных данных
 * 2. Извлечение символов из запроса
 * 3. Точный поиск символов
 * 4. FTS-поиск
 * 5. Расширение графа от точек входа (BFS)
 * 6. Извлечение блоков кода
 * 7. Форматирование (Markdown или JSON)
 */

import * as fs from 'fs';
import type {
  ISubgraph,
  ISearchResult,
  INode,
  IEdge,
  NodeKind,
  EdgeKind,
  TaskInput,
  BuildContextOptions,
  FindRelevantContextOptions,
  TaskContext,
  CodeBlock,
  IGraphStats,
} from '../ntgraph/Types';

/** Расширенная статистика контекста. */
interface IContextStats {
  nodeCount: number;
  edgeCount: number;
  fileCount: number;
  codeBlockCount: number;
  totalCodeSize: number;
  nodesByKind: Record<NodeKind, number>;
  edgesByKind: Record<EdgeKind, number>;
  filesByLanguage: Record<string, number>;
  lastUpdated: number;
}

/** Объединённые опции построения контекста. */
interface IBuildContextOpts extends BuildContextOptions, FindRelevantContextOptions {}
import type { QueryBuilder } from '../ntgraph/QueryBuilder';
import { GraphTraverser } from '../ntgraph/Traversal';
import { extractSymbolsFromQuery } from './SymbolExtractor';
import { formatContextAsMarkdown, formatContextAsJson } from './Formatter';
import { LOW_CONFIDENCE_MARKER } from './Markers';
import { isTestFile, isConfigLeafNode } from '../ntgraph/Utils';
import { HIGH_VALUE_NODE_KINDS, SUPERTYPE_BEARING_KINDS, MAX_HOPS, DEFAULT_FIND_OPTIONS } from '../resolution/Constants';
import { getStemVariants } from '../ntgraph/Utils';

// =============================================================================
// Константы
// =============================================================================

const DEFAULT_BUILD_OPTIONS: Required<IBuildContextOpts> = {
  maxNodes: 20,
  maxCodeBlocks: 5,
  maxCodeBlockSize: 1500,
  includeCode: true,
  format: 'markdown',
  searchLimit: 3,
  traversalDepth: 1,
  minScore: 0.3,
  edgeKinds: [],
  nodeKinds: Array.from(HIGH_VALUE_NODE_KINDS),
};

// =============================================================================
// ContextBuilder
// =============================================================================

/**
 * Строит контекст для AI-задач.
 */
export class ContextBuilder {
  private readonly projectRoot: string;
  private readonly queries: QueryBuilder;
  private readonly traverser: GraphTraverser;

  constructor(projectRoot: string, queries: QueryBuilder, traverser: GraphTraverser) {
    this.projectRoot = projectRoot;
    this.queries = queries;
    this.traverser = traverser;
  }

  /**
   * Построение контекста для задачи.
   */
  async buildContext(
    input: TaskInput,
    options: IBuildContextOpts = {}
  ): Promise<TaskContext | string> {
    const opts = { ...DEFAULT_BUILD_OPTIONS, ...options };

    // Парсинг входных данных
    const query = typeof input === 'string' ? input : `${input.title}: ${input.description}`;

    // Извлечение символов
    const symbols = extractSymbolsFromQuery(query);

    // Поиск точек входа
    const { entryPoints, confidence } = await this.findEntryPoints(query, symbols, opts);

    // Расширение графа
    const subgraph = this.expandGraph(entryPoints, opts);
    subgraph.confidence = confidence;

    // Извлечение блоков кода
    const codeBlocks = opts.includeCode
      ? this.extractCodeBlocks(subgraph, opts.maxCodeBlocks, opts.maxCodeBlockSize)
      : [];

    // Связанные файлы
    const relatedFiles = this.getRelatedFiles(subgraph);

    // Статистика
    const stats = this.queries.getNodeAndEdgeCount();

    // Резюме
    const summary = this.generateSummary(query, subgraph, entryPoints);

    const context: TaskContext = {
      query,
      subgraph,
      entryPoints,
      codeBlocks,
      relatedFiles,
      summary,
      stats: {
        nodeCount: stats.nodeCount,
        edgeCount: stats.edgeCount,
        fileCount: 0,
        codeBlockCount: codeBlocks.length,
        totalCodeSize: codeBlocks.reduce((sum, b) => sum + b.content.length, 0),
        nodesByKind: {} as Record<NodeKind, number>,
        edgesByKind: {} as Record<EdgeKind, number>,
        filesByLanguage: {},
        lastUpdated: Date.now(),
        dbSizeBytes: 0,
      } as IGraphStats,
    };

    // Форматирование
    if (opts.format === 'json') {
      return formatContextAsJson(context);
    }

    return formatContextAsMarkdown(context);
  }

  /**
   * Поиск релевантного контекста по запросу.
   */
  async findRelevantContext(
    query: string,
    options: FindRelevantContextOptions = {}
  ): Promise<ISubgraph> {
    const opts = { ...DEFAULT_BUILD_OPTIONS, ...options };

    // Извлечение символов
    const symbols = extractSymbolsFromQuery(query);

    // Поиск точек входа
    const { entryPoints, confidence } = await this.findEntryPoints(query, symbols, opts);

    // Расширение графа
    const subgraph = this.expandGraph(entryPoints, opts);
    subgraph.confidence = confidence;
    return subgraph;
  }

  /**
   * Получение кода узла.
   */
  async getCode(nodeId: string): Promise<string | null> {
    const node = this.queries.getNodeById(nodeId);
    if (!node) return null;

    return this.extractNodeCode(node);
  }

  // ===================================================================
  // Поиск точек входа
  // ===================================================================

  private async findEntryPoints(
    query: string,
    symbols: string[],
    opts: Required<IBuildContextOpts>
  ): Promise<{ entryPoints: INode[]; confidence: 'high' | 'low' }> {
    const results: ISearchResult[] = [];
    const seenIds = new Set<string>();
    let bestStep = 0;

    // Шаг 1: Точное совпадение символов
    try {
      const exactResults = this.queries.findNodesByExactName(symbols, {
        ...DEFAULT_FIND_OPTIONS,
        kinds: opts.nodeKinds?.length ? opts.nodeKinds : undefined,
        limit: opts.searchLimit,
      });
      for (const r of exactResults) {
        if (!seenIds.has(r.node.id) && r.score >= opts.minScore) {
          results.push(r);
          seenIds.add(r.node.id);
          bestStep = 1;
        }
      }
    } catch {
      // Точный поиск не удался — продолжаем
    }

    // Шаг 2a: Префиксный поиск определений
    if (results.length < opts.searchLimit) {
      for (const symbol of symbols) {
        const capitalized = symbol.charAt(0).toUpperCase() + symbol.slice(1);
        const stemVariants = getStemVariants(capitalized);

        for (const variant of stemVariants) {
          try {
            const prefixResults = this.queries.findNodesByNameSubstring(variant, {
              kinds: ['class', 'interface', 'struct', 'type_alias', 'component'],
              limit: Math.ceil(opts.searchLimit / symbols.length),
            });
            for (const node of prefixResults) {
              if (!seenIds.has(node.id)) {
                results.push({ node, score: 0.6 });
                seenIds.add(node.id);
                bestStep = 2;
              }
            }
          } catch {
            // Продолжаем
          }
        }
      }
    }

    // Шаг 2b: FTS-поиск
    if (results.length < opts.searchLimit) {
      try {
        const ftsResults = this.queries.searchNodes(query, {
          kinds: opts.nodeKinds?.length ? opts.nodeKinds : undefined,
          limit: opts.searchLimit * 3,
        });
        for (const r of ftsResults) {
          if (!seenIds.has(r.node.id) && r.score >= opts.minScore) {
            results.push(r);
            seenIds.add(r.node.id);
            bestStep = 3;
          }
        }
      } catch {
        // FTS не удался — продолжаем
      }
    }

    // Шаг 3: Составной термин — multi-term boosting
    if (symbols.length >= 2 && results.length > 0) {
      const symbolLower = symbols.map(s => s.toLowerCase());
      for (const r of results) {
        const nameLower = r.node.name.toLowerCase();
        const qNameLower = r.node.qualifiedName.toLowerCase();
        let matchCount = 0;
        for (const sym of symbolLower) {
          if (nameLower.includes(sym) || qNameLower.includes(sym)) {
            matchCount++;
          }
        }
        if (matchCount >= 2) {
          // Агрессивное масштабирование: умножаем балл на число совпавших терминов
          r.score *= (1 + matchCount * 0.5);
        }
      }
    }

    // Шаг 4: LIKE-фоллбэк для camelCase
    if (results.length < opts.searchLimit) {
      for (const symbol of symbols) {
        try {
          const likeResults = this.queries.findNodesByNameSubstring(symbol, {
            ...DEFAULT_FIND_OPTIONS,
            limit: Math.ceil(opts.searchLimit / symbols.length),
          });
         for (const node of likeResults) {
              if (!seenIds.has(node.id)) {
                results.push({ node, score: 0.4 });
                seenIds.add(node.id);
                bestStep = 4;
              }
            }
        } catch {
          // Продолжаем
        }
      }
    }

    // Шаг 5: Fuzzy-фоллбэк
    if (results.length < opts.searchLimit) {
      for (const symbol of symbols) {
        try {
          const fuzzyResults = this.queries.searchNodesFuzzy(symbol, {
            kinds: opts.nodeKinds?.length ? opts.nodeKinds : undefined,
            limit: Math.ceil(opts.searchLimit / symbols.length),
          });
          for (const r of fuzzyResults) {
            if (!seenIds.has(r.node.id) && r.score >= opts.minScore) {
              results.push(r);
              seenIds.add(r.node.id);
              bestStep = 5;
            }
          }
        } catch {
          // Fuzzy не удался — продолжаем
        }
      }
    }

    // Сортировка и ограничение
    results.sort((a, b) => b.score - a.score);
    const filtered = results.slice(0, opts.searchLimit);

    // Разрешение импортов на определения
    const resolved = this.resolveImportsToDefinitions(filtered);

    // Определение уверенности по шагу поиска
    const confidence = bestStep <= 3 ? 'high' : 'low';

    return { entryPoints: resolved.map((r) => r.node), confidence };
  }

  // ===================================================================
  // Буст для core-каталогов
  // ===================================================================

  /**
   * Вычисляет буст для узлов в core-каталогах.
   * Ошибки изолированы — при сбое возвращается 0.
   */
  private computeCoreDirectoryBoost(node: INode): number {
    try {
      const coreDirs = ['src/', 'lib/', 'core/', 'pkg/', 'internal/'];
      const path = node.filePath;
      for (const dir of coreDirs) {
        if (path.startsWith(dir) || path.startsWith(dir.replace('/', '\\'))) {
          return 0.2;
        }
      }
      return 0;
    } catch {
      return 0;
    }
  }

  // ===================================================================
  // Расширение графа
  // ===================================================================

  private expandGraph(entryPoints: INode[], opts: Required<IBuildContextOpts>): ISubgraph {
    const allNodes = new Map<string, INode>();
    const allEdges: IEdge[] = [];
    const roots: string[] = [];

    // Лимит разнообразия по файлам
    const maxPerFile = Math.max(5, Math.ceil(opts.maxNodes * 0.2));
    const fileNodeCount = new Map<string, number>();

    // Лимит непродуктивных узлов
    const maxNonProd = Math.max(3, Math.ceil(opts.maxNodes * 0.15));
    let nonProdCount = 0;

    // Расширение иерархии типов
    const maxHierarchyNodes = Math.ceil(opts.maxNodes / 4);

    const incFileCount = (fp: string) => {
      fileNodeCount.set(fp, (fileNodeCount.get(fp) ?? 0) + 1);
    };

    for (const ep of entryPoints) {
      if (!allNodes.has(ep.id)) {
        allNodes.set(ep.id, ep);
        roots.push(ep.id);
        incFileCount(ep.filePath);
      }

      // BFS от точки входа
      const bfsResult = this.traverser.traverseBFS(ep.id, {
        maxDepth: opts.traversalDepth,
        edgeKinds: opts.edgeKinds?.length ? opts.edgeKinds : undefined,
        nodeKinds: opts.nodeKinds?.length ? opts.nodeKinds : undefined,
        limit: opts.maxNodes - allNodes.size,
        includeStart: false,
      });

      for (const [, node] of bfsResult.nodes) {
        if (allNodes.has(node.id)) continue;

        // Проверка лимита по файлам
        const fileCount = fileNodeCount.get(node.filePath) ?? 0;
        if (fileCount >= maxPerFile) continue;

        // Проверка лимита непродуктивных узлов
        if (isTestFile(node.filePath)) {
          if (nonProdCount >= maxNonProd) continue;
          nonProdCount++;
        }

        allNodes.set(node.id, node);
        incFileCount(node.filePath);
      }

      for (const edge of bfsResult.edges) {
        if (allNodes.has(edge.source) && allNodes.has(edge.target)) {
          allEdges.push(edge);
        }
      }

      // Расширение иерархии типов для class/interface
      if (SUPERTYPE_BEARING_KINDS.has(ep.kind) && allNodes.size < opts.maxNodes) {
        const hierarchy = this.traverser.getTypeHierarchy(ep.id);
        for (const [, node] of hierarchy.nodes) {
          if (!allNodes.has(node.id) && allNodes.size < opts.maxNodes + maxHierarchyNodes) {
            allNodes.set(node.id, node);
          }
        }
        for (const edge of hierarchy.edges) {
          if (allNodes.has(edge.source) && allNodes.has(edge.target)) {
            allEdges.push(edge);
          }
        }
      }
    }

    // Восстановление рёбер
    const nodeIds = Array.from(allNodes.keys());
    const recoveredEdges = this.queries.findEdgesBetweenNodes(nodeIds);
    for (const edge of recoveredEdges) {
      if (!allEdges.some((e) => e.source === edge.source && e.target === edge.target && e.kind === edge.kind)) {
        allEdges.push(edge);
      }
    }

    // Ограничение по maxNodes
    if (allNodes.size > opts.maxNodes) {
      // Приоритет: точки входа, затем узлы в core-каталогах
      const prioritized = Array.from(allNodes.entries()).sort(([, a], [, b]) => {
        const aIsRoot = roots.includes(a.id) ? 1 : 0;
        const bIsRoot = roots.includes(b.id) ? 1 : 0;
        if (bIsRoot !== aIsRoot) return bIsRoot - aIsRoot;
        const aBoost = this.computeCoreDirectoryBoost(a);
        const bBoost = this.computeCoreDirectoryBoost(b);
        return bBoost - aBoost;
      });

      const limited = new Map(prioritized.slice(0, opts.maxNodes));
      allNodes.clear();
      for (const [id, node] of limited) {
        allNodes.set(id, node);
      }

      // Фильтрация рёбер
      const filteredEdges = allEdges.filter((e) => allNodes.has(e.source) && allNodes.has(e.target));
      allEdges.length = 0;
      allEdges.push(...filteredEdges);
    }

    return { nodes: allNodes, edges: allEdges, roots };
  }

  // ===================================================================
  // Извлечение кода
  // ===================================================================

  /**
   * Приоритизированное извлечение блоков кода.
   */
  extractCodeBlocks(
    subgraph: ISubgraph,
    maxBlocks: number,
    maxBlockSize: number
  ): CodeBlock[] {
    const blocks: CodeBlock[] = [];

    // Приоритет: 1) точки входа, 2) функции/методы, 3) классы
    const priorityOrder: NodeKind[] = [
      'function', 'method', 'route', 'component',
      'class', 'interface', 'struct', 'trait',
      'variable', 'constant', 'type_alias',
    ];

    const sortedNodes = Array.from(subgraph.nodes.values()).sort((a, b) => {
      const aIdx = priorityOrder.indexOf(a.kind);
      const bIdx = priorityOrder.indexOf(b.kind);
      return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
    });

    for (const node of sortedNodes) {
      if (blocks.length >= maxBlocks) break;

      // Защита config-листов
      if (isConfigLeafNode(node)) {
        blocks.push({
          content: `// ${node.name}`,
          filePath: node.filePath,
          startLine: node.startLine,
          endLine: node.endLine,
          language: node.language,
          node,
        });
        continue;
      }

      const code = this.extractNodeCode(node);
      if (code) {
        // Ограничение размера
        const truncated = code.length > maxBlockSize
          ? code.slice(0, maxBlockSize) + '\n// ... (обрезано)'
          : code;

        blocks.push({
          content: truncated,
          filePath: node.filePath,
          startLine: node.startLine,
          endLine: node.endLine,
          language: node.language,
          node,
        });
      }
    }

    return blocks;
  }

  /**
   * Извлечение кода узла.
   */
  extractNodeCode(node: INode): string | null {
    try {
      const content = fs.readFileSync(node.filePath, 'utf-8');
      const lines = content.split('\n');

      const start = Math.max(0, node.startLine - 1);
      const end = Math.min(lines.length, node.endLine);

      return lines.slice(start, end).join('\n');
    } catch {
      return null;
    }
  }

  // ===================================================================
  // Пути вызовов
  // ===================================================================

  /**
   * Построение секции call paths.
   */
  buildCallPathsSection(subgraph: ISubgraph): string {
    const lines: string[] = [];
    const budget = 2000;
    const visited = new Set<string>();
    const paths: string[][] = [];

    for (const rootId of subgraph.roots) {
      if (budget <= 0) break;

      this.collectCallPaths(rootId, [], subgraph, visited, paths, MAX_HOPS, budget);
    }

    // Фильтрация цепей, соединяющих 2+ релевантных символов
    const relevantPaths = paths.filter((p) => {
      const relevantCount = p.filter((n) => subgraph.roots.includes(n)).length;
      return relevantCount >= 2;
    });

    for (const path of relevantPaths.slice(0, 20)) {
      lines.push(`- ${path.join(' → ')}`);
    }

    return lines.length > 0 ? `## Пути вызовов\n\n${lines.join('\n')}` : '';
  }

  private collectCallPaths(
    nodeId: string,
    currentPath: string[],
    subgraph: ISubgraph,
    visited: Set<string>,
    paths: string[][],
    maxHops: number,
    budget: number
  ): void {
    if (budget <= 0 || currentPath.length > maxHops) return;

    const node = subgraph.nodes.get(nodeId);
    if (!node) return;

    currentPath.push(node.name);

    if (currentPath.length >= 2) {
      paths.push([...currentPath]);
    }

    const outgoingEdges = subgraph.edges.filter((e) => e.source === nodeId && e.kind === 'calls');
    for (const edge of outgoingEdges) {
      if (!visited.has(edge.target)) {
        visited.add(edge.target);
        this.collectCallPaths(edge.target, currentPath, subgraph, visited, paths, maxHops, budget - 1);
        visited.delete(edge.target);
      }
    }

    currentPath.pop();
  }

  // ===================================================================
  // Низкая уверенность
  // ===================================================================

  /**
   * Построение заметки низкой уверенности.
   */
  buildLowConfidenceNote(entryPoints: INode[]): string {
    if (entryPoints.length === 0) return '';

    // Проверяем, совпал ли запрос преимущественно с общими словами
    const hasSpecificMatch = entryPoints.some((ep) => {
      const name = ep.name.toLowerCase();
      return !['get', 'set', 'init', 'create', 'new', 'build', 'make', 'do', 'run'].includes(name);
    });

    if (!hasSpecificMatch) {
      return `\n> ⚠️ ${LOW_CONFIDENCE_MARKER}: Запрос совпал преимущественно с общими словами.\n> Рекомендуется использовать точные имена символов для более релевантных результатов.`;
    }

    return '';
  }

  // ===================================================================
  // Вспомогательные методы
  // ===================================================================

  /**
   * Связанные файлы подграфа.
   */
  getRelatedFiles(subgraph: ISubgraph): string[] {
    const files = new Set<string>();
    for (const [, node] of subgraph.nodes) {
      files.add(node.filePath);
    }
    return Array.from(files).sort();
  }

  /**
   * Генерация резюме.
   */
  generateSummary(query: string, subgraph: ISubgraph, entryPoints: INode[]): string {
    const nodeKinds = new Map<string, number>();
    for (const [, node] of subgraph.nodes) {
      nodeKinds.set(node.kind, (nodeKinds.get(node.kind) ?? 0) + 1);
    }

    const parts: string[] = [];
    parts.push(`Найдено ${subgraph.nodes.size} узлов и ${subgraph.edges.length} рёбер для запроса "${query}".`);

    if (entryPoints.length > 0) {
      const names = entryPoints.slice(0, 5).map((n) => `\`${n.name}\``).join(', ');
      parts.push(`Точки входа: ${names}${entryPoints.length > 5 ? ' и др.' : ''}.`);
    }

    const kindSummary = Array.from(nodeKinds.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([kind, count]) => `${count} ${kind}`)
      .join(', ');

    if (kindSummary) {
      parts.push(`Состав: ${kindSummary}.`);
    }

    return parts.join(' ');
  }

  /**
   * Разрешение импортов на определения.
   */
  resolveImportsToDefinitions(results: ISearchResult[]): ISearchResult[] {
    const resolved: ISearchResult[] = [];

    for (const r of results) {
      if (r.node.kind !== 'import') {
        resolved.push(r);
        continue;
      }

      // Следующим exports/imports рёбрам
      const edges = this.queries.getOutgoingEdges(r.node.id, ['imports', 'exports']);
      for (const edge of edges) {
        const target = this.queries.getNodeById(edge.target);
        if (target) {
          resolved.push({ node: target, score: r.score });
          break;
        }
      }
    }

    return resolved;
  }
}


