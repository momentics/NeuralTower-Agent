import { Language } from '../ntgraph/Types';

// Карта соответствия расширений файлов языкам программирования
export const EXTENSION_TO_LANGUAGE: Record<string, Language> = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'jsx',
  '.mjs': 'typescript',
  '.cjs': 'typescript',
  '.py': 'python',
  '.pyi': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.c++': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.hxx': 'cpp',
  '.h++': 'cpp',
  '.c': 'c',
  '.cs': 'csharp',
  '.rb': 'ruby',
  '.php': 'php',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.dart': 'dart',
  '.scala': 'scala',
  '.sc': 'scala',
  '.lua': 'lua',
  '.luau': 'luau',
  '.m': 'objc',
  '.r': 'r',
  '.R': 'r',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.xml': 'xml',
  '.properties': 'properties',
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.sql': 'sql',
  '.json': 'json',
  '.md': 'markdown',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.toml': 'toml',
  '.ini': 'ini',
  '.svelte': 'svelte',
  '.vue': 'vue',
  '.astro': 'astro',
  '.liquid': 'liquid',
  '.pas': 'pascal',
  '.pp': 'pascal',
  '.twig': 'twig',
  '.razor': 'razor',
  '.cshtml': 'razor',
};

/**
 * Определяет язык программирования файла по расширению и содержимому.
 * @param filePath - Путь к файлу для определения языка.
 * @param content - Опциональное содержимое файла для проверки shebang.
 * @returns Название языка программирования.
 */
export function detectLanguage(filePath: string, content?: string): Language {
  // Извлекаем расширение файла
  const ext = filePath.includes('.')
    ? filePath.slice(filePath.lastIndexOf('.'))
    : '';

  // Проверяем карту расширений
  const langFromExt = EXTENSION_TO_LANGUAGE[ext];

  if (langFromExt) {
    return langFromExt;
  }

  // Если содержимое предоставлено, проверяем shebang на наличие Python
  if (content) {
    const shebang = content.split('\n')[0];
    if (shebang.startsWith('#!') && shebang.includes('python')) {
      return 'python';
    }
  }

  // Язык не определён
  return 'unknown';
}

// Список языков, для которых есть tree-sitter экстракторы
const SUPPORTED_LANGUAGES = ['typescript', 'python', 'go', 'rust', 'java', 'cpp', 'c', 'csharp'];

// Языки, которые поддерживаются только на уровне файла (без символьной структуры)
const FILE_LEVEL_ONLY_LANGUAGES = ['yaml', 'properties', 'xml'];

/**
 * Проверяет, является ли файл исходным (не бинарным, не генерированным).
 */
export function isSourceFile(filePath: string): boolean {
  // Извлекаем расширение файла
  const ext = filePath.includes('.')
    ? filePath.slice(filePath.lastIndexOf('.'))
    : '';

  // Проверяем, есть ли расширение в карте языков
  if (!(ext in EXTENSION_TO_LANGUAGE)) return false;

  const lower = filePath.toLowerCase();

  // Бинарные и минифицированные файлы
  if (lower.includes('.min.js') || lower.includes('.min.css')) return false;
  if (lower.endsWith('.bundle.js')) return false;

  // Генерируемые директории
  if (lower.includes('/__generated__/') || lower.includes('/generated/')) return false;

  // Генерируемые файлы
  if (lower.endsWith('.generated.ts') || lower.endsWith('.generated.js') || lower.endsWith('.generated.go')) return false;

  return true;
}

/**
 * Проверяет, поддерживается ли язык tree-sitter экстрактором.
 */
export function isLanguageSupported(lang: string): boolean {
  // Возвращаем false для неизвестных или неподдерживаемых языков
  if (lang === 'unknown') {
    return false;
  }

  return SUPPORTED_LANGUAGES.includes(lang);
}

/**
 * Проверяет, является ли языком только на уровне файла (без символьной структуры).
 */
export function isFileLevelOnlyLanguage(lang: string): boolean {
  // Для yaml, properties, xml — файлов без символьной структуры
  return FILE_LEVEL_ONLY_LANGUAGES.includes(lang);
}

/**
 * Загружает переопределения расширений из ntgraph.json в корне проекта.
 */
export function loadExtensionOverrides(rootDir: string): void {
  // Читаем ntgraph.json для кастомных маппингов расширений на языки
  try {
    const fs = require('fs');
    const path = require('path');
    const configPath = path.join(rootDir, 'ntgraph.json');

    if (!fs.existsSync(configPath)) {
      return;
    }

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

    if (config.extensions && typeof config.extensions === 'object') {
      // Переопределяем стандартный маппинг
      for (const [ext, lang] of Object.entries(config.extensions)) {
        if (typeof lang === 'string') {
          EXTENSION_TO_LANGUAGE[ext] = lang as Language;
        }
      }
    }
  } catch {
    // Ошибка чтения конфигурации — игнорируем
  }
}

/**
 * Проверяет, загружена ли грамматика для заданного языка.
 */
export function isGrammarLoaded(language: string): boolean {
  // Импортируем из модуля Grammars для проверки кэша
  const { isGrammarCached } = require('./Grammars');
  return isGrammarCached(language);
}

/**
 * Возвращает массив языков с доступными tree-sitter грамматиками.
 */
export function getSupportedLanguages(): string[] {
  // Возвращаем список языков с tree-sitter поддержкой
  return [...SUPPORTED_LANGUAGES];
}
