/**
 * Разрешение ссылок через импорты.
 *
 * resolveViaImport, resolveJvmImport, extractImportMappings,
 * extractReExports, loadCppIncludeDirs, isPhpIncludePathRef,
 * resolveCobolCopybook, resolveLuaRequire, resolveImportPath,
 * FileExportIndex, isCobolCopybookRef.
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  IUnresolvedReference,
  IResolvedRef,
  IResolutionContext,
  IImportMapping,
  IReExport,
  INode,
  NodeKind,
  Language,
} from '../ntgraph/Types';
import { loadProjectAliases } from '../extraction/PathAliases';
import type { AliasMap } from '../extraction/PathAliases';

// =============================================================================
 // Порядок расширений для разрешения импортов
// =============================================================================

/** Порядок расширений для разрешения импортов по языку. */
const EXTENSION_RESOLUTION: Record<string, string[]> = {
  typescript: ['.ts', '.tsx', '.d.ts', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js'],
  javascript: ['.js', '.jsx', '.mjs', '.cjs', '/index.js', '/index.jsx'],
  tsx: ['.tsx', '.ts', '.d.ts', '.js', '.jsx', '/index.tsx', '/index.ts', '/index.js'],
  jsx: ['.jsx', '.js', '/index.jsx', '/index.js'],
  python: ['.py', '/__init__.py'],
  go: ['.go'],
  rust: ['.rs', '/mod.rs'],
  java: ['.java'],
  c: ['.h', '.c'],
  cpp: ['.h', '.hpp', '.hxx', '.cpp', '.cc', '.cxx'],
  csharp: ['.cs'],
  php: ['.php'],
  ruby: ['.rb'],
  lua: ['.lua', '/init.lua'],
  luau: ['.luau', '/init.luau'],
  cobol: ['.cpy', '.cbl', '.cob', '.cobol'],
};

// =============================================================================
// Кэши WeakMap для мемоизации
// =============================================================================

/** Мемоизация путей импорта: ключ → результат разрешения. */
const importPathMemos = new WeakMap<IResolutionContext, Map<string, string | null>>();

/** Мемоизация поиска экспортируемых символов. */
const exportedSymbolMemos = new WeakMap<IResolutionContext, Map<string, INode | undefined>>();

/** Пер-файловый индекс экспортов для быстрого поиска. */
interface FileExportIndex {
  /** Экспортируемые узлы по имени (первый победитель). */
  byName: Map<string, INode>;
  /** Экспортируемый компонент по умолчанию. */
  defaultComponent: INode | undefined;
  /** Экспортируемая функция/класс по умолчанию. */
  defaultFnClass: INode | undefined;
}

/** Индексы экспортов файлов по контексту. */
const fileExportIndexes = new WeakMap<IResolutionContext, Map<string, FileExportIndex>>();

/** Индекс копов COBOL: стем → пути файлов. */
const cobolCopybookIndexes = new WeakMap<IResolutionContext, Map<string, string[]>>();

/** Индекс файлов Lua по базовым именам. */
const luaFileBasenameIndexes = new WeakMap<IResolutionContext, Map<string, string[]>>();

// =============================================================================
// Кэш директорий include C/C++
// =============================================================================

/** Кэш директорий include C/C++ по корню проекта. */
const cppIncludeDirCache = new Map<string, string[]>();

// =============================================================================
// Утилиты очистки кэшей
// =============================================================================

/**
 * Очистка всех мемо-таблиц резолвера импортов.
 * Вызывается между запусками индексации.
 */
export function clearImportResolverMemos(context: IResolutionContext): void {
  importPathMemos.delete(context);
  exportedSymbolMemos.delete(context);
  fileExportIndexes.delete(context);
  luaFileBasenameIndexes.delete(context);
  cobolCopybookIndexes.delete(context);
}

/**
 * Очистка кэша директорий include C/C++.
 * Вызывается между запусками индексации.
 */
export function clearCppIncludeDirCache(): void {
  cppIncludeDirCache.clear();
}

// =============================================================================
// FileExportIndex — per-file индекс экспортов
// =============================================================================

/**
 * Получение индекса экспортов для файла.
 * Строится лениво и кэшируется в WeakMap.
 */
export function getFileExportIndex(
  filePath: string,
  context: IResolutionContext
): FileExportIndex {
  let perFile = fileExportIndexes.get(context);
  if (!perFile) {
    perFile = new Map();
    fileExportIndexes.set(context, perFile);
  }
  let idx = perFile.get(filePath);
  if (!idx) {
    idx = { byName: new Map(), defaultComponent: undefined, defaultFnClass: undefined };
    for (const n of context.getNodesByFile(filePath)) {
      if (n.isExported !== true) continue;
      if (!idx.byName.has(n.name)) {
        idx.byName.set(n.name, n);
      }
      if (idx.defaultComponent === undefined && n.kind === 'component') {
        idx.defaultComponent = n;
      }
      if (idx.defaultFnClass === undefined && (n.kind === 'function' || n.kind === 'class')) {
        idx.defaultFnClass = n;
      }
    }
    perFile.set(filePath, idx);
  }
  return idx;
}

// =============================================================================
// resolveViaImport
// =============================================================================

/**
 * Разрешение ссылки через import-карты файла.
 *
 * Ищет импорт, который сопоставляет имя ссылки с модулем, затем ищет
 * определение в целевом модуле.
 */
export function resolveViaImport(
  ref: IUnresolvedReference,
  context: IResolutionContext
): IResolvedRef | null {
  if (!ref.filePath) return null;

  // COBOL COPY / EXEC SQL INCLUDE — разрешение копов к файлам
  if (isCobolCopybookRef(ref)) {
    const resolvedPath = resolveImportPath(ref.referenceName, ref.filePath, 'cobol', context);
    if (!resolvedPath) return null;
    const basename = resolvedPath.split('/').pop()!;
    const fileNode = context
      .getNodesByName(basename)
      .find((n) => n.kind === 'file' && n.filePath === resolvedPath);
    if (fileNode) {
      return {
        original: ref,
        targetNodeId: fileNode.id,
        confidence: 0.9,
        provenance: 'import-cobol-copybook',
      };
    }
    return null;
  }

  // Lua / Luau require — разрешение модуля к файлу
  if ((ref.language === 'lua' || ref.language === 'luau') && ref.referenceKind === 'imports') {
    const luaResult = resolveLuaRequire(ref, context);
    if (luaResult) return luaResult;
  }

  // C/C++ #include — разрешение к файлу напрямую
  if ((ref.language === 'c' || ref.language === 'cpp') && ref.referenceKind === 'imports') {
    return resolveCIncludeImport(ref, context);
  }

  // PHP include/require — разрешение пути к файлу
  if (isPhpIncludePathRef(ref)) {
    return resolvePhpIncludeImport(ref, context);
  }

  const mappings = context.getImportMappings(ref.filePath);
  if (!mappings.length) return null;

  // Ищем импорт, который сопоставляет имя ссылки
  for (const mapping of mappings) {
    if (mapping.localName === ref.referenceName || mapping.exportedName === ref.referenceName) {
      // Ищем определение в целевом модуле
      const resolvedPath = resolveImportPath(mapping.source, ref.filePath, ref.language ?? 'typescript', context);
      if (resolvedPath) {
        const targetNode = findExportedSymbol(
          resolvedPath,
          {
            isDefault: mapping.isDefault,
            isNamespace: mapping.isNamespace,
            exportedName: mapping.exportedName,
            memberName: ref.referenceName.startsWith(mapping.localName + '.')
              ? ref.referenceName.slice(mapping.localName.length + 1).split('.')[0]
              : null,
          },
          ref.language ?? 'typescript',
          context,
          new Set()
        );
        if (targetNode) {
          return {
            original: ref,
            targetNodeId: targetNode.id,
            confidence: 0.9,
            provenance: 'import-mapping',
          };
        }
      }

      // Ищем по qualifiedName
      const qName = `${mapping.source}.${mapping.exportedName}`;
      const qNodes = context.getNodesByQualifiedName(qName);
      if (qNodes.length > 0) {
        return {
          original: ref,
          targetNodeId: qNodes[0]!.id,
          confidence: 0.9,
          provenance: 'import-qualified',
        };
      }
    }
  }

  // Проверяем реэкспорт
  const reExports = context.getReExports?.(ref.filePath) ?? [];
  for (const reExport of reExports) {
    if (reExport.kind === 'named' && reExport.exportedName === ref.referenceName) {
      const sourceNodes = context.getNodesByFile(reExport.source);
      for (const node of sourceNodes) {
        if (node.name === reExport.originalName) {
          return {
            original: ref,
            targetNodeId: node.id,
            confidence: 0.85,
            provenance: 're-export',
          };
        }
      }
    }
  }

  return null;
}

// =============================================================================
// resolveImportPath — с мемоизацией
// =============================================================================

/**
 * Разрешение пути импорта к реальному файлу.
 * Результат кэшируется в WeakMap по контексту.
 */
export function resolveImportPath(
  importPath: string,
  fromFile: string,
  language: string,
  context: IResolutionContext
): string | null {
  let memo = importPathMemos.get(context);
  if (!memo) {
    memo = new Map();
    importPathMemos.set(context, memo);
  }
  const key = `${language}\0${fromFile}\0${importPath}`;
  const hit = memo.get(key);
  if (hit !== undefined || memo.has(key)) return hit ?? null;
  const resolved = resolveImportPathUncached(importPath, fromFile, language, context);
  memo.set(key, resolved);
  return resolved;
}

/**
 * Неразмемоизированное разрешение пути импорта.
 */
function resolveImportPathUncached(
  importPath: string,
  fromFile: string,
  language: string,
  context: IResolutionContext
): string | null {
  // COBOL COPY — разрешение по базовому имени
  if (language === 'cobol') {
    return resolveCobolCopybook(importPath, fromFile, context);
  }

  // Lua require — разрешение по базовому имени
  if (language === 'lua' || language === 'luau') {
    return resolveLuaRequirePath(importPath, fromFile, context);
  }

  // Пропускаем внешние пакеты
  if (isExternalImport(importPath, language, context)) {
    return null;
  }

  // Относительные импорты
  if (importPath.startsWith('.')) {
    return resolveRelativeImport(importPath, fromFile, language, context);
  }

  // C/C++ include directory search
  if (language === 'c' || language === 'cpp') {
    return resolveCppIncludePath(importPath, language, context);
  }

  return null;
}

/**
 * Разрешение относительного импорта с перебором расширений.
 */
function resolveRelativeImport(
  importPath: string,
  fromFile: string,
  language: string,
  context: IResolutionContext
): string | null {
  const extensions = EXTENSION_RESOLUTION[language] || [];

  // Python dotted-relative: from .certs import x
  if (language === 'python' && importPath.startsWith('.')) {
    const dots = importPath.length - importPath.replace(/^\.+/, '').length;
    const up = '../'.repeat(Math.max(0, dots - 1));
    const rest = importPath.slice(dots).replace(/\./g, '/');
    const fromDir = fromFile.split('/').slice(0, -1).join('/');
    const pyBase = normalizePath(up + rest, fromDir);
    for (const ext of extensions) {
      if (fileExists(context, pyBase + ext)) return pyBase + ext;
    }
    if (fileExists(context, pyBase)) return pyBase;
    return null;
  }

  const fromDir = fromFile.split('/').slice(0, -1).join('/');
  const basePath = normalizePath(importPath, fromDir);

  // Пробуем каждое расширение
  for (const ext of extensions) {
    const candidate = basePath + ext;
    if (fileExists(context, candidate)) return candidate;
  }

  // Пробуем без расширения
  if (fileExists(context, basePath)) return basePath;

  return null;
}

/**
 * Проверка существования файла через контекст.
 */
function fileExists(context: IResolutionContext, filePath: string): boolean {
  // Пытаемся найти file-узел
  const basename = filePath.split('/').pop()!;
  const nodes = context.getNodesByName(basename);
  return nodes.some((n) => n.kind === 'file' && n.filePath === filePath);
}

/**
 * Нормализация относительного пути.
 */
function normalizePath(rel: string, base: string): string {
  const parts = (base ? [base, rel] : [rel]).join('/').split('/');
  const result: string[] = [];
  for (const part of parts) {
    if (part === '..') {
      result.pop();
    } else if (part !== '.' && part !== '') {
      result.push(part);
    }
  }
  return result.join('/');
}

/**
 * Проверка, является ли импорт внешним (npm-пакет и т.д.).
 */
function isExternalImport(
  importPath: string,
  language: string,
  context?: IResolutionContext
): boolean {
  if (importPath.startsWith('.')) return false;

  // C/C++ стандартные заголовки
  if (language === 'c' || language === 'cpp') {
    if (C_CPP_STDLIB_HEADERS.has(importPath)) return true;
    const withoutExt = importPath.replace(/\.h$/, '');
    if (C_CPP_STDLIB_HEADERS.has(withoutExt)) return true;
  }

  // JS/TS внешние пакеты
  if (['typescript', 'javascript', 'tsx', 'jsx'].includes(language)) {
    if (['fs', 'path', 'os', 'crypto', 'http', 'https', 'url', 'util', 'events', 'stream', 'child_process', 'buffer'].includes(importPath)) {
      return true;
    }
    // Алиасы проекта — локальные
    if (importPath.startsWith('@/')) return false;
    if (importPath.startsWith('~/')) return false;
    if (importPath.startsWith('src/')) return false;
    // Проверяем алиасы проекта
    const aliases = context?.getProjectAliases?.();
    if (aliases) {
      for (const alias of Object.keys(aliases)) {
        if (importPath.startsWith(alias.replace('*', ''))) return false;
      }
    }
    // Скорее всего npm-пакет
    return true;
  }

  // Python стандартная библиотека
  if (language === 'python') {
    const stdLibs = ['os', 'sys', 'json', 're', 'math', 'datetime', 'collections', 'typing', 'pathlib', 'logging'];
    if (stdLibs.includes(importPath.split('.')[0]!)) {
      return true;
    }
  }

  return false;
}

// =============================================================================
// COBOL copybook resolution
// =============================================================================

/**
 * Разрешение COBOL copybook: COPY CVACT01Y (или EXEC SQL INCLUDE X) —
 * имя члена библиотеки, которое компилятор ищет по пути поиска copybook.
 * Сопоставляем с базовыми именами файлов без учёта регистра.
 */
export function resolveCobolCopybook(
  member: string,
  fromFile: string,
  context: IResolutionContext
): string | null {
  let index = cobolCopybookIndexes.get(context);
  if (!index) {
    index = new Map();
    for (const fileNode of context.getNodesByKind('file')) {
      const normalized = fileNode.filePath.replace(/\\/g, '/');
      const base = normalized.split('/').pop() ?? '';
      const dot = base.lastIndexOf('.');
      const stem = (dot > 0 ? base.slice(0, dot) : base).toLowerCase();
      const existing = index.get(stem);
      if (existing) {
        existing.push(fileNode.filePath);
      } else {
        index.set(stem, [fileNode.filePath]);
      }
    }
    cobolCopybookIndexes.set(context, index);
  }

  const candidates = index.get(member.toLowerCase());
  if (!candidates || candidates.length === 0) return null;

  const fromDir = fromFile.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
  let best: string | null = null;
  let bestScore = -1;
  for (const candidate of candidates) {
    const normalized = candidate.replace(/\\/g, '/');
    const ext = normalized.slice(normalized.lastIndexOf('.')).toLowerCase();
    let score = 0;
    if (ext === '.cpy') score += 4;
    else if (ext === '.cbl' || ext === '.cob' || ext === '.cobol') score += 2;
    if (normalized.split('/').slice(0, -1).join('/') === fromDir) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

/**
 * Проверка, является ли ссылка COBOL COPY / EXEC SQL INCLUDE.
 */
export function isCobolCopybookRef(ref: IUnresolvedReference): boolean {
  return (ref.language as string) === 'cobol' && ref.referenceKind === 'imports';
}

// =============================================================================
// Lua require resolution
// =============================================================================

/**
 * Построение индекса файлов Lua по базовым именам.
 * Строится один раз на контекст разрешения.
 */
function luaBasenameIndex(context: IResolutionContext): Map<string, string[]> {
  let index = luaFileBasenameIndexes.get(context);
  if (!index) {
    index = new Map();
    for (const f of context.getAllFiles()) {
      const base = f.split('/').pop() ?? '';
      const existing = index.get(base);
      if (existing) {
        existing.push(f);
      } else {
        index.set(base, [f]);
      }
    }
    luaFileBasenameIndexes.set(context, index);
  }
  return index;
}

/**
 * Разрешение Lua require к файлу модуля.
 * Имя — это либо точечный путь модуля (a.b.c → a/b/c.lua),
 * либо лист instance-пути (Signal от require(script.Parent.Signal) → Signal.luau).
 */
export function resolveLuaRequire(
  ref: IUnresolvedReference,
  context: IResolutionContext
): IResolvedRef | null {
  const name = ref.referenceName;
  if (!name) return null;
  const base = name.includes('.') ? name.replace(/\./g, '/') : name;
  const suffixes = [
    `${base}.lua`,
    `${base}.luau`,
    `${base}/init.lua`,
    `${base}/init.luau`,
  ];
  const byBasename = luaBasenameIndex(context);
  const sharedPrefix = (a: string, b: string): number => {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return i;
  };
  for (const suffix of suffixes) {
    const candidates = byBasename.get(suffix.split('/').pop() ?? '') ?? [];
    const matches = candidates.filter((f) => f === suffix || f.endsWith('/' + suffix));
    if (matches.length === 0) continue;
    matches.sort((x, y) => sharedPrefix(y, ref.filePath!) - sharedPrefix(x, ref.filePath!));
    const best = matches[0]!;
    if (best === ref.filePath) continue;
    const fileNode = context.getNodesByFile(best).find((n) => n.kind === 'file');
    if (fileNode) {
      return {
        original: ref,
        targetNodeId: fileNode.id,
        confidence: 0.9,
        provenance: 'lua-require',
      };
    }
  }
  return null;
}

/**
 * Разрешение пути Lua require (без ссылки, только путь).
 */
function resolveLuaRequirePath(
  importPath: string,
  fromFile: string,
  context: IResolutionContext
): string | null {
  const base = importPath.includes('.') ? importPath.replace(/\./g, '/') : importPath;
  const suffixes = [
    `${base}.lua`,
    `${base}.luau`,
    `${base}/init.lua`,
    `${base}/init.luau`,
  ];
  const byBasename = luaBasenameIndex(context);
  for (const suffix of suffixes) {
    const candidates = byBasename.get(suffix.split('/').pop() ?? '') ?? [];
    const matches = candidates.filter((f) => f === suffix || f.endsWith('/' + suffix));
    if (matches.length === 0) continue;
    const sharedPrefix = (a: string, b: string): number => {
      let i = 0;
      while (i < a.length && i < b.length && a[i] === b[i]) i++;
      return i;
    };
    matches.sort((x, y) => sharedPrefix(y, fromFile) - sharedPrefix(x, fromFile));
    const best = matches[0]!;
    if (best === fromFile) continue;
    return best;
  }
  return null;
}

// =============================================================================
// C/C++ include directory search
// =============================================================================

/** Стандартные заголовки C/C++ (без разделителей). */
const C_CPP_STDLIB_HEADERS = new Set([
  // C стандартная библиотека
  'assert.h', 'complex.h', 'ctype.h', 'errno.h', 'fenv.h', 'float.h',
  'inttypes.h', 'iso646.h', 'limits.h', 'locale.h', 'math.h', 'setjmp.h',
  'signal.h', 'stdalign.h', 'stdarg.h', 'stdatomic.h', 'stdbool.h',
  'stddef.h', 'stdint.h', 'stdio.h', 'stdlib.h', 'stdnoreturn.h',
  'string.h', 'tgmath.h', 'threads.h', 'time.h', 'uchar.h', 'wchar.h',
  'wctype.h',
  // C++ обёртки C-библиотеки
  'cassert', 'ccomplex', 'cctype', 'cerrno', 'cfenv', 'cfloat',
  'cinttypes', 'ciso646', 'climits', 'clocale', 'cmath', 'csetjmp',
  'csignal', 'cstdalign', 'cstdarg', 'cstdbool', 'cstddef', 'cstdint',
  'cstdio', 'cstdlib', 'cstring', 'ctgmath', 'ctime', 'cuchar',
  'cwchar', 'cwctype',
  // C++ STL
  'algorithm', 'any', 'array', 'atomic', 'barrier', 'bit', 'bitset',
  'charconv', 'chrono', 'codecvt', 'compare', 'complex', 'concepts',
  'condition_variable', 'coroutine', 'deque', 'exception', 'execution',
  'expected', 'filesystem', 'format', 'forward_list', 'fstream',
  'functional', 'future', 'generator', 'initializer_list', 'iomanip',
  'ios', 'iosfwd', 'iostream', 'istream', 'iterator', 'latch',
  'limits', 'list', 'locale', 'map', 'mdspan', 'memory', 'memory_resource',
  'mutex', 'new', 'numbers', 'numeric', 'optional', 'ostream', 'print',
  'queue', 'random', 'ranges', 'ratio', 'regex', 'scoped_allocator',
  'semaphore', 'set', 'shared_mutex', 'source_location', 'span',
  'spanstream', 'sstream', 'stack', 'stacktrace', 'stdexcept',
  'stdfloat', 'stop_token', 'streambuf', 'string', 'string_view',
  'strstream', 'syncstream', 'system_error', 'thread', 'tuple',
  'type_traits', 'typeindex', 'typeinfo', 'unordered_map',
  'unordered_set', 'utility', 'valarray', 'variant', 'vector',
  'version',
]);

/**
 * Загрузка директорий include из C++ конфигурации.
 *
 * Стратегия:
 * 1. compile_commands.json — разбор -I и -isystem флагов.
 * 2. CMakeLists.txt — include_directories().
 * 3. Makefile — -I флаги.
 * 4. Эвристика — стандартные директории (include/, src/, lib/).
 */
export function loadCppIncludeDirs(projectRoot: string): string[] {
  const cached = cppIncludeDirCache.get(projectRoot);
  if (cached !== undefined) return cached;

  const dirs = loadCppIncludeDirsFromCompileDB(projectRoot)
    || loadCppIncludeDirsFromCMake(projectRoot)
    || loadCppIncludeDirsFromMakefile(projectRoot)
    || loadCppIncludeDirsHeuristic(projectRoot);

  cppIncludeDirCache.set(projectRoot, dirs);
  return dirs;
}

/**
 * Загрузка директорий include из compile_commands.json.
 * Возвращает null, если файл не найден.
 */
function loadCppIncludeDirsFromCompileDB(projectRoot: string): string[] | null {
  const candidates = [
    path.join(projectRoot, 'compile_commands.json'),
    path.join(projectRoot, 'build', 'compile_commands.json'),
    path.join(projectRoot, 'cmake-build-debug', 'compile_commands.json'),
    path.join(projectRoot, 'cmake-build-release', 'compile_commands.json'),
    path.join(projectRoot, 'out', 'compile_commands.json'),
  ];

  let dbPath: string | undefined;
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) {
        dbPath = c;
        break;
      }
    } catch {
      // игнорируем
    }
  }
  if (!dbPath) return null;

  try {
    const content = fs.readFileSync(dbPath, 'utf-8');
    const entries = JSON.parse(content) as Array<{
      directory: string;
      command?: string;
      arguments?: string[];
    }>;
    if (!Array.isArray(entries)) return null;

    const dirSet = new Set<string>();
    for (const entry of entries) {
      const dir = entry.directory || projectRoot;
      const args = entry.arguments || (entry.command ? shlexSplit(entry.command) : []);
      for (let i = 0; i < args.length; i++) {
        const arg = args[i]!;
        let includeDir: string | undefined;
        // -I<dir> (без пробела)
        if (arg.startsWith('-I') && arg.length > 2) {
          includeDir = arg.substring(2);
        }
        // -isystem <dir> (с пробелом)
        else if ((arg === '-isystem' || arg === '-I') && i + 1 < args.length) {
          includeDir = args[i + 1];
          i++;
        }
        if (includeDir) {
          const absPath = path.isAbsolute(includeDir)
            ? includeDir
            : path.resolve(dir, includeDir);
          const relPath = path.relative(projectRoot, absPath).replace(/\\/g, '/');
          // Пропускаем системные директории и пути вне проекта
          if (!relPath.startsWith('..') && relPath.length > 0 && !path.isAbsolute(relPath)) {
            dirSet.add(relPath);
          }
        }
      }
    }
    return Array.from(dirSet);
  } catch {
    return null;
  }
}

/**
 * Загрузка директорий include из CMakeLists.txt.
 */
function loadCppIncludeDirsFromCMake(projectRoot: string): string[] | null {
  const cmakePath = path.join(projectRoot, 'CMakeLists.txt');
  if (!fs.existsSync(cmakePath)) return null;

  try {
    const content = fs.readFileSync(cmakePath, 'utf-8');
    const matches = content.matchAll(/include_directories\s*\(\s*([^)]+)\)/g);
    const dirs: string[] = [];
    for (const match of matches) {
      const paths = match[1].split(/\s+/);
      for (const p of paths) {
        const trimmed = p.trim();
        if (trimmed) {
          const absPath = path.isAbsolute(trimmed) ? trimmed : path.join(projectRoot, trimmed);
          const relPath = path.relative(projectRoot, absPath).replace(/\\/g, '/');
          if (!relPath.startsWith('..') && relPath.length > 0) {
            dirs.push(relPath);
          }
        }
      }
    }
    return dirs;
  } catch {
    return null;
  }
}

/**
 * Загрузка директорий include из Makefile.
 */
function loadCppIncludeDirsFromMakefile(projectRoot: string): string[] | null {
  const makefilePath = path.join(projectRoot, 'Makefile');
  if (!fs.existsSync(makefilePath)) return null;

  try {
    const content = fs.readFileSync(makefilePath, 'utf-8');
    const matches = content.matchAll(/-I(\S+)/g);
    const dirs: string[] = [];
    for (const match of matches) {
      dirs.push(match[1]);
    }
    return dirs;
  } catch {
    return null;
  }
}

/**
 * Минимальный shlex-разбор для строк команд компилятора.
 * Обрабатывает двойные и одинарные кавычки.
 */
function shlexSplit(cmd: string): string[] {
  const result: string[] = [];
  let i = 0;
  while (i < cmd.length) {
    // Пропускаем пробелы
    while (i < cmd.length && /\s/.test(cmd[i]!)) i++;
    if (i >= cmd.length) break;
    const ch = cmd[i]!;
    if (ch === '"') {
      i++;
      let arg = '';
      while (i < cmd.length && cmd[i] !== '"') {
        if (cmd[i] === '\\' && i + 1 < cmd.length) { i++; arg += cmd[i]; }
        else { arg += cmd[i]; }
        i++;
      }
      i++; // закрывающая кавычка
      result.push(arg);
    } else if (ch === "'") {
      i++;
      let arg = '';
      while (i < cmd.length && cmd[i] !== "'") { arg += cmd[i]; i++; }
      i++; // закрывающая кавычка
      result.push(arg);
    } else {
      let arg = '';
      while (i < cmd.length && !/\s/.test(cmd[i]!)) { arg += cmd[i]; i++; }
      result.push(arg);
    }
  }
  return result;
}

/**
 * Эвристическое обнаружение директорий include.
 * Проверяет стандартные директории и сканирует верхнеуровневые
 * директории на наличие .h/.hpp файлов.
 */
function loadCppIncludeDirsHeuristic(projectRoot: string): string[] {
  const dirs: string[] = [];
  const conventionDirs = ['include', 'src', 'lib', 'api', 'inc'];

  try {
    const entries = fs.readdirSync(projectRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      // Стандартные директории
      if (conventionDirs.includes(name.toLowerCase())) {
        dirs.push(name);
        continue;
      }
      // Любая верхнеуровневая директория с .h/.hpp файлами
      try {
        const subFiles = fs.readdirSync(path.join(projectRoot, name));
        if (subFiles.some((f) => /\.(h|hpp|hxx|hh)$/i.test(f))) {
          dirs.push(name);
        }
      } catch {
        // игнорируем ошибки доступа
      }
    }
  } catch {
    // игнорируем
  }

  return dirs;
}

/**
 * Разрешение C/C++ include пути через поиск по директориям include.
 */
function resolveCppIncludePath(
  importPath: string,
  language: string,
  context: IResolutionContext
): string | null {
  const includeDirs = context.getCppIncludeDirs?.() ?? [];
  const extensions = EXTENSION_RESOLUTION[language] ?? [];

  for (const dir of includeDirs) {
    const normalizedDir = dir.replace(/\\/g, '/');
    for (const ext of extensions) {
      const candidate = normalizedDir + '/' + importPath + ext;
      if (fileExists(context, candidate)) return candidate;
    }
    // Пробуем как есть (уже с расширением)
    const candidate = normalizedDir + '/' + importPath;
    if (fileExists(context, candidate)) return candidate;
  }

  return null;
}

/**
 * Разрешение C/C++ #include ссылки к файлу.
 */
function resolveCIncludeImport(
  ref: IUnresolvedReference,
  context: IResolutionContext
): IResolvedRef | null {
  if (!ref.filePath) return null;

  // Сначала ищем в той же директории (для #include "X.h")
  const slash = ref.filePath.lastIndexOf('/');
  const fromDir = slash >= 0 ? ref.filePath.slice(0, slash) : '';
  const siblingPath = fromDir ? `${fromDir}/${ref.referenceName}` : ref.referenceName;
  const siblingBase = siblingPath.split('/').pop()!;
  const sibling = context
    .getNodesByName(siblingBase)
    .find((n) => n.kind === 'file' && n.filePath === siblingPath);
  if (sibling) {
    return {
      original: ref,
      targetNodeId: sibling.id,
      confidence: 0.92,
      provenance: 'c-include-sibling',
    };
  }

  // Ищем через include директории
  const resolvedPath = resolveImportPath(ref.referenceName, ref.filePath, ref.language ?? 'c', context);
  if (!resolvedPath) return null;
  const basename = resolvedPath.split('/').pop()!;
  const fileNodes = context.getNodesByName(basename).filter((n) => n.kind === 'file');
  const fileNode = fileNodes.find((n) => n.filePath === resolvedPath);
  if (fileNode) {
    return {
      original: ref,
      targetNodeId: fileNode.id,
      confidence: 0.9,
      provenance: 'c-include-dir',
    };
  }
  return null;
}

// =============================================================================
// PHP include path resolution
// =============================================================================

/**
 * Разрешение PHP include/require пути к файлу.
 */
function resolvePhpIncludeImport(
  ref: IUnresolvedReference,
  context: IResolutionContext
): IResolvedRef | null {
  if (!ref.filePath) return null;

  const fromDir = ref.filePath.split('/').slice(0, -1).join('/');
  const basePath = normalizePath(ref.referenceName, fromDir);
  const extensions = EXTENSION_RESOLUTION.php ?? [];

  if (fileExists(context, basePath)) {
    const basename = basePath.split('/').pop()!;
    const fileNode = context
      .getNodesByName(basename)
      .find((n) => n.kind === 'file' && n.filePath === basePath);
    if (fileNode) {
      return {
        original: ref,
        targetNodeId: fileNode.id,
        confidence: 0.9,
        provenance: 'php-include',
      };
    }
  }

  for (const ext of extensions) {
    const candidate = basePath + ext;
    if (fileExists(context, candidate)) {
      const bn = candidate.split('/').pop()!;
      const fileNode = context
        .getNodesByName(bn)
        .find((n) => n.kind === 'file' && n.filePath === candidate);
      if (fileNode) {
        return {
          original: ref,
          targetNodeId: fileNode.id,
          confidence: 0.9,
          provenance: 'php-include',
        };
      }
    }
  }

  return null;
}

// =============================================================================
// findExportedSymbol — с поддержкой FileExportIndex
// =============================================================================

/** Максимальная глубина следования по цепочке реэкспортов. */
const REEXPORT_MAX_DEPTH = 8;

/**
 * Поиск экспортируемого символа в файле, со следованием по цепочке
 * реэкспортов (export { x } from './other').
 * Использует FileExportIndex для быстрого поиска.
 */
function findExportedSymbol(
  filePath: string,
  want: {
    isDefault: boolean;
    isNamespace: boolean;
    exportedName: string;
    memberName: string | null;
  },
  language: string,
  context: IResolutionContext,
  visited: Set<string>,
  depth = 0
): INode | undefined {
  // Мемоизация только верхнего уровня
  if (depth === 0 && visited.size === 0) {
    let memo = exportedSymbolMemos.get(context);
    if (!memo) {
      memo = new Map();
      exportedSymbolMemos.set(context, memo);
    }
    const key = `${filePath}\0${want.isDefault ? 1 : 0}${want.isNamespace ? 1 : 0}\0${want.exportedName}\0${want.memberName ?? ''}\0${language}`;
    if (memo.has(key)) return memo.get(key);
    const result = findExportedSymbolWalk(filePath, want, language, context, visited, depth);
    memo.set(key, result);
    return result;
  }
  return findExportedSymbolWalk(filePath, want, language, context, visited, depth);
}

/**
 * Рекурсивный поиск экспортируемого символа.
 */
function findExportedSymbolWalk(
  filePath: string,
  want: {
    isDefault: boolean;
    isNamespace: boolean;
    exportedName: string;
    memberName: string | null;
  },
  language: string,
  context: IResolutionContext,
  visited: Set<string>,
  depth: number
): INode | undefined {
  if (depth > REEXPORT_MAX_DEPTH) return undefined;
  if (visited.has(filePath)) return undefined;
  visited.add(filePath);

  const exportIndex = getFileExportIndex(filePath, context);

  // 1. Прямое совпадение: символ объявлен в этом файле
  if (want.isDefault) {
    const direct = exportIndex.defaultComponent ?? exportIndex.defaultFnClass;
    if (direct) return direct;
  } else if (want.isNamespace && want.memberName) {
    const direct = exportIndex.byName.get(want.memberName);
    if (direct) return direct;
  } else {
    const direct = exportIndex.byName.get(want.exportedName);
    if (direct) return direct;
  }

  // 2. Реэкспорт: файл пересылает символ в другой модуль
  const reExports = context.getReExports?.(filePath, language as Language) ?? [];
  if (reExports.length === 0) return undefined;

  const targetName = want.isDefault ? 'default' : want.exportedName;
  for (const rex of reExports) {
    if (rex.kind === 'named' && rex.exportedName === targetName) {
      const next = resolveImportPath(rex.source, filePath, language, context);
      if (!next) continue;
      const chained = findExportedSymbol(
        next,
        {
          isDefault: rex.originalName === 'default',
          isNamespace: false,
          exportedName: rex.originalName,
          memberName: null,
        },
        language,
        context,
        visited,
        depth + 1
      );
      if (chained) return chained;
    }
  }

  // 3. Реэкспорт со звёздочкой: export * from './other'
  for (const rex of reExports) {
    if (rex.kind === 'wildcard') {
      const next = resolveImportPath(rex.source, filePath, language, context);
      if (!next) continue;
      const chained = findExportedSymbol(next, want, language, context, visited, depth + 1);
      if (chained) return chained;
    }
  }

  return undefined;
}

// =============================================================================
// resolveJvmImport
// =============================================================================

/**
 * JVM FQN разрешение: com.example.foo.Bar → поиск по qualifiedName.
 */
export function resolveJvmImport(
  ref: IUnresolvedReference,
  context: IResolutionContext
): IResolvedRef | null {
  const name = ref.referenceName;

  // Проверяем, похоже ли на JVM FQN
  if (!name.includes('.')) return null;

  const lang = ref.language ?? '';
  if (!['java', 'kotlin', 'scala'].includes(lang)) return null;

  // Ищем по точному qualifiedName
  const exactMatches = context.getNodesByQualifiedName(name);
  if (exactMatches.length > 0) {
    return {
      original: ref,
      targetNodeId: exactMatches[0]!.id,
      confidence: 0.95,
      provenance: 'jvm-fqn',
    };
  }

  // Ищем по последнему сегменту
  const lastSegment = name.split('.').pop()!;
  const nameMatches = context.getNodesByName(lastSegment);
  for (const node of nameMatches) {
    if (node.qualifiedName === name || node.qualifiedName.endsWith(`.${lastSegment}`)) {
      return {
        original: ref,
        targetNodeId: node.id,
        confidence: 0.8,
        provenance: 'jvm-segment',
      };
    }
  }

  return null;
}

// =============================================================================
// extractImportMappings
// =============================================================================

/**
 * Извлечение импортов из содержимого файла.
 */
export function extractImportMappings(
  filePath: string,
  content: string,
  language: string
): IImportMapping[] {
  const mappings: IImportMapping[] = [];

  switch (language) {
    case 'typescript':
    case 'javascript':
    case 'tsx':
    case 'jsx':
      extractJsImports(content, mappings);
      break;
    case 'python':
      extractPythonImports(content, mappings);
      break;
    case 'go':
      extractGoImports(content, mappings);
      break;
    case 'java':
    case 'kotlin':
    case 'scala':
      extractJvmImports(content, mappings);
      break;
    case 'rust':
      extractRustImports(content, mappings);
      break;
    case 'ruby':
      extractRubyImports(content, mappings);
      break;
    case 'php':
      extractPhpImports(content, mappings);
      break;
    case 'csharp':
      extractCsharpImports(content, mappings);
      break;
    case 'c':
    case 'cpp':
      extractCImports(content, mappings);
      break;
    case 'cobol':
      extractCobolImports(content, mappings);
      break;
    case 'lua':
    case 'luau':
      extractLuaImports(content, mappings);
      break;
  }

  return mappings;
}

/** Извлечение импортов JavaScript/TypeScript. */
function extractJsImports(content: string, mappings: IImportMapping[]): void {
  const lines = content.split('\n');
  for (const line of lines) {
    // import { Foo, Bar } from './module'
    const namedMatch = line.match(/^\s*import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/);
    if (namedMatch) {
      const names = namedMatch[1].split(',').map((n: string) => n.trim());
      for (const name of names) {
        const [local, exported] = name.split(/\s+as\s+/);
        mappings.push({
          localName: local.trim(),
          exportedName: exported?.trim() || local.trim(),
          source: namedMatch[2],
          isDefault: false,
          isNamespace: false,
        });
      }
      continue;
    }

    // import Foo from './module'
    const defaultMatch = line.match(/^\s*import\s+(\w+)\s+from\s*['"]([^'"]+)['"]/);
    if (defaultMatch) {
      mappings.push({
        localName: defaultMatch[1],
        exportedName: 'default',
        source: defaultMatch[2],
        isDefault: true,
        isNamespace: false,
      });
      continue;
    }

    // import * as Foo from './module'
    const nsMatch = line.match(/^\s*import\s*\*\s*as\s+(\w+)\s+from\s*['"]([^'"]+)['"]/);
    if (nsMatch) {
      mappings.push({
        localName: nsMatch[1],
        exportedName: '*',
        source: nsMatch[2],
        isDefault: false,
        isNamespace: true,
      });
    }
  }
}

/** Извлечение импортов Python. */
function extractPythonImports(content: string, mappings: IImportMapping[]): void {
  const lines = content.split('\n');
  for (const line of lines) {
    // from module import Foo, Bar
    const fromMatch = line.match(/^\s*from\s+([\w.]+)\s+import\s+(.+)/);
    if (fromMatch) {
      const names = fromMatch[2].split(',').map((n: string) => n.trim());
      for (const name of names) {
        const [local, exported] = name.split(/\s+as\s+/);
        mappings.push({
          localName: local.trim(),
          exportedName: exported?.trim() || local.trim(),
          source: fromMatch[1],
          isDefault: false,
          isNamespace: false,
        });
      }
      continue;
    }

    // import module
    const importMatch = line.match(/^\s*import\s+([\w.]+)/);
    if (importMatch) {
      const parts = importMatch[1].split('.');
      mappings.push({
        localName: parts[parts.length - 1],
        exportedName: importMatch[1],
        source: importMatch[1],
        isDefault: false,
        isNamespace: true,
      });
    }
  }
}

/** Извлечение импортов Go. */
function extractGoImports(content: string, mappings: IImportMapping[]): void {
  const importBlock = content.match(/import\s*\((.*?)\)/s);
  if (importBlock) {
    const lines = importBlock[1].split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//')) continue;

      // alias "path"
      const aliasMatch = trimmed.match(/^(\w+)\s+"([^"]+)"/);
      if (aliasMatch) {
        const parts = aliasMatch[2].split('/');
        mappings.push({
          localName: aliasMatch[1],
          exportedName: parts[parts.length - 1],
          source: aliasMatch[2],
          isDefault: false,
          isNamespace: true,
        });
        continue;
      }

      // "path"
      const pathMatch = trimmed.match(/^"([^"]+)"/);
      if (pathMatch) {
        const parts = pathMatch[1].split('/');
        mappings.push({
          localName: parts[parts.length - 1],
          exportedName: parts[parts.length - 1],
          source: pathMatch[1],
          isDefault: false,
          isNamespace: true,
        });
      }
    }
  }
}

/** Извлечение импортов JVM. */
function extractJvmImports(content: string, mappings: IImportMapping[]): void {
  const lines = content.split('\n');
  for (const line of lines) {
    // import com.example.Foo;
    const importMatch = line.match(/^\s*import\s+(static\s+)?([\w.*]+)\s*;/);
    if (importMatch) {
      const fqName = importMatch[2];
      const parts = fqName.split('.');
      mappings.push({
        localName: parts[parts.length - 1] === '*' ? '' : parts[parts.length - 1],
        exportedName: fqName,
        source: fqName,
        isDefault: false,
        isNamespace: parts[parts.length - 1] === '*',
      });
    }
  }
}

/** Извлечение импортов Rust. */
function extractRustImports(content: string, mappings: IImportMapping[]): void {
  const lines = content.split('\n');
  for (const line of lines) {
    // use crate::foo::Bar;
    const useMatch = line.match(/^\s*use\s+([\w::]+)\s*;/);
    if (useMatch) {
      const parts = useMatch[1].split('::');
      mappings.push({
        localName: parts[parts.length - 1] === '*' ? '' : parts[parts.length - 1],
        exportedName: useMatch[1],
        source: useMatch[1],
        isDefault: false,
        isNamespace: parts[parts.length - 1] === '*',
      });
    }
  }
}

/** Извлечение импортов Ruby. */
function extractRubyImports(content: string, mappings: IImportMapping[]): void {
  const lines = content.split('\n');
  for (const line of lines) {
    // require 'module'
    const reqMatch = line.match(/^\s*(?:require|require_relative)\s+['"]([^'"]+)['"]/);
    if (reqMatch) {
      mappings.push({
        localName: '',
        exportedName: reqMatch[1],
        source: reqMatch[1],
        isDefault: false,
        isNamespace: true,
      });
    }
  }
}

/** Извлечение импортов PHP. */
function extractPhpImports(content: string, mappings: IImportMapping[]): void {
  const lines = content.split('\n');
  for (const line of lines) {
    // use Foo\Bar;
    const useMatch = line.match(/^\s*use\s+([\w\\]+)\s*;/);
    if (useMatch) {
      const parts = useMatch[1].split('\\');
      mappings.push({
        localName: parts[parts.length - 1],
        exportedName: useMatch[1],
        source: useMatch[1],
        isDefault: false,
        isNamespace: false,
      });
    }
  }
}

/** Извлечение импортов C#. */
function extractCsharpImports(content: string, mappings: IImportMapping[]): void {
  const lines = content.split('\n');
  for (const line of lines) {
    // using System.Collections;
    const usingMatch = line.match(/^\s*using\s+([\w.]+)\s*;/);
    if (usingMatch) {
      const parts = usingMatch[1].split('.');
      mappings.push({
        localName: parts[parts.length - 1],
        exportedName: usingMatch[1],
        source: usingMatch[1],
        isDefault: false,
        isNamespace: true,
      });
    }
  }
}

/** Извлечение импортов C/C++. */
function extractCImports(content: string, mappings: IImportMapping[]): void {
  const lines = content.split('\n');
  for (const line of lines) {
    // #include <header> or #include "header"
    const includeMatch = line.match(/^\s*#\s*include\s*[<"]([^>"]+)[>"]/);
    if (includeMatch) {
      const modulePath = includeMatch[1];
      // Базовое имя без расширения для localName
      const basename = modulePath.split('/').pop()!.replace(/\.(h|hpp|hxx|hh|inl|ipp|cxx|cc|cpp)$/,'');
      mappings.push({
        localName: basename || modulePath,
        exportedName: modulePath,
        source: modulePath,
        isDefault: false,
        isNamespace: true,
      });
    }
  }
}

/** Извлечение импортов COBOL (COPY statements). */
function extractCobolImports(content: string, mappings: IImportMapping[]): void {
  const lines = content.split('\n');
  for (const line of lines) {
    // COPY CVACT01Y
    const copyMatch = line.match(/^\s*COPY\s+(\w+)/i);
    if (copyMatch) {
      mappings.push({
        localName: '',
        exportedName: copyMatch[1],
        source: copyMatch[1],
        isDefault: false,
        isNamespace: true,
      });
      continue;
    }

    // EXEC SQL INCLUDE X
    const sqlIncludeMatch = line.match(/^\s*EXEC\s+SQL\s+INCLUDE\s+(\w+)/i);
    if (sqlIncludeMatch) {
      mappings.push({
        localName: '',
        exportedName: sqlIncludeMatch[1],
        source: sqlIncludeMatch[1],
        isDefault: false,
        isNamespace: true,
      });
    }
  }
}

/** Извлечение импортов Lua (require). */
function extractLuaImports(content: string, mappings: IImportMapping[]): void {
  const lines = content.split('\n');
  for (const line of lines) {
    // require('module') or require "module"
    const reqMatch = line.match(/^\s*(?:local\s+)?(\w+)\s*=\s*require\s*[\('"]([^)'"]+)[)"]/);
    if (reqMatch) {
      mappings.push({
        localName: reqMatch[1],
        exportedName: reqMatch[2],
        source: reqMatch[2],
        isDefault: false,
        isNamespace: true,
      });
    }
  }
}

// =============================================================================
// extractReExports
// =============================================================================

/**
 * Извлечение реэкспорта из содержимого файла.
 */
export function extractReExports(content: string, language: string): IReExport[] {
  const reExports: IReExport[] = [];

  if (['typescript', 'javascript', 'tsx', 'jsx'].includes(language)) {
    const lines = content.split('\n');
    for (const line of lines) {
      // export { Foo } from './module'
      const namedMatch = line.match(/^\s*export\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/);
      if (namedMatch) {
        const names = namedMatch[1].split(',').map((n: string) => n.trim());
        for (const name of names) {
          const [exported, original] = name.split(/\s+as\s+/);
          reExports.push({
            kind: 'named',
            exportedName: exported.trim(),
            originalName: original?.trim() || exported.trim(),
            source: namedMatch[2],
          });
        }
        continue;
      }

      // export * from './module'
      const wildcardMatch = line.match(/^\s*export\s*\*\s*from\s*['"]([^'"]+)['"]/);
      if (wildcardMatch) {
        reExports.push({
          kind: 'wildcard',
          source: wildcardMatch[1],
        });
      }
    }
  }

  return reExports;
}

// =============================================================================
// isPhpIncludePathRef
// =============================================================================

/**
 * PHP include path обнаружение: предотвращает фоллбэк к name-matcher.
 */
export function isPhpIncludePathRef(ref: IUnresolvedReference): boolean {
  if (ref.language !== 'php') return false;

  const name = ref.referenceName;
  // PHP include path ссылки содержат разделители путей
  return name.includes('/') || name.includes('\\') || name.endsWith('.php');
}

// =============================================================================
// loadProjectAliases
// =============================================================================

/**
 * Загрузка path-алиасов из tsconfig.json / jsconfig.json.
 */
// loadProjectAliases imported directly from extraction/PathAliases.ts
