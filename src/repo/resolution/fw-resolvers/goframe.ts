/**
 * Фреймворк-резолвер для GoFrame.
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

/** Встроенные методы ghttp.RouterGroup. */
const GOFRADE_ROUTE_METHODS = new Set([
  'GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS',
  'BindGroup', 'Prefix', 'Middleware', 'SHUTDOWN',
]);

/** Встроенные зависимости GoFrame. */
const GOFRADE_DEPS = new Set([
  'g', 'gf', 'ghttp', 'gdb', 'glog', 'gvar', 'gjson',
  'gvalid', 'gtime', 'gstr', 'gctx', 'gconv',
]);

/** Обнаружение GoFrame проекта. */
function detectGoFrame(context: IResolutionContext): boolean {
  const files = context.getAllFiles();

  // Проверяем go.mod
  const goModFile = files.find((f) => f === 'go.mod');
  if (goModFile) {
    const content = context.getFileContent?.(goModFile);
    if (content && /github\.com\/go-frame\/go-frame/i.test(content)) return true;
  }

  // Проверяем Go файлы на импорты GoFrame
  const goFiles = files.filter((f) => f.endsWith('.go'));
  for (const f of goFiles) {
    const content = context.getFileContent?.(f);
    if (content && /"github\.com\/go-frame\/go-frame\//.test(content)) {
      return true;
    }
  }

  return false;
}

/** Извлечение route-узлов из GoFrame. */
function extractGoFrameRoutes(filePath: string, content: string): IFrameworkExtractionResult {
  const nodes: INode[] = [];
  const references: IUnresolvedReference[] = [];

  // s.Group("/path", func(group *ghttp.RouterGroup) { ... })
  const groupRe = /\.Group\s*\(\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = groupRe.exec(content))) {
    const groupPath = m[1];
    const lineNum = content.substring(0, m.index).split('\n').length;

    nodes.push({
      id: crypto.createHash('sha256').update(`group:${filePath}:${groupPath}`).digest('hex'),
      kind: NodeKind.Route,
      name: `group ${groupPath}`,
      qualifiedName: `${filePath}#${groupPath}`,
      filePath,
      language: 'go',
      startLine: lineNum,
      endLine: lineNum,
      startColumn: 0,
      endColumn: m[0].length,
      updatedAt: Date.now(),
    });
  }

  // s.GET("/path", handler) или group.GET("/path", handler)
  const verbRe = /\.(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s*\(\s*["']([^"']+)["']\s*,\s*(\w+)/g;
  while ((m = verbRe.exec(content))) {
    const verb = m[1];
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

  // s.Map(handler) — маппинг обработчиков
  const mapRe = /\.Map\s*\(\s*(\w+)/g;
  while ((m = mapRe.exec(content))) {
    const handler = m[1];
    const lineNum = content.substring(0, m.index).split('\n').length;

    references.push({
      fromNodeId: filePath,
      referenceName: handler,
      referenceKind: 'calls',
      line: lineNum,
      column: 0,
      filePath,
      language: 'go',
    });
  }

  // s.Bind(handler) — привязка обработчиков
  const bindRe = /\.Bind\s*\(\s*(\w+)/g;
  while ((m = bindRe.exec(content))) {
    const handler = m[1];
    const lineNum = content.substring(0, m.index).split('\n').length;

    references.push({
      fromNodeId: filePath,
      referenceName: handler,
      referenceKind: 'calls',
      line: lineNum,
      column: 0,
      filePath,
      language: 'go',
    });
  }

  return { nodes, references };
}

/** Извлечение middleware узлов из GoFrame. */
function extractGoFrameMiddleware(filePath: string, content: string): IFrameworkExtractionResult {
  const nodes: INode[] = [];
  const references: IUnresolvedReference[] = [];

  // s.Middleware(middleware.Func)
  const mwRe = /\.Middleware\s*\(\s*(\w+)(?:\.(\w+))?\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = mwRe.exec(content))) {
    const mwName = m[1];
    const lineNum = content.substring(0, m.index).split('\n').length;

    nodes.push({
      id: crypto.createHash('sha256').update(`middleware:${filePath}:${mwName}`).digest('hex'),
      kind: NodeKind.Component,
      name: mwName,
      qualifiedName: `${filePath}#${mwName}`,
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

/** Извлечение контроллеров GoFrame. */
function extractGoFrameControllers(filePath: string, content: string): IFrameworkExtractionResult {
  const nodes: INode[] = [];
  const references: IUnresolvedReference[] = [];

  // type XxxController struct{}
  const ctrlRe = /type\s+(\w+Controller)\s+struct\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = ctrlRe.exec(content))) {
    const ctrlName = m[1];
    const lineNum = content.substring(0, m.index).split('\n').length;

    nodes.push({
      id: crypto.createHash('sha256').update(`controller:${filePath}:${ctrlName}`).digest('hex'),
      kind: NodeKind.Class,
      name: ctrlName,
      qualifiedName: `${filePath}#${ctrlName}`,
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

/** Извлечение моделей GoFrame. */
function extractGoFrameModels(filePath: string, content: string): IFrameworkExtractionResult {
  const nodes: INode[] = [];
  const references: IUnresolvedReference[] = [];

  // type XxxModel struct{}
  const modelRe = /type\s+(\w+Model)\s+struct\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = modelRe.exec(content))) {
    const modelName = m[1];
    const lineNum = content.substring(0, m.index).split('\n').length;

    nodes.push({
      id: crypto.createHash('sha256').update(`model:${filePath}:${modelName}`).digest('hex'),
      kind: NodeKind.Class,
      name: modelName,
      qualifiedName: `${filePath}#${modelName}`,
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

/** Резолвер GoFrame. */
const goFrameResolver: IFrameworkResolver = {
  name: 'GoFrame',
  languages: LANGUAGES,

  detect: detectGoFrame,

  claimsReference(name: string): boolean {
    // GoFrame пакетные ссылки с . — могут не существовать как символы
    return GOFRADE_DEPS.has(name);
  },

  resolve(ref: IUnresolvedReference, context: IResolutionContext): IResolvedRef | null {
    const name = ref.referenceName;

    // Встроенные зависимости GoFrame
    if (GOFRADE_DEPS.has(name)) {
      return {
        original: ref,
        targetNodeId: ref.fromNodeId,
        confidence: 1.0,
        provenance: 'goframe-dep',
      };
    }

    // *Controller
    if (/Controller$/.test(name)) {
      const nodes = context.getNodesByName(name).filter((n) => n.kind === 'struct' || n.kind === 'class');
      if (nodes.length === 1) {
        return {
          original: ref,
          targetNodeId: nodes[0]!.id,
          confidence: 0.85,
          provenance: 'goframe-controller',
        };
      }
    }

    // *Model
    if (/Model$/.test(name)) {
      const nodes = context.getNodesByName(name).filter((n) => n.kind === 'struct' || n.kind === 'class');
      if (nodes.length === 1) {
        return {
          original: ref,
          targetNodeId: nodes[0]!.id,
          confidence: 0.85,
          provenance: 'goframe-model',
        };
      }
    }

    // *Service
    if (/Service$/.test(name)) {
      const nodes = context.getNodesByName(name).filter((n) => n.kind === 'struct' || n.kind === 'class');
      if (nodes.length === 1) {
        return {
          original: ref,
          targetNodeId: nodes[0]!.id,
          confidence: 0.85,
          provenance: 'goframe-service',
        };
      }
    }

    // *Logic
    if (/Logic$/.test(name)) {
      const nodes = context.getNodesByName(name).filter((n) => n.kind === 'struct' || n.kind === 'class');
      if (nodes.length === 1) {
        return {
          original: ref,
          targetNodeId: nodes[0]!.id,
          confidence: 0.85,
          provenance: 'goframe-logic',
        };
      }
    }

    return null;
  },

  extract(filePath: string, content: string): IFrameworkExtractionResult {
    const allNodes: INode[] = [];
    const allRefs: IUnresolvedReference[] = [];

    // GoFrame routes
    const routeResult = extractGoFrameRoutes(filePath, content);
    allNodes.push(...routeResult.nodes);
    allRefs.push(...routeResult.references);

    // GoFrame middleware
    const mwResult = extractGoFrameMiddleware(filePath, content);
    allNodes.push(...mwResult.nodes);
    allRefs.push(...mwResult.references);

    // GoFrame controllers
    const ctrlResult = extractGoFrameControllers(filePath, content);
    allNodes.push(...ctrlResult.nodes);
    allRefs.push(...ctrlResult.references);

    // GoFrame models
    const modelResult = extractGoFrameModels(filePath, content);
    allNodes.push(...modelResult.nodes);
    allRefs.push(...modelResult.references);

    return { nodes: allNodes, references: allRefs };
  },
};

registerFrameworkResolver(goFrameResolver);
