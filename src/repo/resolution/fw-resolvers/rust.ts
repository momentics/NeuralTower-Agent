/**
 * Фреймворк-резолвер для Rust (Actix-web, Axum).
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
const LANGUAGES: Language[] = ['rust'];

/** Балансировка скобок с учётом строк для извлечения тела. */
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

/** Извлечение route-узлов из Axum. */
function extractAxumRoutes(filePath: string, content: string): IFrameworkExtractionResult {
  const nodes: INode[] = [];
  const references: IUnresolvedReference[] = [];

  // .route("/path", get(handler)) или .route("/path", post(handler))
  const routeRe = /\.route\s*\(\s*["']([^"']+)["']\s*,\s*(get|post|put|delete|patch|head|options|on)\s*\(\s*(\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = routeRe.exec(content))) {
    const routePath = m[1];
    const verb = m[2].toUpperCase();
    const handler = m[3];
    const lineNum = content.substring(0, m.index).split('\n').length;

    const routeNode: INode = {
      id: crypto.createHash('sha256').update(`route:${filePath}:${routePath}`).digest('hex'),
      kind: NodeKind.Route,
      name: `${verb} ${routePath}`,
      qualifiedName: `${filePath}#${routePath}`,
      filePath,
      language: 'rust',
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
      language: 'rust',
    });
  }

  // .get(handler), .post(handler) и т.д.
  const verbRe = /\.(get|post|put|delete|patch|head|options)\s*\(\s*(\w+)/g;
  while ((m = verbRe.exec(content))) {
    const verb = m[1].toUpperCase();
    const handler = m[2];
    const lineNum = content.substring(0, m.index).split('\n').length;

    // Проверяем, что это не просто .get() без маршрута
    if (/\.route/.test(content.substring(Math.max(0, m.index - 100), m.index))) continue;

    const routeNode: INode = {
      id: crypto.createHash('sha256').update(`route:${filePath}:${verb}`).digest('hex'),
      kind: NodeKind.Route,
      name: verb,
      qualifiedName: `${filePath}#${verb}`,
      filePath,
      language: 'rust',
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
      language: 'rust',
    });
  }

  // Route::new().route("/path", get(handler)) — Axum macro
  const routeNewRe = /Route::new\s*\(\s*\)\s*\.route\s*\(\s*["']([^"']+)["']\s*,\s*(get|post|put|delete|patch)\s*\(\s*(\w+)/g;
  while ((m = routeNewRe.exec(content))) {
    const routePath = m[1];
    const verb = m[2].toUpperCase();
    const handler = m[3];
    const lineNum = content.substring(0, m.index).split('\n').length;

    const routeNode: INode = {
      id: crypto.createHash('sha256').update(`route:${filePath}:${routePath}`).digest('hex'),
      kind: NodeKind.Route,
      name: `${verb} ${routePath}`,
      qualifiedName: `${filePath}#${routePath}`,
      filePath,
      language: 'rust',
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
      language: 'rust',
    });
  }

  return { nodes, references };
}

/** Извлечение route-узлов из Actix-web. */
function extractActixRoutes(filePath: string, content: string): IFrameworkExtractionResult {
  const nodes: INode[] = [];
  const references: IUnresolvedReference[] = [];

  // web::get("/path").to(handler)
  const actixRe = /web::(get|post|put|delete|patch|head|options)\s*\(\s*["']([^"']+)["']\s*\)\s*\.to\s*\(\s*(\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = actixRe.exec(content))) {
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
      language: 'rust',
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
      language: 'rust',
    });
  }

  // #[get("/path")] / #[post("/path")] — actix-web attribute macros
  const attrRe = /#\[([gpd])et\s*\(\s*["']([^"']+)["']\s*\)\]/g;
  while ((m = attrRe.exec(content))) {
    const verb = m[1].toUpperCase();
    const routePath = m[2];
    const lineNum = content.substring(0, m.index).split('\n').length;

    const routeNode: INode = {
      id: crypto.createHash('sha256').update(`route:${filePath}:${routePath}`).digest('hex'),
      kind: NodeKind.Route,
      name: `${verb} ${routePath}`,
      qualifiedName: `${filePath}#${routePath}`,
      filePath,
      language: 'rust',
      startLine: lineNum,
      endLine: lineNum,
      startColumn: 0,
      endColumn: m[0].length,
      updatedAt: Date.now(),
    };
    nodes.push(routeNode);

    // Ищем имя функции после атрибута
    const afterAttr = content.substring(m.index + m[0].length);
    const funcRe = /\s*fn\s+(\w+)/;
    const fm = afterAttr.match(funcRe);
    if (fm) {
      references.push({
        fromNodeId: routeNode.id,
        referenceName: fm[1],
        referenceKind: 'calls',
        line: lineNum + 1,
        column: 0,
        filePath,
        language: 'rust',
      });
    }
  }

  return { nodes, references };
}

/** Извлечение route-узлов из Rocket. */
function extractRocketRoutes(filePath: string, content: string): IFrameworkExtractionResult {
  const nodes: INode[] = [];
  const references: IUnresolvedReference[] = [];

  // #[get("/path")] / #[post("/path")] — Rocket attribute macros
  const rocketRe = /#\[([a-z]+)\s*\(\s*["']([^"']+)["']\s*\)\]/g;
  let m: RegExpExecArray | null;
  while ((m = rocketRe.exec(content))) {
    const verb = m[1].toUpperCase();
    const routePath = m[2];
    const lineNum = content.substring(0, m.index).split('\n').length;

    const routeNode: INode = {
      id: crypto.createHash('sha256').update(`route:${filePath}:${routePath}`).digest('hex'),
      kind: NodeKind.Route,
      name: `${verb} ${routePath}`,
      qualifiedName: `${filePath}#${routePath}`,
      filePath,
      language: 'rust',
      startLine: lineNum,
      endLine: lineNum,
      startColumn: 0,
      endColumn: m[0].length,
      updatedAt: Date.now(),
    };
    nodes.push(routeNode);

    // Ищем имя функции после атрибута
    const afterAttr = content.substring(m.index + m[0].length);
    const funcRe = /\s*fn\s+(\w+)/;
    const fm = afterAttr.match(funcRe);
    if (fm) {
      references.push({
        fromNodeId: routeNode.id,
        referenceName: fm[1],
        referenceKind: 'calls',
        line: lineNum + 1,
        column: 0,
        filePath,
        language: 'rust',
      });
    }
  }

  return { nodes, references };
}

/** Обнаружение Rust веб-фреймворка. */
function detectRustWeb(context: IResolutionContext): boolean {
  const files = context.getAllFiles();

  // Проверяем Cargo.toml
  const cargoFile = files.find((f) => f === 'Cargo.toml');
  if (cargoFile) {
    const content = context.getFileContent?.(cargoFile);
    if (content && /(actix|axum|rocket|warp|tide|salvo)/i.test(content)) return true;
  }

  // Проверяем Rust файлы на импорты фреймворков
  const rustFiles = files.filter((f) => f.endsWith('.rs'));
  for (const f of rustFiles) {
    const content = context.getFileContent?.(f);
    if (content && /(actix|axum|rocket|warp|tide|salvo)/i.test(content)) {
      return true;
    }
  }

  return false;
}

/** Резолвер Rust (Actix, Axum, Rocket). */
const rustResolver: IFrameworkResolver = {
  name: 'Rust',
  languages: LANGUAGES,

  detect: detectRustWeb,

  claimsReference(name: string): boolean {
    // Rust модульные ссылки с :: — могут не существовать как символы
    return name.includes('::');
  },

  resolve(ref: IUnresolvedReference, context: IResolutionContext): IResolvedRef | null {
    const name = ref.referenceName;

    // Rust модульные ссылки (path::to::item)
    if (name.includes('::')) {
      const parts = name.split('::');
      const lastPart = parts[parts.length - 1];

      // Ищем функцию или тип
      const nodes = context.getNodesByName(lastPart);
      if (nodes.length === 1) {
        return {
          original: ref,
          targetNodeId: nodes[0]!.id,
          confidence: 0.85,
          provenance: 'rust-module',
        };
      }

      // Ищем в файлах
      const files = context.getAllFiles().filter((f) => f.endsWith('.rs'));
      for (const f of files) {
        const fileNodes = context.getNodesByFile(f);
        const found = fileNodes.find(
          (n) => (n.kind === 'function' || n.kind === 'struct' || n.kind === 'enum' || n.kind === 'type_alias') && n.name === lastPart
        );
        if (found) {
          return {
            original: ref,
            targetNodeId: found.id,
            confidence: 0.8,
            provenance: 'rust-module',
          };
        }
      }
    }

    // Handler функции (обычно fn с конкретными паттернами)
    if (/Handler$/.test(name)) {
      const nodes = context.getNodesByName(name).filter((n) => n.kind === 'struct');
      if (nodes.length === 1) {
        return {
          original: ref,
          targetNodeId: nodes[0]!.id,
          confidence: 0.85,
          provenance: 'rust-handler',
        };
      }
    }

    // State (Axum)
    if (name === 'State') {
      return {
        original: ref,
        targetNodeId: ref.fromNodeId,
        confidence: 1.0,
        provenance: 'rust-axum-state',
      };
    }

    // Json (Actix/Axum)
    if (name === 'Json') {
      return {
        original: ref,
        targetNodeId: ref.fromNodeId,
        confidence: 1.0,
        provenance: 'rust-json',
      };
    }

    return null;
  },

  extract(filePath: string, content: string): IFrameworkExtractionResult {
    const allNodes: INode[] = [];
    const allRefs: IUnresolvedReference[] = [];

    // Axum routes
    const axumResult = extractAxumRoutes(filePath, content);
    allNodes.push(...axumResult.nodes);
    allRefs.push(...axumResult.references);

    // Actix routes
    const actixResult = extractActixRoutes(filePath, content);
    allNodes.push(...actixResult.nodes);
    allRefs.push(...actixResult.references);

    // Rocket routes
    const rocketResult = extractRocketRoutes(filePath, content);
    allNodes.push(...rocketResult.nodes);
    allRefs.push(...rocketResult.references);

    return { nodes: allNodes, references: allRefs };
  },
};

registerFrameworkResolver(rustResolver);
