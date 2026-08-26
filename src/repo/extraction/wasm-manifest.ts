/**
 * Манифест WASM-грамматик: язык/грамматика → файл wasm.
 *
 * JSON-часть инлайнится esbuild в бандлы extension.js и ParserWorker.js;
 * scripts/copy-wasm-assets.mjs читает тот же JSON при сборке.
 */

import manifestJson from './wasm-manifest.json';

/** Карта «имя грамматики → файл wasm в директории грамматик». */
export const WASM_MANIFEST: Record<string, string> = manifestJson.grammars;

/**
 * Набор имён грамматик, необходимых для извлечения языка.
 *
 * ВАЖНО: язык 'c' ВСЕГДА требует обеих грамматик (c и cpp): .h-файлы
 * детектируются как 'c' (EXTENSION_TO_LANGUAGE: '.h' → 'c') и парсятся
 * двойным парсингом C→C++, поэтому загрузка только 'c' ломает .h в
 * C-проектах без .cpp-файлов. Для остальных языков расширение не
 * требуется (ts-семейство без filePath грузит обе TS-грамматики).
 */
export function grammarNamesForLanguage(language: string, filePath?: string): string[] {
  const ext = filePath ? filePath.slice(filePath.lastIndexOf('.')).toLowerCase() : '';
  switch (language) {
    case 'typescript':
    case 'javascript':
    case 'tsx':
    case 'jsx':
      // JS/JSX парсятся TS-грамматиками; .tsx/.jsx — TSX-грамматикой.
      // Без filePath грузим обе, чтобы покрыть любые расширения.
      return ext === '.tsx' || ext === '.jsx' ? ['tsx'] : ['typescript', 'tsx'];
    case 'c':
      // .h детектируются как язык 'c' и требуют двойного парсинга (C + C++),
      // поэтому для 'c' всегда загружаются обе грамматики.
      return ['c', 'cpp'];
    case 'cpp':
      return ['cpp'];
    case 'vue':
    case 'svelte':
    case 'astro':
      // Скриптовая/фронтматтерная часть парсится TS-грамматикой.
      return ['typescript'];
    default:
      return WASM_MANIFEST[language] ? [language] : [];
  }
}
