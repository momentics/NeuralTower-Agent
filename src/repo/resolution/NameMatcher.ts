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
import { SUPERTYPE_BEARING_KINDS, CHAIN_LANGUAGES, SCOPED_CHAIN_LANGUAGES, CHAIN_SHAPE, AMBIGUOUS_NAME_CEILING } from './Constants';

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
  if (lang1 === lang2) return true;
  const family1 = LANGUAGE_FAMILIES.get(lang1.toLowerCase()) ?? lang1;
  const family2 = LANGUAGE_FAMILIES.get(lang2.toLowerCase()) ?? lang2;
  return family1 === family2;
}

/**
 * Проверяет, принадлежит ли язык к известному многоязыковому семейству.
 * Неизвестные языки и форматы конфигурации образуют одиночные семейства.
 */
export function isKnownLanguageFamily(lang: string): boolean {
  return LANGUAGE_FAMILIES.has(lang.toLowerCase());
}

/**
 * True, когда a и b — два РАЗНЫХ известных семейства.
 * Фильтр слабее, чем отрицание sameLanguageFamily: vue/svelte (собственный тег)
 * импортируют .ts — это не cross-family. Python, PHP, Go — одиночные семейства,
 * тоже не cross-family (их refs не пересекаются с другими языками).
 */
export function crossesKnownFamily(lang1: string, lang2: string): boolean {
  return isKnownLanguageFamily(lang1.toLowerCase()) && isKnownLanguageFamily(lang2.toLowerCase()) && !sameLanguageFamily(lang1, lang2);
}

/**
 * Убирает кросс-языковые кандидаты из списка результатов поиска.
 * references/function_ref — строгий фильтр (только то же семейство).
 * imports — слабый фильтр (не пересечение двух известных семейств).
 */
function applyLanguageGate(candidates: INode[], ref: IUnresolvedReference): INode[] {
  if (ref.referenceKind === 'references' || ref.referenceKind === 'function_ref') {
    return candidates.filter((c) => sameLanguageFamily(c.language, ref.language ?? ''));
  }
  if (ref.referenceKind === 'imports') {
    return candidates.filter((c) => !crossesKnownFamily(c.language, ref.language ?? ''));
  }
  return candidates;
}

// =============================================================================
// matchByFilePath
// =============================================================================

/**
 * Разрешение по пути файла (#include "X.h", #include "snippets/drawer-menu.liquid").
 *
 * Проверяет, выглядит ли ссылка как путь к файлу, ищет file-узлы с совпадающим
 * именем. Предпочитает точное совпадение пути, затем суффиксное совпадение,
 * затем единственный файл с пониженной уверенностью.
 */
export function matchByFilePath(
  ref: IUnresolvedReference,
  context: IResolutionContext
): IResolvedRef | null {
  const name = ref.referenceName;

  // Путь (содержит /) или имя файла с коротким расширением (.h, .ts, .go и т.д.)
  if (!name.includes('/') && !/\.[A-Za-z][A-Za-z0-9]{0,3}$/.test(name)) {
    return null;
  }

  // Извлекаем имя файла из пути
  const fileName = name.split('/').pop();
  if (!fileName) return null;

  // Ищем file-узлы с таким именем
  const allNodes = context.getNodesByName(fileName);
  const fileNodes = allNodes.filter((n) => n.kind === 'file');

  if (fileNodes.length === 0) return null;

  // Точное совпадение пути по qualified_name или filePath
  const exactMatch = fileNodes.find(
    (n) => n.qualifiedName === name || n.filePath === name
  );
  if (exactMatch) {
    return {
      original: ref,
      targetNodeId: exactMatch.id,
      confidence: 0.95,
      provenance: 'file-path',
    };
  }

  // Суффиксное совпадение (ref="snippets/foo.liquid" → "src/snippets/foo.liquid")
  const suffixMatches = fileNodes.filter(
    (n) => n.qualifiedName.endsWith(name) || n.filePath.endsWith(name)
  );
  if (suffixMatches.length > 0) {
    return {
      original: ref,
      targetNodeId: pickClosestFileNode(suffixMatches, ref).id,
      confidence: 0.85,
      provenance: 'file-path',
    };
  }

  // Если только один file-узел — используем с пониженной уверенностью
  if (fileNodes.length === 1) {
    return {
      original: ref,
      targetNodeId: fileNodes[0]!.id,
      confidence: 0.7,
      provenance: 'file-path',
    };
  }

  return null;
}

/**
 * Выбор ближайшего file-узла среди кандидатов, совпадающих по имени файла.
 *
 * Приоритет: та же директория → наибольшая близость путей → то же языковое семейство.
 */
function pickClosestFileNode(candidates: INode[], ref: IUnresolvedReference): INode {
  const dirOf = (p: string): string => {
    const i = p.lastIndexOf('/');
    return i >= 0 ? p.slice(0, i) : '';
  };

  const refDir = ref.filePath ? dirOf(ref.filePath) : '';
  const sameDir = candidates.filter((c) => dirOf(c.filePath) === refDir);
  const pool = sameDir.length > 0 ? sameDir : candidates;

  let best: INode | null = null;
  let bestScore = -Infinity;

  for (const c of pool) {
    const score =
      computePathProximity(ref.filePath ?? '', c.filePath) +
      (ref.language && sameLanguageFamily(c.language, ref.language) ? 5 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }

  return best!;
}

/**
 * Вычисляет близость двух путей: общее количество общих сегментов пути.
 * Больше значение — пути ближе друг к другу в файловой системе.
 */
function computePathProximity(pathA: string, pathB: string): number {
  const partsA = pathA.split('/').filter(Boolean);
  const partsB = pathB.split('/').filter(Boolean);

  let common = 0;
  const len = Math.min(partsA.length, partsB.length);
  for (let i = 0; i < len; i++) {
    if (partsA[i] === partsB[i]) {
      common++;
    } else {
      break;
    }
  }

  // Нормализуем: 0–100, где 100 — один и тот же файл
  const maxLen = Math.max(partsA.length, partsB.length);
  if (maxLen === 0) return 100;

  return Math.round((common / maxLen) * 100);
}

// =============================================================================
// matchReference
// =============================================================================

/**
 * Сопоставление ссылки по имени символа.
 *
 * Ищет узлы с совпадающим именем. Исключает import-узлы, применяет
 * языковую фильтрацию, проверку лексической достижимости и порог неоднозначности.
 */
export function matchReference(
  ref: IUnresolvedReference,
  context: IResolutionContext
): IResolvedRef | null {
  const name = ref.referenceName;

  // Точное совпадение по имени
  const candidates = applyLanguageGate(context.getNodesByName(name), ref)
    .filter((n) => n.kind !== 'import')
    .filter((n) => isLexicallyReachable(n, ref, context));

  if (candidates.length === 0) {
    return null;
  }

  // Один кандидат — используем его
  if (candidates.length === 1) {
    const isCrossLanguage = candidates[0]!.language !== ref.language;
    return {
      original: ref,
      targetNodeId: candidates[0]!.id,
      confidence: isCrossLanguage ? 0.5 : 0.9,
      provenance: 'exact-match',
    };
  }

  // Порог неоднозначности: при превышении отказываемся от fuzzy
  if (candidates.length > AMBIGUOUS_NAME_CEILING) {
    return null;
  }

  // Несколько кандидатов — предпочитаем файл вызова
  const ordered = ref.filePath ? preferCallSiteFile(candidates, ref.filePath) : candidates;
  const best = ordered[0]!;
  const proximity = ref.filePath ? computePathProximity(ref.filePath, best.filePath) : 100;
  const confidence = proximity >= 30 ? 0.7 : 0.4;
  return {
    original: ref,
    targetNodeId: best.id,
    confidence,
    provenance: 'exact-match',
  };
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
// matchCppCallChain
// =============================================================================

/** Форма цепного вызова C++: TypeName::method().method2() */
const CPP_CHAIN_SHAPE = /^([A-Za-z_]\w*)::(\w+)\(\)(?:\.(\w+))?$/;

/**
 * Сопоставление цепных вызовов C++: TypeName::method().method2().
 *
 * Разрешает цепочки вида Widget::instance().render():
 * 1. Ищет метод method на типе TypeName (через resolveMethodOnType).
 * 2. Если есть method2 — пытается найти его на типе результата первого метода.
 */
export function matchCppCallChain(
  ref: IUnresolvedReference,
  context: IResolutionContext
): IResolvedRef | null {
  const lang = ref.language ?? '';
  if (lang !== 'cpp' && lang !== 'c') {
    return null;
  }

  const match = ref.referenceName.match(CPP_CHAIN_SHAPE);
  if (!match) {
    return null;
  }

  const [, typeName, firstMethod, secondMethod] = match;

  // Разрешаем первый метод на типе
  const first = resolveMethodOnType(
    typeName,
    firstMethod,
    ref,
    context,
    0.7,
    'cpp-call-chain'
  );
  if (!first) {
    return null;
  }

  // Если есть второй метод — ищем его на типе результата
  if (secondMethod) {
    const firstNode = context.getNodeById(first.targetNodeId);
    if (firstNode?.returnType) {
      const returnTypeName = normalizeInferredTypeName(firstNode.returnType);
      if (returnTypeName) {
        const second = resolveMethodOnType(
          returnTypeName,
          secondMethod,
          ref,
          context,
          0.5,
          'cpp-call-chain'
        );
        if (second) {
          return second;
        }
      }
    }
  }

  return first;
}

// =============================================================================
// inferLocalReceiverType
// =============================================================================

/** Токены, которые никогда не являются типами. */
const NON_TYPE_RECEIVER_TOKENS = new Set([
  'this', 'self', 'super', 'new', 'return', 'await', 'yield', 'typeof',
  'null', 'nil', 'None', 'true', 'false', 'True', 'False', 'undefined',
]);

/**
 * Нормализует выражение типа к простому имени: убирает дженерики,
 * указатели/ссылки, берёт последний квалифицированный сегмент.
 */
export function normalizeInferredTypeName(raw: string): string | null {
  const cleaned = raw.replace(/<[^>]*>/g, '').replace(/[&*]/g, '').trim();
  const seg = cleaned.split(/[.:]+/).filter(Boolean).pop();
  if (!seg) return null;
  if (NON_TYPE_RECEIVER_TOKENS.has(seg)) return null;
  return seg;
}

/**
 * Инференс типа получателя из локальных переменных.
 *
 * Для вызовов вида `receiver.method()` пытается определить тип получателя
 * из объявления переменной в том же файле. Работает для Java, Kotlin,
 * C#, Swift, Go, Python, Rust, PHP, Ruby, Scala, Dart, TypeScript.
 */
export function inferLocalReceiverType(
  receiverName: string,
  ref: IUnresolvedReference,
  context: IResolutionContext
): string | null {
  const lang = ref.language;
  if (!lang) return null;

  if (!ref.filePath) return null;
  const lines = context.getFileLines?.(ref.filePath) ?? null;
  if (!lines || lines.length === 0) return null;

  const escaped = receiverName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = buildLocalReceiverTypePatterns(lang, escaped);
  if (patterns.length === 0) return null;

  // Сканируем вверх от строки вызова
  const callLineIndex = Math.max(0, ref.line - 2);
  for (let i = callLineIndex; i >= 0; i--) {
    const line = lines[i];
    if (!line) continue;

    for (const pattern of patterns) {
      const m = line.match(pattern);
      if (m && m[1]) {
        return normalizeInferredTypeName(m[1]!);
      }
    }
  }

  return null;
}

/**
 * Создаёт паттерны для инференса типа получателя по языку.
 * Каждый паттерн захватывает тип в группе 1.
 */
function buildLocalReceiverTypePatterns(language: string, r: string): RegExp[] {
  switch (language) {
    case 'typescript':
    case 'javascript':
    case 'tsx':
    case 'jsx':
      return [
        new RegExp(`\\b${r}\\b\\s*=\\s*new\\s+([A-Za-z_$][\\w.$]*)`),
        new RegExp(`\\b${r}\\b\\s*:\\s*([A-Z][\\w.$]*)`),
      ];
    case 'python':
      return [
        new RegExp(`\\b${r}\\b\\s*=\\s*([A-Z][\\w.]*)\\s*\\(`),
        new RegExp(`\\b${r}\\b\\s*:\\s*([A-Z][\\w.]*)`),
      ];
    case 'java':
      return [
        new RegExp(`\\b${r}\\b\\s*=\\s*new\\s+([A-Za-z_][\\w.]*)`),
        new RegExp(`\\b([A-Z][\\w.]*)\\s+${r}\\b\\s*[=;,)]`),
      ];
    case 'kotlin':
      return [
        new RegExp(`\\b${r}\\b\\s*=\\s*([A-Z][\\w.]*)\\s*\\(`),
        new RegExp(`\\b${r}\\b\\s*:\\s*([A-Z][\\w.]*)`),
      ];
    case 'csharp':
      return [
        new RegExp(`\\b${r}\\b\\s*=\\s*new\\s+([A-Za-z_][\\w.]*)`),
        new RegExp(`\\b([A-Z][\\w.]*)\\s+${r}\\b\\s*[=;,)]`),
      ];
    case 'swift':
      return [
        new RegExp(`\\b${r}\\b\\s*=\\s*([A-Z][\\w.]*)\\s*\\(`),
        new RegExp(`\\b${r}\\b\\s*:\\s*([A-Z][\\w.]*)`),
      ];
    case 'rust':
      return [
        new RegExp(`\\blet\\s+(?:mut\\s+)?${r}\\b(?:\\s*:[^=]+)?=\\s*&?(?:mut\\s+)?([A-Z][\\w]*)`),
        new RegExp(`\\b${r}\\s*:\\s*&?(?:mut\\s+)?([A-Z][\\w]*)`),
      ];
    case 'go':
      return [
        new RegExp(`\\b${r}\\b\\s*:=\\s*&?([A-Za-z_][\\w.]*)\\s*{`),
        new RegExp(`\\bvar\\s+${r}\\s+\\*?([A-Za-z_][\\w.]*)`),
        new RegExp(`\\b${r}\\s+\\*?([A-Z][\\w.]*)`),
      ];
    case 'ruby':
      return [
        new RegExp(`\\b${r}\\b\\s*=\\s*([A-Z][\\w:]*)\\.new\\b`),
      ];
    case 'scala':
      return [
        new RegExp(`\\b${r}\\b\\s*=\\s*(?:new\\s+)?([A-Z][\\w.]*)`),
        new RegExp(`\\b${r}\\b\\s*:\\s*([A-Z][\\w.]*)`),
      ];
    case 'dart':
      return [
        new RegExp(`\\b${r}\\b\\s*=\\s*([A-Z][\\w.]*)\\s*\\(`),
        new RegExp(`\\b([A-Z][\\w.]*)\\s+${r}\\b\\s*[=;,)]`),
      ];
    case 'php':
      return [
        new RegExp(`\\$?${r}\\b\\s*=\\s*new\\s+([A-Za-z_\\\\][\\w\\\\]*)`),
        new RegExp(`\\b([A-Za-z_\\\\][\\w\\\\]*)\\s+&?\\$${r}\\b`),
      ];
    default:
      return [];
  }
}

// =============================================================================
// matchByQualifiedName
// =============================================================================

/**
 * Разрешение по квалифицированному имени: Foo::bar или Foo.bar.
 *
 * Фильтрует config-константы для calls-ссылок, применяет
 * preferCallSiteFile для устранения неоднозначности.
 */
export function matchByQualifiedName(
  ref: IUnresolvedReference,
  context: IResolutionContext
): IResolvedRef | null {
  if (!ref.referenceName.includes('::') && !ref.referenceName.includes('.')) {
    return null;
  }

  // Фильтруем config-константы для calls — service.process() не должен
  // разрешаться в yaml-ключ service.process
  const keepForRef = (nodes: INode[]): INode[] =>
    ref.referenceKind === 'calls'
      ? nodes.filter((n) => !(n.kind === 'constant' && (n.language === 'yaml' || n.language === 'properties')))
      : nodes;

  const candidates = keepForRef(context.getNodesByQualifiedName(ref.referenceName));

  if (candidates.length === 1) {
    return {
      original: ref,
      targetNodeId: candidates[0]!.id,
      confidence: 0.95,
      provenance: 'qualified-name',
    };
  }

  // Несколько символов с одинаковым qualifiedName — предпочитаем файл вызова
  if (candidates.length > 1 && ref.filePath) {
    const ordered = preferCallSiteFile(candidates, ref.filePath);
    if (ordered[0]!.filePath === ref.filePath) {
      return {
        original: ref,
        targetNodeId: ordered[0]!.id,
        confidence: 0.95,
        provenance: 'qualified-name',
      };
    }
  }

  // Частичное совпадение по qualifiedName
  const parts = ref.referenceName.split(/[:.]/);
  const lastName = parts[parts.length - 1];
  if (lastName) {
    const partialCandidates = keepForRef(context.getNodesByName(lastName))
      .filter((candidate) => candidate.qualifiedName.endsWith(ref.referenceName));
    const chosen = ref.filePath ? preferCallSiteFile(partialCandidates, ref.filePath)[0] : partialCandidates[0];
    if (chosen) {
      return {
        original: ref,
        targetNodeId: chosen.id,
        confidence: 0.85,
        provenance: 'qualified-name',
      };
    }
  }

  return null;
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
 * Проверяет лексическую достижимость кандидата из источника ссылки.
 *
 * Вложенная функция достижима только если источник находится внутри
 * контейнера, который её содержит. Если источник вне контейнера,
 * вложенная функция не в области видимости.
 */
export function isLexicallyReachable(
  candidate: INode,
  ref: IUnresolvedReference,
  context: IResolutionContext
): boolean {
  // Только функции могут быть вложенными
  if (candidate.kind !== 'function') return true;

  const sourceNode = context.getNodeById(ref.fromNodeId);
  if (!sourceNode) return true;

  // Ищем контейнер — ближайший родитель-функцию или метод
  const candidateAncestors = context.getAncestors(candidate.id);
  const container = candidateAncestors.find(
    (a) => a.kind === 'function' || a.kind === 'method'
  );

  // Нет контейнера — функция на верхнем уровне, всегда достижима
  if (!container) return true;

  // Источник должен быть внутри контейнера
  const sourceAncestors = context.getAncestors(sourceNode.id);

  // Источник = сам контейнер
  if (sourceNode.id === container.id) return true;

  // Источник внутри контейнера
  return sourceAncestors.some((a) => a.id === container.id);
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

/**
 * Сортировка узлов: сначала узлы из файла вызова, затем остальные.
 *
 * При неоднозначных совпадениях (несколько одинаковых qualifiedName)
 * предпочтение отдаётся определению в файле вызова — без этого
 * вызов в b/svc.cpp ошибочно указывает на a/svc.cpp.
 */
export function preferCallSiteFile(nodes: INode[], callSiteFile: string): INode[] {
  if (nodes.length < 2) return nodes;
  const same: INode[] = [];
  const other: INode[] = [];
  for (const n of nodes) {
    if (n.filePath === callSiteFile) {
      same.push(n);
    } else {
      other.push(n);
    }
  }
  return same.length ? [...same, ...other] : nodes;
}

/**
 * Разрешение метода по типу с supertype walk.
 *
 * Ищет узлы-методы по имени и фильтрует по qualifiedName,
 * заканчивающемуся на `<typeName>::<methodName>`. Работает как
 * для in-class определений (`class Foo { int bar() {} }`), так и
 * для out-of-line (`int Foo::bar() {}` в foo.cpp при class Foo в foo.hpp).
 * При отсутствии совпадений выполняется обход supertype (BFS, глубина до 4).
 *
 * @param typeName — имя типа, на котором ищем метод.
 * @param methodName — имя метода.
 * @param ref — неразрешённая ссылка.
 * @param context — контекст разрешения.
 * @param confidence — уверенность разрешения.
 * @param resolvedBy — источник разрешения.
 * @param preferredFqn — опциональный FQN для устранения неоднозначности (Java/Kotlin).
 * @param depth — глубина рекурсии для supertype walk.
 */
export function resolveMethodOnType(
  typeName: string,
  methodName: string,
  ref: IUnresolvedReference,
  context: IResolutionContext,
  confidence: number,
  resolvedBy: string,
  preferredFqn?: string,
  depth: number = 0
): IResolvedRef | null {
  const lang = ref.language;
  const filePath = ref.filePath;

  // Ищем методы по имени и фильтруем по qualifiedName
  const methodCandidates = context.getNodesByName(methodName);
  const want = `${typeName}::${methodName}`;
  const matches: INode[] = [];
  for (const m of methodCandidates) {
    if (m.kind !== 'method') continue;
    if (lang && m.language !== lang) continue;
    const qn = m.qualifiedName;
    if (qn === want || qn.endsWith(`::${want}`)) {
      matches.push(m);
    }
  }

  if (matches.length === 0) {
    // Фолбэк: метод может быть определён на supertype
    if (depth < 4 && context.getSupertypesByName && lang) {
      for (const supertype of context.getSupertypesByName(typeName, lang)) {
        const via = resolveMethodOnType(
          supertype,
          methodName,
          ref,
          context,
          confidence,
          resolvedBy,
          preferredFqn,
          depth + 1
        );
        if (via) return via;
      }
    }
    return null;
  }

  // Устранение неоднозначности через preferredFqn (Java/Kotlin)
  if (matches.length > 1 && preferredFqn && lang) {
    const ext = lang === 'kotlin' ? '.kt' : '.java';
    const fqnPath = preferredFqn.replace(/\./g, '/') + ext;
    const chosen = matches.find((m) => {
      const fp = m.filePath.replace(/\\/g, '/');
      return fp.endsWith(fqnPath) || fp.endsWith('/' + fqnPath);
    });
    if (chosen) {
      return {
        original: ref,
        targetNodeId: chosen.id,
        confidence,
        provenance: resolvedBy,
      };
    }
  }

  // Языково-независимое устранение неоднозначности: предпочитаем файл вызова
  const ordered = filePath ? preferCallSiteFile(matches, filePath) : matches;
  return {
    original: ref,
    targetNodeId: ordered[0]!.id,
    confidence,
    provenance: resolvedBy,
  };
}
