/**
 * Синтез рёбер GoFrame: route → controller-method (#747).
 *
 * GoFrame привязывает маршруты рефлективно (`group.Bind(user.NewV1())`), поэтому
 * маршрут, объявленный в теге `g.Meta` типа запроса, не имеет статического ребра
 * к методу, который его обслуживает. Эта проходная функция закрывает цикл,
 * соединяя каждый маршрут с его обработчиком.
 *
 * Ключ соединения — ТИП ЗАПРОСА, а не имя метода — имена методов GoFrame
 * произвольны (`DeptSearchReq` обслуживается `List`, `DeptAddReq` — `Add`),
 * так что единственная надёжная связь — тип запроса в сигнатуре обработчика:
 *
 *   func (c *sysDeptController) Add(ctx context.Context, req *system.DeptAddReq) (…)
 *                                                              ^^^^^^^^^^^^^^^^  ключ
 *
 * Узлы Go-методов уже содержат сигнатуру, поэтому повторное чтение источника
 * не требуется. Каждое синтезированное ребро — `kind:'calls'`,
 * `provenance:'heuristic'`, `metadata.synthesizedBy:'goframe-route'` — мост
 * рефлективной диспетчеризации.
 */

import type { QueryBuilder } from '../ntgraph/QueryBuilder';
import type { IEdge, IResolutionContext, INode } from '../ntgraph/Types';
import { EdgeKind } from '../ntgraph/Types';
import { createYielder, type MaybeYield } from '../extraction/Orchestrator';

/** Маркер GoFrame-маршрута в квалифицированном имени route-узла. */
export const GOFRAME_ROUTE_MARKER = 'goframe:';

/** Предел рёбер-фан-аут — защита от аномалий; реальные приложения: 1 маршрут → 1 метод. */
const FANOUT_CAP = 2000;

/**
 * Типы указательных параметров в сигнатуре Go-метода, в квалифицированной
 * и неквалифицированной формах: `(ctx context.Context, req *cash.ListReq)` →
 * `["cash.ListReq", "ListReq"]`. Квалифицированная форма различает множество
 * одинаковых неквалифицированных имён; неквалифицированная — запасной вариант
 * для обработчика в том же пакете.
 */
function pointerParamTypes(sig: string): string[] {
  const out: string[] = [];
  const re = /\*\s*(?:(\w+)\.)?([A-Z]\w*)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sig)) !== null) {
    if (m[1]) out.push(`${m[1]}.${m[2]}`);
    out.push(m[2]!);
  }
  return out;
}

/**
 * Корневой модуль addon-плагина в пути (`addons/hgexample/…` → `hgexample`),
 * или `''` для основного приложения. Крупные GoFrame-приложения поставляют
 * демо-аддоны, которые дублируют целое дерево модулей — одинаковые имена
 * пакетов и типы запросов — так что квалификатор пакета не может отличить
 * `config.GetReq` аддона от `config.GetReq` ядра. Корень аддона может.
 */
function addonRoot(p: string): string {
  return /(?:^|\/)addons\/([^/]+)\//.exec(p)?.[1] ?? '';
}

/**
 * Выбирает один обработчик для маршрута из кандидатов с одинаковым типом запроса.
 * Обычно один кандидат. Когда несколько разделяют тип запроса (клонированный
 * addon-модуль), оставляет методы в директории controller, затем тот, что
 * в том же модуле, что и маршрут. Оставшаяся неоднозначность ⇒ без ребра.
 */
function selectHandler(candidates: INode[], routeFile: string): INode | null {
  if (candidates.length === 1) return candidates[0]!;
  let cands = candidates.filter((h) => /\/controller(s)?\//.test(h.filePath));
  if (cands.length === 0) cands = candidates;
  if (cands.length === 1) return cands[0]!;
  const ar = addonRoot(routeFile);
  const sameModule = cands.filter((h) => addonRoot(h.filePath) === ar);
  return sameModule.length === 1 ? sameModule[0]! : null;
}

/**
 * Синтез рёбер GoFrame: route → controller-method.
 *
 * Для каждого GoFrame-маршрута (route-узел с `g.Meta` метаданными)
 * находит метод-обработчик по типу запроса в сигнатуре и создаёт
 * calls-ребро от маршрута к методу контроллера.
 */
export function synthesizeGoframeEdges(
  _queries: QueryBuilder,
  context: IResolutionContext,
  onYield: MaybeYield = createYielder()
): IEdge[] {
  const edges: IEdge[] = [];
  const seen = new Set<string>();
  let scanned = 0;

  // Route-узлы, созданные экстрактором GoFrame, сгруппированы по
  // квалифицированному типу запроса (`cash.ListReq`). `wanted` хранит
  // все ключи, которые может совпасть сигнатура обработчика.
  const routesByReqType = new Map<string, INode[]>();
  const wanted = new Set<string>();

  for (const route of context.iterateNodesByKind?.('route') ?? context.getNodesByKind('route')) {
    if ((++scanned & 63) === 0) onYield();
    if (route.language !== 'go') continue;
    const marker = route.qualifiedName.indexOf(GOFRAME_ROUTE_MARKER);
    if (marker < 0) continue;
    const joinKey = route.qualifiedName.slice(marker + GOFRAME_ROUTE_MARKER.length);
    if (!joinKey) continue;
    let arr = routesByReqType.get(joinKey);
    if (!arr) { arr = []; routesByReqType.set(joinKey, arr); }
    arr.push(route);
    wanted.add(joinKey);
    const dot = joinKey.lastIndexOf('.');
    if (dot >= 0) wanted.add(joinKey.slice(dot + 1)); // неквалифицированный запасной вариант
  }

  if (routesByReqType.size === 0) return edges;

  // Кандидаты-обработчики: Go-методы, чья сигнатура принимает указатель
  // на тип запроса из `wanted`, индексированы по каждой совпадающей форме.
  const handlersByKey = new Map<string, INode[]>();

  for (const method of context.iterateNodesByKind?.('method') ?? context.getNodesByKind('method')) {
    if ((++scanned & 63) === 0) onYield();
    if (method.language !== 'go' || !method.signature) continue;
    for (const t of pointerParamTypes(method.signature)) {
      if (!wanted.has(t)) continue;
      let arr = handlersByKey.get(t);
      if (!arr) { arr = []; handlersByKey.set(t, arr); }
      arr.push(method);
    }
  }

  let added = 0;
  for (const [joinKey, routes] of routesByReqType) {
    const bare = joinKey.includes('.') ? joinKey.slice(joinKey.lastIndexOf('.') + 1) : joinKey;
    // Точное квалифицированное совпадение пакета первым; неквалифицированный тип — запасной.
    const candidates = handlersByKey.get(joinKey) ?? handlersByKey.get(bare);
    if (!candidates || candidates.length === 0) continue;
    const requestType = bare;

    for (const route of routes) {
      const handler = selectHandler(candidates, route.filePath);
      if (!handler || route.id === handler.id) continue;
      const key = `${route.id}>${handler.id}`;
      if (seen.has(key) || added >= FANOUT_CAP) continue;
      seen.add(key);

      edges.push({
        source: route.id,
        target: handler.id,
        kind: EdgeKind.Calls,
        line: route.startLine,
        provenance: 'heuristic',
        metadata: {
          synthesizedBy: 'goframe-route',
          route: route.name,
          requestType,
          registeredAt: `${handler.filePath}:${handler.startLine}`,
        },
      });
      added++;
    }
  }

  return edges;
}
