const { parentPort } = require('worker_threads');
const path = require('path');

// Экземпляр парсера tree-sitter.
let parser = null;

// Кэш загруженных грамматик.
const grammarCache = new Map();

/**
 * Инициализирует парсер tree-sitter.
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
 * Возвращает вариант грамматики в зависимости от языка и пути к файлу.
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

  if (language === 'cpp') {
    if (ext === '.h') {
      try {
        const cPkg = await import('tree-sitter-c');
        return cPkg.default || cPkg;
      } catch {
        return loadGrammar('cpp');
      }
    }
  }

  return loadGrammar(language);
}

/**
 * Парсит содержимое файла и возвращает сериализованное AST.
 */
async function parseFile(language, content, filePath) {
  const p = await initParser();
  const grammar = await getGrammarVariant(language, filePath);

  if (!grammar) {
    throw new Error('Не удалось загрузить грамматику для языка: ' + language);
  }

  p.setLanguage(grammar);
  const tree = p.parse(content);

  // Сериализуем дерево для передачи в основной поток.
  return {
    root: {
      type: tree.rootNode.type,
      start: tree.rootNode.startPosition,
      end: tree.rootNode.endPosition,
      childCount: tree.rootNode.childCount,
    },
    tree: tree.rootNode,
  };
}

// Обработка сообщений от основного потока.
if (parentPort) {
  parentPort.on('message', async (msg) => {
    try {
      if (msg.type === 'parse') {
        const tree = await parseFile(msg.language, msg.content, msg.filePath);

        parentPort.postMessage({
          type: 'result',
          id: msg.id,
          tree: tree,
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
