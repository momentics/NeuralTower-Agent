/**
 * Фреймворк-резолверы для Django, Flask и FastAPI.
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

/** Языки, к которым применимы резолверы. */
const LANGUAGES: Language[] = ['python'];

/** Общие зависимости для обнаружения. */
function checkPythonDeps(
  context: IResolutionContext,
  packageNames: string[]
): boolean {
  const files = context.getAllFiles();
  const depFiles = ['requirements.txt', 'setup.py', 'pyproject.toml', 'Pipfile'];

  for (const depFile of depFiles) {
    if (!files.includes(depFile)) continue;
    const content = context.getFileContent?.(depFile);
    if (!content) continue;
    for (const pkg of packageNames) {
      if (new RegExp(pkg, 'i').test(content)) return true;
    }
  }

  return false;
}

/** Поиск методов по имени типа и имени метода. */
function resolveByNameAndKind(
  typeName: string,
  methodName: string,
  context: IResolutionContext,
  preferredDirs?: string[]
): INode | null {
  const nodes = context.getNodesByName(typeName);
  for (const typeNode of nodes) {
    if (typeNode.kind !== 'class') continue;
    if (preferredDirs) {
      if (!preferredDirs.some((d) => typeNode.filePath.startsWith(d))) continue;
    }
    const children = context.getChildren(typeNode.id);
    const method = children.find((c) => c.kind === 'method' && c.name === methodName);
    if (method) return method;
  }
  return null;
}

/** Извлечение decorator-based route-узлов. */
function extractDecoratorRoutes(
  filePath: string,
  content: string,
  language: Language
): IFrameworkExtractionResult {
  const nodes: INode[] = [];
  const references: IUnresolvedReference[] = [];

  // @x.route('/path') или @x.VERB('/path')
  const routeRe = /@\w+\.(?:route|get|post|put|delete|patch)\s*\(\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = routeRe.exec(content))) {
    const routePath = m[1];
    const lineNum = content.substring(0, m.index).split('\n').length;

    // Ищем имя метода на следующей строке
    const lines = content.split('\n');
    const nextLine = lines[lineNum] || '';
    const funcRe = /def\s+(\w+)/;
    const fm = nextLine.match(funcRe);

    const routeNode: INode = {
      id: crypto.createHash('sha256').update(`route:${filePath}:${routePath}`).digest('hex'),
      kind: NodeKind.Route,
      name: routePath,
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

    if (fm) {
      references.push({
        fromNodeId: routeNode.id,
        referenceName: fm[1],
        referenceKind: 'calls',
        line: lineNum + 1,
        column: 0,
        filePath,
        language,
      });
    }
  }

  return { nodes, references };
}

// =============================================================================
// Django
// =============================================================================

function detectDjango(context: IResolutionContext): boolean {
  const files = context.getAllFiles();
  if (files.includes('manage.py')) return true;
  return checkPythonDeps(context, ['django']);
}

const djangoResolver: IFrameworkResolver = {
  name: 'Django',
  languages: LANGUAGES,

  detect: detectDjango,

  claimsReference(name: string): boolean {
    return name === '_iterable_class' || /\.urls$/.test(name);
  },

  resolve(ref: IUnresolvedReference, context: IResolutionContext): IResolvedRef | null {
    const name = ref.referenceName;

    // _iterable_class — ORM dynamic dispatch
    if (name === '_iterable_class') {
      const nodes = context.getNodesByName('ModelIterable');
      if (nodes.length > 0) {
        const iter = context.getChildren(nodes[0]!.id).find(
          (c) => c.kind === 'method' && c.name === '__iter__'
        );
        if (iter) {
          return {
            original: ref,
            targetNodeId: iter.id,
            confidence: 0.7,
            provenance: 'django-orm',
          };
        }
      }
      return null;
    }

    // *Model
    if (/Model$/.test(name)) {
      const nodes = context.getNodesByName(name).filter((n) => n.kind === 'class');
      if (nodes.length === 1) {
        return {
          original: ref,
          targetNodeId: nodes[0]!.id,
          confidence: 0.85,
          provenance: 'django-model',
        };
      }
    }

    // *View / *ViewSet
    if (/View$/.test(name) || /ViewSet$/.test(name)) {
      const nodes = context.getNodesByName(name).filter((n) => n.kind === 'class');
      if (nodes.length === 1) {
        return {
          original: ref,
          targetNodeId: nodes[0]!.id,
          confidence: 0.85,
          provenance: 'django-view',
        };
      }
    }

    // *Form
    if (/Form$/.test(name)) {
      const nodes = context.getNodesByName(name).filter((n) => n.kind === 'class');
      if (nodes.length === 1) {
        return {
          original: ref,
          targetNodeId: nodes[0]!.id,
          confidence: 0.85,
          provenance: 'django-form',
        };
      }
    }

    return null;
  },

  extract(filePath: string, content: string): IFrameworkExtractionResult {
    const allNodes: INode[] = [];
    const allRefs: IUnresolvedReference[] = [];

    // path(), re_path(), url()
    const pathRe = /(?:path|re_path|url)\s*\(\s*["']([^"']+)["']\s*,\s*(\w+)/g;
    let m: RegExpExecArray | null;
    while ((m = pathRe.exec(content))) {
      const routePath = m[1];
      const handler = m[2];
      const lineNum = content.substring(0, m.index).split('\n').length;

      const routeNode: INode = {
        id: crypto.createHash('sha256').update(`route:${filePath}:${routePath}`).digest('hex'),
        kind: NodeKind.Route,
        name: routePath,
        qualifiedName: `${filePath}#${routePath}`,
        filePath,
        language: 'python',
        startLine: lineNum,
        endLine: lineNum,
        startColumn: 0,
        endColumn: m[0].length,
        updatedAt: Date.now(),
      };
      allNodes.push(routeNode);

      allRefs.push({
        fromNodeId: routeNode.id,
        referenceName: handler,
        referenceKind: 'calls',
        line: lineNum,
        column: 0,
        filePath,
        language: 'python',
      });
    }

    // DRF router.register()
    const routerRe = /router\.register\s*\(\s*["']([^"']+)["']\s*,\s*(?:viewset\s*=\s*)?(\w+)/g;
    while ((m = routerRe.exec(content))) {
      const routePath = m[1];
      const viewset = m[2];
      const lineNum = content.substring(0, m.index).split('\n').length;

      const routeNode: INode = {
        id: crypto.createHash('sha256').update(`route:${filePath}:${routePath}`).digest('hex'),
        kind: NodeKind.Route,
        name: routePath,
        qualifiedName: `${filePath}#${routePath}`,
        filePath,
        language: 'python',
        startLine: lineNum,
        endLine: lineNum,
        startColumn: 0,
        endColumn: m[0].length,
        updatedAt: Date.now(),
      };
      allNodes.push(routeNode);

      allRefs.push({
        fromNodeId: routeNode.id,
        referenceName: viewset,
        referenceKind: 'calls',
        line: lineNum,
        column: 0,
        filePath,
        language: 'python',
      });
    }

    // Decorator routes
    const decResult = extractDecoratorRoutes(filePath, content, 'python');
    allNodes.push(...decResult.nodes);
    allRefs.push(...decResult.references);

    return { nodes: allNodes, references: allRefs };
  },
};

// =============================================================================
// Flask
// =============================================================================

function detectFlask(context: IResolutionContext): boolean {
  const files = context.getAllFiles();
  if (checkPythonDeps(context, ['flask'])) return true;

  // Проверяем entrypoint файлы
  for (const entry of ['app.py', 'wsgi.py', 'run.py']) {
    if (!files.includes(entry)) continue;
    const content = context.getFileContent?.(entry);
    if (content && /Flask\s*\(/.test(content)) return true;
  }

  return false;
}

const flaskResolver: IFrameworkResolver = {
  name: 'Flask',
  languages: LANGUAGES,

  detect: detectFlask,

  resolve(ref: IUnresolvedReference, context: IResolutionContext): IResolvedRef | null {
    const name = ref.referenceName;

    // *_bp, *_blueprint
    if (/_bp$/.test(name) || /_blueprint$/.test(name)) {
      const nodes = context.getNodesByName(name);
      if (nodes.length === 1) {
        return {
          original: ref,
          targetNodeId: nodes[0]!.id,
          confidence: 0.85,
          provenance: 'flask-blueprint',
        };
      }
    }

    return null;
  },

  extract(filePath: string, content: string): IFrameworkExtractionResult {
    const allNodes: INode[] = [];
    const allRefs: IUnresolvedReference[] = [];

    // Decorator routes
    const decResult = extractDecoratorRoutes(filePath, content, 'python');
    allNodes.push(...decResult.nodes);
    allRefs.push(...decResult.references);

    // Flask-RESTful add_resource()
    const resourceRe = /add_resource\s*\(\s*(\w+)\s*,\s*["']([^"']+)["']/g;
    let m: RegExpExecArray | null;
    while ((m = resourceRe.exec(content))) {
      const resource = m[1];
      const routePath = m[2];
      const lineNum = content.substring(0, m.index).split('\n').length;

      const routeNode: INode = {
        id: crypto.createHash('sha256').update(`route:${filePath}:${routePath}`).digest('hex'),
        kind: NodeKind.Route,
        name: routePath,
        qualifiedName: `${filePath}#${routePath}`,
        filePath,
        language: 'python',
        startLine: lineNum,
        endLine: lineNum,
        startColumn: 0,
        endColumn: m[0].length,
        updatedAt: Date.now(),
      };
      allNodes.push(routeNode);

      allRefs.push({
        fromNodeId: routeNode.id,
        referenceName: resource,
        referenceKind: 'calls',
        line: lineNum,
        column: 0,
        filePath,
        language: 'python',
      });
    }

    return { nodes: allNodes, references: allRefs };
  },
};

// =============================================================================
// FastAPI
// =============================================================================

function detectFastAPI(context: IResolutionContext): boolean {
  const files = context.getAllFiles();
  if (checkPythonDeps(context, ['fastapi'])) return true;

  // Проверяем entrypoint файлы
  for (const entry of ['app.py', 'main.py', 'api.py']) {
    if (!files.includes(entry)) continue;
    const content = context.getFileContent?.(entry);
    if (content && /FastAPI\s*\(/.test(content)) return true;
  }

  return false;
}

const fastapiResolver: IFrameworkResolver = {
  name: 'FastAPI',
  languages: LANGUAGES,

  detect: detectFastAPI,

  claimsReference(name: string): boolean {
    // *_router и get_* — могут не существовать как символы
    return /_router$/.test(name) || /^get_/.test(name);
  },

  resolve(ref: IUnresolvedReference, context: IResolutionContext): IResolvedRef | null {
    const name = ref.referenceName;

    // *_router
    if (/_router$/.test(name)) {
      const nodes = context.getNodesByName(name);
      if (nodes.length === 1) {
        return {
          original: ref,
          targetNodeId: nodes[0]!.id,
          confidence: 0.85,
          provenance: 'fastapi-router',
        };
      }
    }

    // get_* — dependency injection
    if (/^get_/.test(name)) {
      const nodes = context.getNodesByName(name).filter((n) => n.kind === 'function');
      if (nodes.length === 1) {
        return {
          original: ref,
          targetNodeId: nodes[0]!.id,
          confidence: 0.85,
          provenance: 'fastapi-di',
        };
      }
    }

    // Depends
    if (name === 'Depends') {
      return null;
    }

    return null;
  },

  extract(filePath: string, content: string): IFrameworkExtractionResult {
    const allNodes: INode[] = [];
    const allRefs: IUnresolvedReference[] = [];

    // Decorator routes
    const decResult = extractDecoratorRoutes(filePath, content, 'python');
    allNodes.push(...decResult.nodes);
    allRefs.push(...decResult.references);

    return { nodes: allNodes, references: allRefs };
  },
};

registerFrameworkResolver(djangoResolver);
registerFrameworkResolver(flaskResolver);
registerFrameworkResolver(fastapiResolver);
