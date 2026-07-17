/**
 * Сопоставление ссылок по имени.
 *
 * matchReference, matchFunctionRef, matchDottedCallChain,
 * matchScopedCallChain, sameLanguageFamily, crossesKnownFamily.
 */

import type {
  IUnresolvedReference,
  IResolvedRef,
  IResolutionContext,
  NodeKind,
  Language,
  INode,
} from '../ntgraph/Types';
import { SUPERTYPE_BEARING_KINDS, CHAIN_LANGUAGES, SCOPED_CHAIN_LANGUAGES, CHAIN_SHAPE } from './Constants';

// =============================================================================
// Языковые семейства
// =============================================================================

/** Семейства языков для cross-family фильтрации. */
const LANGUAGE_FAMILIES: ReadonlyMap<string, string> = new Map([
  ['typescript', 'javascript'],
  ['javascript', 'javascript'],
  ['tsx', 'javascript'],
  ['jsx', 'javascript'],
  ['python', 'python'],
  ['go', 'go'],
  ['rust', 'rust'],
  ['java', 'jvm'],
  ['kotlin', 'jvm'],
  ['scala', 'jvm'],
  ['c', 'c'],
  ['cpp', 'c'],
  ['csharp', 'dotnet'],
  ['razor', 'dotnet'],
  ['php', 'php'],
  ['ruby', 'ruby'],
  ['swift', 'swift'],
  ['dart', 'dart'],
  ['svelte', 'javascript'],
  ['vue', 'javascript'],
  ['astro', 'javascript'],
  ['pascal', 'pascal'],
  ['lua', 'lua'],
  ['luau', 'lua'],
  ['objc', 'c'],
]);

/**
 * Сравнивает языковые семейства.
 * TypeScript и JavaScript — одно семейство, Python и Go — разные.
 */
export function sameLanguageFamily(lang1: string, lang2: string): boolean {
  const family1 = LANGUAGE_FAMILIES.get(lang1.toLowerCase()) ?? lang1;
  const family2 = LANGUAGE_FAMILIES.get(lang2.toLowerCase()) ?? lang2;
  return family1 === family2;
}

/**
 * Обнаружение cross-family ссылок: возвращает true, если языки из разных семейств.
 */
export function crossesKnownFamily(lang1: string, lang2: string): boolean {
  return !sameLanguageFamily(lang1, lang2);
}

// =============================================================================
// matchReference
// =============================================================================

/**
 * Сопоставление ссылки по имени символа.
 *
 * Ищет узлы с совпадающим именем. Применяет языковую фильтрацию.
 */
export function matchReference(
  ref: IUnresolvedReference,
  context: IResolutionContext
): IResolvedRef | null {
  const name = ref.referenceName;

  // Точное совпадение по имени
  const exactMatches = context.getNodesByName(name);
  if (exactMatches.length > 0) {
    for (const node of exactMatches) {
      // Языковая фильтрация
      if (ref.language && crossesKnownFamily(ref.language, node.language)) {
        continue;
      }
      return {
        original: ref,
        targetNodeId: node.id,
        confidence: 0.9,
        provenance: 'name-match',
      };
    }
  }

  // Совпадение в нижнем регистре
  const lowerMatches = context.getNodesByLowerName(name.toLowerCase());
  if (lowerMatches.length > 0) {
    for (const node of lowerMatches) {
      if (ref.language && crossesKnownFamily(ref.language, node.language)) {
        continue;
      }
      return {
        original: ref,
        targetNodeId: node.id,
        confidence: 0.7,
        provenance: 'lower-name-match',
      };
    }
  }

  return null;
}

// =============================================================================
// matchFunctionRef
// =============================================================================

/**
 * Сопоставление функциональных ссылок — для callback-регистраций.
 *
 * Например, `onClick={handleClick}` — функция как значение.
 */
export function matchFunctionRef(
  ref: IUnresolvedReference,
  context: IResolutionContext
): IResolvedRef | null {
  if (ref.referenceKind !== 'function_ref') {
    return null;
  }

  const name = ref.referenceName;
  const exactMatches = context.getNodesByName(name);

  for (const node of exactMatches) {
    if (node.kind !== 'function' && node.kind !== 'method' && node.kind !== 'variable') {
      continue;
    }
    if (ref.language && crossesKnownFamily(ref.language, node.language)) {
      continue;
    }
    return {
      original: ref,
      targetNodeId: node.id,
      confidence: 0.8,
      provenance: 'function-ref',
    };
  }

  return null;
}

// =============================================================================
// matchDottedCallChain
// =============================================================================

/**
 * Сопоставление цепных вызовов через `.`: Foo().bar() → поиск Foo, затем bar на типе результата.
 */
export function matchDottedCallChain(
  ref: IUnresolvedReference,
  context: IResolutionContext
): IResolvedRef | null {
  if (!CHAIN_LANGUAGES.has(ref.language ?? '')) {
    return null;
  }

  const match = ref.referenceName.match(CHAIN_SHAPE);
  if (!match) {
    return null;
  }

  const [, factoryName, methodName] = match;

  // Находим фабричный тип
  const factoryNodes = context.getNodesByName(factoryName);
  if (factoryNodes.length === 0) {
    return null;
  }

  const factoryNode = factoryNodes.find(
    (n) => SUPERTYPE_BEARING_KINDS.has(n.kind)
  );
  if (!factoryNode) {
    return null;
  }

  // Ищем метод на супертипах фабрики
  const methodNode = findMethodOnSupertypes(factoryNode, methodName, context);
  if (!methodNode) {
    return null;
  }

  return {
    original: ref,
    targetNodeId: methodNode.id,
    confidence: 0.6,
    provenance: 'dotted-call-chain',
  };
}

// =============================================================================
// matchScopedCallChain
// =============================================================================

/**
 * Сопоставление цепных вызовов через `::` (Rust): Foo::bar() → поиск Foo::bar.
 */
export function matchScopedCallChain(
  ref: IUnresolvedReference,
  context: IResolutionContext
): IResolvedRef | null {
  if (!SCOPED_CHAIN_LANGUAGES.has(ref.language ?? '')) {
    return null;
  }

  const scopedMatch = ref.referenceName.match(/^(.+)::(\w+)$/);
  if (!scopedMatch) {
    return null;
  }

  const [, typeName, methodName] = scopedMatch;

  // Ищем метод по qualifiedName
  const qualifiedName = `${typeName}::${methodName}`;
  const exactMatches = context.getNodesByQualifiedName(qualifiedName);
  if (exactMatches.length > 0) {
    return {
      original: ref,
      targetNodeId: exactMatches[0]!.id,
      confidence: 0.85,
      provenance: 'scoped-call-chain',
    };
  }

  // Ищем метод в типе
  const typeNodes = context.getNodesByName(typeName);
  for (const typeNode of typeNodes) {
    if (!SUPERTYPE_BEARING_KINDS.has(typeNode.kind)) continue;

    const methodNode = findMethodOnType(typeNode, methodName, context);
    if (methodNode) {
      return {
        original: ref,
        targetNodeId: methodNode.id,
        confidence: 0.7,
        provenance: 'scoped-call-chain',
      };
    }
  }

  return null;
}

// =============================================================================
// Вспомогательные функции
// =============================================================================

/**
 * Поиск метода на супертипах узла через BFS.
 */
function findMethodOnSupertypes(
  typeNode: INode,
  methodName: string,
  context: IResolutionContext
): INode | null {
  const visited = new Set<string>();
  const queue = [typeNode.id];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    // Проверяем текущий тип
    const methodNode = findMethodOnType(context.getNodeById(currentId)!, methodName, context);
    if (methodNode) return methodNode;

    // Добавляем супертипы в очередь
    const supertypes = context.getSupertypes(currentId);
    for (const st of supertypes) {
      if (!visited.has(st.id)) {
        queue.push(st.id);
      }
    }
  }

  return null;
}

/**
 * Поиск метода на конкретном типе.
 */
function findMethodOnType(
  typeNode: INode,
  methodName: string,
  context: IResolutionContext
): INode | null {
  if (!typeNode) return null;

  const children = context.getChildren(typeNode.id);
  for (const child of children) {
    if (child.kind === 'method' && child.name === methodName) {
      return child;
    }
  }

  return null;
}
