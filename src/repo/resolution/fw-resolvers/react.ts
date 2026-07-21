/**
 * Фреймворк-резолвер для React и Next.js.
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
const LANGUAGES: Language[] = ['typescript', 'javascript', 'tsx', 'jsx'];

/** Обнаружение React/Next.js проекта. */
function detectReact(context: IResolutionContext): boolean {
  const files = context.getAllFiles();

  // Проверяем JSX/TSX файлы
  const hasJsx = files.some((f) => f.endsWith('.jsx') || f.endsWith('.tsx'));
  if (hasJsx) return true;

  // Проверяем package.json
  const pkgFile = files.find((f) => f === 'package.json');
  if (pkgFile) {
    const content = context.getFileContent?.(pkgFile);
    if (content) {
      try {
        const pkg = JSON.parse(content);
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (deps.react || deps.next || deps['react-native']) return true;
      } catch {
        // JSON не разобран — пропускаем
      }
    }
  }

  return false;
}

/** Проверка: файл является JSX/TSX. */
function isJsxFile(filePath: string): boolean {
  return filePath.endsWith('.jsx') || filePath.endsWith('.tsx');
}

/** Извлечение route-узлов из React Router v5/v6. */
function extractReactRouterRoutes(filePath: string, content: string): IFrameworkExtractionResult {
  const nodes: INode[] = [];
  const references: IUnresolvedReference[] = [];

  // React Router v5: <Route path="/x" component={Comp}/>
  const v5Re = /<Route\s+path\s*=\s*["']([^"']+)["']\s+component\s*=\s*\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = v5Re.exec(content))) {
    const routePath = m[1];
    const compName = m[2].trim();
    const lineNum = content.substring(0, m.index).split('\n').length;

    nodes.push({
      id: crypto.createHash('sha256').update(`route:${filePath}:${routePath}`).digest('hex'),
      kind: NodeKind.Route,
      name: routePath,
      qualifiedName: `${filePath}#${routePath}`,
      filePath,
      language: 'typescript',
      startLine: lineNum,
      endLine: lineNum,
      startColumn: 0,
      endColumn: m[0].length,
      updatedAt: Date.now(),
    });

    references.push({
      fromNodeId: nodes[nodes.length - 1].id,
      referenceName: compName,
      referenceKind: 'references',
      line: lineNum,
      column: 0,
      filePath,
      language: 'typescript',
    });
  }

  // React Router v6: <Route path="/x" element={<Comp/>}>
  const v6Re = /<Route\s+path\s*=\s*["']([^"']+)["']\s+element\s*=\s*<([A-Z][A-Za-z0-9_]*)/g;
  while ((m = v6Re.exec(content))) {
    const routePath = m[1];
    const compName = m[2];
    const lineNum = content.substring(0, m.index).split('\n').length;

    nodes.push({
      id: crypto.createHash('sha256').update(`route:${filePath}:${routePath}`).digest('hex'),
      kind: NodeKind.Route,
      name: routePath,
      qualifiedName: `${filePath}#${routePath}`,
      filePath,
      language: 'typescript',
      startLine: lineNum,
      endLine: lineNum,
      startColumn: 0,
      endColumn: m[0].length,
      updatedAt: Date.now(),
    });

    references.push({
      fromNodeId: nodes[nodes.length - 1].id,
      referenceName: compName,
      referenceKind: 'references',
      line: lineNum,
      column: 0,
      filePath,
      language: 'typescript',
    });
  }

  // Data-router: createBrowserRouter([{ path, element }])
  const dataRe = /createBrowserRouter\s*\(\s*\[\s*\{\s*path\s*:\s*["']([^"']+)["']\s*,\s*element\s*:\s*<([A-Z][A-Za-z0-9_]*)/g;
  while ((m = dataRe.exec(content))) {
    const routePath = m[1];
    const compName = m[2];
    const lineNum = content.substring(0, m.index).split('\n').length;

    nodes.push({
      id: crypto.createHash('sha256').update(`route:${filePath}:${routePath}`).digest('hex'),
      kind: NodeKind.Route,
      name: routePath,
      qualifiedName: `${filePath}#${routePath}`,
      filePath,
      language: 'typescript',
      startLine: lineNum,
      endLine: lineNum,
      startColumn: 0,
      endColumn: m[0].length,
      updatedAt: Date.now(),
    });

    references.push({
      fromNodeId: nodes[nodes.length - 1].id,
      referenceName: compName,
      referenceKind: 'references',
      line: lineNum,
      column: 0,
      filePath,
      language: 'typescript',
    });
  }

  return { nodes, references };
}

/** Извлечение route-узлов из Next.js pages/ директории. */
function extractNextJsRoutes(filePath: string, language: Language): IFrameworkExtractionResult {
  const nodes: INode[] = [];
  const references: IUnresolvedReference[] = [];

  if (!filePath.startsWith('pages/')) return { nodes, references };

  // Пропускаем _app.tsx, _document.tsx и т.д.
  const baseName = filePath.split('/').pop() || '';
  if (baseName.startsWith('_')) return { nodes, references };

  const relative = filePath.slice('pages/'.length);
  const routePath = relative
    .replace(/\/index$/, '')
    .replace(/\[([^\]]+)\]/g, ':$1')
    .replace(/\/$/, '') || '/';

  const pathStr = routePath.startsWith('/') ? routePath : `/${routePath}`;

  nodes.push({
    id: crypto.createHash('sha256').update(`route:${filePath}:${pathStr}`).digest('hex'),
    kind: NodeKind.Route,
    name: pathStr,
    qualifiedName: `${filePath}#${pathStr}`,
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

/** Извлечение route-узлов из Next.js app/ директории. */
function extractNextAppRoutes(filePath: string, language: Language): IFrameworkExtractionResult {
  const nodes: INode[] = [];
  const references: IUnresolvedReference[] = [];

  if (!filePath.startsWith('app/')) return { nodes, references };

  const baseName = filePath.split('/').pop() || '';
  if (baseName.startsWith('_') || baseName === 'layout.tsx' || baseName === 'loading.tsx') return { nodes, references };

  const relative = filePath.slice('app/'.length);
  const routePath = relative
    .replace(/\/page$/, '')
    .replace(/\[([^\]]+)\]/g, ':$1')
    .replace(/\/$/, '') || '/';

  const pathStr = routePath.startsWith('/') ? routePath : `/${routePath}`;

  nodes.push({
    id: crypto.createHash('sha256').update(`route:${filePath}:${pathStr}`).digest('hex'),
    kind: NodeKind.Route,
    name: pathStr,
    qualifiedName: `${filePath}#${pathStr}`,
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

/** Резолвер React/Next.js. */
const reactResolver: IFrameworkResolver = {
  name: 'React',
  languages: LANGUAGES,

  detect: detectReact,

  resolve(ref: IUnresolvedReference, context: IResolutionContext): IResolvedRef | null {
    // Компоненты (PascalCase) — только из JSX файлов
    if (isJsxFile(ref.filePath || '')) {
      const name = ref.referenceName;

      // PascalCase компонент
      if (/^[A-Z][A-Za-z0-9_]*$/.test(name)) {
        const nodes = context.getNodesByName(name).filter(
          (n) => n.kind === NodeKind.Component || n.kind === 'function' || n.kind === 'class'
        );
        if (nodes.length === 1) {
          return {
            original: ref,
            targetNodeId: nodes[0]!.id,
            confidence: 0.85,
            provenance: 'react-component',
          };
        }
        // При неоднозначном имени — вернуть null, пусть name-matcher решит
      }

      // Хуки (use*)
      if (/^use[A-Z]/.test(name)) {
        const nodes = context.getNodesByName(name).filter((n) => n.kind === 'function');
        if (nodes.length === 1) {
          return {
            original: ref,
            targetNodeId: nodes[0]!.id,
            confidence: 0.9,
            provenance: 'react-hook',
          };
        }
      }

      // Контексты (*Context, *Provider)
      if (/Context$/.test(name) || /Provider$/.test(name)) {
        const nodes = context.getNodesByName(name);
        if (nodes.length === 1) {
          return {
            original: ref,
            targetNodeId: nodes[0]!.id,
            confidence: 0.85,
            provenance: 'react-context',
          };
        }
      }
    }

    return null;
  },

  extract(filePath: string, content: string): IFrameworkExtractionResult {
    const allNodes: INode[] = [];
    const allRefs: IUnresolvedReference[] = [];

    // React Router
    const routerResult = extractReactRouterRoutes(filePath, content);
    allNodes.push(...routerResult.nodes);
    allRefs.push(...routerResult.references);

    // Определяем язык для Next.js
    const lang: Language = filePath.endsWith('.tsx') ? 'typescript' : 'javascript';

    // Next.js pages
    if (filePath.startsWith('pages/')) {
      const pagesResult = extractNextJsRoutes(filePath, lang);
      allNodes.push(...pagesResult.nodes);
      allRefs.push(...pagesResult.references);
    }

    // Next.js app
    if (filePath.startsWith('app/')) {
      const appResult = extractNextAppRoutes(filePath, lang);
      allNodes.push(...appResult.nodes);
      allRefs.push(...appResult.references);
    }

    return { nodes: allNodes, references: allRefs };
  },
};

registerFrameworkResolver(reactResolver);
