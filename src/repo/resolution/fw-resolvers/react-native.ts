/**
 * Фреймворк-резолвер для React Native:
 * AppRegistry.registerComponent → component-узлы.
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
const LANGUAGES: Language[] = ['typescript', 'javascript'];

function sha256hex(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

/** Обнаружение React Native проекта. */
function detectReactNative(context: IResolutionContext): boolean {
  const allFiles = context.getAllFiles();
  const pkg = allFiles.find((f) => f === 'package.json');
  if (pkg) {
    const content = context.getFileContent(pkg);
    if (content) {
      try {
        const data = JSON.parse(content);
        const deps = { ...data.dependencies, ...data.devDependencies };
        if (deps['react-native']) return true;
      } catch {
        // JSON не разобран — пропускаем
      }
    }
  }
  // Фолбэк: AppRegistry в коде
  const jsFiles = allFiles.filter((f) => /\.(ts|js|tsx|jsx)$/.test(f));
  for (const f of jsFiles.slice(0, 200)) {
    const content = context.getFileContent(f);
    if (content && /AppRegistry\.registerComponent/.test(content)) return true;
  }
  return false;
}

/** Извлечение component-узлов из AppRegistry.registerComponent. */
function extractReactNativeComponents(filePath: string, content: string): IFrameworkExtractionResult {
  const nodes: INode[] = [];
  const references: IUnresolvedReference[] = [];

  const re = /AppRegistry\.registerComponent\(\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const name = m[1];
    const lineNum = content.substring(0, m.index).split('\n').length;
    nodes.push({
      id: sha256hex(`rn-component:${filePath}:${name}`),
      kind: NodeKind.Component,
      name,
      qualifiedName: name,
      filePath,
      language: filePath.endsWith('.ts') || filePath.endsWith('.tsx') ? 'typescript' : 'javascript',
      startLine: lineNum,
      endLine: lineNum,
      startColumn: 0,
      endColumn: m[0].length,
      updatedAt: Date.now(),
    });
  }

  return { nodes, references };
}

/** Резолвер React Native. */
const reactNativeResolver: IFrameworkResolver = {
  name: 'React Native',
  languages: LANGUAGES,
  detect: detectReactNative,
  resolve: (_ref: IUnresolvedReference, _context: IResolutionContext): IResolvedRef | null => null,
  extract: extractReactNativeComponents,
};

registerFrameworkResolver(reactNativeResolver);
