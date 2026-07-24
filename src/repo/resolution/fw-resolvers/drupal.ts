/**
 * Фреймворк-резолвер для Drupal.
 *
 * Обрабатывает маршруты из *.routing.yml, #[Route()] аннотации PHP,
 * Form-классы и сервисы Drupal.
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
const LANGUAGES: Language[] = ['php'];

/** Встроенные хелперы Drupal. */
const DRUPAL_HELPERS = new Set([
  't', 'l', 'link', 'url', 'format_date', 'format_plural',
  'file_create_url', 'file_create_filename',
]);

/** Обнаружение Drupal проекта. */
function detectDrupal(context: IResolutionContext): boolean {
  const files = context.getAllFiles();

  if (files.some((f) => f.includes('core/lib/Drupal.php'))) return true;
  if (files.some((f) => f.startsWith('core/themes/'))) return true;

  const composerFile = files.find((f) => f === 'composer.json');
  if (composerFile) {
    const content = context.getFileContent?.(composerFile);
    if (content) {
      try {
        const pkg = JSON.parse(content);
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (deps['drupal/core']) return true;
      } catch {
        // JSON не разобран — пропускаем
      }
    }
  }

  return false;
}

/** Извлечение route-узлов из *.routing.yml. */
function extractRoutingYaml(filePath: string, content: string): IFrameworkExtractionResult {
  const nodes: INode[] = [];
  const references: IUnresolvedReference[] = [];

  const yamlRouteRe = /^(\w[\w.]+):\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = yamlRouteRe.exec(content))) {
    const routeName = m[1];
    const lineNum = content.substring(0, m.index).split('\n').length;

    const afterMatch = content.substring(m.index + m[0].length);
    const pathRe = /^\s+path:\s*['"]([^'"]+)['"]/;
    const controllerRe = /^\s+_controller:\s*['"]?([^'"\s]+)['"]?/;

    const pm = afterMatch.match(pathRe);
    const cm = afterMatch.match(controllerRe);

    if (pm) {
      const routePath = pm[1];

      const routeNode: INode = {
        id: crypto.createHash('sha256').update(`route:${filePath}:${routeName}`).digest('hex'),
        kind: NodeKind.Route,
        name: routePath,
        qualifiedName: `drupal.routing:${routeName}`,
        filePath,
        language: 'php',
        startLine: lineNum,
        endLine: lineNum,
        startColumn: 0,
        endColumn: m[0].length,
        updatedAt: Date.now(),
      };
      nodes.push(routeNode);

      if (cm) {
        const controller = cm[1];
        references.push({
          fromNodeId: routeNode.id,
          referenceName: controller,
          referenceKind: 'calls',
          line: lineNum + 2,
          column: 0,
          filePath,
          language: 'php',
        });
      }
    }
  }

  return { nodes, references };
}

/** Извлечение route-узлов из #[Route()] аннотаций Symfony/Drupal. */
function extractRouteAnnotations(filePath: string, content: string): IFrameworkExtractionResult {
  const nodes: INode[] = [];
  const references: IUnresolvedReference[] = [];

  const annoRouteRe = /#\[Route\s*\(\s*['"]([^'"]+)['"]/g;
  let am: RegExpExecArray | null;
  while ((am = annoRouteRe.exec(content))) {
    const routePath = am[1];
    const lineNum = content.substring(0, am.index).split('\n').length;

    const afterMatch = content.substring(am.index + am[0].length);
    const nameRe = /name\s*=\s*['"]([^'"]+)['"]/;
    const nm = afterMatch.match(nameRe);
    const routeName = nm ? nm[1] : `route_${lineNum}`;

    const routeNode: INode = {
      id: crypto.createHash('sha256').update(`route:${filePath}:${routeName}`).digest('hex'),
      kind: NodeKind.Route,
      name: routePath,
      qualifiedName: `drupal.route:${routeName}`,
      filePath,
      language: 'php',
      startLine: lineNum,
      endLine: lineNum,
      startColumn: 0,
      endColumn: am[0].length,
      updatedAt: Date.now(),
    };
    nodes.push(routeNode);

    const funcRe = /\bfunction\s+(\w+)/;
    const fm = afterMatch.match(funcRe);
    if (fm) {
      references.push({
        fromNodeId: routeNode.id,
        referenceName: fm[1],
        referenceKind: 'calls',
        line: lineNum + 1,
        column: 0,
        filePath,
        language: 'php',
      });
    }
  }

  return { nodes, references };
}

/** Извлечение Form-классов Drupal. */
function extractDrupalForms(filePath: string, content: string): IFrameworkExtractionResult {
  const nodes: INode[] = [];
  const references: IUnresolvedReference[] = [];

  const formRe = /class\s+(\w+)\s+extends\s+FormBase/g;
  let m: RegExpExecArray | null;
  while ((m = formRe.exec(content))) {
    const formName = m[1];
    const lineNum = content.substring(0, m.index).split('\n').length;

    nodes.push({
      id: crypto.createHash('sha256').update(`form:${filePath}:${formName}`).digest('hex'),
      kind: NodeKind.Component,
      name: formName,
      qualifiedName: `${filePath}#${formName}`,
      filePath,
      language: 'php',
      startLine: lineNum,
      endLine: lineNum,
      startColumn: 0,
      endColumn: m[0].length,
      updatedAt: Date.now(),
    });
  }

  return { nodes, references };
}

/** Резолвер Drupal. */
const drupalResolver: IFrameworkResolver = {
  name: 'Drupal',
  languages: LANGUAGES,

  detect: detectDrupal,

  claimsReference(name: string): boolean {
    // PHP-пути с обратными слэшами (Drupal\SomeModule\Controller\...)
    return name.includes('\\');
  },

  resolve(ref: IUnresolvedReference, context: IResolutionContext): IResolvedRef | null {
    const name = ref.referenceName;

    if (DRUPAL_HELPERS.has(name)) {
      return {
        original: ref,
        targetNodeId: ref.fromNodeId,
        confidence: 1.0,
        provenance: 'drupal-helper',
      };
    }

    // PHP-пути: Drupal\SomeModule\Controller\SomeController::method
    if (name.includes('\\')) {
      const parts = name.split('\\');
      const lastPart = parts[parts.length - 1];

      const nodes = context.getNodesByName(lastPart);
      if (nodes.length === 1) {
        return {
          original: ref,
          targetNodeId: nodes[0]!.id,
          confidence: 0.85,
          provenance: 'drupal-fqn',
        };
      }
    }

    if (name.endsWith('Form')) {
      const nodes = context.getNodesByName(name).filter(
        (n) => n.kind === 'class'
      );
      if (nodes.length === 1) {
        return {
          original: ref,
          targetNodeId: nodes[0]!.id,
          confidence: 0.85,
          provenance: 'drupal-form',
        };
      }
    }

    return null;
  },

  extract(filePath: string, content: string): IFrameworkExtractionResult {
    const allNodes: INode[] = [];
    const allRefs: IUnresolvedReference[] = [];

    if (filePath.endsWith('.routing.yml')) {
      const result = extractRoutingYaml(filePath, content);
      allNodes.push(...result.nodes);
      allRefs.push(...result.references);
    }

    if (filePath.endsWith('.php') && content.includes('#[Route')) {
      const result = extractRouteAnnotations(filePath, content);
      allNodes.push(...result.nodes);
      allRefs.push(...result.references);
    }

    if (filePath.endsWith('.php') && content.includes('FormBase')) {
      const result = extractDrupalForms(filePath, content);
      allNodes.push(...result.nodes);
      allRefs.push(...result.references);
    }

    return { nodes: allNodes, references: allRefs };
  },
};

registerFrameworkResolver(drupalResolver);
