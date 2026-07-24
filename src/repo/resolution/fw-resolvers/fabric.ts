/**
 * Фреймворк-резолвер для Fabric.js (Canvas).
 *
 * Обрабатывает инициализацию Canvas, обработчики событий,
 * и встроенные классы Fabric.
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

/** Встроенные классы Fabric. */
const FABRIC_CLASSES = new Set([
  'Canvas', 'StaticCanvas', 'FreeDrawingBrush',
  'Rect', 'Circle', 'Ellipse', 'Triangle', 'Polygon', 'Polyline', 'Line',
  'Text', 'IText', 'Textbox',
  'Group', 'ActiveSelection', 'Image', 'Path', 'PathGroup',
  'Object', 'Shadow', 'Gradient', 'Pattern',
]);

/** Обнаружение Fabric.js проекта. */
function detectFabric(context: IResolutionContext): boolean {
  const files = context.getAllFiles();

  const pkgFile = files.find((f) => f === 'package.json');
  if (pkgFile) {
    const content = context.getFileContent?.(pkgFile);
    if (content) {
      try {
        const pkg = JSON.parse(content);
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (deps.fabric) return true;
      } catch {
        // JSON не разобран — пропускаем
      }
    }
  }

  // Проверяем импорт fabric в файлах
  return files.some((f) => {
    if (!f.endsWith('.ts') && !f.endsWith('.js') && !f.endsWith('.tsx') && !f.endsWith('.jsx')) return false;
    const content = context.getFileContent?.(f);
    return content && (content.includes('fabric') || content.includes('new fabric.'));
  });
}

/** Извлечение обработчиков событий canvas.on(). */
function extractCanvasEvents(filePath: string, content: string): IFrameworkExtractionResult {
  const nodes: INode[] = [];
  const references: IUnresolvedReference[] = [];

  // canvas.on('mouse:down', handler) — обработчик события
  const eventRe = /\.on\s*\(\s*['"]([^'"]+)['"]\s*,\s*(?:function\s*(?:\([^)]*\))?\s*\{|(\w+))/g;
  let m: RegExpExecArray | null;
  while ((m = eventRe.exec(content))) {
    const eventName = m[1];
    const handlerName = m[2];
    const lineNum = content.substring(0, m.index).split('\n').length;

    const eventNode: INode = {
      id: crypto.createHash('sha256').update(`event:${filePath}:${eventName}`).digest('hex'),
      kind: NodeKind.Route,
      name: eventName,
      qualifiedName: `${filePath}#event:${eventName}`,
      filePath,
      language: 'javascript',
      startLine: lineNum,
      endLine: lineNum,
      startColumn: 0,
      endColumn: m[0].length,
      updatedAt: Date.now(),
    };
    nodes.push(eventNode);

    if (handlerName) {
      references.push({
        fromNodeId: eventNode.id,
        referenceName: handlerName,
        referenceKind: 'calls',
        line: lineNum,
        column: 0,
        filePath,
        language: 'javascript',
      });
    }
  }

  return { nodes, references };
}

/** Резолвер Fabric.js. */
const fabricResolver: IFrameworkResolver = {
  name: 'Fabric',
  languages: LANGUAGES,

  detect: detectFabric,

  claimsReference(name: string): boolean {
    return FABRIC_CLASSES.has(name) || name.startsWith('fabric.');
  },

  resolve(ref: IUnresolvedReference, context: IResolutionContext): IResolvedRef | null {
    const name = ref.referenceName;

    // Встроенные классы Fabric
    if (FABRIC_CLASSES.has(name)) {
      return {
        original: ref,
        targetNodeId: ref.fromNodeId,
        confidence: 1.0,
        provenance: 'fabric-class',
      };
    }

    // fabric.ClassName — ссылки на встроенные классы
    if (name.startsWith('fabric.')) {
      const className = name.slice(7);
      if (FABRIC_CLASSES.has(className)) {
        return {
          original: ref,
          targetNodeId: ref.fromNodeId,
          confidence: 1.0,
          provenance: 'fabric-qualified',
        };
      }
    }

    return null;
  },

  extract(filePath: string, content: string): IFrameworkExtractionResult {
    const allNodes: INode[] = [];
    const allRefs: IUnresolvedReference[] = [];

    if (content.includes('.on(')) {
      const result = extractCanvasEvents(filePath, content);
      allNodes.push(...result.nodes);
      allRefs.push(...result.references);
    }

    return { nodes: allNodes, references: allRefs };
  },
};

registerFrameworkResolver(fabricResolver);
