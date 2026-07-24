/**
 * Фреймворк-резолвер для Svelte и SvelteKit.
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
const LANGUAGES: Language[] = ['svelte', 'typescript', 'javascript'];

/** Автоматически импортируемые функции SvelteKit. */
const SVELTEKIT_AUTO_IMPORTS = new Set([
  'browser', 'dev', 'building', 'mode', 'prerendering',
]);

/** Встроенные директивы Svelte. */
const SVELTE_DIRECTIVES = new Set([
  'onMount', 'onDestroy', 'tick', 'afterUpdate', 'beforeUpdate',
  'createEventDispatcher', 'getContext', 'setContext', 'hasContext',
]);

/** Встроенные хуки SvelteKit. */
const SVELTEKIT_HOOKS = new Set([
  'handle', 'handleFetch', 'handleError', 'load',
]);

/** Обнаружение Svelte/SvelteKit проекта. */
function detectSvelte(context: IResolutionContext): boolean {
  const files = context.getAllFiles();

  // Проверяем .svelte файлы
  if (files.some((f) => f.endsWith('.svelte'))) return true;

  // Проверяем package.json
  const pkgFile = files.find((f) => f === 'package.json');
  if (pkgFile) {
    const content = context.getFileContent?.(pkgFile);
    if (content) {
      try {
        const pkg = JSON.parse(content);
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (deps.svelte || deps['@sveltejs/kit']) return true;
      } catch {
        // JSON не разобран — пропускаем
      }
    }
  }

  // Проверяем svelte.config.js
  if (files.some((f) => f.startsWith('svelte.config'))) return true;

  return false;
}

/** Конвертация пути SvelteKit routes/ в маршрут. */
function svelteKitRoute(filePath: string): string {
  let route = filePath
    .replace(/^routes\//, '')
    .replace(/\/\+page\.svelte$/, '')
    .replace(/\/\+page\.js$/, '')
    .replace(/\/\+page\.ts$/, '')
    .replace(/\/\+server\.js$/, '')
    .replace(/\/\+server\.ts$/, '')
    .replace(/\/\+layout\.svelte$/, '')
    .replace(/\+page\.svelte$/, '')
    .replace(/\+page\.js$/, '')
    .replace(/\+page\.ts$/, '')
    .replace(/\+server\.js$/, '')
    .replace(/\+server\.ts$/, '');

  // [slug].svelte → :slug
  route = route.replace(/\[([^\]]+)\]/g, ':$1');

  return route.startsWith('/') ? route : `/${route}`;
}

/** Извлечение route-узлов из SvelteKit routes/. */
function extractSvelteKitPageRoutes(filePath: string, language: Language): IFrameworkExtractionResult {
  const nodes: INode[] = [];
  const references: IUnresolvedReference[] = [];

  if (!filePath.startsWith('routes/')) return { nodes, references };

  // Пропускаем layout и error
  if (/\+layout|error\.svelte/.test(filePath)) return { nodes, references };

  const routePath = svelteKitRoute(filePath);

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

/** Извлечение API endpoint-узлов из SvelteKit routes/. */
function extractSvelteKitApiRoutes(filePath: string, content: string, language: Language): IFrameworkExtractionResult {
  const nodes: INode[] = [];
  const references: IUnresolvedReference[] = [];

  if (!filePath.startsWith('routes/')) return { nodes, references };

  const routePath = svelteKitRoute(filePath);

  // +server.ts — export const get, post, put, delete, patch
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

/** Извлечение SvelteKit hooks. */
function extractSvelteKitHooks(filePath: string, content: string, language: Language): IFrameworkExtractionResult {
  const nodes: INode[] = [];
  const references: IUnresolvedReference[] = [];

  if (!filePath.includes('+hooks')) return { nodes, references };

  // export const handle / handleError / handleFetch
  const hookRe = /export\s+const\s+(handle|handleError|handleFetch)\s*=/g;
  let hm: RegExpExecArray | null;
  while ((hm = hookRe.exec(content))) {
    const hookName = hm[1];
    const lineNum = content.substring(0, hm.index).split('\n').length;

    nodes.push({
      id: crypto.createHash('sha256').update(`hook:${filePath}:${hookName}`).digest('hex'),
      kind: NodeKind.Component,
      name: hookName,
      qualifiedName: `${filePath}#${hookName}`,
      filePath,
      language,
      startLine: lineNum,
      endLine: lineNum,
      startColumn: 0,
      endColumn: hm[0].length,
      updatedAt: Date.now(),
    });
  }

  return { nodes, references };
}

/** Извлечение SvelteKit load functions. */
function extractSvelteKitLoadFunctions(filePath: string, content: string, language: Language): IFrameworkExtractionResult {
  const nodes: INode[] = [];
  const references: IUnresolvedReference[] = [];

  if (!filePath.startsWith('routes/')) return { nodes, references };

  // export const load = async ({ fetch, params }) => { ... }
  const loadRe = /export\s+const\s+load\s*=/g;
  let lm: RegExpExecArray | null;
  while ((lm = loadRe.exec(content))) {
    const lineNum = content.substring(0, lm.index).split('\n').length;

    nodes.push({
      id: crypto.createHash('sha256').update(`load:${filePath}`).digest('hex'),
      kind: NodeKind.Function,
      name: 'load',
      qualifiedName: `${filePath}#load`,
      filePath,
      language,
      startLine: lineNum,
      endLine: lineNum,
      startColumn: 0,
      endColumn: lm[0].length,
      updatedAt: Date.now(),
    });
  }

  return { nodes, references };
}

/** Резолвер Svelte/SvelteKit. */
const svelteResolver: IFrameworkResolver = {
  name: 'Svelte',
  languages: LANGUAGES,

  detect: detectSvelte,

  claimsReference(name: string): boolean {
    return SVELTEKIT_AUTO_IMPORTS.has(name) || SVELTE_DIRECTIVES.has(name);
  },

  resolve(ref: IUnresolvedReference, context: IResolutionContext): IResolvedRef | null {
    const name = ref.referenceName;

    // Автоматические импорты SvelteKit
    if (SVELTEKIT_AUTO_IMPORTS.has(name)) {
      return {
        original: ref,
        targetNodeId: ref.fromNodeId,
        confidence: 1.0,
        provenance: 'sveltekit-auto-import',
      };
    }

    // Встроенные директивы Svelte
    if (SVELTE_DIRECTIVES.has(name)) {
      return {
        original: ref,
        targetNodeId: ref.fromNodeId,
        confidence: 1.0,
        provenance: 'svelte-directive',
      };
    }

    // Компоненты Svelte (PascalCase) — разрешение в .svelte файлы
    if (/^[A-Z][A-Za-z0-9_]*$/.test(name)) {
      const files = context.getAllFiles().filter((f) => f.endsWith('.svelte'));
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
            provenance: 'svelte-component',
          };
        }
      }
    }

    // Встроенные хуки SvelteKit
    if (SVELTEKIT_HOOKS.has(name)) {
      return {
        original: ref,
        targetNodeId: ref.fromNodeId,
        confidence: 1.0,
        provenance: 'sveltekit-hook',
      };
    }

    return null;
  },

  extract(filePath: string, content: string): IFrameworkExtractionResult {
    const allNodes: INode[] = [];
    const allRefs: IUnresolvedReference[] = [];

    const lang: Language = filePath.endsWith('.svelte') ? 'svelte' : (filePath.endsWith('.ts') ? 'typescript' : 'javascript');

    // Маршруты страниц SvelteKit
    if (filePath.startsWith('routes/') && (filePath.includes('+page') || filePath.includes('+server'))) {
      const result = extractSvelteKitPageRoutes(filePath, lang);
      allNodes.push(...result.nodes);
      allRefs.push(...result.references);
    }

    // API endpoints SvelteKit
    if (filePath.startsWith('routes/') && filePath.includes('+server')) {
      const result = extractSvelteKitApiRoutes(filePath, content, lang);
      allNodes.push(...result.nodes);
      allRefs.push(...result.references);
    }

    // Hooks SvelteKit
    if (filePath.includes('+hooks')) {
      const result = extractSvelteKitHooks(filePath, content, lang);
      allNodes.push(...result.nodes);
      allRefs.push(...result.references);
    }

    // Load functions SvelteKit
    if (filePath.startsWith('routes/') && filePath.endsWith('.js') || filePath.endsWith('.ts')) {
      const result = extractSvelteKitLoadFunctions(filePath, content, lang);
      allNodes.push(...result.nodes);
      allRefs.push(...result.references);
    }

    return { nodes: allNodes, references: allRefs };
  },
};

registerFrameworkResolver(svelteResolver);
