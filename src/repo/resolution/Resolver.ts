/**
 * ReferenceResolver — координатор всех стратегий разрешения ссылок.
 *
 * 3-проходное разрешение:
 * 1. Основной проход — стандартное разрешение через все стратегии
 * 2. Цепные вызовы через соответствие (chained calls via conformance)
 * 3. Отложенные this.<member> ссылки через BFS супертипов
 */

import * as fs from 'fs';
import {
  NodeKind,
  EdgeKind,
} from '../ntgraph/Types';
import type {
  IUnresolvedReference,
  IResolvedRef,
  IResolutionResult,
  IResolutionContext,
  INode,
  IEdge,
  Language,
  IImportMapping,
  IReExport,
  IFrameworkResolver,
  IAliasMap,
  IGoModule,
  IWorkspacePackages,
} from '../ntgraph/Types';
import type { QueryBuilder } from '../ntgraph/QueryBuilder';
import { LRUCache } from '../ntgraph/LruCache';
import { isBuiltInSymbol } from './BuiltIns';
import {
  matchReference,
  matchFunctionRef,
  matchByQualifiedName,
  matchDottedCallChain,
  matchScopedCallChain,
  sameLanguageFamily,
  crossesKnownFamily,
} from './NameMatcher';
import {
  resolveViaImport,
  resolveJvmImport,
  extractImportMappings,
  extractReExports,
  isPhpIncludePathRef,
} from './ImportResolver';
import { synthesizeCallbackEdges } from './CallbackSynthesizer';
import {
  CHAIN_LANGUAGES,
  SCOPED_CHAIN_LANGUAGES,
  CHAIN_SHAPE,
  SUPERTYPE_BEARING_KINDS,
} from './Constants';
import { detectFrameworks, getApplicableFrameworks } from './Frameworks';
import { loadProjectAliases } from '../extraction/PathAliases';
import { loadGoModule } from '../extraction/GoModule';
import { loadWorkspacePackages } from '../extraction/WorkspacePackages';

// =============================================================================
// ReferenceResolver
// =============================================================================

/**
 * Координатор всех стратегий разрешения ссылок.
 */
export class ReferenceResolver {
  private readonly projectRoot: string;
  private readonly queries: QueryBuilder;

  // Кэши
  private readonly nodeCache: LRUCache<string, INode[]>;
  private readonly fileCache: LRUCache<string, string | null>;
  private readonly importMappingCache: LRUCache<string, IImportMapping[]>;
  private readonly reExportCache: LRUCache<string, IReExport[]>;
  private readonly nameCache: LRUCache<string, INode[]>;
  private readonly lowerNameCache: LRUCache<string, INode[]>;
  private readonly qualifiedNameCache: LRUCache<string, INode[]>;
  private readonly razorUsingsCache: Map<string, string[]>;
  private readonly fileLinesCache: Map<string, string[] | null>;

  // Предварительно загруженные данные
  private knownNames: Set<string> | null = null;
  private knownFiles: Set<string> | null = null;
  private cachesWarmed: boolean = false;

  // Ленивая загрузка конфигурации
  private projectAliases: IAliasMap | null | undefined = undefined;
  private goModule: IGoModule | null | undefined = undefined;
  private workspacePackages: IWorkspacePackages | null | undefined = undefined;

  // Фреймворки
  private detectedFrameworks: string[] | null = null;
  private frameworkResolvers: IFrameworkResolver[] = [];

  constructor(projectRoot: string, queries: QueryBuilder) {
    this.projectRoot = projectRoot;
    this.queries = queries;

    const cacheLimit = Number(process.env.NTGRAPH_RESOLVER_CACHE_SIZE) || 5_000;
    const contentCacheLimit = Math.max(64, Math.floor(cacheLimit / 5));

    this.nodeCache = new LRUCache(cacheLimit);
    this.fileCache = new LRUCache(contentCacheLimit);
    this.importMappingCache = new LRUCache(cacheLimit);
    this.reExportCache = new LRUCache(cacheLimit);
    this.nameCache = new LRUCache(cacheLimit);
    this.lowerNameCache = new LRUCache(cacheLimit);
    this.qualifiedNameCache = new LRUCache(cacheLimit);
    this.razorUsingsCache = new Map();
    this.fileLinesCache = new Map();
  }

  // ===================================================================
  // Инициализация
  // ===================================================================

  /** Инициализация резолвера. */
  initialize(): void {
    this.warmCaches();
    this.detectFrameworks();
  }

  /** Предварительная загрузка кэшей. */
  warmCaches(): void {
    if (this.cachesWarmed) return;

    this.knownNames = new Set(this.queries.getAllNodeNames());
    this.knownFiles = new Set(this.queries.getAllFilePaths().map((p) => p));
    this.cachesWarmed = true;
  }

  /** Очистка кэшей. */
  clearCaches(): void {
    this.nodeCache.clear();
    this.fileCache.clear();
    this.importMappingCache.clear();
    this.reExportCache.clear();
    this.nameCache.clear();
    this.lowerNameCache.clear();
    this.qualifiedNameCache.clear();
    this.razorUsingsCache.clear();
    this.fileLinesCache.clear();
    this.knownNames = null;
    this.knownFiles = null;
    this.cachesWarmed = false;
    this.detectedFrameworks = null;
  }

  // ===================================================================
  // Основные методы разрешения
  // ===================================================================

  /**
   * Разрешение всех ссылок.
   */
  resolveAll(
    unresolvedRefs: IUnresolvedReference[],
    onProgress?: (resolved: number, total: number) => void
  ): IResolutionResult {
    const start = Date.now();
    const resolved: IResolvedRef[] = [];
    const unresolved: IUnresolvedReference[] = [];

    for (let i = 0; i < unresolvedRefs.length; i++) {
      const ref = unresolvedRefs[i]!;
      const result = this.resolveOne(ref);

      if (result) {
        resolved.push(result);
      } else {
        unresolved.push(ref);
      }

      // Прогресс-отчёт каждый 1%
      if (onProgress && i > 0 && i % Math.max(1, Math.floor(unresolvedRefs.length / 100)) === 0) {
        onProgress(i, unresolvedRefs.length);
      }
    }

    return {
      resolved,
      unresolved,
      durationMs: Date.now() - start,
    };
  }

  /**
   * Разрешение одной ссылки.
   */
  resolveOne(ref: IUnresolvedReference): IResolvedRef | null {
    // Предварительная фильтрация: встроенные символы
    if (isBuiltInSymbol(ref.referenceName, ref.language ?? 'unknown')) {
      return null;
    }

    // Предварительная фильтрация: knownNames
    if (this.cachesWarmed && this.knownNames && !this.knownNames.has(ref.referenceName)) {
      // Проверяем, не является ли это импортом
      if (!this.matchesAnyImport(ref)) {
        // Проверяем claimsReference у фреймворк-резолверов
        let claimed = false;
        for (const resolver of this.frameworkResolvers) {
          if (resolver.claimsReference?.(ref.referenceName)) {
            claimed = true;
            break;
          }
        }
        if (!claimed) {
          return null;
        }
      }
    }

    // Стратегия 1: Фреймворк-специфичное разрешение
    const frameworkResult = this.resolveFramework(ref);
    if (frameworkResult) {
      const gated = this.gateFrameworkLanguage(frameworkResult, ref);
      if (gated) return gated;
    }

    // Стратегия 2: Razor/Blazor @using
    const razorResult = this.resolveRazorUsing(ref);
    if (razorResult) return razorResult;

    // Стратегия 3: JVM FQN импорт
    const jvmResult = resolveJvmImport(ref, this);
    if (jvmResult) return jvmResult;

    // Стратегия 4: Разрешение через импорты
    const importResult = resolveViaImport(ref, this);
    if (importResult) {
      const gated = this.gateLanguage(importResult, ref);
      if (gated) return gated;
    }

    // Стратегия 5: Разрешение по квалифицированному имени
    const qnameResult = matchByQualifiedName(ref, this);
    if (qnameResult) {
      const gated = this.gateLanguage(qnameResult, ref);
      if (gated) return gated;
    }

    // Стратегия 5.1: Сопоставление по имени
    const nameResult = matchReference(ref, this);
    if (nameResult) {
      const gated = this.gateLanguage(nameResult, ref);
      if (gated) return gated;
    }

    // Стратегия 6: Функции как значения
    const fnResult = matchFunctionRef(ref, this);
    if (fnResult) return fnResult;

    // Стратегия 7: this.<member> разрешение
    const thisResult = this.resolveThisMemberFnRef(ref);
    if (thisResult) return thisResult;

    // PHP include path защита
    if (isPhpIncludePathRef(ref)) {
      return null;
    }

    return null;
  }

  /**
   * Создание рёбер из разрешённых ссылок.
   */
  createEdges(resolved: IResolvedRef[]): IEdge[] {
    const edges: IEdge[] = [];

    for (const r of resolved) {
      const ref = r.original;
      let kind: IEdge['kind'] = ref.referenceKind === 'function_ref' ? 'references' : ref.referenceKind;

      // Промоция вида ребра
      if (kind === 'extends') {
        const target = this.queries.getNodeById(r.targetNodeId);
        if (target && (target.kind === 'interface' || target.kind === 'protocol')) {
          kind = 'implements';
        }
      }

      if (kind === 'calls') {
        const target = this.queries.getNodeById(r.targetNodeId);
        if (target && SUPERTYPE_BEARING_KINDS.has(target.kind)) {
          // Python/Ruby не имеют new — calls → instantiates
          if (ref.language === 'python' || ref.language === 'ruby') {
            kind = 'instantiates';
          }
        }
      }

      if (ref.referenceKind === 'function_ref') {
        edges.push({
          source: ref.fromNodeId,
          target: r.targetNodeId,
          kind,
          metadata: { fnRef: true, resolvedBy: r.provenance, confidence: r.confidence },
          line: ref.line,
          column: ref.column,
          provenance: 'heuristic',
        });
        continue;
      }

      edges.push({
        source: ref.fromNodeId,
        target: r.targetNodeId,
        kind,
        metadata: { resolvedBy: r.provenance, confidence: r.confidence },
        line: ref.line,
        column: ref.column,
        provenance: 'heuristic',
      });
    }

    return edges;
  }

  /**
   * Разрешение и сохранение ссылок.
   */
  resolveAndPersist(
    unresolvedRefs: IUnresolvedReference[],
    onProgress?: (resolved: number, total: number) => void
  ): IResolutionResult {
    const result = this.resolveAll(unresolvedRefs, onProgress);
    const edges = this.createEdges(result.resolved);
    this.queries.insertEdges(edges);

    // Удаляем разрешённые ссылки
    const resolvedRefs = result.resolved.map((r) => r.original);
    this.queries.deleteSpecificResolvedReferences(resolvedRefs);

    return result;
  }

  /**
   * Batch-разрешение с сохранением.
   */
  async resolveAndPersistBatched(
    onProgress?: (resolved: number, total: number) => void,
    batchSize: number = 5_000
  ): Promise<IResolutionResult> {
    const start = Date.now();
    let totalResolved = 0;
    let prevRemaining = Infinity;

    while (true) {
      const remaining = this.queries.getUnresolvedReferencesCount();
      if (remaining === 0) break;

      // Защита от бесконечного цикла
      if (remaining >= prevRemaining) break;
      prevRemaining = remaining;

      const refs = this.queries.getUnresolvedReferencesBatch(0, batchSize);
      if (refs.length === 0) break;

      const batchResult = this.resolveAll(refs, (resolved, total) => {
        onProgress?.(totalResolved + resolved, totalResolved + total);
      });

      // Создаём и вставляем рёбра
      const edges = this.createEdges(batchResult.resolved);
      this.queries.insertEdges(edges);

      // Удаляем разрешённые ссылки
      const resolvedRefs = batchResult.resolved.map((r) => r.original);
      this.queries.deleteSpecificResolvedReferences(resolvedRefs);

      totalResolved += batchResult.resolved.length;

      // Yield для event loop
      await Promise.resolve();
    }

    // Синтез callback-рёбер (оборачивается в try/catch)
    try {
      const callbackEdges = synthesizeCallbackEdges(this.queries, this);
      this.queries.insertEdges(callbackEdges);
    } catch {
      // Синтез добавочный — ошибки не критичны
    }

    return {
      resolved: [],
      unresolved: this.queries.getUnresolvedReferences(),
      durationMs: Date.now() - start,
    };
  }

  // ===================================================================
  // 3-проходное разрешение
  // ===================================================================

  /**
   * Проход 2: Цепные вызовы через соответствие.
   */
  resolveChainedCallsViaConformance(): number {
    let count = 0;
    const unresolved = this.queries.getUnresolvedReferences();

    for (const ref of unresolved) {
      if (!CHAIN_LANGUAGES.has(ref.language ?? '')) continue;

      // Dotted call chain
      if (CHAIN_SHAPE.test(ref.referenceName)) {
        const result = matchDottedCallChain(ref, this);
        if (result) {
          const edges = this.createEdges([result]);
          this.queries.insertEdges(edges);
          this.queries.deleteSpecificResolvedReferences([ref]);
          count++;
          continue;
        }
      }

      // Scoped call chain (Rust)
      if (SCOPED_CHAIN_LANGUAGES.has(ref.language ?? '')) {
        const result = matchScopedCallChain(ref, this);
        if (result) {
          const edges = this.createEdges([result]);
          this.queries.insertEdges(edges);
          this.queries.deleteSpecificResolvedReferences([ref]);
          count++;
        }
      }
    }

    return count;
  }

  /**
   * Проход 3: Отложенные this.<member> ссылки через BFS супертипов.
   */
  resolveDeferredThisMemberRefs(): number {
    let count = 0;
    const unresolved = this.queries.getUnresolvedReferences();

    for (const ref of unresolved) {
      if (!ref.referenceName.startsWith('this.')) continue;

      const memberName = ref.referenceName.slice(5);
      const fromNode = this.queries.getNodeById(ref.fromNodeId);
      if (!fromNode) continue;

      // BFS по супертипам
      const ancestors = this.getAncestors(fromNode.id);
      for (const ancestor of ancestors) {
        const children = this.queries.getNodesByFile(ancestor.filePath);
        for (const child of children) {
          if (child.kind === 'method' && child.name === memberName) {
            const resolved: IResolvedRef = {
              original: ref,
              targetNodeId: child.id,
              confidence: 0.7,
              provenance: 'deferred-this-member',
            };
            const edges = this.createEdges([resolved]);
            this.queries.insertEdges(edges);
            this.queries.deleteSpecificResolvedReferences([ref]);
            count++;
            break;
          }
        }
      }
    }

    return count;
  }

  // ===================================================================
  // Фреймворки
  // ===================================================================

  /**
   * Запуск postExtract для каждого фреймворка.
   */
  runPostExtract(): number {
    this.clearCaches();
    let count = 0;

    try {
      for (const resolver of this.frameworkResolvers) {
        try {
          const nodes = resolver.postExtract?.(this) || [];
          count += nodes.length;
        } catch {
          // Изоляция ошибок фреймворка
        }
      }
    } finally {
      this.clearCaches();
    }

    return count;
  }

  /**
   * Получение обнаруженных фреймворков.
   */
  getDetectedFrameworks(): string[] {
    if (this.detectedFrameworks === null) {
      this.detectFrameworks();
    }
    return this.detectedFrameworks || [];
  }

  private detectFrameworks(): void {
    this.frameworkResolvers = detectFrameworks(this);
    this.detectedFrameworks = this.frameworkResolvers.map((r) => r.name);
  }

  private resolveFramework(ref: IUnresolvedReference): IResolvedRef | null {
    if (this.detectedFrameworks === null) {
      this.detectFrameworks();
    }

    if (!this.frameworkResolvers.length) return null;

    const applicable = getApplicableFrameworks(this.frameworkResolvers, ref.language ?? 'unknown');
    for (const resolver of applicable) {
      const result = resolver.resolve(ref, this);
      if (result) return result;
    }

    return null;
  }

  // ===================================================================
  // Вспомогательные методы
  // ===================================================================

  /**
   * Быстрая проверка: есть ли хоть какое-то совпадение для имени.
   */
  hasAnyPossibleMatch(name: string): boolean {
    if (!this.cachesWarmed || !this.knownNames) return true;
    return this.knownNames.has(name);
  }

  /**
   * Проверка: совпадает ли ссылка с любым известным импортом.
   */
  matchesAnyImport(ref: IUnresolvedReference): boolean {
    if (!ref.filePath) return false;

    const mappings = this.getImportMappings(ref.filePath);
    for (const mapping of mappings) {
      if (mapping.localName === ref.referenceName || mapping.exportedName === ref.referenceName) {
        return true;
      }
    }

    return false;
  }

  /**
   * Языковая фильтрация: отбрасывает разрешение при переходе между языковыми семействами.
   */
  gateLanguage(result: IResolvedRef | null, ref: IUnresolvedReference): IResolvedRef | null {
    if (!result || !ref.language) return result;

    const targetNode = this.queries.getNodeById(result.targetNodeId);
    if (!targetNode) return result;

    if (crossesKnownFamily(ref.language, targetNode.language)) {
      return null;
    }

    return result;
  }

  /**
   * Языковая фильтрация для фреймворкового разрешения.
   */
  gateFrameworkLanguage(result: IResolvedRef | null, ref: IUnresolvedReference): IResolvedRef | null {
    if (!result || !ref.language) return result;

    const targetNode = this.queries.getNodeById(result.targetNodeId);
    if (!targetNode) return result;

    if (crossesKnownFamily(ref.language, targetNode.language)) {
      return null;
    }

    return result;
  }

  /**
   * Разрешение this.<member> против собственных членов класса.
   */
  resolveThisMemberFnRef(ref: IUnresolvedReference): IResolvedRef | null {
    if (!ref.referenceName.startsWith('this.')) return null;

    const memberName = ref.referenceName.slice(5);
    const fromNode = this.queries.getNodeById(ref.fromNodeId);
    if (!fromNode) return null;

    // Ищем в родителе
    const ancestors = this.getAncestors(fromNode.id);
    for (const ancestor of ancestors) {
      if (!SUPERTYPE_BEARING_KINDS.has(ancestor.kind)) continue;

      const children = this.queries.getNodesByFile(ancestor.filePath);
      for (const child of children) {
        if (child.kind === 'method' && child.name === memberName) {
          return {
            original: ref,
            targetNodeId: child.id,
            confidence: 0.85,
            provenance: 'this-member',
          };
        }
      }
    }

    return null;
  }

  /**
   * Разрешение Razor/Blazor @using.
   */
  resolveRazorUsing(ref: IUnresolvedReference): IResolvedRef | null {
    if (!ref.filePath) return null;

    const ext = ref.filePath.split('.').pop()?.toLowerCase();
    if (!['razor', 'cshtml'].includes(ext ?? '')) return null;

    const usings = this.getRazorUsings(ref.filePath);
    if (usings.length === 0) return null;

    // Ищем тип в пространствах имён
    for (const ns of usings) {
      const qName = `${ns}.${ref.referenceName}`;
      const nodes = this.queries.getNodesByQualifiedNameExact(qName);
      if (nodes.length > 0) {
        return {
          original: ref,
          targetNodeId: nodes[0]!.id,
          confidence: 0.9,
          provenance: 'razor-using',
        };
      }
    }

    return null;
  }

  /**
   * Получение @using из _Imports.razor (каскадный поиск).
   */
  getRazorUsings(filePath: string): string[] {
    const cached = this.razorUsingsCache.get(filePath);
    if (cached !== undefined) return cached;

    const usings: string[] = [];
    let dir = filePath;

    while (dir.length > 0) {
      const importsPath = dir + '/_Imports.razor';
      if (this.fileCache.has(importsPath)) {
        const content = this.fileCache.get(importsPath);
        if (content) {
          const matches = content.matchAll(/@using\s+([\w.]+)/g);
          for (const m of matches) {
            if (!usings.includes(m[1])) {
              usings.push(m[1]);
            }
          }
        }
        break;
      }

      const content = this.getFileContent(importsPath);
      if (content) {
        const matches = content.matchAll(/@using\s+([\w.]+)/g);
        for (const m of matches) {
          if (!usings.includes(m[1])) {
            usings.push(m[1]);
          }
        }
        break;
      }

      dir = dir.substring(0, dir.lastIndexOf('/'));
    }

    this.razorUsingsCache.set(filePath, usings);
    return usings;
  }

  // ===================================================================
  // IResolutionContext
  // ===================================================================

  getNodeById(id: string): INode | null {
    const cached = this.nodeCache.get(id);
    if (cached && cached.length > 0) return cached[0];

    const node = this.queries.getNodeById(id);
    if (node) {
      this.nodeCache.set(id, [node]);
    }
    return node;
  }

  getNodesByFile(filePath: string): INode[] {
    const cached = this.nodeCache.get(`file:${filePath}`);
    if (cached) return cached;

    const nodes = this.queries.getNodesByFile(filePath);
    this.nodeCache.set(`file:${filePath}`, nodes);
    return nodes;
  }

  getNodesByName(name: string): INode[] {
    const cached = this.nameCache.get(name);
    if (cached) return cached;

    const nodes = this.queries.getNodesByName(name);
    this.nameCache.set(name, nodes);
    return nodes;
  }

  getNodesByKind(_kind: NodeKind): INode[] {
    return this.queries.getNodesByKind(_kind);
  }

  getNodesByQualifiedName(qualifiedName: string): INode[] {
    const cached = this.qualifiedNameCache.get(qualifiedName);
    if (cached) return cached;

    const nodes = this.queries.getNodesByQualifiedNameExact(qualifiedName);
    this.qualifiedNameCache.set(qualifiedName, nodes);
    return nodes;
  }

  getNodesByLowerName(lowerName: string): INode[] {
    const cached = this.lowerNameCache.get(lowerName);
    if (cached) return cached;

    const nodes = this.queries.getNodesByLowerName(lowerName);
    this.lowerNameCache.set(lowerName, nodes);
    return nodes;
  }

  getSupertypes(nodeId: string): INode[] {
    const edges = this.queries.getOutgoingEdges(nodeId, ['extends', 'implements']);
    const targets = this.queries.getNodesByIds(edges.map((e) => e.target));
    return edges.map((e) => targets.get(e.target)).filter((n): n is INode => n !== undefined);
  }

  getChildren(nodeId: string): INode[] {
    const edges = this.queries.getOutgoingEdges(nodeId, ['contains']);
    const targets = this.queries.getNodesByIds(edges.map((e) => e.target));
    return edges.map((e) => targets.get(e.target)).filter((n): n is INode => n !== undefined);
  }

  getAncestors(nodeId: string): INode[] {
    const result: INode[] = [];
    const visited = new Set<string>();
    let currentId = nodeId;

    while (true) {
      if (visited.has(currentId)) break;
      visited.add(currentId);

      const containingEdges = this.queries.getIncomingEdges(currentId, ['contains']);
      const firstEdge = containingEdges[0];
      if (!firstEdge) break;

      const parentNode = this.queries.getNodeById(firstEdge.source);
      if (parentNode) {
        result.push(parentNode);
        currentId = parentNode.id;
      } else {
        break;
      }
    }

    return result;
  }

  getIncomingEdges(nodeId: string): IEdge[] {
    return this.queries.getIncomingEdges(nodeId);
  }

  getOutgoingEdges(nodeId: string): IEdge[] {
    return this.queries.getOutgoingEdges(nodeId);
  }

  getFileContent(filePath: string): string | null {
    const cached = this.fileCache.get(filePath);
    if (cached !== undefined) return cached;

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      this.fileCache.set(filePath, content);
      return content;
    } catch {
      this.fileCache.set(filePath, null);
      return null;
    }
  }

  getFilePathFromNodeId(nodeId: string): string | null {
    const node = this.queries.getNodeById(nodeId);
    return node?.filePath ?? null;
  }

  getLanguageFromNodeId(nodeId: string): Language | null {
    const node = this.queries.getNodeById(nodeId);
    return node?.language ?? null;
  }

  getAllFiles(): string[] {
    return this.queries.getAllFilePaths();
  }

  getImportMappings(filePath: string): IImportMapping[] {
    const cached = this.importMappingCache.get(filePath);
    if (cached) return cached;

    const content = this.getFileContent(filePath);
    if (!content) {
      this.importMappingCache.set(filePath, []);
      return [];
    }

    const node = this.queries.getNodeById(filePath);
    const language = node?.language ?? 'unknown';

    const mappings = extractImportMappings(filePath, content, language);
    this.importMappingCache.set(filePath, mappings);
    return mappings;
  }

  getReExports(filePath: string, _language?: Language): IReExport[] {
    const cached = this.reExportCache.get(filePath);
    if (cached) return cached;

    const content = this.getFileContent(filePath);
    if (!content) {
      this.reExportCache.set(filePath, []);
      return [];
    }

    const node = this.queries.getNodeById(filePath);
    const language = node?.language ?? 'unknown';

    const reExports = extractReExports(content, language);
    this.reExportCache.set(filePath, reExports);
    return reExports;
  }

  /**
   * Потоковая итерация узлов вида один за другим вместо материализации.
   */
  iterateNodesByKind(kind: NodeKind): IterableIterator<INode> {
    return this.queries.iterateNodesByKind(kind);
  }

  /**
   * readFile(filePath), разбитый на строки, LRU-cached на файл.
   */
  getFileLines(filePath: string): string[] | null {
    const cached = this.fileLinesCache.get(filePath);
    if (cached !== undefined) return cached;

    const content = this.getFileContent(filePath);
    if (!content) {
      this.fileLinesCache.set(filePath, null);
      return null;
    }

    const lines = content.split('\n');
    this.fileLinesCache.set(filePath, lines);
    return lines;
  }

  /**
   * Узлы method-определений, соответствующих typeName::methodName в language.
   */
  getMethodMatches(typeName: string, methodName: string, language: Language): INode[] {
    const allMethods = this.queries.getNodesByKind(NodeKind.Method);
    return allMethods.filter(
      (n) =>
        n.language === language &&
        (n.name === `${typeName}::${methodName}` || n.name === `${typeName}.${methodName}`)
    );
  }

  /**
   * Прямые супертипы типа с именем typeName (тот же язык): классы, которые он
   * расширяет, и интерфейсы/протоколы/черты, которые он реализует.
   */
  getSupertypesByName(typeName: string, language: Language): string[] {
    const nodes = this.queries.getNodesByQualifiedNameExact(typeName);
    if (nodes.length === 0) return [];

    const edges = this.queries.getOutgoingEdges(nodes[0]!.id, [EdgeKind.Extends, EdgeKind.Implements]);
    const targets = this.queries.getNodesByIds(edges.map((e) => e.target));

    return edges
      .map((e) => targets.get(e.target))
      .filter((n): n is INode => n !== undefined)
      .map((n) => n.name);
  }

  /**
   * Список непосредственных поддиректорий relativePath (относительно корня проекта).
   */
  listDirectories(relativePath: string): string[] {
    const fullPath = this.projectRoot + '/' + relativePath;
    try {
      const entries = fs.readdirSync(fullPath, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return [];
    }
  }

  /**
   * Директории поиска include для C/C++ (относительно корня проекта).
   */
  getCppIncludeDirs(): string[] {
    const cmakePath = this.projectRoot + '/CMakeLists.txt';
    const content = this.getFileContent(cmakePath);
    if (!content) return [];

    const dirs: string[] = [];
    const regex = /include_directories\s*\(\s*([^)]+)\s*\)/g;
    let match;

    while ((match = regex.exec(content)) !== null) {
      const args = match[1];
      if (args.includes('SYSTEM')) continue;

      const paths = args.split(/\s+/);
      for (const p of paths) {
        const trimmed = p.trim().replace(/^["']|["']$/g, '');
        if (trimmed) dirs.push(trimmed);
      }
    }

    return dirs;
  }

  // Ленивая загрузка
  getProjectAliases(): IAliasMap | null {
    if (this.projectAliases === undefined) {
      const raw = loadProjectAliases(this.projectRoot);
      if (!raw) {
        this.projectAliases = null;
      } else {
        // Конвертация AliasMap → IAliasMap
        const result: IAliasMap = {};
        for (const pattern of raw.patterns) {
          const key = pattern.prefix + (pattern.hasWildcard ? '*' : '');
          result[key] = pattern.replacements;
        }
        this.projectAliases = result;
      }
    }
    return this.projectAliases;
  }

  getGoModule(): IGoModule | null {
    if (this.goModule === undefined) {
      const raw = loadGoModule(this.projectRoot);
      if (!raw) {
        this.goModule = null;
      } else {
        this.goModule = {
          modulePath: raw.modulePath,
          goVersion: '',
          dependencies: new Map(),
        };
      }
    }
    return this.goModule;
  }

  getWorkspacePackages(): IWorkspacePackages | null {
    if (this.workspacePackages === undefined) {
      const raw = loadWorkspacePackages(this.projectRoot);
      if (!raw) {
        this.workspacePackages = null;
      } else {
        this.workspacePackages = {
          packages: raw.byName as unknown as Map<string, string>,
          workspaces: Array.from(raw.byName.keys()),
        };
      }
    }
    return this.workspacePackages;
  }
}
