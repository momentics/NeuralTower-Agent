/**
 * Фреймворк-резолвер для Play Framework (Java/Scala).
 *
 * Обрабатывает маршруты из conf/routes, контроллеры
 * с аннотациями @Inject и @Action.
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
const LANGUAGES: Language[] = ['java', 'scala'];

/** Обнаружение Play Framework проекта. */
function detectPlay(context: IResolutionContext): boolean {
  const files = context.getAllFiles();

  // Проверяем build.sbt на play
  const sbtFile = files.find((f) => f === 'build.sbt');
  if (sbtFile) {
    const content = context.getFileContent?.(sbtFile);
    if (content && /play/.test(content)) return true;
  }

  // Проверяем conf/routes
  const routesFile = files.find((f) => f === 'conf/routes');
  if (routesFile) return true;

  // Проверяем package.json на play
  const pkgFile = files.find((f) => f === 'package.json');
  if (pkgFile) {
    const content = context.getFileContent?.(pkgFile);
    if (content) {
      try {
        const pkg = JSON.parse(content);
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (deps['play']) return true;
      } catch {
        // JSON не разобран — пропускаем
      }
    }
  }

  return false;
}

/** Извлечение route-узлов из conf/routes. */
function extractPlayRoutes(filePath: string, content: string): IFrameworkExtractionResult {
  const nodes: INode[] = [];
  const references: IUnresolvedReference[] = [];

  // GET /path controllers.SomeController.action()
  const routeRe = /^(GET|POST|PUT|DELETE|PATCH|OPTIONS)\s+([^\s]+)\s+(controllers\.\w+\.\w+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = routeRe.exec(content))) {
    const verb = m[1];
    const routePath = m[2];
    const controllerRef = m[3];
    const lineNum = content.substring(0, m.index).split('\n').length;

    const routeNode: INode = {
      id: crypto.createHash('sha256').update(`route:${filePath}:${routePath}`).digest('hex'),
      kind: NodeKind.Route,
      name: `${verb} ${routePath}`,
      qualifiedName: `${filePath}#${routePath}`,
      filePath,
      language: 'java',
      startLine: lineNum,
      endLine: lineNum,
      startColumn: 0,
      endColumn: m[0].length,
      updatedAt: Date.now(),
    };
    nodes.push(routeNode);

    references.push({
      fromNodeId: routeNode.id,
      referenceName: controllerRef,
      referenceKind: 'calls',
      line: lineNum,
      column: 0,
      filePath,
      language: 'java',
    });
  }

  return { nodes, references };
}

/** Извлечение контроллеров Play. */
function extractPlayControllers(filePath: string, content: string): IFrameworkExtractionResult {
  const nodes: INode[] = [];
  const references: IUnresolvedReference[] = [];

  // class SomeController extends Controller — контроллеры Play
  const ctrlRe = /class\s+(\w+)\s+extends\s+Controller/g;
  let cm: RegExpExecArray | null;
  while ((cm = ctrlRe.exec(content))) {
    const ctrlName = cm[1];
    const lineNum = content.substring(0, cm.index).split('\n').length;

    nodes.push({
      id: crypto.createHash('sha256').update(`controller:${filePath}:${ctrlName}`).digest('hex'),
      kind: NodeKind.Component,
      name: ctrlName,
      qualifiedName: `${filePath}#${ctrlName}`,
      filePath,
      language: 'java',
      startLine: lineNum,
      endLine: lineNum,
      startColumn: 0,
      endColumn: cm[0].length,
      updatedAt: Date.now(),
    });
  }

  // @Action аннотации
  const actionRe = /@Action\s*\(\s*["']([^"']+)["']\s*\)/g;
  while ((cm = actionRe.exec(content))) {
    const actionPath = cm[1];
    const lineNum = content.substring(0, cm.index).split('\n').length;

    const routeNode: INode = {
      id: crypto.createHash('sha256').update(`action:${filePath}:${actionPath}`).digest('hex'),
      kind: NodeKind.Route,
      name: actionPath,
      qualifiedName: `${filePath}#action:${actionPath}`,
      filePath,
      language: 'java',
      startLine: lineNum,
      endLine: lineNum,
      startColumn: 0,
      endColumn: cm[0].length,
      updatedAt: Date.now(),
    };
    nodes.push(routeNode);

    // Ищем метод после аннотации
    const afterMatch = content.substring(cm.index + cm[0].length);
    const funcRe = /\bdef\s+(\w+)/;
    const fm = afterMatch.match(funcRe);
    if (fm) {
      references.push({
        fromNodeId: routeNode.id,
        referenceName: fm[1],
        referenceKind: 'calls',
        line: lineNum + 1,
        column: 0,
        filePath,
        language: 'java',
      });
    }
  }

  return { nodes, references };
}

/** Резолвер Play Framework. */
const playResolver: IFrameworkResolver = {
  name: 'Play',
  languages: LANGUAGES,

  detect: detectPlay,

  claimsReference(name: string): boolean {
    // Ссылки вида controllers.SomeController.action
    return name.startsWith('controllers.');
  },

  resolve(ref: IUnresolvedReference, context: IResolutionContext): IResolvedRef | null {
    const name = ref.referenceName;

    // controllers.SomeController.action — ссылки из routes
    if (name.startsWith('controllers.')) {
      const parts = name.split('.');
      const methodName = parts[parts.length - 1];

      const nodes = context.getNodesByName(methodName);
      if (nodes.length === 1) {
        return {
          original: ref,
          targetNodeId: nodes[0]!.id,
          confidence: 0.85,
          provenance: 'play-controller',
        };
      }

      // Ищем по имени контроллера
      const controllerName = parts[1];
      const ctrlNodes = context.getNodesByName(controllerName).filter(
        (n) => n.kind === 'class'
      );
      if (ctrlNodes.length === 1) {
        return {
          original: ref,
          targetNodeId: ctrlNodes[0]!.id,
          confidence: 0.8,
          provenance: 'play-controller',
        };
      }
    }

    return null;
  },

  extract(filePath: string, content: string): IFrameworkExtractionResult {
    const allNodes: INode[] = [];
    const allRefs: IUnresolvedReference[] = [];

    // conf/routes — файл маршрутов Play
    if (filePath === 'conf/routes') {
      const result = extractPlayRoutes(filePath, content);
      allNodes.push(...result.nodes);
      allRefs.push(...result.references);
    }

    // Контроллеры Java/Scala
    if (filePath.endsWith('.java') || filePath.endsWith('.scala')) {
      if (content.includes('extends Controller') || content.includes('@Action')) {
        const result = extractPlayControllers(filePath, content);
        allNodes.push(...result.nodes);
        allRefs.push(...result.references);
      }
    }

    return { nodes: allNodes, references: allRefs };
  },
};

registerFrameworkResolver(playResolver);
