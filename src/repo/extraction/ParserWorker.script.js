const { parentPort } = require('worker_threads');
const path = require('path');

let parser = null;
const grammarCache = new Map();

/**
 * Инициализирует парсер tree-sitter с кэшированием.
 */
async function initParser() {
  if (parser) return parser;
  const ts = await import('tree-sitter');
  parser = new ts.Parser();
  return parser;
}

/**
 * Загружает грамматику для языка с кэшированием.
 */
async function loadGrammar(language) {
  if (grammarCache.has(language)) {
    return grammarCache.get(language);
  }

  const pkg = await import('tree-sitter-' + language);
  let grammar;

  if (language === 'typescript') {
    grammar = pkg.TSXGrammar || pkg.default;
  } else {
    grammar = pkg.default || pkg;
  }

  grammarCache.set(language, grammar);
  return grammar;
}

/**
 * Возвращает вариант грамматики в зависимости от языка и расширения файла.
 */
async function getGrammarVariant(language, filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (language === 'typescript') {
    if (ext === '.tsx') {
      const pkg = await import('tree-sitter-typescript');
      return pkg.TSXGrammar || pkg.default;
    } else {
      const pkg = await import('tree-sitter-typescript');
      return pkg.TSGrammar || pkg.default;
    }
  }

  if (ext === '.h' && (language === 'c' || language === 'cpp')) {
    // Для .h файлов сначала пробуем C грамматику, затем C++
    try {
      const cPkg = await import('tree-sitter-c');
      return cPkg.default || cPkg;
    } catch {
      return loadGrammar('cpp');
    }
  }

  return loadGrammar(language);
}

/**
 * Загружает грамматики для всех указанных языков.
 */
async function loadGrammars(languages) {
  for (const lang of languages) {
    try {
      await loadGrammar(lang);
    } catch {
      // Грамматика недоступна — пропускаем без ошибки
    }
  }
  parentPort.postMessage({ type: 'grammars-loaded' });
}

/**
 * Парсит файл через tree-sitter и возвращает результат извлечения.
 */
async function parseFile(language, content, filePath, frameworkNames) {
  const { extractFromSource } = await import(
    path.join(__dirname, '..', 'tree-sitter.js')
  );
  // Сериализуем дерево для передачи в основной поток.
  return extractFromSource(filePath, content, language, frameworkNames);
}

if (parentPort) {
  parentPort.on('message', async (msg) => {
    try {
      if (msg.type === 'load-grammars') {
        await loadGrammars(msg.languages);
      } else if (msg.type === 'parse') {
        const result = await parseFile(
          msg.language,
          msg.content,
          msg.filePath,
          msg.frameworkNames
        );

        parentPort.postMessage({
          type: 'parse-result',
          id: msg.id,
          result: result,
        });
      }
    } catch (err) {
      parentPort.postMessage({
        type: 'error',
        id: msg.id,
        message: err.message || String(err),
      });
    }
  });
}
