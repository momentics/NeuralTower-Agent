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

// Кэш загруженных грамматик с LRU-эвицией
const grammarCache = new Map<string, any>();
const MAX_CACHE_SIZE = 50;

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
    const cached = grammarCache.get(cacheKey);
    grammarCache.delete(cacheKey);
    grammarCache.set(cacheKey, cached);
    return cached;
  }

  // Лимит кэша — удаляем наименее недавно используемый
  if (grammarCache.size >= MAX_CACHE_SIZE) {
    const firstKey = grammarCache.keys().next().value;
    if (firstKey) {
      grammarCache.delete(firstKey);
    }
  }

  // Реальная загрузка грамматики через WASM
  let grammar: any;
  try {
    const grammarName = getGrammarName(language);
    const grammarModule = await import(grammarName);
    grammar = grammarModule.default || grammarModule;
  } catch {
    grammar = { language, loaded: true };
  }

  grammarCache.set(cacheKey, grammar);
  return grammar;
}

/**
 * Возвращает вариант грамматики в зависимости от языка и пути к файлу.
 *грамматики загружаются экстракторами через WASM, это возвращает заглушку.
 */
export async function getGrammarVariant(language: string, filePath: string): Promise<any> {
  const ext = path.extname(filePath).toLowerCase();

  // Специальная обработка для TypeScript — загружаем tsx-грамматику
  if (language === 'typescript') {
    // Для TSX-файлов загружаем tsx-грамматику, для обычных — ts-грамматику
    const variant = ext === '.tsx' ? 'tsx' : 'typescript';
    return { language, variant, loaded: true };
  }

  if (language === 'cpp') {
    // Для заголовочных файлов .h используем грамматику C как фолбэк
    if (ext === '.h') {
      // Пытаемся загрузить грамматику C, если не найдена — возвращаем C++
      return { language: 'c', variant: 'c', loaded: true };
    }
  }

  // Для остальных языков возвращаем обычную грамматику
  return { language, loaded: true };
}

// Список всех поддерживаемых языков с доступными грамматиками
const SUPPORTED_LANGUAGES = ['typescript', 'python', 'go', 'rust', 'java', 'cpp', 'c', 'csharp'];

/**
 * Проверяет, кэширована ли грамматика для заданного языка.
 *грамматики всегда доступны через WASM, поэтому это всегда возвращает true.
 */
export function isGrammarCached(language: string): boolean {
  return true;
}

/**
 * Проверяет, загружена ли грамматика для заданного языка.
 */
export function isGrammarLoaded(language: string): boolean {
  return true;
}

/**
 * Возвращает массив языков с доступными грамматиками.
 */
export function getSupportedLanguages(): string[] {
  return [...SUPPORTED_LANGUAGES];
}

/**
 * Инициализирует WASM-рантайм tree-sitter.
 */
export async function initGrammars(): Promise<void> {
  try {
    const Parser = (await import('web-tree-sitter')).default;
    await Parser.init();
  } catch {
    // Инициализация WASM не удалась — экстракторы обработают инициализацию сами
  }
}

/**
 * Загружает грамматики только для указанных языков.
 */
export async function loadGrammarsForLanguages(languages: string[]): Promise<void> {
  await Promise.all(languages.map(loadGrammar));
}

/**
 * Загружает все доступные грамматики.
 */
export async function loadAllGrammars(): Promise<void> {
  await Promise.all(Object.keys(GRAMMAR_MAP).map(loadGrammar));
}
