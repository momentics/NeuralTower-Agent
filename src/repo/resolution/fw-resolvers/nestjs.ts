/**
 * Фреймворк-резолвер для NestJS.
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
const LANGUAGES: Language[] = ['typescript'];

/** String-aware чтение аргументов (...). */
function readArgs(s: string, start: number): string {
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
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (depth === 0) return s.substring(start, i).trim();
  }
  return s.substring(start).trim();
}

/** Нахождение декораторов с string-aware балансировкой скобок. */
function findDecorators(content: string): Array<{ name: string; args: string; line: number }> {
  const result: Array<{ name: string; args: string; line: number }> = [];
  const re = /@(\w+)\s*(?:\(([^)]*)\))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const name = m[1];
    const lineNum = content.substring(0, m.index).split('\n').length;
    let args = m[2] || '';

    // Если аргументы содержат вложенные скобки, читаем правильно
    if (m[2]) {
      const parenStart = content.indexOf('(', m.index + m[0].length - (m[2] ? m[2].length + 2 : 1));
      if (parenStart >= 0) {
        const parenEnd = content.indexOf(')', parenStart + 1);
        if (parenEnd > parenStart) {
          args = content.substring(parenStart + 1, parenEnd).trim();
        }
      }
    }

    result.push({ name, args, line: lineNum });
  }
  return result;
}

/** Определение границ классов (controller/resolver/gateway). */
function buildClassScopes(content: string): Array<{ name: string; startLine: number; endLine: number }> {
  const scopes: Array<{ name: string; startLine: number; endLine: number }> = [];
  const re = /class\s+(\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const name = m[1];
    const startLine = content.substring(0, m.index).split('\n').length;
    // Находим закрывающую скобку класса
    const braceStart = content.indexOf('{', m.index);
    if (braceStart >= 0) {
      let depth = 1;
      for (let i = braceStart + 1; i < content.length; i++) {
        if (content[i] === '{') depth++;
        if (content[i] === '}') depth--;
        if (depth === 0) {
          const endLine = content.substring(0, i).split('\n').length;
          scopes.push({ name, startLine, endLine });
          break;
        }
      }
    }
  }
  return scopes;
}

/** Определение имени метода после декоратора (пропуск stacked decorators). */
function methodNameAfter(content: string, decoratorLine: number): string | null {
  const lines = content.split('\n');
  for (let i = decoratorLine; i < lines.length; i++) {
    const line = lines[i]?.trim() || '';
    if (!line.startsWith('@')) {
      const m = line.match(/(?:async\s+)?(\w+)\s*\(/);
      if (m) return m[1];
      return null;
    }
  }
  return null;
}

/** Обнаружение NestJS проекта. */
function detectNestJS(context: IResolutionContext): boolean {
  const files = context.getAllFiles();

  // Проверяем package.json
  const pkgFile = files.find((f) => f === 'package.json');
  if (pkgFile) {
    const content = context.getFileContent?.(pkgFile);
    if (content) {
      try {
        const pkg = JSON.parse(content);
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (deps['@nestjs/core']) return true;
        // Проверяем @nestjs/*
        for (const key of Object.keys(deps)) {
          if (key.startsWith('@nestjs/')) return true;
        }
      } catch {
        // JSON не разобран — пропускаем
      }
    }
  }

  // Проверяем файлы *.controller.ts / *.module.ts / *.resolver.ts / *.gateway.ts
  const nestFiles = files.filter((f) =>
    /\.(controller|module|resolver|gateway)\.ts$/.test(f)
  );
  for (const f of nestFiles) {
    const content = context.getFileContent?.(f);
    if (content && /@(?:Controller|Module|Resolver|WebSocketGateway)\s*\(/.test(content)) {
      return true;
    }
  }

  return false;
}

/** Извлечение HTTP routes. */
function extractHttpRoutes(
  filePath: string,
  content: string
): IFrameworkExtractionResult {
  const nodes: INode[] = [];
  const references: IUnresolvedReference[] = [];

  // @Controller(prefix)
  const controllerRe = /@Controller\s*\(\s*["']([^"']*)["']/;
  const cm = content.match(controllerRe);
  const prefix = cm ? cm[1] : '';

  // @Get, @Post и т.д.
  const methodRe = /@(?:Get|Post|Put|Delete|Patch)\s*(?:\(\s*["']([^"']*)["']\s*\))?/g;
  let m: RegExpExecArray | null;
  while ((m = methodRe.exec(content))) {
    const methodPath = m[1] || '/';
    const lineNum = content.substring(0, m.index).split('\n').length;
    const fullPath = prefix + methodPath;

    nodes.push({
      id: crypto.createHash('sha256').update(`route:${filePath}:${fullPath}`).digest('hex'),
      kind: NodeKind.Route,
      name: fullPath,
      qualifiedName: `${filePath}#${fullPath}`,
      filePath,
      language: 'typescript',
      startLine: lineNum,
      endLine: lineNum,
      startColumn: 0,
      endColumn: m[0].length,
      updatedAt: Date.now(),
    });
  }

  return { nodes, references };
}

/** Извлечение GraphQL operations. */
function extractGraphQLRoutes(
  filePath: string,
  content: string
): IFrameworkExtractionResult {
  const nodes: INode[] = [];
  const references: IUnresolvedReference[] = [];

  // Только внутри @Resolver класса
  if (!/@Resolver/.test(content)) return { nodes, references };

  const resolverRe = /@Resolver\s*\(\s*(\w+)/;
  const rm = content.match(resolverRe);
  const entity = rm ? rm[1] : '';

  // @Query, @Mutation, @Subscription
  const opRe = /@(?:Query|Mutation|Subscription)\s*(?:\(\s*["']([^"']*)["']\s*\))?/g;
  let m: RegExpExecArray | null;
  while ((m = opRe.exec(content))) {
    const opName = m[1] || '';
    const lineNum = content.substring(0, m.index).split('\n').length;

    nodes.push({
      id: crypto.createHash('sha256').update(`graphql:${filePath}:${opName}`).digest('hex'),
      kind: NodeKind.Route,
      name: opName || `graphql_${lineNum}`,
      qualifiedName: `${filePath}#${opName}`,
      filePath,
      language: 'typescript',
      startLine: lineNum,
      endLine: lineNum,
      startColumn: 0,
      endColumn: m[0].length,
      metadata: { entity },
      updatedAt: Date.now(),
    });
  }

  return { nodes, references };
}

/** Извлечение Microservice handlers. */
function extractMicroserviceRoutes(
  filePath: string,
  content: string
): IFrameworkExtractionResult {
  const nodes: INode[] = [];
  const references: IUnresolvedReference[] = [];

  // @MessagePattern, @EventPattern
  const patternRe = /@(?:MessagePattern|EventPattern)\s*\(\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = patternRe.exec(content))) {
    const pattern = m[1];
    const lineNum = content.substring(0, m.index).split('\n').length;

    nodes.push({
      id: crypto.createHash('sha256').update(`microservice:${filePath}:${pattern}`).digest('hex'),
      kind: NodeKind.Route,
      name: pattern,
      qualifiedName: `${filePath}#${pattern}`,
      filePath,
      language: 'typescript',
      startLine: lineNum,
      endLine: lineNum,
      startColumn: 0,
      endColumn: m[0].length,
      updatedAt: Date.now(),
    });
  }

  return { nodes, references };
}

/** Извлечение WebSocket handlers. */
function extractWebSocketRoutes(
  filePath: string,
  content: string
): IFrameworkExtractionResult {
  const nodes: INode[] = [];
  const references: IUnresolvedReference[] = [];

  // @WebSocketGateway(namespace)
  const gatewayRe = /@WebSocketGateway\s*\(\s*["']?([^"'\n,}]*)["']?/;
  const gm = content.match(gatewayRe);
  const namespace = gm ? gm[1] : '';

  // @SubscribeMessage(event)
  const subRe = /@SubscribeMessage\s*\(\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = subRe.exec(content))) {
    const event = m[1];
    const lineNum = content.substring(0, m.index).split('\n').length;

    nodes.push({
      id: crypto.createHash('sha256').update(`ws:${filePath}:${namespace}:${event}`).digest('hex'),
      kind: NodeKind.Route,
      name: `${namespace}/${event}`,
      qualifiedName: `${filePath}#${namespace}/${event}`,
      filePath,
      language: 'typescript',
      startLine: lineNum,
      endLine: lineNum,
      startColumn: 0,
      endColumn: m[0].length,
      updatedAt: Date.now(),
    });
  }

  return { nodes, references };
}

/** Резолвер NestJS. */
const nestjsResolver: IFrameworkResolver = {
  name: 'NestJS',
  languages: LANGUAGES,

  detect: detectNestJS,

  resolve(ref: IUnresolvedReference, context: IResolutionContext): IResolvedRef | null {
    const name = ref.referenceName;

    // Provider/controller refs (Service$, Controller$, Resolver$ и т.д.)
    if (/Service$/.test(name) || /Controller$/.test(name) || /Resolver$/.test(name)) {
      const nodes = context.getNodesByName(name).filter((n) => n.kind === 'class');
      if (nodes.length === 1) {
        return {
          original: ref,
          targetNodeId: nodes[0]!.id,
          confidence: 0.85,
          provenance: 'nestjs-provider',
        };
      }
    }

    return null;
  },

  extract(filePath: string, content: string): IFrameworkExtractionResult {
    const allNodes: INode[] = [];
    const allRefs: IUnresolvedReference[] = [];

    // HTTP routes
    if (filePath.endsWith('.controller.ts')) {
      const httpResult = extractHttpRoutes(filePath, content);
      allNodes.push(...httpResult.nodes);
      allRefs.push(...httpResult.references);
    }

    // GraphQL operations
    if (filePath.endsWith('.resolver.ts')) {
      const gqlResult = extractGraphQLRoutes(filePath, content);
      allNodes.push(...gqlResult.nodes);
      allRefs.push(...gqlResult.references);
    }

    // Microservice handlers
    const microResult = extractMicroserviceRoutes(filePath, content);
    allNodes.push(...microResult.nodes);
    allRefs.push(...microResult.references);

    // WebSocket handlers
    if (filePath.endsWith('.gateway.ts')) {
      const wsResult = extractWebSocketRoutes(filePath, content);
      allNodes.push(...wsResult.nodes);
      allRefs.push(...wsResult.references);
    }

    return { nodes: allNodes, references: allRefs };
  },

  postExtract(context: IResolutionContext): INode[] {
    // RouterModule.register([...]) — кросс-файловая финализация префиксов маршрутов
    const nodes: INode[] = [];

    // Ищем файлы с RouterModule.register
    const files = context.getAllFiles();
    for (const f of files) {
      const content = context.getFileContent?.(f);
      if (!content) continue;

      // Ищем RouterModule.register([{ path: '...', children: [...] }])
      const registerRe = /RouterModule\.register\s*\(\s*\[\s*\{\s*path\s*:\s*["']([^"']+)["']\s*,\s*children\s*:\s*\[\s*([^\]]+)\]/g;
      let m: RegExpExecArray | null;
      while ((m = registerRe.exec(content))) {
        const prefix = m[1];
        const children = m[2];

        // Извлекаем контроллеры из children
        const controllerRe = /(\w+)Controller/g;
        let cm: RegExpExecArray | null;
        while ((cm = controllerRe.exec(children))) {
          const controllerName = cm[1];
          const controllerNodes = context.getNodesByName(controllerName).filter(
            (n) => n.kind === 'class'
          );
          if (controllerNodes.length > 0) {
            // Обновляем route-узлы с префиксом
            const existingRoutes = context.getNodesByKind('route');
            for (const route of existingRoutes) {
              if (route.filePath === f && !route.name.startsWith(prefix)) {
                // Создаём обновлённый узел с префиксом
                nodes.push({
                  ...route,
                  name: `${prefix}${route.name}`,
                  qualifiedName: `${f}#${prefix}${route.name}`,
                });
              }
            }
          }
        }
      }
    }

    return nodes;
  },
};

registerFrameworkResolver(nestjsResolver);
