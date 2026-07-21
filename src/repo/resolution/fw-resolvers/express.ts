/**
 * Фреймворк-резолвер для Express и Node.js.
 */

import type {
  IFrameworkResolver,
  IUnresolvedReference,
  IResolvedRef,
  IResolutionContext,
  INode,
  IFrameworkExtractionResult,
  Language,
} from '../../ntgraph/Types';
import { NodeKind } from '../../ntgraph/Types';
import { registerFrameworkResolver } from '../Frameworks';
import * as crypto from 'crypto';

/** Языки, к которым применим резолвер. */
const LANGUAGES: Language[] = ['typescript', 'javascript'];

/** Вызовы res/req методов и JS builtins, которые НЕ являются бизнес-флоу. */
const RESERVED_CALLS = new Set([
  'json', 'send', 'sendFile', 'render', 'redirect', 'status', 'end',
  'write', 'setHeader', 'append', 'location', 'cookie', 'clearCookie',
  'format', 'params', 'query', 'body', 'headers', 'ip', 'method',
  'get', 'accepts', 'range', 'is', 'stale', 'fresh', 'signedCookies',
  'originalUrl', 'url', 'path', 'hostname', 'protocol', 'secure',
  'xhr', 'subdomains', 'query', 'params', 'splat', 'route',
  'push', 'pop', 'map', 'filter', 'reduce', 'forEach', 'find',
  'includes', 'indexOf', 'toString', 'valueOf', 'then', 'catch',
  'resolve', 'reject', 'log', 'error', 'warn', 'info',
]);

/** Обнаружение Express проекта. */
function detectExpress(context: IResolutionContext): boolean {
  const files = context.getAllFiles();

  // Проверяем package.json
  const pkgFile = files.find((f) => f === 'package.json');
  if (pkgFile) {
    const content = context.getFileContent?.(pkgFile);
    if (content) {
      try {
        const pkg = JSON.parse(content);
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (deps.express || deps.fastify || deps.koa || deps.hapi) return true;
      } catch {
        // JSON не разобран — пропускаем
      }
    }
  }

  // Проверяем файлы с routes/controllers/middleware в пути
  const routeFiles = files.filter((f) =>
    /routes|controllers|middleware/i.test(f) && /\.(ts|js)$/.test(f)
  );
  for (const f of routeFiles) {
    const content = context.getFileContent?.(f);
    if (content && /(?:app|router)\.(?:get|post|put|delete|patch|use)\s*\(/.test(content)) {
      return true;
    }
  }

  return false;
}

/** String-aware балансировка скобок для извлечения тела. */
function matchDelim(s: string, start: number, open: string, close: string): number {
  let depth = 1;
  let inStr = false;
  let strChar = '';
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === strChar) inStr = false;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      inStr = true;
      strChar = c;
      continue;
    }
    if (c === open) depth++;
    if (c === close) depth--;
    if (depth === 0) return i;
  }
  return s.length;
}

/** Извлечение route-узлов из Express. */
function extractExpressRoutes(filePath: string, content: string): IFrameworkExtractionResult {
  const nodes: INode[] = [];
  const references: IUnresolvedReference[] = [];

  // app.VERB('/path', handler) или router.VERB('/path', handler)
  const routeRe = /\b(?:app|router)\.(get|post|put|delete|patch|use)\s*\(\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = routeRe.exec(content))) {
    const verb = m[1].toUpperCase();
    const routePath = m[2];
    const lineNum = content.substring(0, m.index).split('\n').length;

    const routeNode: INode = {
      id: crypto.createHash('sha256').update(`route:${filePath}:${routePath}`).digest('hex'),
      kind: NodeKind.Route,
      name: `${verb} ${routePath}`,
      qualifiedName: `${filePath}#${routePath}`,
      filePath,
      language: filePath.endsWith('.ts') ? 'typescript' : 'javascript',
      startLine: lineNum,
      endLine: lineNum,
      startColumn: 0,
      endColumn: m[0].length,
      updatedAt: Date.now(),
    };
    nodes.push(routeNode);

    // Находим обработчик — ищем закрывающую скобку
    const openParen = content.indexOf('(', m.index + m[0].length - 1);
    if (openParen >= 0) {
      const closeParen = matchDelim(content, openParen + 1, '(', ')');
      const args = content.substring(openParen + 1, closeParen).trim();

      // Проверяем inline arrow handler
      const arrowIdx = args.indexOf('=>');
      if (arrowIdx >= 0) {
        const bodyStart = content.indexOf('{', openParen + arrowIdx);
        if (bodyStart >= 0) {
          const bodyEnd = matchDelim(content, bodyStart + 1, '{', '}');
          const body = content.substring(bodyStart + 1, bodyEnd);

          // Ищем вызовы в теле (исключая RESERVED_CALLS)
          const callRe = /(\w+)\s*\(/g;
          let cm: RegExpExecArray | null;
          while ((cm = callRe.exec(body))) {
            const callName = cm[1];
            if (!RESERVED_CALLS.has(callName) && !/^(req|res|next|ctx)$/.test(callName)) {
              references.push({
                fromNodeId: routeNode.id,
                referenceName: callName,
                referenceKind: 'calls',
                line: lineNum,
                column: 0,
                filePath,
                language: routeNode.language,
              });
            }
          }
        }
      } else {
        // Named handler — последняя функция в аргументах
        const lastArg = args.split(',').pop()?.trim();
        if (lastArg && lastArg !== 'next') {
          references.push({
            fromNodeId: routeNode.id,
            referenceName: lastArg,
            referenceKind: 'calls',
            line: lineNum,
            column: 0,
            filePath,
            language: routeNode.language,
          });
        }
      }
    }
  }

  return { nodes, references };
}

/** Резолвер Express. */
const expressResolver: IFrameworkResolver = {
  name: 'Express',
  languages: LANGUAGES,

  detect: detectExpress,

  claimsReference(name: string): boolean {
    // Controller.method — могут не существовать как символы
    return name.includes('.');
  },

  resolve(ref: IUnresolvedReference, context: IResolutionContext): IResolvedRef | null {
    const name = ref.referenceName;

    // Controller.method
    if (name.includes('.')) {
      const [controllerName, methodName] = name.split('.');
      const controllers = context.getNodesByName(controllerName).filter(
        (n) => n.kind === 'class' || n.kind === 'function'
      );
      if (controllers.length === 1) {
        const children = context.getChildren(controllers[0]!.id);
        const method = children.find((c) => c.kind === 'method' && c.name === methodName);
        if (method) {
          return {
            original: ref,
            targetNodeId: method.id,
            confidence: 0.9,
            provenance: 'express-controller',
          };
        }
      }
    }

    // Service.method
    if (name.endsWith('.method') || name.includes('.method')) {
      const parts = name.split('.');
      if (parts.length === 2) {
        const [svcName, methodName] = parts;
        const services = context.getNodesByName(svcName).filter(
          (n) => n.kind === 'class' || n.kind === 'function'
        );
        if (services.length === 1) {
          const children = context.getChildren(services[0]!.id);
          const method = children.find((c) => c.kind === 'method' && c.name === methodName);
          if (method) {
            return {
              original: ref,
              targetNodeId: method.id,
              confidence: 0.85,
              provenance: 'express-service',
            };
          }
        }
      }
    }

    // Middleware — ищем по имени
    if (/^(auth|cors|helmet|bodyParser|compression|morgan|rateLimit|passport|session|cookieParser|csrf|csurf)$/.test(name)) {
      const nodes = context.getNodesByName(name);
      if (nodes.length === 1) {
        return {
          original: ref,
          targetNodeId: nodes[0]!.id,
          confidence: 0.8,
          provenance: 'express-middleware',
        };
      }
    }

    return null;
  },

  extract(filePath: string, content: string): IFrameworkExtractionResult {
    return extractExpressRoutes(filePath, content);
  },
};

registerFrameworkResolver(expressResolver);
