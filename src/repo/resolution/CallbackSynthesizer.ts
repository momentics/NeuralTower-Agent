/**
 * Синтез callback-рёбер для динамической диспетчеризации.
 *
 * Добавляет рёбра для обработчиков событий, callback-регистраций
 * и других форм динамической диспетчеризации.
 */

import type { QueryBuilder } from '../ntgraph/QueryBuilder';
import type { IEdge, IResolutionContext, INode } from '../ntgraph/Types';
import { EdgeKind } from '../ntgraph/Types';

// Языки, поддерживающие переопределение методов интерфейса
const IFACE_OVERRIDE_LANGS = new Set([
  'java', 'kotlin', 'csharp', 'typescript', 'javascript', 'swift', 'scala', 'go', 'rust',
]);

// Языки для closure-collection dispatch (Swift, Kotlin)
const CC_LANGUAGES = new Set(['swift', 'kotlin']);

// Максимум диспетчеров/регистраторов на одно поле — слишком общее имя, отбрасываем
const CC_FANOUT_CAP = 8;

// Диспетчер: callbacks.forEach { $0() } или callbacks.forEach { it() }
const CC_DISPATCH_RE = /(\w+)\.forEach\s*\{\s*(?:\$0|it)\s*\(/g;

// Регистрация через write-блок: $0.streams.append(…) или $0.append(…)
const CC_APPEND_WRITE_RE = /(\w+)\.write\s*\{\s*\$0(?:\.(\w+))?\.(?:append|add|push|insert)\s*\(/g;

// Прямая регистрация: callbacks.append(handler)
const CC_APPEND_DIRECT_RE = /(\w+)\.(?:append|add|push|insert)\s*\(/g;
import { createYielder, type MaybeYield } from '../extraction/Orchestrator';

// =============================================================================
// Константы
// =============================================================================

/** Максимум callback-рёбер на один канал. */
const MAX_CALLBACKS_PER_CHANNEL = 40;

/**
 * Ленивый проход по всем method + function узлам (O(1) память).
 * Материализация всех узлов для однократной фильтрации приводит к OOM
 * на проектах с миллионами символов — итерация держит память постоянной.
 */
function* methodAndFunctionNodes(queries: QueryBuilder): IterableIterator<INode> {
  yield* queries.iterateNodesByKind('method');
  yield* queries.iterateNodesByKind('function');
}

/** Регулярное выражение для обнаружения this.setState() в React. */
const SETSTATE_RE = /this\.setState\s*\(/;

// =============================================================================
// Вспомогательные функции для closure-collection
// =============================================================================

/**
 * Вырезает строки из содержимого файла по номерам строк (1-based).
 */
function sliceLines(content: string, startLine: number, endLine: number): string | null {
  if (!startLine || !endLine) return null;
  return content.split('\n').slice(startLine - 1, endLine).join('\n');
}

/**
 * Создаёт функцию для определения номера строки по индексу в исходном тексте.
 * Использует бинарный поиск по индексу переносов строк.
 */
function makeLineAt(src: string, baseLine: number): (idx: number) => number {
  let nl: number[] | null = null;
  return (idx: number) => {
    if (!nl) {
      nl = [];
      for (let i = src.indexOf('\n'); i !== -1; i = src.indexOf('\n', i + 1)) nl.push(i);
    }
    let lo = 0;
    let hi = nl.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (nl[mid]! < idx) lo = mid + 1;
      else hi = mid;
    }
    return baseLine + lo;
  };
}

/**
 * Closure-collection dispatch: диспетчер итерирует коллекцию замыканий,
 * регистратор добавляет замыкание в ту же коллекцию.
 *
 * Для Swift/Kotlin методов ищет паттерны:
 * - Диспетчер: field.forEach { $0() } / field.forEach { it() }
 * - Регистратор: field.append(handler) / field.add(handler) / field.push(handler) / field.insert(handler)
 *
 * Создаёт calls-рёбра от диспетчера к регистратору по совпадению имени поля.
 */
function closureCollectionEdges(
  queries: QueryBuilder,
  context: IResolutionContext,
  onYield: MaybeYield
): IEdge[] {
  const dispatchers = new Map<string, Array<{ node: INode; line: number }>>();
  const registrars = new Map<string, Array<{ node: INode; line: number }>>();

  const addReg = (field: string | undefined, node: INode, absLine: number) => {
    if (!field || /^\d+$/.test(field)) return;
    const arr = registrars.get(field) ?? [];
    if (!arr.some((r) => r.node.id === node.id)) arr.push({ node, line: absLine });
    registrars.set(field, arr);
  };

  let scanned = 0;
  let matchTick = 0;

  for (const kind of ['method', 'function'] as const) {
    for (const m of queries.iterateNodesByKind(kind)) {
      if (++scanned % 64 === 0) onYield();
      if (!CC_LANGUAGES.has(m.language)) continue;

      const content = context.getFileContent(m.filePath);
      const src = content && sliceLines(content, m.startLine, m.endLine);
      if (!src) continue;

      const hasForEach = src.includes('.forEach');
      const hasAppend = src.includes('.append(') || src.includes('.add(') || src.includes('.push(') || src.includes('.insert(');
      if (!hasForEach && !hasAppend) continue;

      const lineAt = makeLineAt(src, m.startLine);

      if (hasForEach) {
        CC_DISPATCH_RE.lastIndex = 0;
        let d: RegExpExecArray | null;
        while ((d = CC_DISPATCH_RE.exec(src))) {
          if (++matchTick % 256 === 0) onYield();
          const arr = dispatchers.get(d[1]!) ?? [];
          if (!arr.some((n) => n.node.id === m.id)) arr.push({ node: m, line: lineAt(d.index) });
          dispatchers.set(d[1]!, arr);
        }
      }

      if (hasAppend) {
        CC_APPEND_WRITE_RE.lastIndex = 0;
        let w: RegExpExecArray | null;
        while ((w = CC_APPEND_WRITE_RE.exec(src))) {
          if (++matchTick % 256 === 0) onYield();
          addReg(w[2] || w[1], m, lineAt(w.index));
        }

        CC_APPEND_DIRECT_RE.lastIndex = 0;
        let a: RegExpExecArray | null;
        while ((a = CC_APPEND_DIRECT_RE.exec(src))) {
          if (++matchTick % 256 === 0) onYield();
          addReg(a[1], m, lineAt(a.index));
        }
      }
    }
  }

  const edges: IEdge[] = [];
  const seen = new Set<string>();

  for (const [field, disps] of dispatchers) {
    const regs = registrars.get(field);
    if (!regs || regs.length === 0) continue;
    if (disps.length > CC_FANOUT_CAP || regs.length > CC_FANOUT_CAP) continue;

    for (const disp of disps) {
      for (const reg of regs) {
        if (disp.node.id === reg.node.id) continue;
        const key = `${disp.node.id}>${reg.node.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({
          source: disp.node.id,
          target: reg.node.id,
          kind: EdgeKind.Calls,
          line: disp.line,
          provenance: 'heuristic',
          metadata: {
            synthesizedBy: 'closure-collection',
            field,
            registeredAt: `${reg.node.filePath}:${reg.line}`,
          },
        });
      }
    }
  }

  return edges;
}

// =============================================================================
// synthesizeCallbackEdges
// =============================================================================

/**
 * Синтез callback-рёбер для динамической диспетчеризации.
 *
 * Вызывается после batched разрешения. Оборачивается в try/catch,
 * так как синтез является добавочным и опциональным.
 */
export function synthesizeCallbackEdges(
  queries: QueryBuilder,
  context: IResolutionContext,
  onYield: MaybeYield = createYielder()
): IEdge[] {
  const edges: IEdge[] = [];

  try {
    // Синтез для React-обработчиков событий
    edges.push(...synthesizeReactCallbackEdges(queries, context, onYield));

    // Синтез для Vue-обработчиков событий
    edges.push(...synthesizeVueCallbackEdges(queries, context, onYield));

    // Синтез для Express маршрутов
    edges.push(...synthesizeExpressCallbackEdges(queries, context, onYield));

    // Синтез для Python декораторов
    edges.push(...synthesizePythonDecoratorEdges(queries, context, onYield));

    // Синтез для Java аннотаций
    edges.push(...synthesizeJavaAnnotationEdges(queries, context, onYield));

    // Синтез React setState → render
    edges.push(...reactRenderEdges(queries, context, onYield));

    // Синтез для C++ virtual override
    edges.push(...cppOverrideEdges(queries, context, onYield));

    // Связь методов интерфейса с реализациями
    edges.push(...interfaceOverrideEdges(queries, context, onYield));

    // Closure-collection dispatch для Swift/Kotlin
    edges.push(...closureCollectionEdges(queries, context, onYield));

    // Связь Go-методов с типами-получателями в разных файлах
    edges.push(...goCrossFileMethodContainsEdges(queries, context, onYield));

    // Структурное определение реализации интерфейсов в Go
    edges.push(...goImplementsEdges(queries, context, onYield));
  } catch {
    // Синтез добавочный — ошибки не критичны
  }

  return edges;
}

/** Проход синтеза рёбер. */
export interface ISynthPass {
  name: string;
  run(queries: QueryBuilder, context: IResolutionContext, onYield: MaybeYield): Promise<IEdge[]>;
}

/** Доступные проходы синтеза. */
export const SYNTH_PASSES: ISynthPass[] = [
  {
    name: 'callback',
    run: async (queries: QueryBuilder, context: IResolutionContext, onYield: MaybeYield) =>
      synthesizeCallbackEdges(queries, context, onYield),
  },
];

/**
 * Синтез callback-рёбер для React-обработчиков событий.
 */
function synthesizeReactCallbackEdges(
  queries: QueryBuilder,
  context: IResolutionContext,
  onYield: MaybeYield
): IEdge[] {
  const edges: IEdge[] = [];

  // Ищем узлы с декораторами onClick, onChange и т.д.
  const jsxKinds = ['typescript', 'javascript', 'tsx', 'jsx'] as const;
  let count = 0;

  for (const node of methodAndFunctionNodes(queries)) {
    if (++count % 100 === 0) onYield();
    if (!jsxKinds.includes(node.language as any)) continue;

    // Проверяем, является ли функция обработчиком события
    const eventName = extractReactEventName(node.name);
    if (!eventName) continue;

    // Ищем, где используется эта функция
    const usages = queries.getIncomingEdges(node.id, [EdgeKind.References]);
    for (const edge of usages) {
      const sourceNode = queries.getNodeById(edge.source);
      if (sourceNode && sourceNode.kind === 'component') {
        edges.push({
          source: sourceNode.id,
          target: node.id,
          kind: EdgeKind.Calls,
          metadata: {
            synthesizedBy: 'react-event-handler',
            event: eventName,
            registeredAt: `${sourceNode.filePath}:${sourceNode.startLine}`,
          },
          provenance: 'heuristic',
        });
      }
    }
  }

  return edges;
}

/**
 * Синтез callback-рёбер для Vue-обработчиков событий.
 */
function synthesizeVueCallbackEdges(
  _queries: QueryBuilder,
  _context: IResolutionContext,
  onYield: MaybeYield
): IEdge[] {
  // Vue-обработчики событий: @click="handler" → рёбро к handler
  const edges: IEdge[] = [];
  let count = 0;

  for (const node of methodAndFunctionNodes(_queries)) {
    if (++count % 100 === 0) onYield();
    if (node.language !== 'vue' && node.language !== 'typescript' && node.language !== 'javascript') continue;

    const eventName = extractVueEventName(node.name);
    if (!eventName) continue;

    // Ищем компонент-родителя
    const ancestors = _context.getAncestors(node.id);
    for (const ancestor of ancestors) {
      if (ancestor.kind === 'component') {
        edges.push({
          source: ancestor.id,
          target: node.id,
          kind: EdgeKind.Calls,
          metadata: {
            synthesizedBy: 'vue-event-handler',
            event: eventName,
          },
          provenance: 'heuristic',
        });
        break;
      }
    }
  }

  return edges;
}

/**
 * Синтез callback-рёбер для Express маршрутов.
 */
function synthesizeExpressCallbackEdges(
  queries: QueryBuilder,
  _context: IResolutionContext,
  onYield: MaybeYield
): IEdge[] {
  const edges: IEdge[] = [];
  let count = 0;

  // Ищем route-узлы
  for (const node of _context.iterateNodesByKind?.('route') ?? []) {
    if (++count % 100 === 0) onYield();
    if (!['typescript', 'javascript'].includes(node.language)) continue;

    // Ищем исходящие рёбра calls к handler-функциям
    const callEdges = queries.getOutgoingEdges(node.id, [EdgeKind.Calls]);
    for (const edge of callEdges) {
      const target = queries.getNodeById(edge.target);
      if (target && target.kind === 'function') {
        edges.push({
          source: node.id,
          target: target.id,
          kind: EdgeKind.Calls,
          metadata: {
            synthesizedBy: 'express-route',
            via: 'app.get/app.post/etc',
          },
          provenance: 'heuristic',
        });
      }
    }
  }

  return edges;
}

/**
 * Синтез callback-рёбер для Python декораторов.
 */
function synthesizePythonDecoratorEdges(
  queries: QueryBuilder,
  _context: IResolutionContext,
  onYield: MaybeYield
): IEdge[] {
  const edges: IEdge[] = [];
  let count = 0;

  // Ищем функции с декораторами
  for (const node of methodAndFunctionNodes(queries)) {
    if (!node.decorators || node.decorators.length === 0) continue;

    for (const decorator of node.decorators) {
      // Ищем декоратор
      const decoratorNodes = _context.getNodesByName(decorator);
      for (const dn of decoratorNodes) {
        if (dn.kind === 'function') {
          edges.push({
            source: node.id,
            target: dn.id,
            kind: EdgeKind.Decorates,
            metadata: {
              synthesizedBy: 'python-decorator',
              decorator: decorator,
            },
            provenance: 'heuristic',
          });
        }
      }

      // Flask route декораторы
      if (decorator.startsWith('@') || decorator.includes('route')) {
        const routeEdges = queries.getOutgoingEdges(node.id, [EdgeKind.Calls]);
        for (const edge of routeEdges) {
          edges.push({
            source: node.id,
            target: edge.target,
            kind: EdgeKind.Calls,
            metadata: {
              synthesizedBy: 'flask-route',
              via: decorator,
            },
            provenance: 'heuristic',
          });
        }
      }
    }
  }

  return edges;
}

/**
 * Синтез callback-рёбер для Java аннотаций.
 */
function synthesizeJavaAnnotationEdges(
  _queries: QueryBuilder,
  _context: IResolutionContext,
  onYield: MaybeYield
): IEdge[] {
  const edges: IEdge[] = [];
  let count = 0;

  // Ищем методы с аннотациями @RequestMapping, @GetMapping и т.д.
  for (const node of methodAndFunctionNodes(_queries)) {
    if (++count % 100 === 0) onYield();
    if (node.language !== 'java' && node.language !== 'kotlin') continue;
    if (!node.decorators || node.decorators.length === 0) continue;

    for (const decorator of node.decorators) {
      if (decorator.includes('RequestMapping') || decorator.includes('GetMapping') ||
          decorator.includes('PostMapping') || decorator.includes('PutMapping') ||
          decorator.includes('DeleteMapping')) {
        // Ищем контроллер-родителя
        const ancestors = _context.getAncestors(node.id);
        for (const ancestor of ancestors) {
          if (ancestor.kind === 'class') {
            edges.push({
              source: ancestor.id,
              target: node.id,
              kind: EdgeKind.Calls,
              metadata: {
                synthesizedBy: 'spring-route',
                via: decorator,
              },
              provenance: 'heuristic',
            });
            break;
          }
        }
      }
    }
  }

  return edges;
}

/**
 * Синтез рёбер React setState → render.
 *
 * Для каждого класса, содержащего метод render:
 * ищет методы с вызовами this.setState() и создаёт
 * calls-рёбра от этих методов к render.
 */
function reactRenderEdges(
  queries: QueryBuilder,
  context: IResolutionContext,
  onYield: MaybeYield
): IEdge[] {
  const edges: IEdge[] = [];
  const seen = new Set<string>();
  let scanned = 0;

  // Собираем классы, содержащие метод render
  const renderOwners = new Set<string>();
  for (const n of context.getNodesByName('render')) {
    if (n.kind !== 'method') continue;
    for (const e of queries.getIncomingEdges(n.id, [EdgeKind.Contains])) {
      renderOwners.add(e.source);
    }
  }

  if (renderOwners.size === 0) return edges;

  // Проходим по всем классам
  for (const cls of queries.iterateNodesByKind('class')) {
    if (++scanned % 64 === 0) onYield();
    if (!renderOwners.has(cls.id)) continue;

    // Получаем все методы класса
    const children = queries
      .getOutgoingEdges(cls.id, [EdgeKind.Contains])
      .map((e) => queries.getNodeById(e.target))
      .filter((n): n is INode => !!n && n.kind === 'method');

    const render = children.find((n) => n.name === 'render');
    if (!render) continue;

    let added = 0;
    for (const m of children) {
      if (added >= MAX_CALLBACKS_PER_CHANNEL) break;
      if (m.id === render.id) continue;

      // Проверяем наличие setState в методе
      const content = context.getFileContent(m.filePath);
      if (!content) continue;

      const lines = content.split('\n');
      const src = lines.slice(m.startLine - 1, m.endLine).join('\n');
      if (!SETSTATE_RE.test(src)) continue;

      const key = `${m.id}>${render.id}`;
      if (seen.has(key)) continue;
      seen.add(key);

      edges.push({
        source: m.id,
        target: render.id,
        kind: EdgeKind.Calls,
        line: m.startLine,
        provenance: 'heuristic',
        metadata: {
          synthesizedBy: 'react-render',
          via: 'setState',
          registeredAt: `${render.filePath}:${render.startLine}`,
        },
      });
      added++;
    }
  }

  return edges;
}

/**
 * Синтез рёбер C++ virtual override.
 *
 * Для каждого C++ класса с parent через extends-ребро:
 * для каждого метода родительского класса ищет метод с тем же именем
 * в дочернем классе и создаёт overrides-ребро Base::method → Derived::method.
 */
function cppOverrideEdges(
  queries: QueryBuilder,
  _context: IResolutionContext,
  onYield: MaybeYield
): IEdge[] {
  const edges: IEdge[] = [];
  const seen = new Set<string>();
  let count = 0;

  // Получает все method-узлы, contained в заданном классе
  const methodsOf = (classId: string): INode[] =>
    queries
      .getOutgoingEdges(classId, [EdgeKind.Contains])
      .map((e) => queries.getNodeById(e.target))
      .filter((n): n is INode => !!n && n.kind === 'method');

  for (const cls of queries.iterateNodesByKind('class')) {
    if (++count % 100 === 0) onYield();
    if (cls.language !== 'cpp') continue;

    const subMethods = methodsOf(cls.id);
    if (subMethods.length === 0) continue;

    for (const ext of queries.getOutgoingEdges(cls.id, [EdgeKind.Extends])) {
      const base = queries.getNodeById(ext.target);
      if (!base || base.language !== 'cpp' || base.id === cls.id) continue;

      const baseMethods = new Map(methodsOf(base.id).map((m) => [m.name, m]));

      for (const m of subMethods) {
        const bm = baseMethods.get(m.name);
        if (!bm || bm.id === m.id) continue;

        const key = `${bm.id}>${m.id}`;
        if (seen.has(key)) continue;
        seen.add(key);

        edges.push({
          source: bm.id,
          target: m.id,
          kind: EdgeKind.Overrides,
          metadata: {
            synthesizedBy: 'cpp-override',
            via: m.name,
            registeredAt: `${m.filePath}:${m.startLine}`,
          },
          provenance: 'heuristic',
        });
      }
    }
  }

  return edges;
}

// =============================================================================
// interfaceOverrideEdges
// =============================================================================

/**
 * Связывает методы интерфейса с их реализациями в классах.
 *
 * Для каждого класса (или struct) с ребром implements/extends к интерфейсу:
 * группирует методы класса по имени, затем для каждого метода интерфейса
 * создаёт overrides-ребро к каждому методу реализации с тем же именем.
 */
function interfaceOverrideEdges(
  queries: QueryBuilder,
  _context: IResolutionContext,
  onYield: MaybeYield
): IEdge[] {
  const edges: IEdge[] = [];
  const seen = new Set<string>();
  let count = 0;

  // Кэширует method-узлы, contained в узле (мемоизация для популярных интерфейсов)
  const methodsMemo = new Map<string, INode[]>();
  const methodsOf = (nodeId: string): INode[] => {
    const hit = methodsMemo.get(nodeId);
    if (hit) return hit;
    const methods = queries
      .getOutgoingEdges(nodeId, [EdgeKind.Contains])
      .map((e) => queries.getNodeById(e.target))
      .filter((n): n is INode => !!n && n.kind === 'method');
    methodsMemo.set(nodeId, methods);
    return methods;
  };

  // Виды конкретных типов: class — Java/Kotlin/C#/TS/Scala, struct — Swift value types
  const concreteKinds = ['class', 'struct'] as const;
  for (const kind of concreteKinds) {
    for (const cls of queries.iterateNodesByKind(kind)) {
      if (++count % 64 === 0) onYield();

      // Пропускаем классы без supertype-рёбер — большинство классов не реализуют ничего
      const sups = queries.getOutgoingEdges(cls.id, [EdgeKind.Implements, EdgeKind.Extends]);
      if (sups.length === 0) continue;

      const implMethods = methodsOf(cls.id).filter((n) => IFACE_OVERRIDE_LANGS.has(n.language));
      if (implMethods.length === 0) continue;

      for (const sup of sups) {
        const base = queries.getNodeById(sup.target);
        if (!base || !IFACE_OVERRIDE_LANGS.has(base.language) || base.id === cls.id) continue;

        // Группируем методы реализации по имени для обработки перегрузок
        const implByName = new Map<string, INode[]>();
        for (const m of implMethods) {
          const arr = implByName.get(m.name);
          if (arr) arr.push(m);
          else implByName.set(m.name, [m]);
        }

        let added = 0;
        for (const bm of methodsOf(base.id)) {
          if (added >= MAX_CALLBACKS_PER_CHANNEL) break;
          for (const m of implByName.get(bm.name) ?? []) {
            if (added >= MAX_CALLBACKS_PER_CHANNEL) break;
            if (bm.id === m.id) continue;

            const key = `${bm.id}>${m.id}`;
            if (seen.has(key)) continue;
            seen.add(key);

            edges.push({
              source: bm.id,
              target: m.id,
              kind: EdgeKind.Overrides,
              line: bm.startLine,
              provenance: 'heuristic',
              metadata: {
                synthesizedBy: 'interface-impl',
                via: m.name,
                registeredAt: `${m.filePath}:${m.startLine}`,
              },
            });
            added++;
          }
        }
      }
    }
  }

  return edges;
}

// =============================================================================
// goImplementsEdges
// =============================================================================

/**
 * Структурное определение реализации интерфейсов в Go.
 *
 * Для каждого Go-интерфейса собирает имена методов, затем проверяет каждый
 * Go-struct на наличие всех этих методов. Если struct реализует все методы
 * интерфейса, создаёт implements-ребро struct → interface.
 */
function goImplementsEdges(
  queries: QueryBuilder,
  _context: IResolutionContext,
  onYield: MaybeYield
): IEdge[] {
  const edges: IEdge[] = [];
  const seen = new Set<string>();
  let count = 0;

  // Собирает имена методов, contained в узле
  const methodNameSet = (id: string): Set<string> =>
    new Set(
      queries
        .getOutgoingEdges(id, [EdgeKind.Contains])
        .map((e) => queries.getNodeById(e.target))
        .filter((n): n is INode => !!n && n.kind === 'method')
        .map((n) => n.name)
    );

  // Материализуем только Go-structs (проход ограничен по языку)
  const goStructs: INode[] = [];
  for (const s of queries.iterateNodesByKind('struct')) {
    if (++count % 64 === 0) onYield();
    if (s.language === 'go') goStructs.push(s);
  }

  const structMethods = new Map<string, Set<string>>();
  for (const s of goStructs) structMethods.set(s.id, methodNameSet(s.id));

  for (const iface of queries.iterateNodesByKind('interface')) {
    if (++count % 64 === 0) onYield();
    if (iface.language !== 'go') continue;

    const want = methodNameSet(iface.id);
    if (want.size === 0) continue;

    let added = 0;
    for (const s of goStructs) {
      if (added >= MAX_CALLBACKS_PER_CHANNEL) break;
      const have = structMethods.get(s.id);
      if (!have || have.size < want.size) continue;

      let all = true;
      for (const m of want) {
        if (!have.has(m)) { all = false; break; }
      }
      if (!all) continue;

      const key = `${s.id}>${iface.id}`;
      if (seen.has(key)) continue;
      seen.add(key);

      edges.push({
        source: s.id,
        target: iface.id,
        kind: EdgeKind.Implements,
        line: s.startLine,
        provenance: 'heuristic',
        metadata: {
          synthesizedBy: 'go-implements',
          via: iface.name,
          registeredAt: `${s.filePath}:${s.startLine}`,
        },
      });
      added++;
    }
  }

  return edges;
}

// =============================================================================
// goCrossFileMethodContainsEdges
// =============================================================================

/**
 * Связывает Go-методы с типами-получателями в разных файлах.
 *
 * Для каждого Go-метода извлекает тип-получатель из квалифицированного имени
 * (например, User.Save → получатель User). Если метод не имеет contains-ребра
 * от типа-владельца в том же файле, ищет тип в том же каталоге (пакете)
 * и создаёт contains-ребро.
 */
function goCrossFileMethodContainsEdges(
  queries: QueryBuilder,
  _context: IResolutionContext,
  onYield: MaybeYield
): IEdge[] {
  const edges: IEdge[] = [];
  const seen = new Set<string>();
  const typeKinds = new Set(['struct', 'class', 'interface', 'enum', 'type_alias']);
  let count = 0;

  for (const method of queries.iterateNodesByKind('method')) {
    if (++count % 100 === 0) onYield();
    if (method.language !== 'go') continue;

    const qn = method.qualifiedName;
    if (!qn) continue;

    const sep = qn.lastIndexOf('::');
    if (sep <= 0) continue;

    const receiver = qn.slice(0, sep);
    if (!receiver) continue;

    // Проверяем, есть ли уже contains-ребро от типа-владельца
    const incoming = queries.getIncomingEdges(method.id, [EdgeKind.Contains]);
    const hasTypeParent = incoming.some((e) => {
      const src = queries.getNodeById(e.source);
      return src != null && typeKinds.has(src.kind);
    });
    if (hasTypeParent) continue;

    // Ищем тип-получатель в том же каталоге (пакете Go)
    const methodDir = getDir(method.filePath);
    const candidates = queries.getNodesByName(receiver);
    const owner = candidates.find(
      (n) => n.language === 'go' && typeKinds.has(n.kind) && getDir(n.filePath) === methodDir
    );
    if (!owner) continue;

    const key = `${owner.id}>${method.id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    edges.push({
      source: owner.id,
      target: method.id,
      kind: EdgeKind.Contains,
      line: method.startLine,
      provenance: 'heuristic',
      metadata: {
        synthesizedBy: 'go-cross-file-method',
        via: receiver,
        registeredAt: `${method.filePath}:${method.startLine}`,
      },
    });
  }

  return edges;
}

// =============================================================================
// Вспомогательные функции
// =============================================================================

/**
 * Извлечение имени React-события из имени обработчика.
 * onClick → click, onChange → change
 */
function extractReactEventName(name: string): string | null {
  const match = name.match(/^on([A-Z]\w+)$/);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Извлечение имени Vue-события из имени обработчика.
 * handleClick → click
 */
function extractVueEventName(name: string): string | null {
  const match = name.match(/^handle([A-Z]\w+)$/);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Извлечение каталога из пути файла.
 */
function getDir(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const i = normalized.lastIndexOf('/');
  return i >= 0 ? normalized.slice(0, i) : '';
}
