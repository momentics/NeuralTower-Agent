/**
 * Фреймворк-резолвер для Astro.
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
const LANGUAGES: Language[] = ['typescript', 'javascript', 'astro'];

/** Встроенные хелперы Astro. */
const ASTRO_HELPERS = new Set([
  'getStaticPaths', 'render', 'createContentCollection', 'getCollection',
  'createAsset', 'getImage', 'getImageSet', 'getEndpoint',
]);

/** Автоматически импортируемые функции Astro. */
const ASTRO_AUTO_IMPORTS = new Set([
  'Astro', 'defineConfig', 'defineRoute', 'getCollection',
]);

/** Обнаружение Astro проекта. */
function detectAstro(context: IResolutionContext): boolean {
  const files = context.getAllFiles();

  // Проверяем package.json
  const pkgFile = files.find((f) => f === 'package.json');
  if (pkgFile) {
    const content = context.getFileContent?.(pkgFile);
    if (content) {
      try {
        const pkg = JSON.parse(content);
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (deps.astro) return true;
      } catch {
        // JSON не разобран — пропускаем
      }
    }
  }

  // Проверяем astro.config.mjs
  if (files.some((f) => f.startsWith('astro.config'))) return true;

  // Проверяем .astro файлы
  if (files.some((f) => f.endsWith('.astro'))) return true;

  return false;
}

/** Конвертация пути Astro pages/ в маршрут. */
function astroPageToRoute(filePath: string): string {
  let route = filePath
    .replace(/^pages\//, '')
    .replace(/\/index\.astro$/, '')
    .replace(/\.astro$/, '');

  // [...slug].astro → *slug
  route = route.replace(/\[\.\.\.([^\]]+)\]/g, '*$1');
  // [slug].astro → :slug
  route = route.replace(/\[([^\]]+)\]/g, ':$1');

  return route.startsWith('/') ? route : `/${route}`;
}

/** Извлечение route-узлов из Astro pages/. */
function extractAstroPageRoutes(filePath: string, language: Language): IFrameworkExtractionResult {
  const nodes: INode[] = [];
  const references: IUnresolvedReference[] = [];

  if (!filePath.startsWith('pages/')) return { nodes, references };

  const routePath = astroPageToRoute(filePath);

  nodes.push({
    id: crypto.createHash('sha256').update(`route:${filePath}:${routePath}`).digest('hex'),
    kind: NodeKind.Route,
    name: routePath,
    qualifiedName: `${filePath}#${routePath}`,
    filePath,
    language,
    startLine: 1,
    endLine: 1,
    startColumn: 0,
    endColumn: 0,
    updatedAt: Date.now(),
  });

  return { nodes, references };
}

/** Извлечение API endpoint-узлов из Astro pages/api/. */
function extractAstroApiRoutes(filePath: string, content: string, language: Language): IFrameworkExtractionResult {
  const nodes: INode[] = [];
  const references: IUnresolvedReference[] = [];

  if (!filePath.startsWith('pages/api/') || !filePath.endsWith('.ts') && !filePath.endsWith('.js')) {
    return { nodes, references };
  }

  const routePath = astroPageToRoute(filePath).replace(/^\/api/, '/api');

  // Ищем export const get, post, put, delete, patch
  const handlerRe = /export\s+const\s+(get|post|put|delete|patch)\s*=/g;
  let m: RegExpExecArray | null;
  while ((m = handlerRe.exec(content))) {
    const verb = m[1].toUpperCase();
    const lineNum = content.substring(0, m.index).split('\n').length;

    const routeNode: INode = {
      id: crypto.createHash('sha256').update(`route:${filePath}:${routePath}`).digest('hex'),
      kind: NodeKind.Route,
      name: `${verb} ${routePath}`,
      qualifiedName: `${filePath}#${routePath}`,
      filePath,
      language,
      startLine: lineNum,
      endLine: lineNum,
      startColumn: 0,
      endColumn: m[0].length,
      updatedAt: Date.now(),
    };
    nodes.push(routeNode);
  }

  return { nodes, references };
}

/** Извлечение Astro middleware. */
function extractAstroMiddleware(filePath: string, language: Language): IFrameworkExtractionResult {
  const nodes: INode[] = [];
  const references: IUnresolvedReference[] = [];

  if (!filePath.startsWith('middleware')) return { nodes, references };

  const name = filePath
    .replace(/^middleware/, '')
    .replace(/\.\w+$/, '');

  nodes.push({
    id: crypto.createHash('sha256').update(`middleware:${filePath}:${name}`).digest('hex'),
    kind: NodeKind.Component,
    name: name || 'middleware',
    qualifiedName: `${filePath}#${name}`,
    filePath,
    language,
    startLine: 1,
    endLine: 1,
    startColumn: 0,
    endColumn: 0,
    updatedAt: Date.now(),
  });

  return { nodes, references };
}

/** Извлечение Astro content collections. */
function extractAstroContentCollections(filePath: string, content: string, language: Language): IFrameworkExtractionResult {
  const nodes: INode[] = [];
  const references: IUnresolvedReference[] = [];

  // content.config.ts — collection definitions
  if (!/content\.config\./.test(filePath)) return { nodes, references };

  // defineCollection({ ... })
  const collectionRe = /defineCollection\s*\(\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = collectionRe.exec(content))) {
    const lineNum = content.substring(0, m.index).split('\n').length;

    // Ищем имя коллекции в том же блоке
    const beforeMatch = content.substring(0, m.index);
    const nameRe = /(?:const|let|var)\s+(\w+)\s*=\s*defineCollection/g;
    const nm = beforeMatch.match(nameRe);
    const collName = nm ? nm[nm.length - 1] : `collection_${lineNum}`;

    nodes.push({
      id: crypto.createHash('sha256').update(`collection:${filePath}:${collName}`).digest('hex'),
      kind: NodeKind.Component,
      name: collName,
      qualifiedName: `${filePath}#${collName}`,
      filePath,
      language,
      startLine: lineNum,
      endLine: lineNum,
      startColumn: 0,
      endColumn: m[0].length,
      updatedAt: Date.now(),
    });
  }

  return { nodes, references };
}

/** Извлечение Astro integrations. */
function extractAstroIntegrations(filePath: string, content: string): IFrameworkExtractionResult {
  const nodes: INode[] = [];
  const references: IUnresolvedReference[] = [];

  if (!filePath.startsWith('astro.config')) return { nodes, references };

  // integrations: [someIntegration()]
  const integrationRe = /integrations\s*:\s*\[\s*\w+\(\s*\{/g;
  let im: RegExpExecArray | null;
  while ((im = integrationRe.exec(content))) {
    const lineNum = content.substring(0, im.index).split('\n').length;

    // Извлекаем имя интеграции
    const beforeMatch = content.substring(0, im.index);
    const intRe = /(\w+)\s*\(\s*\{/g;
    const im2 = beforeMatch.match(intRe);
    if (im2) {
      const intName = im2[im2.length - 1];
      nodes.push({
        id: crypto.createHash('sha256').update(`integration:${filePath}:${intName}`).digest('hex'),
        kind: NodeKind.Component,
        name: intName,
        qualifiedName: `${filePath}#${intName}`,
        filePath,
        language: 'javascript',
        startLine: lineNum,
        endLine: lineNum,
        startColumn: 0,
        endColumn: im[0].length,
        updatedAt: Date.now(),
      });
    }
  }

  return { nodes, references };
}

/** Резолвер Astro. */
const astroResolver: IFrameworkResolver = {
  name: 'Astro',
  languages: LANGUAGES,

  detect: detectAstro,

  claimsReference(name: string): boolean {
    return ASTRO_AUTO_IMPORTS.has(name) || ASTRO_HELPERS.has(name);
  },

  resolve(ref: IUnresolvedReference, context: IResolutionContext): IResolvedRef | null {
    const name = ref.referenceName;

    // Автоматические импорты Astro
    if (ASTRO_AUTO_IMPORTS.has(name)) {
      return {
        original: ref,
        targetNodeId: ref.fromNodeId,
        confidence: 1.0,
        provenance: 'astro-auto-import',
      };
    }

    // Встроенные хелперы Astro
    if (ASTRO_HELPERS.has(name)) {
      return {
        original: ref,
        targetNodeId: ref.fromNodeId,
        confidence: 1.0,
        provenance: 'astro-helper',
      };
    }

    // Компоненты Astro (PascalCase) — разрешение в .astro файлы
    if (/^[A-Z][A-Za-z0-9_]*$/.test(name)) {
      const files = context.getAllFiles().filter((f) => f.endsWith('.astro'));
      for (const f of files) {
        const fileNodes = context.getNodesByFile(f);
        const comp = fileNodes.find(
          (n) => n.kind === NodeKind.Component && n.name === name
        );
        if (comp) {
          return {
            original: ref,
            targetNodeId: comp.id,
            confidence: 0.85,
            provenance: 'astro-component',
          };
        }
      }
    }

    // Content collections
    if (/^getCollection$/.test(name)) {
      return {
        original: ref,
        targetNodeId: ref.fromNodeId,
        confidence: 1.0,
        provenance: 'astro-content',
      };
    }

    return null;
  },

  extract(filePath: string, content: string): IFrameworkExtractionResult {
    const allNodes: INode[] = [];
    const allRefs: IUnresolvedReference[] = [];

    const lang: Language = filePath.endsWith('.astro') ? 'astro' : (filePath.endsWith('.ts') ? 'typescript' : 'javascript');

    // Маршруты страниц Astro
    if (filePath.startsWith('pages/')) {
      const result = extractAstroPageRoutes(filePath, lang);
      allNodes.push(...result.nodes);
      allRefs.push(...result.references);
    }

    // API endpoints Astro
    if (filePath.startsWith('pages/api/')) {
      const result = extractAstroApiRoutes(filePath, content, lang);
      allNodes.push(...result.nodes);
      allRefs.push(...result.references);
    }

    // Middleware Astro
    if (filePath.startsWith('middleware')) {
      const result = extractAstroMiddleware(filePath, lang);
      allNodes.push(...result.nodes);
      allRefs.push(...result.references);
    }

    // Content collections
    const collResult = extractAstroContentCollections(filePath, content, lang);
    allNodes.push(...collResult.nodes);
    allRefs.push(...collResult.references);

    // Интеграции Astro
    if (filePath.startsWith('astro.config')) {
      const intResult = extractAstroIntegrations(filePath, content);
      allNodes.push(...intResult.nodes);
      allRefs.push(...intResult.references);
    }

    return { nodes: allNodes, references: allRefs };
  },
};

registerFrameworkResolver(astroResolver);
