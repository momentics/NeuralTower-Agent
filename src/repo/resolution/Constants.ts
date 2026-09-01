/**
 * Константы для модуля разрешения ссылок.
 */

import type { NodeKind } from '../ntgraph/Types';

/** Узлы высокой ценности для приоритизации в обходе. */
export const HIGH_VALUE_NODE_KINDS = new Set<NodeKind>([
  'function', 'method', 'class', 'interface', 'type_alias', 'struct',
  'trait', 'component', 'route', 'variable', 'constant', 'enum',
  'module', 'namespace',
]);

/** Узлы, которые могут иметь супертипы. */
export const SUPERTYPE_BEARING_KINDS = new Set<NodeKind>([
  'class', 'struct', 'interface', 'trait', 'protocol', 'enum',
]);

/** Узлы-контейнеры для анализа радиуса воздействия. */
export const CONTAINER_NODE_KINDS = new Set<NodeKind>([
  'class', 'interface', 'struct', 'trait', 'protocol', 'module', 'enum',
]);

/** Языки для цепных вызовов статических фабрик / fluent. */
export const CHAIN_LANGUAGES = new Set([
  'java', 'kotlin', 'csharp', 'swift', 'rust', 'go', 'scala', 'dart', 'objc', 'pascal', 'cpp',
]);

/** Языки для scoped-цепей (::). */
export const SCOPED_CHAIN_LANGUAGES = new Set(['rust', 'php']);

/** Форма цепного вызова: Foo().bar(). */
export const CHAIN_SHAPE = /^(.+)\(\)\.(\w+)$/;

/** Максимальное число шагов в цепочке вызовов. */
export const MAX_HOPS = 6;

/** Дефолтный лимит кэша. */
export const DEFAULT_CACHE_LIMIT = 5_000;

/** Дефолтные опции для точного поиска узлов (findNodesByExactName и аналоги). */
import type { ISearchOptions } from '../ntgraph/Types';
export const DEFAULT_FIND_OPTIONS: ISearchOptions = {
  kinds: Array.from(HIGH_VALUE_NODE_KINDS),
  limit: 3,
  caseSensitive: false,
};

/**
 * Порог числа кандидатов с одинаковым именем, при превышении которого
 * fuzzy-совпадение отключается — имя считается «вездесущим» (например,
 * `init`/`update`/`render` в каждом виджете вложенной темы). Настраивается
 * через переменную среды `NTGRAPH_AMBIGUOUS_NAME_CEILING`.
 */
const DEFAULT_AMBIGUOUS_NAME_CEILING = 500;
function resolveAmbiguousNameCeiling(): number {
  const raw = process.env.NTGRAPH_AMBIGUOUS_NAME_CEILING;
  if (!raw) return DEFAULT_AMBIGUOUS_NAME_CEILING;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_AMBIGUOUS_NAME_CEILING;
}
export const AMBIGUOUS_NAME_CEILING = resolveAmbiguousNameCeiling();
