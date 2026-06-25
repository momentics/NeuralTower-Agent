import path from 'path';

// Карта языков к npm-пакетам грамматик
const GRAMMAR_MAP: Record<string, string> = {
  typescript: 'tree-sitter-typescript',
  python: 'tree-sitter-python',
  go: 'tree-sitter-go',
  rust: 'tree-sitter-rust',
  java: 'tree-sitter-java',
  cpp: 'tree-sitter-cpp',
  csharp: 'tree-sitter-c-sharp',
};

// Кэш загруженных грамматик для избежания повторных загрузок
const grammarCache = new Map<string, any>();

/**
 * Возвращает имя npm-пакета для заданного языка.
 */
export function getGrammarName(language: string): string {
  const name = GRAMMAR_MAP[language];
  if (!name) {
    throw new Error(`Неизвестный язык: ${language}`);
  }
  return name;
}

/**
 * Загружает грамматику по имени языка с использованием кэша.
 */
export async function loadGrammar(language: string): Promise<any> {
  const cacheKey = language;

  // Проверяем кэш перед загрузкой
  if (grammarCache.has(cacheKey)) {
    return grammarCache.get(cacheKey);
  }

  const packageName = getGrammarName(language);

  let grammar: any;

  // Специальная обработка для TypeScript — загружаем tsx-грамматику
  if (language === 'typescript') {
    const pkg = await import(packageName);
    grammar = pkg.TSXGrammar || pkg.default;
  } else {
    const pkg = await import(packageName);
    grammar = pkg.default || pkg;
  }

  grammarCache.set(cacheKey, grammar);
  return grammar;
}

/**
 * Возвращает вариант грамматики в зависимости от языка и пути к файлу.
 * — TypeScript: TSX для .tsx, TS для .ts
 * — C++: tree-sitter-c для .h, tree-sitter-cpp для остальных
 */
export async function getGrammarVariant(language: string, filePath: string): Promise<any> {
  const ext = path.extname(filePath).toLowerCase();

  if (language === 'typescript') {
    // Для TSX-файлов загружаем tsx-грамматику, для обычных — ts-грамматику
    if (ext === '.tsx') {
      const pkg = await import('tree-sitter-typescript');
      return pkg.TSX || pkg.TypeScript || pkg.default;
    } else {
      const pkg = await import('tree-sitter-typescript');
      return pkg.TypeScript || pkg.default;
    }
  }

  if (language === 'cpp') {
    // Для заголовочных файлов .h используем грамматику C как фолбэк
    if (ext === '.h') {
      // Пытаемся загрузить грамматику C, если не найдена — возвращаем C++
      try {
        const cPkg = await import('tree-sitter-c');
        return cPkg.default || cPkg;
      } catch {
        return loadGrammar('cpp');
      }
    }
  }

  // Для остальных языков возвращаем обычную грамматику
  return loadGrammar(language);
}
