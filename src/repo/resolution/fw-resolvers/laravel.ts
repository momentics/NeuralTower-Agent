/**
 * Фреймворк-резолвер для Laravel.
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

/** Маппинг фасадов Laravel на реальные классы. */
export const FACADE_MAPPINGS: Record<string, string> = {
  Auth: 'Illuminate\\Auth\\AuthManager',
  Cache: 'Illuminate\\Cache\\CacheManager',
  Config: 'Illuminate\\Config\\Repository',
  Cookie: 'Illuminate\\Cookie\\CookieJar',
  Crypt: 'Illuminate\\Encryption\\Encrypter',
  DB: 'Illuminate\\Database\\DatabaseManager',
  Event: 'Illuminate\\Events\\Dispatcher',
  File: 'Illuminate\\Filesystem\\FilesystemManager',
  Hash: 'Illuminate\\Hashing\\HashManager',
  Log: 'Illuminate\\Log\\LogManager',
  Mail: 'Illuminate\\Mail\\MailManager',
  Queue: 'Illuminate\\Queue\\QueueManager',
  Request: 'Illuminate\\Http\\Request',
  Response: 'Illuminate\\Http\\ResponseFactory',
  Route: 'Illuminate\\Routing\\Router',
  Schema: 'Illuminate\\Database\\Schema\\Builder',
  Session: 'Illuminate\\Session\\Store',
  Storage: 'Illuminate\\Filesystem\\FilesystemManager',
  URL: 'Illuminate\\Routing\\UrlGenerator',
  View: 'Illuminate\\View\\Factory',
};

/** Обнаружение Laravel проекта. */
function detectLaravel(context: IResolutionContext): boolean {
  const files = context.getAllFiles();
  return files.includes('artisan') || files.includes('app/Http/Kernel.php');
}

/** Разрешение Controller@method. */
function resolveControllerMethod(
  controllerName: string,
  methodName: string,
  context: IResolutionContext
): INode | null {
  // Ищем в app/Http/Controllers/
  const files = context.getAllFiles();
  const controllerFiles = files.filter((f) =>
    f.startsWith('app/Http/Controllers/') && f.endsWith('.php')
  );

  for (const f of controllerFiles) {
    const content = context.getFileContent?.(f);
    if (!content) continue;

    // Ищем класс
    const classRe = new RegExp(`class\\s+${controllerName.replace(/\//g, '\\/')}\\s*\\{`);
    if (!classRe.test(content)) continue;

    // Ищем метод
    const methodRe = new RegExp(`function\\s+${methodName}\\s*\\(`);
    if (!methodRe.test(content)) continue;

    // Находим метод в узлах
    const nodes = context.getNodesByFile(f);
    const method = nodes.find(
      (n) => n.kind === 'method' && n.name === methodName
    );
    if (method) return method;

    // Создаём узел, если не найден
    const lineNum = content.split('\n').findIndex((l) => methodRe.test(l)) + 1;
    return {
      id: crypto.createHash('sha256').update(`${f}:${methodName}`).digest('hex'),
      kind: NodeKind.Method,
      name: methodName,
      qualifiedName: `${controllerName}.${methodName}`,
      filePath: f,
      language: 'php',
      startLine: lineNum,
      endLine: lineNum,
      startColumn: 0,
      endColumn: 0,
      updatedAt: Date.now(),
    };
  }

  return null;
}

/** Извлечение route-узлов из Laravel. */
function extractLaravelRoutes(filePath: string, content: string): IFrameworkExtractionResult {
  const nodes: INode[] = [];
  const references: IUnresolvedReference[] = [];

  // Route::VERB('/path', handler)
  const routeRe = /Route::(get|post|put|delete|patch|resource|apiResource)\s*\(\s*["']([^"']+)["']\s*,\s*(.+?)(?:\)|$)/gis;
  let m: RegExpExecArray | null;
  while ((m = routeRe.exec(content))) {
    const verb = m[1].toUpperCase();
    const routePath = m[2];
    const handler = m[3].trim();
    const lineNum = content.substring(0, m.index).split('\n').length;

    const routeNode: INode = {
      id: crypto.createHash('sha256').update(`route:${filePath}:${routePath}`).digest('hex'),
      kind: NodeKind.Route,
      name: `${verb} ${routePath}`,
      qualifiedName: `${filePath}#${routePath}`,
      filePath,
      language: 'php',
      startLine: lineNum,
      endLine: lineNum,
      startColumn: 0,
      endColumn: m[0].length,
      updatedAt: Date.now(),
    };
    nodes.push(routeNode);

    // Форма 1: [Class::class, 'method']
    const arrayRe = /\[\s*(\w+)::class\s*,\s*['"](\w+)['"]\s*\]/;
    const am = handler.match(arrayRe);
    if (am) {
      references.push({
        fromNodeId: routeNode.id,
        referenceName: `${am[1]}@${am[2]}`,
        referenceKind: 'calls',
        line: lineNum,
        column: 0,
        filePath,
        language: 'php',
      });
      continue;
    }

    // Форма 2: 'Controller@method'
    const strRe = /['"]([^'"]+@[^'"]+)['"]/;
    const sm = handler.match(strRe);
    if (sm) {
      references.push({
        fromNodeId: routeNode.id,
        referenceName: sm[1],
        referenceKind: 'calls',
        line: lineNum,
        column: 0,
        filePath,
        language: 'php',
      });
      continue;
    }

    // Форма 3: Class::class
    const classRe = /(\w+)::class/;
    const cm = handler.match(classRe);
    if (cm) {
      references.push({
        fromNodeId: routeNode.id,
        referenceName: cm[1],
        referenceKind: 'calls',
        line: lineNum,
        column: 0,
        filePath,
        language: 'php',
      });
    }
  }

  return { nodes, references };
}

/** Резолвер Laravel. */
const laravelResolver: IFrameworkResolver = {
  name: 'Laravel',
  languages: LANGUAGES,

  detect: detectLaravel,

  claimsReference(name: string): boolean {
    // Controller@method — эти ссылки не существуют как символы
    // Model::method — Eloquent static calls
    return name.includes('@') || name.includes('::');
  },

  resolve(ref: IUnresolvedReference, context: IResolutionContext): IResolvedRef | null {
    const name = ref.referenceName;

    // Controller@method
    if (name.includes('@')) {
      const [controllerName, methodName] = name.split('@');
      const method = resolveControllerMethod(controllerName, methodName, context);
      if (method) {
        return {
          original: ref,
          targetNodeId: method.id,
          confidence: 0.9,
          provenance: 'laravel-controller',
        };
      }
      return null;
    }

    // Model::method() — Eloquent static calls
    if (name.includes('::')) {
      const [modelName, methodName] = name.split('::');
      const models = context.getNodesByName(modelName).filter(
        (n) => n.kind === 'class'
      );
      if (models.length === 1) {
        const children = context.getChildren(models[0]!.id);
        const method = children.find((c) => c.kind === 'method' && c.name === methodName);
        if (method) {
          return {
            original: ref,
            targetNodeId: method.id,
            confidence: 0.9,
            provenance: 'laravel-eloquent',
          };
        }
      }
    }

    // Facade calls — внешние, вернуть null
    if (name in FACADE_MAPPINGS) {
      return null;
    }

    // Helper functions — внешние, вернуть null
    if (/^(route|view|config|asset|url|redirect|abort|auth|bcrypt|crypto|event|now|today|str|tap|value|with)$/.test(name)) {
      return null;
    }

    return null;
  },

  extract(filePath: string, content: string): IFrameworkExtractionResult {
    return extractLaravelRoutes(filePath, content);
  },
};

registerFrameworkResolver(laravelResolver);
