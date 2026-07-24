/**
 * Фреймворк-резолвер для Ruby on Rails.
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
const LANGUAGES: Language[] = ['ruby'];

/** Встроенные хелперы Rails. */
const RAILS_HELPERS = new Set([
  'redirect_to', 'render', 'render_to_string', 'redirect_back',
  'authorize', 'policy', 'current_user', 'current_account',
  'params', 'request', 'response', 'session', 'cookies',
  'flash', 'head', 'send_file', 'send_data',
]);

/** Встроенные методы контроллеров Rails. */
const RAILS_CONTROLLER_METHODS = new Set([
  'before_action', 'after_action', 'around_action', 'skip_before_action',
  'skip_after_action', 'skip_around_action', 'prepend_before_action',
  'prepend_after_action', 'prepend_around_action',
]);

/** Обнаружение Rails проекта. */
function detectRails(context: IResolutionContext): boolean {
  const files = context.getAllFiles();

  // Проверяем Gemfile
  const gemfile = files.find((f) => f === 'Gemfile');
  if (gemfile) {
    const content = context.getFileContent?.(gemfile);
    if (content && /gem\s+["']rails["']/i.test(content)) return true;
  }

  // Проверяем конфигурационные файлы Rails
  if (files.includes('config/routes.rb') || files.includes('config/application.rb')) return true;

  // Проверяем Rakefile
  const rakefile = files.find((f) => f === 'Rakefile');
  if (rakefile) {
    const content = context.getFileContent?.(rakefile);
    if (content && /Rails\.application\.tasks\.load_tasks/.test(content)) return true;
  }

  // Проверяем наличие контроллеров
  const controllerFiles = files.filter((f) =>
    f.includes('/controllers/') && f.endsWith('.rb')
  );
  for (const f of controllerFiles) {
    const content = context.getFileContent?.(f);
    if (content && /Controller(?:Base|Concern)/.test(content)) {
      return true;
    }
  }

  return false;
}

/** Извлечение route-узлов из config/routes.rb. */
function extractRailsRoutes(filePath: string, content: string): IFrameworkExtractionResult {
  const nodes: INode[] = [];
  const references: IUnresolvedReference[] = [];

  if (!filePath.endsWith('config/routes.rb')) return { nodes, references };

  // get '/path', to: 'controller#action'
  const routeRe = /(get|post|put|delete|patch|match|resources|namespace|scope)\s+(?:\(\s*)?["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = routeRe.exec(content))) {
    const verb = m[1].toUpperCase();
    const routePath = m[2];
    const lineNum = content.substring(0, m.index).split('\n').length;

    const routeNode: INode = {
      id: crypto.createHash('sha256').update(`route:${filePath}:${routePath}`).digest('hex'),
      kind: NodeKind.Route,
      name: `${verb} ${routePath}`,
      qualifiedName: `${filePath}#${routePath}`,
      filePath,
      language: 'ruby',
      startLine: lineNum,
      endLine: lineNum,
      startColumn: 0,
      endColumn: m[0].length,
      updatedAt: Date.now(),
    };
    nodes.push(routeNode);

    // Ищем to: 'controller#action'
    const afterRoute = content.substring(m.index + m[0].length, m.index + m[0].length + 200);
    const toRe = /to:\s*["']([^"']+)["']/;
    const tm = afterRoute.match(toRe);
    if (tm) {
      references.push({
        fromNodeId: routeNode.id,
        referenceName: tm[1],
        referenceKind: 'calls',
        line: lineNum,
        column: 0,
        filePath,
        language: 'ruby',
      });
    }

    // Ищем via: %i[get post]
    const viaRe = /via:\s*%\[([^\]]+)\]/;
    const vm = afterRoute.match(viaRe);
    if (vm) {
      const verbs = vm[1].split(/\s+/);
      for (const v of verbs) {
        const vNode: INode = {
          id: crypto.createHash('sha256').update(`route:${filePath}:${v.toUpperCase()} ${routePath}`).digest('hex'),
          kind: NodeKind.Route,
          name: `${v.toUpperCase()} ${routePath}`,
          qualifiedName: `${filePath}#${v.toUpperCase()} ${routePath}`,
          filePath,
          language: 'ruby',
          startLine: lineNum,
          endLine: lineNum,
          startColumn: 0,
          endColumn: m[0].length,
          updatedAt: Date.now(),
        };
        nodes.push(vNode);
      }
    }
  }

  // resources :posts, only: [:index, :show]
  const resourcesRe = /resources\s+[:"](\w+)(?:\s*,\s*only:\s*%\[([^\]]+)\])?/g;
  let rm: RegExpExecArray | null;
  while ((rm = resourcesRe.exec(content))) {
    const resourceName = rm[1];
    const lineNum = content.substring(0, rm.index).split('\n').length;

    const controllerName = `${resourceName}_controller`;

    // Создаём узлы для каждого действия
    const actions = rm[2]
      ? rm[2].split(',').map((a) => a.trim().replace(/:/g, ''))
      : ['index', 'show', 'new', 'edit', 'create', 'update', 'destroy'];

    for (const action of actions) {
      const routeNode: INode = {
        id: crypto.createHash('sha256').update(`route:${filePath}:${resourceName}/${action}`).digest('hex'),
        kind: NodeKind.Route,
        name: `${action} ${resourceName}`,
        qualifiedName: `${filePath}#${resourceName}/${action}`,
        filePath,
        language: 'ruby',
        startLine: lineNum,
        endLine: lineNum,
        startColumn: 0,
        endColumn: rm[0].length,
        updatedAt: Date.now(),
      };
      nodes.push(routeNode);

      references.push({
        fromNodeId: routeNode.id,
        referenceName: `${controllerName}#${action}`,
        referenceKind: 'calls',
        line: lineNum,
        column: 0,
        filePath,
        language: 'ruby',
      });
    }
  }

  return { nodes, references };
}

/** Извлечение controller-узлов из контроллеров Rails. */
function extractRailsControllers(filePath: string, content: string): IFrameworkExtractionResult {
  const nodes: INode[] = [];
  const references: IUnresolvedReference[] = [];

  // class PostsController < ApplicationController
  const classRe = /class\s+(\w+)\s*<\s*(\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = classRe.exec(content))) {
    const controllerName = m[1];
    const parentClass = m[2];
    const lineNum = content.substring(0, m.index).split('\n').length;

    nodes.push({
      id: crypto.createHash('sha256').update(`controller:${filePath}:${controllerName}`).digest('hex'),
      kind: NodeKind.Class,
      name: controllerName,
      qualifiedName: `${filePath}#${controllerName}`,
      filePath,
      language: 'ruby',
      startLine: lineNum,
      endLine: lineNum,
      startColumn: 0,
      endColumn: m[0].length,
      updatedAt: Date.now(),
    });

    if (parentClass !== 'Object' && parentClass !== 'BasicObject') {
      references.push({
        fromNodeId: nodes[nodes.length - 1].id,
        referenceName: parentClass,
        referenceKind: 'extends',
        line: lineNum,
        column: 0,
        filePath,
        language: 'ruby',
      });
    }
  }

  // before_action :method_name
  const actionRe = /(before_action|after_action|around_action)\s+(?:\(\s*)?[:"](\w+)/g;
  while ((m = actionRe.exec(content))) {
    const hookType = m[1];
    const methodName = m[2];
    const lineNum = content.substring(0, m.index).split('\n').length;

    references.push({
      fromNodeId: nodes.length > 0 ? nodes[nodes.length - 1].id : filePath,
      referenceName: methodName,
      referenceKind: 'calls',
      line: lineNum,
      column: 0,
      filePath,
      language: 'ruby',
    });
  }

  return { nodes, references };
}

/** Разрешение controller#action ссылки. */
function resolveRailsControllerAction(
  controllerName: string,
  actionName: string,
  context: IResolutionContext
): INode | null {
  const files = context.getAllFiles();
  const controllerFiles = files.filter((f) =>
    f.includes('/controllers/') && f.endsWith('.rb')
  );

  for (const f of controllerFiles) {
    const content = context.getFileContent?.(f);
    if (!content) continue;

    // Ищем класс контроллера
    const classRe = new RegExp(`class\\s+${controllerName}\\s*<`);
    if (!classRe.test(content)) continue;

    // Ищем метод
    const methodRe = new RegExp(`def\\s+(?:self\\.)?${actionName}\\s*\\(`);
    if (!methodRe.test(content)) continue;

    // Находим метод в узлах
    const fileNodes = context.getNodesByFile(f);
    const method = fileNodes.find(
      (n) => n.kind === 'method' && n.name === actionName
    );
    if (method) return method;

    // Создаём узел, если не найден
    const methodLine = content.split('\n').findIndex((l) => methodRe.test(l)) + 1;
    return {
      id: crypto.createHash('sha256').update(`${f}:${actionName}`).digest('hex'),
      kind: NodeKind.Method,
      name: actionName,
      qualifiedName: `${controllerName}#${actionName}`,
      filePath: f,
      language: 'ruby',
      startLine: methodLine,
      endLine: methodLine,
      startColumn: 0,
      endColumn: 0,
      updatedAt: Date.now(),
    };
  }

  return null;
}

/** Резолвер Ruby on Rails. */
const railsResolver: IFrameworkResolver = {
  name: 'Rails',
  languages: LANGUAGES,

  detect: detectRails,

  claimsReference(name: string): boolean {
    // controller#action — эти ссылки не существуют как символы
    return name.includes('#');
  },

  resolve(ref: IUnresolvedReference, context: IResolutionContext): IResolvedRef | null {
    const name = ref.referenceName;

    // Controller#action
    if (name.includes('#')) {
      const [controllerName, actionName] = name.split('#');
      const method = resolveRailsControllerAction(controllerName, actionName, context);
      if (method) {
        return {
          original: ref,
          targetNodeId: method.id,
          confidence: 0.9,
          provenance: 'rails-controller',
        };
      }
      return null;
    }

    // *Controller
    if (/Controller$/.test(name)) {
      const nodes = context.getNodesByName(name).filter((n) => n.kind === 'class');
      if (nodes.length === 1) {
        return {
          original: ref,
          targetNodeId: nodes[0]!.id,
          confidence: 0.85,
          provenance: 'rails-controller',
        };
      }
    }

    // *Model
    if (/Model$/.test(name)) {
      const nodes = context.getNodesByName(name).filter((n) => n.kind === 'class');
      if (nodes.length === 1) {
        return {
          original: ref,
          targetNodeId: nodes[0]!.id,
          confidence: 0.85,
          provenance: 'rails-model',
        };
      }
    }

    // *Helper
    if (/Helper$/.test(name)) {
      const nodes = context.getNodesByName(name).filter((n) => n.kind === 'module');
      if (nodes.length === 1) {
        return {
          original: ref,
          targetNodeId: nodes[0]!.id,
          confidence: 0.85,
          provenance: 'rails-helper',
        };
      }
    }

    // *Mailer
    if (/Mailer$/.test(name)) {
      const nodes = context.getNodesByName(name).filter((n) => n.kind === 'class');
      if (nodes.length === 1) {
        return {
          original: ref,
          targetNodeId: nodes[0]!.id,
          confidence: 0.85,
          provenance: 'rails-mailer',
        };
      }
    }

    // *Job
    if (/Job$/.test(name)) {
      const nodes = context.getNodesByName(name).filter((n) => n.kind === 'class');
      if (nodes.length === 1) {
        return {
          original: ref,
          targetNodeId: nodes[0]!.id,
          confidence: 0.85,
          provenance: 'rails-job',
        };
      }
    }

    // Встроенные хелперы Rails
    if (RAILS_HELPERS.has(name)) {
      return {
        original: ref,
        targetNodeId: ref.fromNodeId,
        confidence: 1.0,
        provenance: 'rails-helper',
      };
    }

    // Встроенные методы контроллеров
    if (RAILS_CONTROLLER_METHODS.has(name)) {
      return {
        original: ref,
        targetNodeId: ref.fromNodeId,
        confidence: 1.0,
        provenance: 'rails-controller-method',
      };
    }

    return null;
  },

  extract(filePath: string, content: string): IFrameworkExtractionResult {
    const allNodes: INode[] = [];
    const allRefs: IUnresolvedReference[] = [];

    // Rails routes
    const routeResult = extractRailsRoutes(filePath, content);
    allNodes.push(...routeResult.nodes);
    allRefs.push(...routeResult.references);

    // Rails controllers
    if (filePath.includes('/controllers/') && filePath.endsWith('.rb')) {
      const controllerResult = extractRailsControllers(filePath, content);
      allNodes.push(...controllerResult.nodes);
      allRefs.push(...controllerResult.references);
    }

    return { nodes: allNodes, references: allRefs };
  },
};

registerFrameworkResolver(railsResolver);
