/**
 * Фреймворк-резолвер для ASP.NET Core: route-атрибуты → route-узлы.
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
const LANGUAGES: Language[] = ['csharp', 'razor'];

function sha256hex(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

/** Обнаружение ASP.NET Core проекта. */
function detectAspNetCore(context: IResolutionContext): boolean {
  const allFiles = context.getAllFiles();
  const csproj = allFiles.find((f) => f.endsWith('.csproj'));
  if (csproj) {
    const content = context.getFileContent(csproj);
    if (content && /Microsoft\.AspNetCore/i.test(content)) return true;
  }
  // Фолбэк: route-атрибуты в коде
  const csFiles = allFiles.filter((f) => f.endsWith('.cs'));
  for (const f of csFiles.slice(0, 200)) {
    const content = context.getFileContent(f);
    if (content && /\[(Route|HttpGet|HttpPost|HttpPut|HttpDelete|HttpPatch)\s*\(/.test(content)) {
      return true;
    }
  }
  return false;
}

/** Извлечение route-узлов из атрибутов. */
function extractAspNetRoutes(filePath: string, content: string): IFrameworkExtractionResult {
  const nodes: INode[] = [];
  const references: IUnresolvedReference[] = [];

  const routeRe = /\[(Route|HttpGet|HttpPost|HttpPut|HttpDelete|HttpPatch)\s*\(\s*(?:"([^"]*)")?/g;
  let m: RegExpExecArray | null;
  while ((m = routeRe.exec(content))) {
    const attr = m[1];
    const routePath = m[2] ?? '';
    const lineNum = content.substring(0, m.index).split('\n').length;
    const verb = attr === 'Route' ? 'ROUTE' : attr.toUpperCase().replace('HTTP', '');
    const name = routePath ? `${verb} ${routePath}` : verb;

    nodes.push({
      id: sha256hex(`route:${filePath}:${lineNum}:${name}`),
      kind: NodeKind.Route,
      name,
      qualifiedName: `${filePath}#${lineNum}`,
      filePath,
      language: filePath.endsWith('.cs') ? 'csharp' : 'razor',
      startLine: lineNum,
      endLine: lineNum,
      startColumn: 0,
      endColumn: m[0].length,
      updatedAt: Date.now(),
    });
  }

  return { nodes, references };
}

/** Резолвер ASP.NET Core. */
const aspnetCoreResolver: IFrameworkResolver = {
  name: 'ASP.NET Core',
  languages: LANGUAGES,
  detect: detectAspNetCore,
  resolve: (_ref: IUnresolvedReference, _context: IResolutionContext): IResolvedRef | null => null,
  extract: extractAspNetRoutes,
};

registerFrameworkResolver(aspnetCoreResolver);
