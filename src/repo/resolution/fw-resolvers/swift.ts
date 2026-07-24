/**
 * Фреймворк-резолвер для Swift (SwiftUI, UIKit).
 *
 * Обрабатывает NavigationLink, @IBAction, @State/@Binding привязки
 * и UIStoryboardSegue.
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
const LANGUAGES: Language[] = ['swift'];

/** Встроенные SwiftUI-представления. */
const SWIFTUI_VIEWS = new Set([
  'View', 'Text', 'Image', 'Button', 'NavigationLink', 'List', 'Form',
  'TextField', 'SecureField', 'Toggle', 'Picker', 'ScrollView',
  'VStack', 'HStack', 'ZStack', 'Stack',
  'NavigationStack', 'NavigationSplitView', 'TabView', 'TabItem',
  'Sheet', 'Alert', 'Menu', 'ContextMenu', 'Popover',
  'Divider', 'Spacer', 'ProgressView', 'ProgressBar',
]);

/** Обнаружение SwiftUI/UIKit проекта. */
function detectSwift(context: IResolutionContext): boolean {
  const files = context.getAllFiles();

  // Проверяем наличие .swift файлов с импортами SwiftUI или UIKit
  const swiftFiles = files.filter((f) => f.endsWith('.swift'));
  for (const f of swiftFiles) {
    const content = context.getFileContent?.(f);
    if (content && (content.includes('import SwiftUI') || content.includes('import UIKit'))) {
      return true;
    }
  }

  return false;
}

/** Извлечение NavigationLink как route-узлов. */
function extractNavigationLinks(filePath: string, content: string): IFrameworkExtractionResult {
  const nodes: INode[] = [];
  const references: IUnresolvedReference[] = [];

  // NavigationLink(destination: DetailView()) — навигация SwiftUI
  const navRe = /NavigationLink\s*\(destination:\s*([A-Z][A-Za-z0-9_]*)/g;
  let m: RegExpExecArray | null;
  while ((m = navRe.exec(content))) {
    const destName = m[1];
    const lineNum = content.substring(0, m.index).split('\n').length;

    const linkNode: INode = {
      id: crypto.createHash('sha256').update(`navlink:${filePath}:${destName}`).digest('hex'),
      kind: NodeKind.Route,
      name: destName,
      qualifiedName: `${filePath}#navlink:${destName}`,
      filePath,
      language: 'swift',
      startLine: lineNum,
      endLine: lineNum,
      startColumn: 0,
      endColumn: m[0].length,
      updatedAt: Date.now(),
    };
    nodes.push(linkNode);

    references.push({
      fromNodeId: linkNode.id,
      referenceName: destName,
      referenceKind: 'references',
      line: lineNum,
      column: 0,
      filePath,
      language: 'swift',
    });
  }

  // NavigationLink("Label", value: ...) — навигация SwiftUI
  const navValueRe = /NavigationLink\s*\(.*value:\s*([A-Z][A-Za-z0-9_]*)/g;
  while ((m = navValueRe.exec(content))) {
    const valueName = m[1];
    const lineNum = content.substring(0, m.index).split('\n').length;

    const linkNode: INode = {
      id: crypto.createHash('sha256').update(`navlink:${filePath}:${valueName}`).digest('hex'),
      kind: NodeKind.Route,
      name: valueName,
      qualifiedName: `${filePath}#navlink:${valueName}`,
      filePath,
      language: 'swift',
      startLine: lineNum,
      endLine: lineNum,
      startColumn: 0,
      endColumn: m[0].length,
      updatedAt: Date.now(),
    };
    nodes.push(linkNode);

    references.push({
      fromNodeId: linkNode.id,
      referenceName: valueName,
      referenceKind: 'references',
      line: lineNum,
      column: 0,
      filePath,
      language: 'swift',
    });
  }

  return { nodes, references };
}

/** Извлечение @IBAction методов. */
function extractIBActions(filePath: string, content: string): IFrameworkExtractionResult {
  const nodes: INode[] = [];
  const references: IUnresolvedReference[] = [];

  // @IBAction func buttonTapped(_ sender: UIButton) — действия интерфейса
  const actionRe = /@IBAction\s+func\s+(\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = actionRe.exec(content))) {
    const actionName = m[1];
    const lineNum = content.substring(0, m.index).split('\n').length;

    nodes.push({
      id: crypto.createHash('sha256').update(`ibaction:${filePath}:${actionName}`).digest('hex'),
      kind: NodeKind.Method,
      name: actionName,
      qualifiedName: `${filePath}#${actionName}`,
      filePath,
      language: 'swift',
      startLine: lineNum,
      endLine: lineNum,
      startColumn: 0,
      endColumn: m[0].length,
      updatedAt: Date.now(),
    });
  }

  return { nodes, references };
}

/** Извлечение UIStoryboardSegue. */
function extractSegues(filePath: string, content: string): IFrameworkExtractionResult {
  const nodes: INode[] = [];
  const references: IUnresolvedReference[] = [];

  // prepare(for segue: UIStoryboardSegue) — UIStoryboardSegue
  const segueRe = /prepare\s*\(for\s+segue:\s*UIStoryboardSegue\)/g;
  let m: RegExpExecArray | null;
  while ((m = segueRe.exec(content))) {
    const lineNum = content.substring(0, m.index).split('\n').length;

    nodes.push({
      id: crypto.createHash('sha256').update(`segue:${filePath}:${lineNum}`).digest('hex'),
      kind: NodeKind.Component,
      name: 'prepareForSegue',
      qualifiedName: `${filePath}#segue:${lineNum}`,
      filePath,
      language: 'swift',
      startLine: lineNum,
      endLine: lineNum,
      startColumn: 0,
      endColumn: m[0].length,
      updatedAt: Date.now(),
    });
  }

  return { nodes, references };
}

/** Резолвер SwiftUI/UIKit. */
const swiftResolver: IFrameworkResolver = {
  name: 'SwiftUI',
  languages: LANGUAGES,

  detect: detectSwift,

  claimsReference(name: string): boolean {
    // @IBAction и NavigationLink
    return name.startsWith('@IBAction') || name.startsWith('NavigationLink');
  },

  resolve(ref: IUnresolvedReference, context: IResolutionContext): IResolvedRef | null {
    const name = ref.referenceName;

    // Встроенные SwiftUI-представления
    if (SWIFTUI_VIEWS.has(name)) {
      return {
        original: ref,
        targetNodeId: ref.fromNodeId,
        confidence: 1.0,
        provenance: 'swiftui-view',
      };
    }

    // SwiftUI View-структуры (PascalCase) — компоненты интерфейса
    if (/^[A-Z][A-Za-z0-9_]*$/.test(name)) {
      const nodes = context.getNodesByName(name).filter(
        (n) => n.kind === 'struct' || n.kind === 'class'
      );
      if (nodes.length === 1) {
        return {
          original: ref,
          targetNodeId: nodes[0]!.id,
          confidence: 0.85,
          provenance: 'swiftui-component',
        };
      }
    }

    // @State, @Binding, @ObservedObject привязки
    if (name.startsWith('$')) {
      const propName = name.slice(1);
      const nodes = context.getNodesByName(propName).filter(
        (n) => n.kind === 'property' || n.kind === 'variable'
      );
      if (nodes.length === 1) {
        return {
          original: ref,
          targetNodeId: nodes[0]!.id,
          confidence: 0.9,
          provenance: 'swiftui-binding',
        };
      }
    }

    return null;
  },

  extract(filePath: string, content: string): IFrameworkExtractionResult {
    const allNodes: INode[] = [];
    const allRefs: IUnresolvedReference[] = [];

    // NavigationLink — навигация SwiftUI
    if (content.includes('NavigationLink')) {
      const result = extractNavigationLinks(filePath, content);
      allNodes.push(...result.nodes);
      allRefs.push(...result.references);
    }

    // @IBAction
    if (content.includes('@IBAction')) {
      const result = extractIBActions(filePath, content);
      allNodes.push(...result.nodes);
      allRefs.push(...result.references);
    }

    // UIStoryboardSegue
    if (content.includes('UIStoryboardSegue')) {
      const result = extractSegues(filePath, content);
      allNodes.push(...result.nodes);
      allRefs.push(...result.references);
    }

    return { nodes: allNodes, references: allRefs };
  },
};

registerFrameworkResolver(swiftResolver);
