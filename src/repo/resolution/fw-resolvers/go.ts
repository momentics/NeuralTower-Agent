/**
 * Фреймворк-резолвер для Go веб-фреймворков (Gin, Echo, Chi, gorilla/mux).
 *
 * Обрабатывает маршруты: r.GET("/path", handler), e.POST("/path", handler)
 * и групповые маршруты.
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
const LANGUAGES: Language[] = ['go'];

/** Обнаружение Go веб-фреймворка. */
function detectGoWeb(context: IResolutionContext): boolean {
  const files = context.getAllFiles();

  // Проверяем go.mod на gin, echo, chi, gorilla/mux
  const goMod = files.find((f) => f === 'go.mod');
  if (goMod) {
    const content = context.getFileContent?.(goMod);
    if (content && /(gin|echo|chi|gorilla\/mux)/i.test(content)) return true;
  }

  // Проверяем Go файлы на импорты фреймворков
  const goFiles = files.filter((f) => f.endsWith('.go'));
  for (const f of goFiles) {
    const content = context.getFileContent?.(f);
    if (content && /(gin|echo|chi|gorilla\/mux)/i.test(content)) return true;
  }

  return false;
}

/** Извлечение route-узлов из Gin/Echo/Chi. */
function extractGoRoutes(filePath: string, content: string): IFrameworkExtractionResult {
  const nodes: INode[] = [];
  const references: IUnresolvedReference[] = [];

  // r.GET("/path", handler), r.POST("/path", handler) и т.д.
  const routeRe = /\.([Gg][Ee][Tt]|[Pp][Oo][Ss][Tt]|[Pp][Uu][Tt]|[Dd][Ee][Ll][Ee][Tt][Ee]|[Pp][Aa][Tt][Cc][Hh]|[Oo][Pp][Tt][Ii][Oo][Nn][Ss])\s*\(\s*["']([^"']+)["']\s*,\s*(\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = routeRe.exec(content))) {
    const verb = m[1].toUpperCase();
    const routePath = m[2];
    const handler = m[3];
    const lineNum = content.substring(0, m.index).split('\n').length;

    const routeNode: INode = {
      id: crypto.createHash('sha256').update(`route:${filePath}:${routePath}`).digest('hex'),
      kind: NodeKind.Route,
      name: `${verb} ${routePath}`,
      qualifiedName: `${filePath}#${routePath}`,
      filePath,
      language: 'go',
      startLine: lineNum,
      endLine: lineNum,
      startColumn: 0,
      endColumn: m[0].length,
      updatedAt: Date.now(),
    };
    nodes.push(routeNode);

    references.push({
      fromNodeId: routeNode.id,
      referenceName: handler,
      referenceKind: 'calls',
      line: lineNum,
      column: 0,
      filePath,
      language: 'go',
    });
  }

  // gorilla/mux: r.HandleFunc("/path", handler).Methods("GET") — маршрутизация
  const muxRe = /\.HandleFunc\s*\(\s*["']([^"']+)["']\s*,\s*(\w+)/g;
  while ((m = muxRe.exec(content))) {
    const routePath = m[1];
    const handler = m[2];
    const lineNum = content.substring(0, m.index).split('\n').length;

    const routeNode: INode = {
      id: crypto.createHash('sha256').update(`route:${filePath}:${routePath}`).digest('hex'),
      kind: NodeKind.Route,
      name: routePath,
      qualifiedName: `${filePath}#${routePath}`,
      filePath,
      language: 'go',
      startLine: lineNum,
      endLine: lineNum,
      startColumn: 0,
      endColumn: m[0].length,
      updatedAt: Date.now(),
    };
    nodes.push(routeNode);

    references.push({
      fromNodeId: routeNode.id,
      referenceName: handler,
      referenceKind: 'calls',
      line: lineNum,
      column: 0,
      filePath,
      language: 'go',
    });
  }

  // r.Group("/api") — групповые маршруты
  const groupRe = /\.Group\s*\(\s*["']([^"']+)["']\s*\)/g;
  while ((m = groupRe.exec(content))) {
    const groupPath = m[1];
    const lineNum = content.substring(0, m.index).split('\n').length;

    nodes.push({
      id: crypto.createHash('sha256').update(`group:${filePath}:${groupPath}`).digest('hex'),
      kind: NodeKind.Component,
      name: groupPath,
      qualifiedName: `${filePath}#group:${groupPath}`,
      filePath,
      language: 'go',
      startLine: lineNum,
      endLine: lineNum,
      startColumn: 0,
      endColumn: m[0].length,
      updatedAt: Date.now(),
    });
  }

  return { nodes, references };
}

/** Резолвер Go веб-фреймворков. */
const goWebResolver: IFrameworkResolver = {
  name: 'GoWeb',
  languages: LANGUAGES,

  detect: detectGoWeb,

  claimsReference(name: string): boolean {
    // Go-ссылки с пакетом (package.Func) — квалифицированные имена
    return name.includes('.');
  },

  resolve(ref: IUnresolvedReference, context: IResolutionContext): IResolvedRef | null {
    const name = ref.referenceName;

    // Go-ссылки с пакетом: gin.Context, echo.Context и т.д. — квалифицированные имена
    if (name.includes('.')) {
      const parts = name.split('.');
      const lastPart = parts[parts.length - 1];

      const nodes = context.getNodesByName(lastPart);
      if (nodes.length === 1) {
        return {
          original: ref,
          targetNodeId: nodes[0]!.id,
          confidence: 0.85,
          provenance: 'go-web-qualified',
        };
      }
    }

    // Handler-функции (обычно с суффиксом Handler) — обработчики маршрутов
    if (name.endsWith('Handler')) {
      const nodes = context.getNodesByName(name).filter(
        (n) => n.kind === 'function' || n.kind === 'method'
      );
      if (nodes.length === 1) {
        return {
          original: ref,
          targetNodeId: nodes[0]!.id,
          confidence: 0.9,
          provenance: 'go-web-handler',
        };
      }
    }

    return null;
  },

  extract(filePath: string, content: string): IFrameworkExtractionResult {
    const allNodes: INode[] = [];
    const allRefs: IUnresolvedReference[] = [];

    if (content.includes('.GET') || content.includes('.POST') ||
        content.includes('.PUT') || content.includes('.DELETE') ||
        content.includes('.HandleFunc') || content.includes('.Group')) {
      const result = extractGoRoutes(filePath, content);
      allNodes.push(...result.nodes);
      allRefs.push(...result.references);
    }

    return { nodes: allNodes, references: allRefs };
  },
};

registerFrameworkResolver(goWebResolver);
