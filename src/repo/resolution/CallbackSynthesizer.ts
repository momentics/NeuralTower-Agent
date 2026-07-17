/**
 * Синтез callback-рёбер для динамической диспетчеризации.
 *
 * Добавляет рёбра для обработчиков событий, callback-регистраций
 * и других форм динамической диспетчеризации.
 */

import type { QueryBuilder } from '../ntgraph/QueryBuilder';
import type { IEdge, IResolutionContext, INode } from '../ntgraph/Types';
import { EdgeKind } from '../ntgraph/Types';

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
  context: IResolutionContext
): IEdge[] {
  const edges: IEdge[] = [];

  try {
    // Синтез для React-обработчиков событий
    edges.push(...synthesizeReactCallbackEdges(queries, context));

    // Синтез для Vue-обработчиков событий
    edges.push(...synthesizeVueCallbackEdges(queries, context));

    // Синтез для Express маршрутов
    edges.push(...synthesizeExpressCallbackEdges(queries, context));

    // Синтез для Python декораторов
    edges.push(...synthesizePythonDecoratorEdges(queries, context));

    // Синтез для Java аннотаций
    edges.push(...synthesizeJavaAnnotationEdges(queries, context));
  } catch {
    // Синтез добавочный — ошибки не критичны
  }

  return edges;
}

/**
 * Синтез callback-рёбер для React-обработчиков событий.
 */
function synthesizeReactCallbackEdges(
  queries: QueryBuilder,
  context: IResolutionContext
): IEdge[] {
  const edges: IEdge[] = [];

  // Ищем узлы с декораторами onClick, onChange и т.д.
  const jsxKinds = ['typescript', 'javascript', 'tsx', 'jsx'] as const;

  for (const lang of jsxKinds) {
    for (const node of context.iterateNodesByKind?.('function') ?? []) {
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
  }

  return edges;
}

/**
 * Синтез callback-рёбер для Vue-обработчиков событий.
 */
function synthesizeVueCallbackEdges(
  _queries: QueryBuilder,
  _context: IResolutionContext
): IEdge[] {
  // Vue-обработчики событий: @click="handler" → рёбро к handler
  const edges: IEdge[] = [];

  for (const node of _context.iterateNodesByKind?.('method') ?? []) {
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
  _context: IResolutionContext
): IEdge[] {
  const edges: IEdge[] = [];

  // Ищем route-узлы
  for (const node of _context.iterateNodesByKind?.('route') ?? []) {
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
  _context: IResolutionContext
): IEdge[] {
  const edges: IEdge[] = [];

  // Ищем функции с декораторами
  for (const node of _context.iterateNodesByKind?.('function') ?? []) {
    if (node.language !== 'python') continue;
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
  _context: IResolutionContext
): IEdge[] {
  const edges: IEdge[] = [];

  // Ищем методы с аннотациями @RequestMapping, @GetMapping и т.д.
  for (const node of _context.iterateNodesByKind?.('method') ?? []) {
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
