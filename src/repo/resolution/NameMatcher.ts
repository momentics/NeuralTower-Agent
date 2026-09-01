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
import { findBestMatch, computePathProximity, splitCamelCase } from '../ntgraph/Utils';

// =============================================================================
// Языковые семейства
// =============================================================================

/** Семейства языков для cross-family фильтрации. */
const LANGUAGE_FAMILIES: ReadonlyMap<string, string> = new Map([
  ['typescript', 'web'],
  ['javascript', 'web'],
  ['tsx', 'web'],
  ['jsx', 'web'],
  ['arkts', 'web'],
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
  ['swift', 'apple'],
  ['objc', 'apple'],
  ['dart', 'dart'],
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

// =============================================================================
// matchByExactName
// =============================================================================

/**
 * Точное сопоставление ссылки по имени символа.
 *
 * Ищет узлы с совпадающим именем. Исключает import-узлы, применяет
 * языковую фильтрацию, проверку лексической достижимости и порог неоднозначности.
 */
export function matchByExactName(
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

  // Несколько кандидатов — используем scoring
  const bestMatch = findBestMatch(ref, candidates, context);
  if (bestMatch) {
    const proximity = ref.filePath ? computePathProximity(ref.filePath, bestMatch.filePath) : 100;
    const confidence = proximity >= 30 ? 0.7 : 0.4;
    return {
      original: ref,
      targetNodeId: bestMatch.id,
      confidence,
      provenance: 'exact-match',
    };
  }
  return null;
}

// =============================================================================
// matchReference — мастер-диспетчер
// =============================================================================

/** Декораторы ARKUI для атрибутов UI в ArkTS. */
const ARKUI_ATTRIBUTE_DECORATORS = new Set([
  'Extend', 'Styles', 'AnimatableExtend', 'Builder',
]);

/**
 * Мастер-диспетчер разрешения ссылок.
 *
 * Вызывает все стратегии в порядке убывания уверенности:
 * function_ref → ArkTS → Erlang → file path → qualified name →
 * C++ chain → scoped chain → dotted chain → method call → exact → fuzzy.
 */
export function matchReference(
  ref: IUnresolvedReference,
  context: IResolutionContext
): IResolvedRef | null {
  // Function-as-value — только через dedicated matcher
  if (ref.referenceKind === 'function_ref') {
    return matchFunctionRef(ref, context);
  }

  // ArkTS цепочки UI-атрибутов
  if (ref.language === 'arkts' && ref.referenceName.startsWith('.')) {
    const base = ref.referenceName.slice(1);
    const candidates = context
      .getNodesByName(base)
      .filter(
        (n) =>
          n.language === 'arkts' &&
          n.kind === 'function' &&
          (n.decorators ?? []).some((d: string) => ARKUI_ATTRIBUTE_DECORATORS.has(d))
      );
    const chosen =
      candidates.length > 1 ? preferCallSiteFile(candidates, ref.filePath ?? '') : candidates;
    if (chosen.length !== 1) return null;
    return {
      original: ref,
      targetNodeId: chosen[0]!.id,
      confidence: 0.85,
      provenance: 'exact-match',
    };
  }

  // Erlang behaviour / .app ссылки
  if (
    (ref.language as string) === 'erlang' &&
    (ref.referenceKind === 'implements' || /\.app(?:\.src)?$/i.test(ref.filePath ?? ''))
  ) {
    const modules = context
      .getNodesByName(ref.referenceName)
      .filter((n) => (n.language as string) === 'erlang' && n.kind === 'namespace');
    const chosen = preferCallSiteFile(modules, ref.filePath ?? '')[0];
    if (!chosen) return null;
    return {
      original: ref,
      targetNodeId: chosen.id,
      confidence: 0.9,
      provenance: 'exact-match',
    };
  }

  // Стратегии в порядке уверенности
  const fp = matchByFilePath(ref, context);
  if (fp) return fp;

  const qn = matchByQualifiedName(ref, context);
  if (qn) return qn;

  // C++ chained call
  if (ref.language === 'cpp' || ref.language === 'c') {
    const cpp = matchCppCallChain(ref, context);
    if (cpp) return cpp;
  }

  // Scoped factory chain (PHP, Rust) — цепочки через ::
  if (ref.language === 'php' || ref.language === 'rust') {
    const scoped = matchScopedCallChain(ref, context);
    if (scoped) return scoped;
  }

  // Dotted factory chain — цепочки через .
  if (CHAIN_LANGUAGES.has(ref.language ?? '') || CONSTRUCTS_VIA_BARE_CALL.has(ref.language ?? '')) {
    const dotted = matchDottedCallChain(ref, context);
    if (dotted) return dotted;
  }

  // Вызов метода
  const mc = matchMethodCall(ref, context);
  if (mc) return mc;

  // Точное имя
  const exact = matchByExactName(ref, context);
  if (exact) return exact;

  // Нечёткое совпадение
  const fuzzy = matchFuzzy(ref, context);
  if (fuzzy) return fuzzy;

  return null;
}

// =============================================================================
// matchFuzzy
// =============================================================================

/**
 * Нечёткое сопоставление по имени (case-insensitive).
 *
 * Ищет узлы с совпадающим именем в нижнем регистре. Предпочитает
 * callable-виды (function, method, class) и фильтрует по языку.
 */
export function matchFuzzy(
  ref: IUnresolvedReference,
  context: IResolutionContext
): IResolvedRef | null {
  const lowerName = ref.referenceName.toLowerCase();
  const candidates = context.getNodesByLowerName(lowerName);

  const callableKinds = new Set(['function', 'method', 'class'] as NodeKind[]);
  const callableCandidates = applyLanguageGate(
    candidates.filter((n) => callableKinds.has(n.kind)),
    ref
  );

  const sameLanguageCandidates = callableCandidates.filter(n => n.language === ref.language);
  const finalCandidates = sameLanguageCandidates.length > 0 ? sameLanguageCandidates : callableCandidates;

  if (finalCandidates.length === 1) {
    const isCrossLanguage = finalCandidates[0]!.language !== ref.language;
    return {
      original: ref,
      targetNodeId: finalCandidates[0]!.id,
      confidence: isCrossLanguage ? 0.3 : 0.5,
      provenance: 'fuzzy',
    };
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

  if (ref.referenceName.startsWith('this.')) return null;

  // :: qualified member pointers (C++ &Widget::on_click)
  if (ref.referenceName.includes('::')) {
    const memberName = ref.referenceName.slice(ref.referenceName.lastIndexOf('::') + 2);
    const scoped = context
      .getNodesByName(memberName)
      .filter(
        (n) =>
          (n.kind === 'function' || n.kind === 'method') &&
          sameLanguageFamily(n.language, ref.language ?? '') &&
          n.id !== ref.fromNodeId &&
          (n.qualifiedName === ref.referenceName ||
            n.qualifiedName.endsWith(`::${ref.referenceName}`))
      );
    if (scoped.length === 0) return null;
    const sameFileScoped = scoped.filter((n) => n.filePath === ref.filePath);
    const pool = sameFileScoped.length > 0 ? sameFileScoped : scoped;
    if (sameFileScoped.length === 0 && scoped.length > 1) return null;
    const target = pool.reduce((a, b) => (a.startLine <= b.startLine ? a : b));
    return {
      original: ref,
      targetNodeId: target.id,
      confidence: 0.9,
      provenance: 'function-ref',
    };
  }

  const name = ref.referenceName;
  const bareFnOnly = ['typescript', 'javascript', 'tsx', 'jsx', 'python', 'cpp', 'php', 'arkts'].includes(ref.language ?? '');

  let candidates = context.getNodesByName(name)
    .filter((n) =>
      (n.kind === 'function' || (!bareFnOnly && n.kind === 'method')) &&
      sameLanguageFamily(n.language, ref.language ?? '') &&
      n.id !== ref.fromNodeId
    );

  if (candidates.length === 0) return null;

  // Swift implicit-self scoping — фильтрация по области видимости
  if (ref.language === 'swift' && candidates.some((n) => n.kind === 'method')) {
    const fromNode = context.getNodeById?.(ref.fromNodeId);
    const sep = fromNode ? fromNode.qualifiedName.lastIndexOf('::') : -1;
    const classPrefix = fromNode && sep > 0 ? fromNode.qualifiedName.slice(0, sep) : null;
    candidates = candidates.filter((n) => {
      if (n.kind !== 'method') return true;
      if (!classPrefix) return false;
      const mSep = n.qualifiedName.lastIndexOf('::');
      if (mSep <= 0) return false;
      const methodPrefix = n.qualifiedName.slice(0, mSep);
      return (
        methodPrefix === classPrefix ||
        methodPrefix.endsWith(`::${classPrefix}`) ||
        classPrefix.endsWith(`::${methodPrefix}`)
      );
    });
    if (candidates.length === 0) return null;
  }

  // Предпочитаем тот же файл
  const sameFile = candidates.filter((n) => n.filePath === ref.filePath);
  if (sameFile.length > 0) {
    // Swift неоднозначность методов в том же файле
    if (ref.language === 'swift' && sameFile.length > 1 && sameFile.every((n) => n.kind === 'method')) {
      return null;
    }
    const target = sameFile.reduce((a, b) => (a.startLine <= b.startLine ? a : b));
    return { original: ref, targetNodeId: target.id, confidence: sameFile.length === 1 ? 0.95 : 0.9, provenance: 'function-ref' };
  }
  if (candidates.length === 1) {
    return { original: ref, targetNodeId: candidates[0]!.id, confidence: 0.8, provenance: 'function-ref' };
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
  if (!CHAIN_LANGUAGES.has(ref.language ?? '') && !CONSTRUCTS_VIA_BARE_CALL.has(ref.language ?? '')) {
    return null;
  }

  const match = ref.referenceName.match(CHAIN_SHAPE);
  if (!match) {
    return null;
  }

  const [, factoryName, methodName] = match;

  // Цепочка фабрики Receiver.factory().method — ищем return type фабричного метода
  const lastDot = factoryName.lastIndexOf('.');
  if (lastDot > 0) {
    const factoryClass = factoryName.slice(0, lastDot).split('.').pop();
    const factoryMethod = factoryName.slice(lastDot + 1);
    const ret = lookupCalleeReturnType(`${factoryClass}::${factoryMethod}`, ref, context);
    if (ret) {
      const importedFqn = (ref.language === 'java' || ref.language === 'kotlin')
        ? importedFqnOf(ret, ref, context)
        : undefined;
      const resolved = resolveMethodOnType(ret, methodName!, ref, context, 0.85, 'instance-method', importedFqn);
      if (resolved) return resolved;
      // ObjC: factory returns instancetype → class itself
      if (ref.language === 'objc' || ref.language === 'pascal') {
        const resolved2 = resolveMethodOnType(factoryClass ?? ret, methodName!, ref, context, 0.8, 'instance-method');
        if (resolved2) return resolved2;
      }
    }
  } else {
    // Go bare factory: New().Method() — фабрика без точки
    if (ref.language === 'go') {
      const ret = lookupCalleeReturnType(factoryName, ref, context);
      if (ret) {
        const importedFqn = importedFqnOf(ret, ref, context);
        const gres = resolveMethodOnType(ret, methodName!, ref, context, 0.85, 'instance-method', importedFqn);
        if (gres) return gres;
      }
    }
    // Constructor receiver — языки с вызовом конструктора без new
    if (CONSTRUCTS_VIA_BARE_CALL.has(ref.language ?? '') && /^[A-Z]/.test(factoryName)) {
      const importedFqn = importedFqnOf(factoryName, ref, context);
      const cres = resolveMethodOnType(factoryName, methodName!, ref, context, 0.85, 'instance-method', importedFqn);
      if (cres) return cres;
    }
  }

  return null;
}

/**
 * Ищет return type callee-функции для factory chain.
 */
function lookupCalleeReturnType(callee: string, ref: IUnresolvedReference, context: IResolutionContext): string | null {
  const name = callee.includes('::') ? callee.slice(callee.lastIndexOf('::') + 2) : callee.split('.').pop() ?? callee;
  const candidates = context.getNodesByName(name).filter(
    (n) => (n.kind === 'method' || n.kind === 'function') && n.language === ref.language && !!n.returnType
  );
  if (callee.includes('::')) {
    const scoped = candidates.filter((n) => {
      const qn = n.qualifiedName;
      return qn === callee || qn.endsWith(`::${callee}`) || callee.endsWith(`::${qn}`);
    });
    if (scoped.length > 0) return scoped[0]?.returnType ?? null;
  }
  return candidates[0]?.returnType ?? null;
}

// =============================================================================
// matchCppCallChain
// =============================================================================


/** Извлекает последний сегмент C++ имени через ::. */
function cppLastSegment(name: string): string {
  const idx = name.lastIndexOf('::');
  return idx >= 0 ? name.slice(idx + 2) : name;
}

/** Проверяет существование C++ класса/структуры по имени. */
function cppClassExists(name: string, ref: IUnresolvedReference, context: IResolutionContext): boolean {
  const candidates = context.getNodesByName(name);
  return candidates.some((n) => (n.kind === 'class' || n.kind === 'struct') && n.language === ref.language);
}

/**
 * Разрешает тип результата C++ вызова: make_unique<T>(), recv.method(), Class::method(), func(), Type(), ns::Type().
 */
function resolveCppCallResultType(
  inner: string,
  ref: IUnresolvedReference,
  context: IResolutionContext,
  depth: number = 0,
): string | null {
  if (depth > 4) return null;

  // make_unique<T>() / make_shared<T>() → T
  const mkMatch = inner.match(/make_(unique|shared)\s*<\s*([A-Za-z_]\w*(?:\s*<[^>]*>)?)\s*>\s*\(\)/);
  if (mkMatch) {
    return normalizeCppTypeName(mkMatch[2]) ?? null;
  }

  // recv.method() — ищет тип recv, затем return type метода (только один уровень)
  const dotIdx = inner.lastIndexOf('.');
  if (dotIdx > 0) {
    const recv = inner.slice(0, dotIdx);
    const method = inner.slice(dotIdx + 1);
    if (!recv.includes('.') && !recv.includes('(') && !recv.includes('::')) {
      const ret = lookupCalleeReturnType(`${recv}::${method}`, ref, context);
      if (ret) return ret;
    }
  }

  // Class::method() / func() — return type callee
  if (inner.includes('::')) {
    const ret = lookupCalleeReturnType(inner, ref, context);
    if (ret) return ret;
  } else {
    const ret = lookupCalleeReturnType(inner, ref, context);
    if (ret) return ret;
  }

  // Прямая конструкция Type() / ns::Type()
  const bareName = cppLastSegment(inner.replace(/\(\)$/, ''));
  if (bareName && cppClassExists(bareName, ref, context)) {
    return bareName;
  }

  return null;
}

/**
 * Сопоставление цепных вызовов C++: X().method().
 *
 * Использует resolveCppCallResultType для определения типа результата X,
 * затем ищет method на этом типе.
 */
export function matchCppCallChain(
  ref: IUnresolvedReference,
  context: IResolutionContext
): IResolvedRef | null {
  const lang = ref.language ?? '';
  if (lang !== 'cpp' && lang !== 'c') {
    return null;
  }

  const m = ref.referenceName.match(/^(.+)\(\)\.(\w+)$/);
  if (!m || !m[1] || !m[2]) return null;
  const inner = m[1];
  const method = m[2];

  // Сначала пробуем новый resolveCppCallResultType
  const cls = resolveCppCallResultType(inner, ref, context);
  if (cls) {
    return resolveMethodOnType(cls, method, ref, context, 0.85, 'cpp-call-chain');
  }

  return null;
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

  let scanReceiver = receiverName;
  let phpProperty = false;
  let componentScoped = false;

  if (lang === 'php') {
    const scoped = receiverName.match(/^this->(.+)$/);
    if (scoped) {
      scanReceiver = scoped[1]!;
      phpProperty = true;
      componentScoped = true;
    }
  }

  // CFML scope prefix stripping — удаление префиксов области видимости
  if (lang === 'cfml' || lang === 'cfscript') {
    const scoped = receiverName.match(/^(variables|this|local|arguments)\.(.+)$/i);
    if (scoped) {
      scanReceiver = scoped[2]!;
      componentScoped = scoped[1]!.toLowerCase() === 'variables' || scoped[1]!.toLowerCase() === 'this';
    }
  }

  const escaped = scanReceiver.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = phpProperty
    ? buildPhpPropertyTypePatterns(escaped)
    : localReceiverTypePatternsCached(lang, escaped);
  if (patterns.length === 0) return null;

  // Определяем начало области видимости
  let startIdx = 0;
  if (!componentScoped) {
    startIdx = Math.max(0, enclosingScopeStartLine(ref, context) - 1);
  }
  const callLineIndex = Math.max(0, ref.line - 1);

  // Попытка использовать кэш инкрементального сканирования
  let cachedResult: string | null = null;
  if (!componentScoped) {
    const states = getInferScanStates(context);
    const cacheKey = `${ref.filePath}|${startIdx}|${lang}|${scanReceiver}`;
    const cached = states.get(cacheKey) as { ansType?: string; hi?: number } | undefined;
    if (cached && cached.ansType) {
      if (callLineIndex <= (cached.hi ?? 0)) {
        return cached.ansType;
      }
      // Расширяем сканирование только для новых строк
      startIdx = (cached.hi ?? callLineIndex) + 1;
      cachedResult = cached.ansType;
    }
  }

  for (let i = callLineIndex; i >= startIdx; i--) {
    const line = lines[i];
    if (!line || line.length > 10000) continue;

    for (const pattern of patterns) {
      const m = line.match(pattern);
      if (m && m[1]) {
        const result = normalizeInferredTypeName(m[1]!);
        if (result && !componentScoped) {
          const states = getInferScanStates(context);
          const cacheKey = `${ref.filePath}|${callLineIndex}|${lang}|${scanReceiver}`;
          states.set(cacheKey, { ansType: result, hi: callLineIndex });
        }
        return result;
      }
    }
  }

  // Forward scan для componentScoped — объявление может быть ниже
  if (componentScoped) {
    for (let i = callLineIndex + 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line || line.length > 10000) continue;
      for (const pattern of patterns) {
        const m = line.match(pattern);
        if (m && m[1]) {
          return normalizeInferredTypeName(m[1]!);
        }
      }
    }
  }

  // PHP second-chance: $this->prop = $var → ищем тип $var
  if (phpProperty) {
    return inferPhpAssignedPropertyType(escaped, lines, callLineIndex);
  }

  return null;
}

/**
 * Находит строку начала ближайшей enclosing-функции/метода.
 */
function enclosingScopeStartLine(ref: IUnresolvedReference, context: IResolutionContext): number {
  let start = 1;
  const nodesInFile = context.getNodesByFile(ref.filePath ?? '');
  for (const n of nodesInFile) {
    if (n.kind !== 'function' && n.kind !== 'method') continue;
    if (n.language !== ref.language) continue;
    const end = n.endLine ?? n.startLine;
    if (n.startLine <= ref.line && end >= ref.line && n.startLine >= start) {
      start = n.startLine;
    }
  }
  return start;
}

/**
 * Паттерны для PHP property type inference.
 */
function buildPhpPropertyTypePatterns(r: string): RegExp[] {
  return memoPatterns(`php-prop|${r}`, () => [
    new RegExp(`\\b(?:(?:private|protected|public|readonly|static|final)(?:\\(set\\))?\\s+)+\\??([A-Za-z_\\\\][\\w\\\\]*)\\s+&?\\$${r}\\b`),
    new RegExp(`\\$this->${r}\\b\\s*=\\s*new\\s+([A-Za-z_\\\\][\\w\\\\]*)`),
   ]);
}

/**
 * Второй шанс для PHP: $this->prop = $var → ищем тип $var.
 */
function inferPhpAssignedPropertyType(
  escapedProp: string,
  lines: string[],
  callIdx: number,
): string | null {
  const assignRe = new RegExp(`\\$this->${escapedProp}\\b\\s*=\\s*\\$(\\w+)\\b`);
  let assignIdx = -1;
  let varName: string | null = null;
  for (let i = callIdx; i >= 0; i--) {
    const line = lines[i];
    if (!line || line.length > 10000) continue;
    const m = line.match(assignRe);
    if (m) { assignIdx = i; varName = m[1]!; break; }
  }
  if (varName === null) {
    for (let i = callIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line || line.length > 10000) continue;
      const m = line.match(assignRe);
      if (m) { assignIdx = i; varName = m[1]!; break; }
    }
  }
  if (varName === null) return null;

  const varPatterns = localReceiverTypePatternsCached('php', varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  for (let i = assignIdx; i >= 0; i--) {
    const line = lines[i];
    if (line && line.length <= 10000) {
      for (const re of varPatterns) {
        const m = line.match(re);
        if (m && m[1]) {
          const type = normalizeInferredTypeName(m[1]);
          if (type) return type;
        }
      }
    }
    if (line && /\bfunction\b/.test(line)) break;
  }
  return null;
}

// =============================================================================
// inferCppReceiverType
// =============================================================================

/** Токены, которые никогда не являются типами в C++. */
const CPP_NON_TYPE_TOKENS = new Set([
  'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default',
  'break', 'continue', 'goto', 'throw', 'new', 'delete', 'co_await', 'co_yield',
  'co_return', 'static_cast', 'const_cast', 'dynamic_cast', 'reinterpret_cast',
  'sizeof', 'alignof', 'typeid', 'and', 'or', 'not', 'xor',
]);

/** Нормализует имя типа C++: убирает const/volatile, дженерики, указатели. */
function normalizeCppTypeName(typeName: string): string | null {
  const normalized = typeName
    .replace(/\b(const|volatile|mutable|typename|class|struct)\b/g, ' ')
    .replace(/[&*]+/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return null;
  const parts = normalized.split(/::/).filter(Boolean);
  const last = parts[parts.length - 1];
  if (!last || CPP_NON_TYPE_TOKENS.has(last)) return null;
  return last;
}

/**
 * Определяет тип инициализатора для `auto` переменных C++.
 *
 * Анализирует правую часть: auto x = Type::method() → Type, auto x = make_unique<T>() → T.
 */
function inferCppAutoInitializerType(
  line: string,
  receiverName: string,
  ref: IUnresolvedReference,
  context: IResolutionContext,
  depth: number,
): string | null {
  if (depth > 3) return null;
  const esc = receiverName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // auto x = new Type(...)
  const newMatch = line.match(new RegExp(`\\b${esc}\\b\\s*=\\s*new\\s+([A-Za-z_][\\w:]*(?:\\s*<[^>;]*>)?)\\s*\\(`));
  if (newMatch) return newMatch[1]!;

  // auto x = new Type (без скобок)
  const newBare = line.match(new RegExp(`\\b${esc}\\b\\s*=\\s*new\\s+([A-Za-z_][\\w:]*)\\b`));
  if (newBare) return newBare[1]!;

  // auto x = make_unique<T>(...)
  const mkMatch = line.match(new RegExp(`\\b${esc}\\b\\s*=\\s*make_(unique|shared)\\s*<\\s*([A-Za-z_]\\w*)`));
  if (mkMatch) return mkMatch[2] ?? null;

  // auto x = Type::method(...)
  const qnMatch = line.match(new RegExp(`\\b${esc}\\b\\s*=\\s*([A-Za-z_]\\w*(?:::[A-Za-z_]\\w*)*)::(\\w+)\\s*\\(`));
  if (qnMatch) {
    const ret = lookupCalleeReturnType(qnMatch[1]! + '::' + qnMatch[2]!, ref, context);
    if (ret) return ret;
  }

  // auto x = func(...) — return type
  const fnMatch = line.match(new RegExp(`\\b${esc}\\b\\s*=\\s*(\\w+)\\s*\\(`));
  if (fnMatch) {
    const ret = lookupCalleeReturnType(fnMatch[1]!, ref, context);
    if (ret) return ret;
  }

  // Fallback: захватить всю правую часть и делегировать в resolveCppCallResultType
  const fullRhs = line.match(new RegExp(`\\b${esc}\\b\\s*=\\s*([^;]+)`));
  if (fullRhs) {
    const rhs = fullRhs[1]!.trim();
    const callResult = resolveCppCallResultType(rhs.replace(/\s*\(.*/, '()'), ref, context, depth + 1);
    if (callResult) return callResult;
  }

  return null;
}

/**
 * Инференс типа получателя для C++.
 *
 * Ищет объявление переменной в файле и хедере, нормализует тип.
 */
export function inferCppReceiverType(
  receiverName: string,
  ref: IUnresolvedReference,
  context: IResolutionContext,
): string | null {
  const lines = context.getFileLines?.(ref.filePath ?? '') ?? null;
  if (!lines || lines.length === 0) return null;

  const callLineIndex = Math.max(0, Math.min(lines.length - 1, ref.line - 1));
  const escapedReceiver = receiverName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const receiverPattern = new RegExp(`\\b${escapedReceiver}\\b`);
  const declaratorRegex = new RegExp(
    `([A-Za-z_][\\w:]*(?:\\s*<[^;=(){}]+>)?(?:\\s*[*&]+)?)\\s*\\b${escapedReceiver}\\b\\s*(?=[;=,)\\[{(]|$)`,
  );

  for (let i = callLineIndex; i >= 0; i--) {
    const line = lines[i];
    if (!line || !receiverPattern.test(line) || line.length > 10000) continue;
    const declaratorMatch = line.match(declaratorRegex);
    if (declaratorMatch) {
      const normalized = normalizeCppTypeName(declaratorMatch[1] ?? '');
      if (normalized === 'auto') {
        const initType = inferCppAutoInitializerType(line, receiverName, ref, context, 0);
        if (initType) return initType;
      } else if (normalized) {
        return normalized;
      }
    }
  }

  // Сканируем хедер
  const headerCandidates = [
    (ref.filePath ?? '').replace(/\.(?:c|cc|cpp|cxx)$/i, '.h'),
    (ref.filePath ?? '').replace(/\.(?:c|cc|cpp|cxx)$/i, '.hpp'),
    (ref.filePath ?? '').replace(/\.(?:c|cc|cpp|cxx)$/i, '.hxx'),
  ].filter((c, idx, arr) => arr.indexOf(c) === idx && c !== ref.filePath);

  for (const headerPath of headerCandidates) {
    const headerLines = context.getFileLines?.(headerPath) ?? null;
    if (!headerLines) continue;
    for (const line of headerLines) {
      if (!line || !receiverPattern.test(line)) continue;
      const declaratorMatch = line.match(declaratorRegex);
      if (!declaratorMatch) continue;
      const normalized = normalizeCppTypeName(declaratorMatch[1] ?? '');
      if (normalized && normalized !== 'auto') return normalized;
    }
  }

  return null;
}

// =============================================================================
// inferJavaFieldReceiverType
// =============================================================================

/**
 * Инференс типа получателя из поля класса Java/Kotlin.
 *
 * Для вызовов вида `field.method()` ищет объявление поля в заключающем
 * классе и извлекает тип из сигнатуры.
 */
export function inferJavaFieldReceiverType(
  receiverName: string,
  ref: IUnresolvedReference,
  context: IResolutionContext,
): string | null {
  const inFile = context.getNodesByFile(ref.filePath ?? '');
  if (inFile.length === 0) return null;

  // Ищем класс, заключающий строку вызова
  let enclosing: INode | null = null;
  for (const n of inFile) {
    if (n.kind !== 'class' && n.kind !== 'interface') continue;
    if (n.language !== ref.language) continue;
    const end = n.endLine ?? n.startLine;
    if (n.startLine <= ref.line && end >= ref.line) {
      if (!enclosing || n.startLine >= enclosing.startLine) enclosing = n;
    }
  }
  if (!enclosing) return null;

  const enclosingEnd = enclosing.endLine ?? enclosing.startLine;
  const field = inFile.find(
    (n) =>
      n.kind === 'field' &&
      n.name === receiverName &&
      n.language === ref.language &&
      n.startLine >= enclosing.startLine &&
      (n.endLine ?? n.startLine) <= enclosingEnd,
  );
  if (!field || !field.signature) return null;

  // Signature: "<TypeName> <fieldName>"
  const beforeName = field.signature.slice(0, field.signature.lastIndexOf(field.name));
  const typeRaw = beforeName.trim();
  if (!typeRaw) return null;

  const typeNoGenerics = typeRaw.replace(/<[^>]*>/g, '').trim();
  const typeNoArray = typeNoGenerics.replace(/\[\s*\]/g, '').replace(/\.\.\.$/, '').trim();
  const parts = typeNoArray.split(/[.\s]+/).filter(Boolean);
  const lastPart = parts[parts.length - 1];
  if (!lastPart || !/^[A-Z]/.test(lastPart)) return null;
  return lastPart;
}

// =============================================================================
// importedFqnOf
// =============================================================================

/**
 * Возвращает FQN импортированного типа по локальному имени.
 */
export function importedFqnOf(
  typeName: string,
  ref: IUnresolvedReference,
  context: IResolutionContext,
): string | undefined {
  const imports = context.getImportMappings(ref.filePath ?? '');
  return imports.find((i) => i.localName === typeName)?.source;
}

/** Кэш паттернов для инференса типа получателя. */
const PATTERN_MEMO = new Map<string, RegExp[]>();
const PATTERN_MEMO_CAP = 8192;

/** Мемоизирует построение паттернов. */
function memoPatterns(key: string, build: () => RegExp[]): RegExp[] {
  const hit = PATTERN_MEMO.get(key);
  if (hit) return hit;
  const patterns = build();
  if (PATTERN_MEMO.size >= PATTERN_MEMO_CAP) {
    const oldest = PATTERN_MEMO.keys().next().value;
    if (oldest !== undefined) PATTERN_MEMO.delete(oldest);
  }
  PATTERN_MEMO.set(key, patterns);
  return patterns;
}

/** Кэшированный доступ к паттернам инференса типа получателя. */
export function localReceiverTypePatternsCached(language: string, r: string): RegExp[] {
  return memoPatterns(`${language}|${r}`, () => buildLocalReceiverTypePatterns(language, r));
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
    case 'arkts':
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
    case 'lua':
    case 'luau':
      return [
        new RegExp(`\\b${r}\\b\\s*=\\s*([A-Z][\\w]*)\\.new\\b`),
        new RegExp(`\\b${r}\\b\\s*=\\s*([A-Z][\\w]*)\\s*\\(`),
        new RegExp(`\\b${r}\\b\\s*:\\s*([A-Z][\\w.]*)(?![\\w.]|\\s*[({"'\\[])`),
      ];
    case 'r':
      return [
        new RegExp(`\\b${r}\\b\\s*(?:<-|<<-|=)\\s*([A-Z][\\w.]*)\\$new\\b`),
      ];
    case 'pascal':
      return [
        new RegExp(`\\b${r}\\b\\s*:\\s*([A-Z][\\w]*)`),
        new RegExp(`\\b${r}\\b\\s*:=\\s*([A-Z][\\w.]*)\\.Create\\b`),
      ];
    case 'cfml':
    case 'cfscript':
      return [
        new RegExp(`\\b${r}\\b\\s*=\\s*new\\s+([A-Za-z_][\\w.]*)`),
        new RegExp(`\\b${r}\\b\\s*=\\s*[Cc]reate[Oo]bject\\s*\\(\\s*["']component["']\\s*,\\s*["']([\\w.]+)["']`),
        new RegExp(`\\b${r}\\b\\s*=\\s*[Cc]reate[Oo]bject\\s*\\(\\s*["']([\\w.]+)["']\\s*\\)`),
        new RegExp(`\\b([A-Z][\\w.]*)\\s+${r}\\b\\s*[=;,)]`),
        // cfargument и property
        new RegExp(`\\bcfargument[^>\\n]*\\bname\\s*=\\s*["']${r}["'][^>\\n]*\\btype\\s*=\\s*["']([\\w.]+)["']`, 'i'),
        new RegExp(`\\bcfargument[^>\\n]*\\btype\\s*=\\s*["']([\\w.]+)["'][^>\\n]*\\bname\\s*=\\s*["']${r}["']`, 'i'),
        new RegExp(`\\b(?:cf)?property\\b[^;\\n]*\\bname\\s*=\\s*["']${r}["'][^;\\n]*\\b(?:type|inject)\\s*=\\s*["']([\\w.]+)["']`, 'i'),
        new RegExp(`\\b(?:cf)?property\\b[^;\\n]*\\b(?:type|inject)\\s*=\\s*["']([\\w.]+)["'][^;\\n]*\\bname\\s*=\\s*["']${r}["']`, 'i'),
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
 * Сопоставление цепных вызовов через `::` (Rust, PHP):
 * Cls::for($x)->method() и Foo::new().bar().
 */
export function matchScopedCallChain(
  ref: IUnresolvedReference,
  context: IResolutionContext
): IResolvedRef | null {
  if (!SCOPED_CHAIN_LANGUAGES.has(ref.language ?? '')) {
    return null;
  }

  const m = ref.referenceName.match(/^(.+)\(\)\.(\w+)$/);
  if (!m || !m[1] || !m[2]) return null;
  const inner = m[1];
  const method = m[2];
  if (!inner.includes('::')) return null;

  const factoryClass = inner.slice(0, inner.lastIndexOf('::'));
  const ret = lookupCalleeReturnType(inner, ref, context);
  if (!ret) return null;

  // self marker → factory's class
  const resolvedClass = ret === 'self' ? factoryClass : ret;
  return resolveMethodOnType(resolvedClass, method, ref, context, 0.85, 'instance-method');
}

// =============================================================================
// matchMethodCall
// =============================================================================

/** Языки, в которых конструктор вызывается без `new`. */
const CONSTRUCTS_VIA_BARE_CALL = new Set(['kotlin', 'swift', 'scala', 'dart', 'pascal', 'java']);

/**
 * Сопоставление вызова метода: receiver.method().
 *
 * Поддерживает точку (Java, C#), двоеточие (C++), двоеточие (Lua),
 * доллар (R) и PHP $this->prop.method.
 */
export function matchMethodCall(
  ref: IUnresolvedReference,
  context: IResolutionContext
): IResolvedRef | null {
  const lang = ref.language ?? '';
  const name = ref.referenceName;

  const dotMatch = name.match(/^([\w.]+)\.(\w+:?(?:\w+:)*)(?:$|\.operator[^\w\s.]+)$/);
  const cxxOpMatch = name.match(/^([\w.]+)\.(operator[^\w\s.]+)$/);
  const colonMatch = name.match(/^(\w+)::(\w+)$/);
  const luaColonMatch = (lang === 'lua' || lang === 'luau') ? name.match(/^([\w.]+):(\w+)$/) : null;
  const rDollarMatch = lang === 'r' ? name.match(/^([\w.]+)\$(\w+)$/) : null;

  // PHP $this->prop.method — только через declared-type inference
  const phpThisPropMatch = lang === 'php' ? name.match(/^(this->\w+)\.(\w+)$/) : null;
  if (phpThisPropMatch) {
    const [, receiver, phpMethodName] = phpThisPropMatch;
    const inferredType = inferLocalReceiverType(receiver!, ref, context);
    if (!inferredType) return null;
    return resolveMethodOnType(inferredType, phpMethodName!, ref, context, 0.9, 'instance-method');
  }

  const match = cxxOpMatch || dotMatch || colonMatch || luaColonMatch || rDollarMatch;
  if (!match) return null;

  const [, objectOrClass, methodName] = match;
  const inferableReceiver = dotMatch || cxxOpMatch || luaColonMatch || rDollarMatch;

  // Стратегия 0.5: Определяемый получатель
  if (inferableReceiver) {
    let inferredType: string | null;
    if (lang === 'cpp' || lang === 'c') {
      inferredType = inferCppReceiverType(objectOrClass!, ref, context);
    } else if (lang === 'java' || lang === 'kotlin') {
      inferredType = inferLocalReceiverType(objectOrClass!, ref, context)
        ?? inferJavaFieldReceiverType(objectOrClass!, ref, context);
    } else {
      inferredType = inferLocalReceiverType(objectOrClass!, ref, context);
    }
    if (inferredType) {
      const importedFqn = (lang === 'java' || lang === 'kotlin')
        ? importedFqnOf(inferredType, ref, context)
        : undefined;
      const typedMatch = resolveMethodOnType(
        inferredType, methodName!, ref, context, 0.9, 'instance-method', importedFqn
      );
      if (typedMatch) return typedMatch;
    }
  }

  // Go 2-шаговая цепочка полей
  if (lang === 'go' && dotMatch && objectOrClass!.includes('.')) {
    return matchGoFieldChainCall(objectOrClass!, methodName!, ref, context);
  }

  // Стратегия 1: Прямое совпадение имени класса
  const classCandidates = preferCallSiteFile(
    context.getNodesByName(objectOrClass!),
    ref.filePath ?? '',
  );
  for (const classNode of classCandidates) {
    if (classNode.kind !== 'class' && classNode.kind !== 'struct' && classNode.kind !== 'interface') continue;
    if (classNode.language !== ref.language) continue;
    const nodesInFile = context.getNodesByFile(classNode.filePath);
    const methodNode = nodesInFile.find(
      (n) => n.kind === 'method' && n.name === methodName && n.qualifiedName.includes(classNode.name)
    );
    if (methodNode) {
      return { original: ref, targetNodeId: methodNode.id, confidence: 0.85, provenance: 'qualified-name' };
    }
  }

  // Стратегия 2: Получатель с заглавной буквы
  const capitalizedReceiver = objectOrClass!.charAt(0).toUpperCase() + objectOrClass!.slice(1);
  if (capitalizedReceiver !== objectOrClass) {
    const fuzzyClassCandidates = preferCallSiteFile(
      context.getNodesByName(capitalizedReceiver),
      ref.filePath ?? '',
    );
    for (const classNode of fuzzyClassCandidates) {
      if (classNode.kind !== 'class' && classNode.kind !== 'struct' && classNode.kind !== 'interface') continue;
      if (classNode.language !== ref.language) continue;
      const nodesInFile = context.getNodesByFile(classNode.filePath);
      const methodNode = nodesInFile.find(
        (n) => n.kind === 'method' && n.name === methodName && n.qualifiedName.includes(classNode.name)
      );
      if (methodNode) {
        return { original: ref, targetNodeId: methodNode.id, confidence: 0.8, provenance: 'instance-method' };
      }
    }
  }

  // Стратегия 3: Поиск методов по имени + пересечение слов получателя
  const methodCandidates = context.getNodesByName(methodName!);
  if (methodCandidates.length > AMBIGUOUS_NAME_CEILING) return null;
  const methods = methodCandidates.filter((n) => n.kind === 'method' && n.name === methodName);
  const sameLanguageMethods = methods.filter(m => m.language === ref.language);
  const targetMethods = sameLanguageMethods.length > 0 ? sameLanguageMethods : methods;

  if (targetMethods.length === 1 && targetMethods[0]!.language === ref.language) {
    return { original: ref, targetNodeId: targetMethods[0]!.id, confidence: 0.7, provenance: 'instance-method' };
  }

  if (targetMethods.length > 1) {
    const receiverWords = splitCamelCase(objectOrClass!);
    let bestMatch: INode | undefined;
    let bestScore = 0;
    for (const method of preferCallSiteFile(targetMethods, ref.filePath ?? '')) {
      const classWords = splitCamelCase(method.qualifiedName);
      let score = receiverWords.filter(w =>
        classWords.some(cw => cw.toLowerCase() === w.toLowerCase())
      ).length;
      if (method.language === ref.language) score += 1;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = method;
      }
    }
    if (bestMatch && bestScore >= 2) {
      return { original: ref, targetNodeId: bestMatch.id, confidence: 0.65, provenance: 'instance-method' };
    }
  }

  return null;
}

// =============================================================================
// matchGoFieldChainCall
// =============================================================================

/** Встроенные типы Go — не являются пользовательскими. */
const GO_BUILTIN_FIELD_TYPES = new Set([
  'string', 'bool', 'byte', 'rune', 'error', 'any',
  'int', 'int8', 'int16', 'int32', 'int64',
  'uint', 'uint8', 'uint16', 'uint32', 'uint64', 'uintptr',
  'float32', 'float64', 'complex64', 'complex128',
  'chan', 'map', 'func', 'struct', 'interface',
]);

/**
 * Сопоставление 2-hop цепочки полей Go: target.field.Method().
 *
 * Инферирует тип base, находит поле, определяет его тип, затем метод.
 */
function matchGoFieldChainCall(
  receiverChain: string,
  methodName: string,
  ref: IUnresolvedReference,
  context: IResolutionContext
): IResolvedRef | null {
  const segs = receiverChain.split('.');
  if (segs.length !== 2 || !segs[0] || !segs[1]) return null;
  const [base, field] = segs;

  const baseType = inferLocalReceiverType(base!, ref, context);
  if (!baseType) return null;

  const fieldEsc = field!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const fieldTypeRe = new RegExp(`\\b${fieldEsc}\\s+\\*?\\[?\\]?([A-Za-z_][\\w.]*)`);

  const structs = preferCallSiteFile(context.getNodesByName(baseType), ref.filePath ?? '').filter(
    (n) => (n.kind === 'struct' || n.kind === 'class') && n.language === 'go'
  );
  for (const s of structs) {
    const source = context.getFileContent(s.filePath);
    if (!source) continue;
    const declLines = source.split('\n').slice(Math.max(0, s.startLine - 1), s.endLine);
    for (const rawLine of declLines) {
      const line = rawLine.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
      const m = line.match(fieldTypeRe);
      if (!m || !m[1]) continue;
      const rawType = m[1];
      if (rawType.includes('.')) {
        const pkg = rawType.split('.')[0]!;
        const mod = context.getGoModule?.();
        const imp = context.getImportMappings(s.filePath).find((i) => i.localName === pkg);
        if (!mod || !imp) continue;
        const isLocal = imp.source === mod.modulePath || imp.source.startsWith(mod.modulePath + '/');
        if (!isLocal) continue;
      }
      const fieldType = rawType.split('.').pop()!;
      if (!fieldType || !/^[A-Za-z_]/.test(fieldType) || GO_BUILTIN_FIELD_TYPES.has(fieldType)) continue;
      const resolved = resolveMethodOnType(fieldType, methodName, ref, context, 0.85, 'instance-method');
      if (resolved) return resolved;
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

// =============================================================================
// Состояние сканирования infer и очистка мемо
// =============================================================================

/** Состояние сканирования для infer-функций (по контексту). */
const INFER_SCAN_STATES = new WeakMap<IResolutionContext, Map<string, unknown>>();

/** Получает или создаёт состояние сканирования для контекста. */
function getInferScanStates(context: IResolutionContext): Map<string, unknown> {
  let states = INFER_SCAN_STATES.get(context);
  if (!states) {
    states = new Map();
    INFER_SCAN_STATES.set(context, states);
  }
  return states;
}

/**
 * Очищает состояния сканирования infer (паттерны — чистые функции, безопасны для шаринга).
 */
export function clearNameMatcherMemos(context: IResolutionContext): void {
  getInferScanStates(context).clear();
}

// =============================================================================
// Профилирование NameMatcher
// =============================================================================

/** Профиль времени выполнения (активно только при NTGRAPH_RESOLVE_PROFILE=2). */
const NM_PROFILE: Map<string, { n: number; ns: bigint }> | null =
  process.env.NTGRAPH_RESOLVE_PROFILE === '2'
    ? new Map()
    : null;

/** Замеряет время функции (no-op если профилирование выключено). */
function nmTimed<T>(label: string, fn: () => T): T {
  if (!NM_PROFILE) return fn();
  const t0 = process.hrtime.bigint();
  const r = fn();
  const dt = process.hrtime.bigint() - t0;
  const entry = NM_PROFILE.get(label);
  if (entry) {
    entry.n++;
    entry.ns += dt;
  } else {
    NM_PROFILE.set(label, { n: 1, ns: dt });
  }
  return r;
}

/** Замеряет время функции с аргументом. */
function nmTimedT<A, T>(label: string, fn: (a: A) => T, arg: A): T {
  return nmTimed(label, () => fn(arg));
}

/**
 * Выгружает профиль NameMatcher в log.
 */
export function dumpNameMatcherProfile(label: string): void {
  if (!NM_PROFILE) return;
  console.log(`[NameMatcher profile] ${label}:`);
  for (const [name, { n, ns }] of NM_PROFILE) {
    const ms = Number(ns) / 1e6;
    console.log(`  ${name}: ${n} calls, ${ms.toFixed(1)}ms (${(ms / n).toFixed(3)}ms avg)`);
  }
}
