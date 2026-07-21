/**
 * Фреймворк-резолвер для Vue и Nuxt.
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
const LANGUAGES: Language[] = ['typescript', 'javascript', 'vue'];

/** Макросы компилятора Vue. */
const VUE_COMPILER_MACROS = new Set([
  'defineProps', 'defineEmits', 'defineSlots', 'defineOptions',
  'defineModel', 'defineExpose', 'defineRender', 'defineCustomElement',
  'withDefaults',
]);

/** Автоматически импортируемые композаблы Nuxt. */
export const NUXT_AUTO_IMPORTS = new Set([
  'useRoute', 'useRouter', 'useHead', 'useSeoMeta', 'useServerHead',
  'useServerSeoMeta', 'useFetch', 'useAsyncData', 'useLazyFetch',
  'useLazyAsyncData', 'useCookie', 'useState', 'useRequestHeaders',
  'useRequestEvent', 'useRequestFetch', 'useRuntimeConfig',
  'useAppConfig', 'usePreviewMode', 'useId', 'useNuxtData',
  'clearNuxtData', 'refreshNuxtData', 'abortNavigation',
  'addRouteMiddleware', 'defineNuxtRouteMiddleware', 'setPageLayout',
  'defineNuxtComponent', 'useLoadingIndicator',
]);

/** Виртуальные модули Nuxt. */
export const NUXT_VIRTUAL_MODULES = new Set([
  '#imports', '#components', '#app', '#build', '#head',
]);

/** Обнаружение Vue/Nuxt проекта. */
function detectVue(context: IResolutionContext): boolean {
  const files = context.getAllFiles();

  // Проверяем .vue файлы
  const hasVue = files.some((f) => f.endsWith('.vue'));
  if (hasVue) return true;

  // Проверяем package.json
  const pkgFile = files.find((f) => f === 'package.json');
  if (pkgFile) {
    const content = context.getFileContent?.(pkgFile);
    if (content) {
      try {
        const pkg = JSON.parse(content);
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (deps.vue || deps.nuxt || deps['@nuxt/kit']) return true;
      } catch {
        // JSON не разобран — пропускаем
      }
    }
  }

  return false;
}

/** Конвертация пути Nuxt в маршрут. */
function filePathToNuxtRoute(filePath: string): string {
  let route = filePath
    .replace(/^pages\/|^server\/api\//, '')
    .replace(/\/index$/, '')
    .replace(/\.\w+$/, '');

  // [param] → :param
  route = route.replace(/\[([^\]]+)\]/g, ':$1');
  // [[optional]] → :optional?
  route = route.replace(/\[\[([^\]]+)\]\]/g, ':$1?');
  // [...slug] → *slug
  route = route.replace(/\[\.\.\.([^\]]+)\]/g, '*$1');

  return route.startsWith('/') ? route : `/${route}`;
}

/** Извлечение Nuxt page routes. */
function extractNuxtPageRoutes(filePath: string, language: Language): IFrameworkExtractionResult {
  const nodes: INode[] = [];
  const references: IUnresolvedReference[] = [];

  if (!filePath.startsWith('pages/')) return { nodes, references };

  const routePath = filePathToNuxtRoute(filePath);

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

/** Извлечение Nuxt API routes. */
function extractNuxtApiRoutes(filePath: string, language: Language): IFrameworkExtractionResult {
  const nodes: INode[] = [];
  const references: IUnresolvedReference[] = [];

  if (!filePath.startsWith('server/api/')) return { nodes, references };

  const routePath = filePathToNuxtRoute(filePath);

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

/** Извлечение Nuxt middleware. */
function extractNuxtMiddleware(filePath: string, language: Language): IFrameworkExtractionResult {
  const nodes: INode[] = [];
  const references: IUnresolvedReference[] = [];

  if (!filePath.startsWith('middleware/')) return { nodes, references };

  const name = filePath
    .replace(/^middleware\//, '')
    .replace(/\.\w+$/, '');

  nodes.push({
    id: crypto.createHash('sha256').update(`middleware:${filePath}:${name}`).digest('hex'),
    kind: NodeKind.Component,
    name,
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

/** Резолвер Vue/Nuxt. */
const vueResolver: IFrameworkResolver = {
  name: 'Vue',
  languages: LANGUAGES,

  detect: detectVue,

  claimsReference(name: string): boolean {
    // Vue compiler macros and Nuxt auto-imports — не существуют как символы
    return VUE_COMPILER_MACROS.has(name) || NUXT_AUTO_IMPORTS.has(name);
  },

  resolve(ref: IUnresolvedReference, context: IResolutionContext): IResolvedRef | null {
    const name = ref.referenceName;

    // Макросы компилятора Vue
    if (VUE_COMPILER_MACROS.has(name)) {
      return {
        original: ref,
        targetNodeId: ref.fromNodeId,
        confidence: 1.0,
        provenance: 'vue-macro',
      };
    }

    // Автоматические импорты Nuxt
    if (NUXT_AUTO_IMPORTS.has(name)) {
      return {
        original: ref,
        targetNodeId: ref.fromNodeId,
        confidence: 1.0,
        provenance: 'nuxt-auto-import',
      };
    }

    // Виртуальные модули Nuxt
    if (NUXT_VIRTUAL_MODULES.has(name)) {
      return {
        original: ref,
        targetNodeId: ref.fromNodeId,
        confidence: 1.0,
        provenance: 'nuxt-virtual-module',
      };
    }

    // @/ alias imports — разрешение в src/
    if (name.startsWith('@/')) {
      const resolvedPath = name.replace(/^@\//, 'src/');
      const nodes = context.getNodesByFile(resolvedPath);
      if (nodes.length === 1) {
        return {
          original: ref,
          targetNodeId: nodes[0]!.id,
          confidence: 0.9,
          provenance: 'vue-alias',
        };
      }
    }

    // ~/ alias imports — разрешение в src/
    if (name.startsWith('~/')) {
      const resolvedPath = name.replace(/^~\//, 'src/');
      const nodes = context.getNodesByFile(resolvedPath);
      if (nodes.length === 1) {
        return {
          original: ref,
          targetNodeId: nodes[0]!.id,
          confidence: 0.9,
          provenance: 'vue-alias',
        };
      }
    }

    // Компоненты (PascalCase) — разрешение в .vue файлы
    if (/^[A-Z][A-Za-z0-9_]*$/.test(name)) {
      const files = context.getAllFiles().filter((f) => f.endsWith('.vue'));
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
            provenance: 'vue-component',
          };
        }
      }
    }

    return null;
  },

  extract(filePath: string, content: string): IFrameworkExtractionResult {
    const allNodes: INode[] = [];
    const allRefs: IUnresolvedReference[] = [];

    const lang: Language = filePath.endsWith('.vue') ? 'vue' : (filePath.endsWith('.ts') ? 'typescript' : 'javascript');

    // Маршруты страниц Nuxt
    if (filePath.startsWith('pages/')) {
      const result = extractNuxtPageRoutes(filePath, lang);
      allNodes.push(...result.nodes);
      allRefs.push(...result.references);
    }

    // Маршруты API Nuxt
    if (filePath.startsWith('server/api/')) {
      const result = extractNuxtApiRoutes(filePath, lang);
      allNodes.push(...result.nodes);
      allRefs.push(...result.references);
    }

    // Промежуточное ПО Nuxt
    if (filePath.startsWith('middleware/')) {
      const result = extractNuxtMiddleware(filePath, lang);
      allNodes.push(...result.nodes);
      allRefs.push(...result.references);
    }

    return { nodes: allNodes, references: allRefs };
  },
};

registerFrameworkResolver(vueResolver);
