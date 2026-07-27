/**
 * Утилиты для работы с графом кода.
 * Конвертеры, строковые функции, поиск, парсер, классификаторы,
 * безопасность путей, асинхронные утилиты, мониторинг памяти.
 */

import {
  NodeKind,
  EdgeKind,
  Language,
  INode,
  IEdge,
  IFileRecord,
  ParsedQuery,
  CONFIG_LEAF_LANGUAGES,
  SENSITIVE_PATHS,
  DATABASE_FILENAME,
  FileLock_STALE_TIMEOUT_MS,
  IUnresolvedReference,
  IResolutionContext,
} from './Types';
import { isGeneratedFile as isGeneratedFileFromDetection } from '../extraction/GeneratedDetection';

// =============================================================================
// Конвертеры строк БД
// =============================================================================

interface NodeRow {
  id: string;
  kind: string;
  name: string;
  qualified_name: string;
  file_path: string;
  language: string;
  start_line: number;
  end_line: number;
  start_column: number;
  end_column: number;
  docstring: string | null;
  signature: string | null;
  visibility: string | null;
  is_exported: number;
  is_async: number;
  is_static: number;
  is_abstract: number;
  decorators: string | null;
  type_parameters: string | null;
  return_type: string | null;
  updated_at: number;
}

interface EdgeRow {
  id: number;
  source: string;
  target: string;
  kind: string;
  metadata: string | null;
  line: number | null;
  col: number | null;
  provenance: string | null;
}

interface FileRow {
  path: string;
  content_hash: string;
  language: string;
  size: number;
  modified_at: number;
  indexed_at: number;
  node_count: number;
  errors: string | null;
}

/** Безопасный парсинг JSON из SQLite. */
export function safeJsonParse<T>(str: string | null, fallback: T): T {
  if (!str) return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

/** Преобразует строку БД из snake_case в camelCase Node. */
export function rowToNode(row: NodeRow): INode {
  return {
    id: row.id,
    kind: row.kind as NodeKind,
    name: row.name,
    qualifiedName: row.qualified_name,
    filePath: row.file_path,
    language: row.language as Language,
    startLine: row.start_line,
    endLine: row.end_line,
    startColumn: row.start_column,
    endColumn: row.end_column,
    docstring: row.docstring ?? undefined,
    signature: row.signature ?? undefined,
    visibility: row.visibility as INode['visibility'] ?? undefined,
    isExported: row.is_exported === 1,
    isAsync: row.is_async === 1,
    isStatic: row.is_static === 1,
    isAbstract: row.is_abstract === 1,
    decorators: row.decorators ? safeJsonParse(row.decorators, undefined) : undefined,
    typeParameters: row.type_parameters ? safeJsonParse(row.type_parameters, undefined) : undefined,
    returnType: row.return_type ?? undefined,
    updatedAt: row.updated_at,
  };
}

/** Преобразует строку БД из snake_case в camelCase Edge. */
export function rowToEdge(row: EdgeRow): IEdge {
  return {
    source: row.source,
    target: row.target,
    kind: row.kind as EdgeKind,
    metadata: row.metadata ? safeJsonParse(row.metadata, undefined) : undefined,
    line: row.line ?? undefined,
    column: row.col ?? undefined,
    provenance: (row.provenance ?? undefined) as IEdge['provenance'],
  };
}

/** Преобразует строку БД из snake_case в FileRecord. */
export function rowToFileRecord(row: FileRow): IFileRecord {
  return {
    path: row.path,
    contentHash: row.content_hash,
    language: row.language as Language,
    size: row.size,
    modifiedAt: row.modified_at,
    indexedAt: row.indexed_at,
    nodeCount: row.node_count,
    errors: row.errors ? safeJsonParse(row.errors, undefined) : undefined,
  };
}

// =============================================================================
// Строковые утилиты
// =============================================================================

/** Переводит в нижний регистр, оставляет только буквенно-цифровые символы. */
export function normalizeNameToken(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Читает go.mod, package.json, имя директории репо; фильтрует токены короче 5 символов. */
export function deriveProjectNameTokens(projectRoot: string): Set<string> {
  const tokens = new Set<string>();
  const fs = require('fs');
  const path = require('path');

  // Из package.json
  const pkgPath = path.join(projectRoot, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const name = (pkg.name ?? '').replace(/[^a-zA-Z0-9]/g, ' ').trim();
      for (const t of name.split(/\s+/)) {
        if (t.length >= 5) tokens.add(t.toLowerCase());
      }
    } catch {
      // Игнорируем ошибки парсинга
    }
  }

  // Из go.mod
  const goModPath = path.join(projectRoot, 'go.mod');
  if (fs.existsSync(goModPath)) {
    try {
      const content = fs.readFileSync(goModPath, 'utf8');
      const m = content.match(/^module\s+(.+)$/m);
      if (m) {
        const modName = m[1].trim().split('/').pop() ?? '';
        if (modName.length >= 5) tokens.add(modName.toLowerCase());
      }
    } catch {
      // Игнорируем ошибки
    }
  }

  // Из имени директории
  const dirName = path.basename(projectRoot);
  if (dirName.length >= 5) {
    tokens.add(dirName.toLowerCase());
  }

  return tokens;
}

/** Генерирует варианты основы: -ing, -tion, -ment, -ies, -es, -s, -ed, -er. */
export function getStemVariants(term: string): string[] {
  const variants = new Set<string>();
  variants.add(term);

  const suffixes = ['ing', 'tion', 'ment', 'ies', 'es', 's', 'ed', 'er'];
  for (const suffix of suffixes) {
    if (term.endsWith(suffix) && term.length - suffix.length >= 2) {
      variants.add(term.slice(0, -suffix.length));
    }
  }

  // -ies → -y (особый случай: "cities" → "cit" + "y")
  if (term.endsWith('ies') && term.length >= 5) {
    variants.add(term.slice(0, -3) + 'y');
  }

  return [...variants];
}

/** Разделяет camelCase, PascalCase, snake_case, SCREAMING_SNAKE, dot.notation. */
export function extractSearchTerms(query: string, _options?: unknown): string[] {
  const terms = new Set<string>();

  // Разделяем по пробелам и точкам
  const parts = query.replace(/\./g, ' ').split(/\s+/).filter(Boolean);

  for (const part of parts) {
    // snake_case / SCREAMING_SNAKE
    const snakeParts = part.split(/[_]+/).filter(Boolean);
    if (snakeParts.length > 1) {
      for (const sp of snakeParts) {
        terms.add(sp.toLowerCase());
      }
      continue;
    }

    // camelCase / PascalCase
    const camelParts = part.split(/(?=[A-Z])/).filter(Boolean);
    if (camelParts.length > 1) {
      for (const cp of camelParts) {
        const lower = cp.toLowerCase();
        if (lower.length >= 2) terms.add(lower);
      }
      continue;
    }

    const lower = part.toLowerCase();
    if (lower.length >= 2) terms.add(lower);
  }

  // Добавляем варианты основы для каждого термина
  const baseTerms = [...terms];
  for (const t of baseTerms) {
    for (const variant of getStemVariants(t)) {
      if (variant.length >= 2) terms.add(variant);
    }
  }

  return [...terms];
}

/** Удаляет окружающие двойные кавычки. */
export function unquote(s: string): string {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1);
  }
  return s;
}

/** Чистый DP с ранним выходом при превышении maxDist. */
export function boundedEditDistance(a: string, b: string, maxDist: number): number {
  const m = a.length;
  const n = b.length;

  // Если разница в длинах больше maxDist, расстояние точно больше
  if (Math.abs(m - n) > maxDist) return maxDist + 1;

  // Используем два ряда для экономии памяти
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);

  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    let rowMin = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost
      );
      rowMin = Math.min(rowMin, curr[j]);
    }
    // Ранний выход: если минимальное значение в ряду уже больше maxDist
    if (rowMin > maxDist) return maxDist + 1;
    [prev, curr] = [curr, prev];
  }

  return prev[n];
}

// =============================================================================
// Поиск
// =============================================================================

/** Бонус по виду узла. */
export function kindBonus(kind: NodeKind): number {
  switch (kind) {
    case 'function':
    case 'method':
      return 10;
    case 'class':
    case 'interface':
    case 'struct':
      return 8;
    case 'route':
      return 7;
    case 'constant':
    case 'variable':
    case 'property':
    case 'field':
      return 5;
    case 'type_alias':
    case 'enum':
    case 'trait':
    case 'protocol':
      return 6;
    case 'namespace':
    case 'module':
      return 4;
    case 'component':
      return 9;
    default:
      return 3;
  }
}

/** Бонус по совпадению имени. */
export function nameMatchBonus(query: string, name: string): number {
  const qLower = query.toLowerCase();
  const nLower = name.toLowerCase();

  // Точное совпадение
  if (qLower === nLower) return 30;

  // Имя начинается с запроса
  if (nLower.startsWith(qLower)) return 20;

  // Имя содержит запрос
  if (nLower.includes(qLower)) return 10;

  // Разделяем запрос на части и проверяем, что имя содержит все части
  const terms = qLower.split(/\s+/).filter(Boolean);
  if (terms.length > 1) {
    const allMatch = terms.every(t => nLower.includes(t));
    if (allMatch) return 15;
  }

  return 0;
}

/** Релевантность пути. */
export function scorePathRelevance(
  filePath: string,
  query: string,
  projectNameTokens?: Set<string>
): number {
  const pathLower = filePath.toLowerCase();
  const queryLower = query.toLowerCase();
  const terms = queryLower.split(/\s+/).filter(Boolean);
  let score = 0;

  for (const term of terms) {
    // Пропускаем токены имени проекта — они недискриминативны
    if (projectNameTokens?.has(term)) continue;

    if (pathLower.includes(term)) {
      score += 5;
    }
  }

  // Штраф за тестовые/сгенерированные файлы
  if (isLowValueFile(filePath)) {
    score -= 10;
  }

  return score;
}

/** Определение тестовых/сгенерированных файлов. */
export function isLowValueFile(filePath: string): boolean {
  const lp = filePath.toLowerCase();
  return (
    /(?:^|\/)(tests?|__tests?__|spec)\//.test(lp) ||
    /_test\.go$/.test(lp) ||
    /(?:^|\/)test_[^/]+\.py$/.test(lp) ||
    /_test\.py$/.test(lp) ||
    /_spec\.rb$/.test(lp) ||
    /_test\.rb$/.test(lp) ||
    /\.(test|spec)\.[jt]sx?$/.test(lp) ||
    /(test|spec|tests)\.(java|kt|scala)$/.test(lp) ||
    /(tests?|spec)\.cs$/.test(lp) ||
    /tests?\.swift$/.test(lp) ||
    /_test\.dart$/.test(lp) ||
    isGeneratedFileFromDetection(filePath)
  );
}

// =============================================================================
// Близость путей
// =============================================================================

/** Вычисляет близость путей когда первый путь уже разбит на сегменты директорий. */
export function pathProximityFromDirs(dir1: string[], filePath2: string): number {
  const dir2 = filePath2.split('/');
  dir2.pop();
  let shared = 0;
  const limit = Math.min(dir1.length, dir2.length);
  for (let i = 0; i < limit; i++) {
    if (dir1[i] === dir2[i]) shared++;
    else break;
  }
  return Math.min(shared * 15, 80);
}

/** Вычисляет близость двух путей: общее количество общих сегментов. */
export function computePathProximity(pathA: string, pathB: string): number {
  const dirA = pathA.split('/');
  dirA.pop();
  return pathProximityFromDirs(dirA, pathB);
}

/** Разделяет camelCase/PascalCase строку на слова. */
export function splitCamelCase(str: string): string[] {
  return str.replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s._:\/\\]+/)
    .filter(w => w.length > 1);
}

/** Находит лучший кандидат среди узлов для неразрешённой ссылки. */
export function findBestMatch(
  ref: IUnresolvedReference,
  candidates: INode[],
  _context: IResolutionContext
): INode | null {
  let bestScore = -1;
  let bestNode: INode | null = null;

  const refDirs = (ref.filePath ?? '').split('/');
  refDirs.pop();

  const hasSameLanguage = candidates.some((c) => c.language === ref.language);

  for (const candidate of candidates) {
    if (hasSameLanguage && candidate.language !== ref.language) continue;

    let score = 0;

    if (candidate.filePath === ref.filePath) score += 100;
    score += pathProximityFromDirs(refDirs, candidate.filePath);

    if (candidate.language === ref.language) score += 50;
    else score -= 80;

    if (ref.referenceKind === 'calls' && (candidate.kind === 'function' || candidate.kind === 'method')) score += 25;
    if (ref.referenceKind === 'instantiates' && (candidate.kind === 'class' || candidate.kind === 'struct' || candidate.kind === 'interface')) score += 25;
    if (ref.referenceKind === 'decorates') {
      if (candidate.kind === 'function' || candidate.kind === 'method') score += 25;
      else if (candidate.kind === 'class' || candidate.kind === 'interface') score += 15;
    }

    if (candidate.isExported) score += 10;

    if (candidate.filePath === ref.filePath && candidate.startLine) {
      const distance = Math.abs(candidate.startLine - ref.line);
      score += Math.max(0, 20 - distance / 10);
    }

    if (score > bestScore) {
      bestScore = score;
      bestNode = candidate;
    }
  }

  return bestNode;
}

// =============================================================================
// Парсер запросов
// =============================================================================

/** Полный парсер запросов с токенизацией, поддержкой кавычек, валидацией полей. */
export function parseQuery(raw: string): ParsedQuery {
  const result: ParsedQuery = {
    text: '',
    kinds: [],
    languages: [],
    pathFilters: [],
    nameFilters: [],
  };

  const validKinds = new Set([
    'file', 'class', 'function', 'method', 'property', 'field',
    'interface', 'struct', 'enum', 'type_alias', 'constant', 'variable',
    'namespace', 'module', 'route', 'trait', 'protocol', 'enum_member',
    'parameter', 'import', 'export', 'component',
  ]);

  const tokens: string[] = [];
  let i = 0;

  while (i < raw.length) {
    // Пропускаем пробелы
    if (raw[i] === ' ') {
      i++;
      continue;
    }

    // Кавычки
    if (raw[i] === '"') {
      let end = raw.indexOf('"', i + 1);
      if (end === -1) end = raw.length - 1;
      tokens.push(raw.slice(i + 1, end));
      i = end + 1;
      continue;
    }

    // Поле:значение — только для известных полей
    const colonPos = raw.indexOf(':', i);
    if (colonPos !== -1 && colonPos > i) {
      const field = raw.slice(i, colonPos).toLowerCase();
      const knownFields = new Set(['kind', 'lang', 'language', 'path', 'name']);

      if (knownFields.has(field)) {
        let valueStart = colonPos + 1;
        while (valueStart < raw.length && raw[valueStart] === ' ') valueStart++;

        // Если после двоеточия (и пробелов) снова пробел или конец строки — пустое значение
        if (valueStart >= raw.length || raw[valueStart] === ' ') {
          i = valueStart;
          continue;
        }

        let valueEnd = valueStart;
        if (raw[valueStart] === '"') {
          valueEnd = raw.indexOf('"', valueStart + 1);
          if (valueEnd === -1) valueEnd = raw.length - 1;
          else valueEnd++;
        } else {
          while (valueEnd < raw.length && raw[valueEnd] !== ' ') valueEnd++;
        }

        let value = raw.slice(valueStart, valueEnd).trim();
        // Убираем кавычки
        if (value.startsWith('"') && value.endsWith('"')) {
          value = value.slice(1, -1);
        }

        if (value) {
          let added = false;
          switch (field) {
            case 'kind':
              for (const k of value.split(',')) {
                const trimmed = k.trim();
                if (validKinds.has(trimmed)) {
                  result.kinds.push(trimmed as NodeKind);
                  added = true;
                }
              }
              break;
            case 'lang':
            case 'language':
              for (const l of value.split(',')) {
                const trimmed = l.trim();
                if (trimmed) {
                  result.languages.push(trimmed);
                  added = true;
                }
              }
              break;
            case 'path':
              result.pathFilters.push(value);
              added = true;
              break;
            case 'name':
              result.nameFilters.push(value);
              added = true;
              break;
          }
          // Если значение не было добавлено (невалидный kind и т.д.), добавляем как свободный текст
          if (!added) {
            tokens.push(value);
          }
        }

        i = valueEnd;
        continue;
      }
    }

    // Обычный токен
    let end = i;
    while (end < raw.length && raw[end] !== ' ') end++;
    const token = raw.slice(i, end);
    if (token) tokens.push(token);
    i = end;
  }

  result.text = tokens.join(' ');
  return result;
}

// =============================================================================
// Классификаторы файлов
// =============================================================================

/** Комплексное определение тестовых файлов. */
export function isTestFile(filePath: string): boolean {
  const lp = filePath.toLowerCase();

  // По именам файлов
  if (/(?:^|\/)(?:test|spec|tests?)\./.test(lp)) return true;
  if (/\.(?:test|spec)\.[jt]sx?$/.test(lp)) return true;
  if (/_test\.(?:go|py|rb|dart)$/.test(lp)) return true;
  if (/_spec\.rb$/.test(lp)) return true;
  if (/(?:test|spec|tests?)\.(?:java|kt|scala|cs)$/.test(lp)) return true;
  if (/tests?\.(?:swift)$/.test(lp)) return true;
  if (/test_[^/]+\.(?:py|go)$/.test(lp)) return true;

  // По директориям
  if (/(?:^|\/)(?:tests?|__tests?__|spec|specs|test|testing)\//.test(lp)) return true;

  // Не-продуктовые директории
  if (/(?:^|\/)(?:\.github|\.gitlab|\.circleci|\.travis|\.ci)\//.test(lp)) return true;

  return false;
}

/** Проверяет наличие подчеркивания, цифры или внутреннего заглавного символа. */
export function isDistinctiveIdentifier(token: string): boolean {
  if (token.includes('_')) return true;
  if (/\d/.test(token)) return true;
  // Внутренний заглавный символ (camelCase с заглавной буквой не в начале)
  if (token.length > 1 && /[A-Z]/.test(token.slice(1))) return true;
  return false;
}

/** Определяет узлы-константы YAML/properties. */
export function isConfigLeafNode(node: INode): boolean {
  return (
    node.kind === 'constant' &&
    CONFIG_LEAF_LANGUAGES.has(node.language)
  );
}

// =============================================================================
// Безопасность путей
// =============================================================================

/** Нечувствительный к регистру на Windows. */
export function isWithinDir(child: string, parent: string): boolean {
  const fs = require('fs');
  const path = require('path');
  const isWin = process.platform === 'win32';

  let resolvedChild = child;
  let resolvedParent = parent;

  // Пытаемся использовать realpath для надёжности
  try {
    if (fs.existsSync(child)) resolvedChild = fs.realpathSync(child);
  } catch {
    // Игнорируем
  }
  try {
    if (fs.existsSync(parent)) resolvedParent = fs.realpathSync(parent);
  } catch {
    // Игнорируем
  }

  const normalizedChild = resolvedChild.replace(/\\/g, '/');
  const normalizedParent = resolvedParent.replace(/\\/g, '/');

  if (isWin) {
    return normalizedChild.toLowerCase().startsWith(normalizedParent.toLowerCase() + '/');
  }

  return normalizedChild.startsWith(normalizedParent + '/');
}

/** Лексическая + realpath проверка вложенности. */
export function validatePathWithinRoot(
  projectRoot: string,
  filePath: string,
  _options?: unknown
): boolean {
  // Сначала лексическая проверка
  const normalizedRoot = normalizePath(projectRoot);
  const normalizedPath = normalizePath(filePath);

  if (!normalizedPath.startsWith(normalizedRoot + '/')) {
    return false;
  }

  // Затем realpath проверка
  return isWithinDir(filePath, projectRoot);
}

/** Отклоняет чувствительные системные директории. */
export function validateProjectPath(dirPath: string): string | null {
  const normalized = normalizePath(dirPath);
  for (const sensitive of SENSITIVE_PATHS) {
    const s = normalizePath(sensitive);
    if (normalized.startsWith(s)) {
      return `Путь "${dirPath}" находится в системной директории "${sensitive}"`;
    }
  }
  return null;
}

// =============================================================================
// Пути
// =============================================================================

/** Нормализация с прямым слэшем. */
export function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/\/+/g, '/');
}

/** Формирует путь к БД по умолчанию. */
export function getDatabasePath(projectRoot: string): string {
  const path = require('path');
  return path.join(projectRoot, DATABASE_FILENAME);
}

// =============================================================================
// Числовые утилиты
// =============================================================================

/** Числовое ограничение. */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// =============================================================================
// Сегменты идентификаторов
// =============================================================================

const MIN_SEGMENT_CHARS = 2;
const MAX_SEGMENT_CHARS = 32;
const MAX_SEGMENTS_PER_NAME = 12;

/**
 * Разбивает имя символа на нижнерегистровые сегменты-слова.
 *
 * Обрабатывает camelCase / PascalCase (внутренний lower→Upper),
 * аббревиатуры ("HTMLParser" → html/parser), snake_case / kebab-case
 * (небуквенные символы разделяют), и оставляет цифры приклеенными
 * к слову ("base64Encode" → base64/encode).
 */
export function splitIdentifierSegments(name: string): string[] {
  if (!name) return [];
  const out = new Set<string>();
  for (const run of name.match(/[\p{L}\p{N}]+/gu) ?? []) {
    const parts = run.split(/(?<=[\p{Ll}\p{N}])(?=\p{Lu})|(?<=\p{Lu})(?=\p{Lu}\p{Ll})/u);
    for (const part of parts) {
      if (out.size >= MAX_SEGMENTS_PER_NAME) return [...out];
      const seg = part.toLowerCase();
      if (seg.length < MIN_SEGMENT_CHARS || seg.length > MAX_SEGMENT_CHARS) continue;
      if (/^\p{N}+$/u.test(seg)) continue;
      out.add(seg);
    }
  }
  return [...out];
}

/**
 * Нормализует слово прозы для поиска сегментов: нижний регистр + удаление диакритики.
 */
export function normalizeProseWord(word: string): string {
  return word.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
}

const MAX_PROSE_CANDIDATES = 16;
const MIN_PROSE_CHARS = 4;
const MAX_PROSE_CHARS = 24;

const ENGLISH_PROSE_STOPWORDS = new Set([
  'about', 'above', 'actually', 'after', 'again', 'against', 'almost', 'along', 'also', 'always',
  'another', 'anything', 'around', 'away', 'back', 'because', 'been', 'before', 'behind', 'being',
  'below', 'best', 'better', 'between', 'both', 'cannot', 'come', 'could', 'does', 'doing', 'done',
  'down', 'each', 'either', 'else', 'even', 'ever', 'every', 'everything', 'fine', 'first', 'from',
  'getting', 'give', 'goes', 'going', 'gone', 'good', 'great', 'have', 'having', 'help', 'here',
  'inside', 'instead', 'into', 'just', 'keep', 'know', 'last', 'least', 'less', 'like', 'likely',
  'little', 'look', 'looking', 'made', 'make', 'making', 'many', 'maybe', 'mind', 'more', 'most',
  'much', 'must', 'need', 'needs', 'never', 'next', 'nice', 'none', 'nothing', 'okay', 'only',
  'onto', 'other', 'otherwise', 'over', 'please', 'pretty', 'probably', 'quite', 'rather', 'really',
  'right', 'same', 'seem', 'seems', 'should', 'show', 'since', 'some', 'someone', 'something',
  'somewhere', 'soon', 'still', 'such', 'sure', 'take', 'than', 'thank', 'thanks', 'that', 'their',
  'them', 'then', 'there', 'these', 'they', 'thing', 'things', 'think', 'this', 'those', 'though',
  'tried', 'tries', 'trying', 'under', 'until', 'upon', 'very', 'want', 'wants', 'well', 'went',
  'were', 'what', 'when', 'which', 'while', 'will', 'wish', 'with', 'within', 'without', 'would',
  'wrong', 'your', 'yours',
  'again', 'change', 'changes', 'check', 'class', 'classes', 'code', 'detail', 'details',
  'directory', 'error', 'errors', 'example', 'examples', 'file', 'files', 'folder', 'function',
  'functions', 'issue', 'issues', 'line', 'lines', 'method', 'methods', 'name', 'names', 'problem',
  'problems', 'project', 'question', 'questions', 'rename', 'test', 'tests', 'type', 'types',
  'update', 'value', 'values', 'warning', 'warnings', 'work', 'working', 'write', 'writing',
]);

/**
 * Извлекает кандидаты из прозы для поиска в словаре сегментов.
 */
export function extractProseCandidates(prompt: string): string[] {
  if (!prompt) return [];
  const seen = new Set<string>();
  for (const run of prompt.match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (seen.size >= MAX_PROSE_CANDIDATES) break;
    if (run.length > MAX_PROSE_CHARS) continue;
    const w = normalizeProseWord(run);
    if (w.length < MIN_PROSE_CHARS || w.length > MAX_PROSE_CHARS) continue;
    if (/^\p{N}+$/u.test(w)) continue;
    if (ENGLISH_PROSE_STOPWORDS.has(w)) continue;
    seen.add(w);
  }
  return [...seen];
}

/**
 * Варианты поиска для слова прозы: само слово + фолдинг множественного числа.
 */
export function segmentLookupVariants(word: string): string[] {
  const variants = [word];
  const canStrip2 = word.length >= MIN_PROSE_CHARS + 2;
  const canStrip1 = word.length >= MIN_PROSE_CHARS + 1;
  if (/(?:x|sh|ss|zz)es$/.test(word)) {
    if (canStrip2) variants.push(word.slice(0, -2));
  } else if (/(?:ch|s|z|o)es$/.test(word)) {
    if (canStrip2) variants.push(word.slice(0, -2));
    if (canStrip1) variants.push(word.slice(0, -1));
  } else if (word.endsWith('s') && !word.endsWith('ss')) {
    if (canStrip1) variants.push(word.slice(0, -1));
  }
  return variants;
}

// =============================================================================
// Асинхронные утилиты
// =============================================================================

/** Асинхронная пакетная обработка с GC между батчами. */
export async function processInBatches<T, R>(
  items: T[],
  batchSize: number,
  processor: (batch: T[]) => Promise<R>,
  onBatchComplete?: (index: number, result: R) => void
): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const result = await processor(batch);
    results.push(result);

    if (onBatchComplete) {
      onBatchComplete(Math.floor(i / batchSize), result);
    }

    // GC между батчами
    if (global.gc) {
      global.gc();
    }
  }

  return results;
}

/** Класс асинхронного мьютекса с очередью ожидания. */
export class Mutex {
  private locked = false;
  private waitQueue: Array<() => void> = [];

  /** Приобрести блокировку, возвращает функцию освобождения. */
  async acquire(): Promise<() => void> {
    while (this.locked) {
      await new Promise<void>((resolve) => {
        this.waitQueue.push(resolve);
      });
    }

    this.locked = true;

    return () => {
      this.locked = false;
      const next = this.waitQueue.shift();
      if (next) {
        next();
      }
    };
  }

  /** Выполнить функцию под блокировкой. */
  async withLock<T>(fn: () => Promise<T> | T): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /** Проверка, занята ли блокировка. */
  isLocked(): boolean {
    return this.locked;
  }
}

/** Класс межпроцессной блокировки файлов. */
export class FileLock {
  private fs = require('fs');
  private path = require('path');

  private lockFile: string;
  private held: boolean = false;

  constructor(filePath: string) {
    this.lockFile = `${filePath}.lock`;
  }

  async acquire(): Promise<boolean> {
    try {
      // Атомарное создание с флагом wx
      this.fs.writeFileSync(this.lockFile, String(process.pid), { flag: 'wx' });
      this.held = true;
      return true;
    } catch {
      // Файл уже существует — проверяем живость PID
      try {
        const content = this.fs.readFileSync(this.lockFile, 'utf8').trim();
        const pid = parseInt(content, 10);

        // Проверяем, жив ли процесс
        const isAlive = this.isProcessAlive(pid);

        if (!isAlive || Date.now() - this.fs.statSync(this.lockFile).mtimeMs > FileLock_STALE_TIMEOUT_MS) {
          // Блокировка устарела — удаляем и создаём новую
          this.fs.unlinkSync(this.lockFile);
          this.fs.writeFileSync(this.lockFile, String(process.pid), { flag: 'wx' });
          this.held = true;
          return true;
        }
      } catch {
        // Ошибка чтения — пробуем создать заново
        try {
          this.fs.writeFileSync(this.lockFile, String(process.pid), { flag: 'wx' });
          this.held = true;
          return true;
        } catch {
          return false;
        }
      }

      return false;
    }
  }

  release(): void {
    if (!this.held) return;
    try {
      this.fs.unlinkSync(this.lockFile);
    } catch {
      // Игнорируем ошибки удаления
    }
    this.held = false;
  }

  private isProcessAlive(pid: number): boolean {
    try {
      // На Windows KillProcess с signal 0 проверяет существование
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
}

/** Генератор постраничного чтения файлов. */
export async function* readFileInChunks(
  filePath: string,
  chunkSize: number = 64 * 1024
): AsyncGenerator<string> {
  const fs = require('fs');
  const fd = fs.openSync(filePath, 'r');
  try {
    let offset = 0;
    const buf = Buffer.alloc(chunkSize);
    let bytesRead;

    while ((bytesRead = fs.readSync(fd, buf, 0, chunkSize, offset)) > 0) {
      yield buf.slice(0, bytesRead).toString('utf8');
      offset += bytesRead;
    }
  } finally {
    fs.closeSync(fd);
  }
}

/** Дебаунсинг функций. */
export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/** Троттлинг функций. */
export function throttle<T extends (...args: unknown[]) => void>(
  fn: T,
  interval: number
): (...args: Parameters<T>) => void {
  let lastCall = 0;
  return (...args: Parameters<T>) => {
    const now = Date.now();
    if (now - lastCall >= interval) {
      lastCall = now;
      fn(...args);
    }
  };
}

// =============================================================================
// Память
// =============================================================================

/** Приблизительная оценка размера объекта в памяти. */
export function estimateSize(obj: unknown): number {
  const seen = new WeakSet();
  let bytes = 0;

  const walk = (value: unknown): void => {
    if (value === null || value === undefined) return;

    if (typeof value === 'string') {
      bytes += value.length * 2; // UTF-16
      return;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      bytes += 8;
      return;
    }

    if (typeof value !== 'object') return;

    if (seen.has(value)) return;
    seen.add(value);

    if (Array.isArray(value)) {
      bytes += 16; // overhead массива
      for (const item of value) walk(item);
    } else {
      bytes += 32; // overhead объекта
      for (const key of Object.keys(value as Record<string, unknown>)) {
        bytes += key.length * 2; // ключ
        walk((value as Record<string, unknown>)[key]);
      }
    }
  };

  walk(obj);
  return bytes;
}

/** Класс мониторинга использования памяти. */
export class MemoryMonitor {
  private thresholdBytes: number;
  private onThreshold: () => void;
  private checked: boolean = false;

  constructor(thresholdBytes: number, onThreshold: () => void) {
    this.thresholdBytes = thresholdBytes;
    this.onThreshold = onThreshold;
  }

  check(): void {
    if (this.checked) return;
    const mem = process.memoryUsage();
    if (mem.heapUsed > this.thresholdBytes) {
      this.checked = true;
      this.onThreshold();
    }
  }

  reset(): void {
    this.checked = false;
  }
}
