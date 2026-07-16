/**
 * Удаление комментариев и строковых литералов для regex-сканирования.
 *
 * Заменяет символы комментариев и содержимое строковых литералов пробелами
 * (НЕ удаляет), чтобы смещения в исходном коде сохранялись. Это означает,
 * что match.index от regex на очищенном выводе по-прежнему отображается
 * на ту же строку в исходном коде.
 */

export type CommentLang =
  | 'python' | 'javascript' | 'typescript' | 'php' | 'ruby'
  | 'java' | 'csharp' | 'swift' | 'go' | 'rust' | 'c' | 'cpp' | 'erlang';

/** Главная функция удаления комментариев для regex-сканирования. */
export function stripCommentsForRegex(content: string, lang: CommentLang): string {
  switch (lang) {
    case 'python':
      return stripPython(content);
    case 'ruby':
      return stripRuby(content);
    case 'rust':
      return stripRust(content);
    case 'erlang':
      return stripErlang(content);
    case 'php':
      return stripPhp(content);
    case 'go':
      return stripGo(content);
    case 'javascript':
    case 'typescript':
    case 'java':
    case 'csharp':
    case 'swift':
    case 'c':
    case 'cpp':
      return stripCStyle(content, lang === 'javascript' || lang === 'typescript');
    default:
      return content;
  }
}

/**
 * Заменяет каждый символ в диапазоне пробелами, но сохраняет переводы строк,
 * чтобы номера строк оставались корректными.
 */
function blankRange(buf: string[], start: number, end: number, src: string): void {
  for (let i = start; i < end; i++) {
    buf[i] = src[i] === '\n' ? '\n' : ' ';
  }
}

// ---------- Python ----------

function stripPython(src: string): string {
  const out = src.split('');
  let i = 0;
  const n = src.length;

  while (i < n) {
    const c = src[i]!;
    const c2 = src[i + 1] ?? '';
    const c3 = src[i + 2] ?? '';

    // Трехкратная кавычка: """...""" или '''...'''
    if ((c === '"' || c === "'") && c2 === c && c3 === c) {
      const quote = c;
      const start = i;
      i += 3;
      while (i < n) {
        if (src[i] === '\\' && i + 1 < n) {
          i += 2;
          continue;
        }
        if (src[i] === quote && src[i + 1] === quote && src[i + 2] === quote) {
          i += 3;
          break;
        }
        i++;
      }
      blankRange(out, start, i, src);
      continue;
    }

    // Однострочная строка: '...' или "..."
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      while (i < n && src[i] !== quote) {
        if (src[i] === '\\' && i + 1 < n) {
          i += 2;
          continue;
        }
        if (src[i] === '\n') break;
        i++;
      }
      if (i < n && src[i] === quote) i++;
      continue;
    }

    // Строковый комментарий
    if (c === '#') {
      const start = i;
      while (i < n && src[i] !== '\n') i++;
      blankRange(out, start, i, src);
      continue;
    }

    i++;
  }

  return out.join('');
}

// ---------- Ruby ----------

function stripRuby(src: string): string {
  const out = src.split('');
  let i = 0;
  const n = src.length;
  let atLineStart = true;

  while (i < n) {
    const c = src[i]!;

    // =begin / =end блок-комментарии (в начале строки)
    if (atLineStart && c === '=' && src.startsWith('=begin', i)) {
      const start = i;
      i += 6;
      while (i < n) {
        if (src[i] === '\n') {
          let j = i + 1;
          while (j < n && (src[j] === ' ' || src[j] === '\t')) j++;
          if (src.startsWith('=end', j)) {
            i = j + 4;
            while (i < n && src[i] !== '\n') i++;
            break;
          }
        }
        i++;
      }
      blankRange(out, start, i, src);
      atLineStart = i > 0 && src[i - 1] === '\n';
      continue;
    }

    // Строковые литералы
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      while (i < n && src[i] !== quote) {
        if (src[i] === '\\' && i + 1 < n) {
          i += 2;
          continue;
        }
        if (src[i] === '\n') break;
        i++;
      }
      if (i < n && src[i] === quote) i++;
      atLineStart = false;
      continue;
    }

    // Строковый комментарий
    if (c === '#') {
      const start = i;
      while (i < n && src[i] !== '\n') i++;
      blankRange(out, start, i, src);
      atLineStart = false;
      continue;
    }

    if (c === '\n') {
      atLineStart = true;
      i++;
      continue;
    }
    if (c === ' ' || c === '\t') {
      i++;
      continue;
    }
    atLineStart = false;
    i++;
  }

  return out.join('');
}

// ---------- C-style (JS/TS/Java/C#/Swift) ----------

function stripCStyle(src: string, allowSingleQuoteStrings: boolean): string {
  const out = src.split('');
  let i = 0;
  const n = src.length;

  while (i < n) {
    const c = src[i]!;
    const c2 = src[i + 1] ?? '';

    // Блок-комментарий
    if (c === '/' && c2 === '*') {
      const start = i;
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      if (i < n) i += 2;
      blankRange(out, start, i, src);
      continue;
    }

    // Строковый комментарий
    if (c === '/' && c2 === '/') {
      const start = i;
      while (i < n && src[i] !== '\n') i++;
      blankRange(out, start, i, src);
      continue;
    }

    // Строковые литералы
    if (c === '"' || (allowSingleQuoteStrings && c === "'") || c === '`') {
      const quote = c;
      i++;
      while (i < n && src[i] !== quote) {
        if (src[i] === '\\' && i + 1 < n) {
          i += 2;
          continue;
        }
        if (quote !== '`' && src[i] === '\n') break;
        i++;
      }
      if (i < n && src[i] === quote) i++;
      continue;
    }

    i++;
  }

  return out.join('');
}

// ---------- PHP ----------

function stripPhp(src: string): string {
  const out = src.split('');
  let i = 0;
  const n = src.length;

  while (i < n) {
    const c = src[i]!;
    const c2 = src[i + 1] ?? '';

    // Блок-комментарий
    if (c === '/' && c2 === '*') {
      const start = i;
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      if (i < n) i += 2;
      blankRange(out, start, i, src);
      continue;
    }

    // Строковый комментарий //
    if (c === '/' && c2 === '/') {
      const start = i;
      while (i < n && src[i] !== '\n') i++;
      blankRange(out, start, i, src);
      continue;
    }

    // Строковый комментарий #
    if (c === '#') {
      const start = i;
      while (i < n && src[i] !== '\n') i++;
      blankRange(out, start, i, src);
      continue;
    }

    // Строковые литералы
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      while (i < n && src[i] !== quote) {
        if (src[i] === '\\' && i + 1 < n) {
          i += 2;
          continue;
        }
        if (src[i] === '\n') break;
        i++;
      }
      if (i < n && src[i] === quote) i++;
      continue;
    }

    i++;
  }

  return out.join('');
}

// ---------- Go ----------

function stripGo(src: string): string {
  const out = src.split('');
  let i = 0;
  const n = src.length;

  while (i < n) {
    const c = src[i]!;
    const c2 = src[i + 1] ?? '';

    // Блок-комментарий
    if (c === '/' && c2 === '*') {
      const start = i;
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      if (i < n) i += 2;
      blankRange(out, start, i, src);
      continue;
    }

    // Строковый комментарий
    if (c === '/' && c2 === '/') {
      const start = i;
      while (i < n && src[i] !== '\n') i++;
      blankRange(out, start, i, src);
      continue;
    }

    // Сырая строка с обратными кавычками
    if (c === '`') {
      i++;
      while (i < n && src[i] !== '`') i++;
      if (i < n) i++;
      continue;
    }

    // Интерпретируемая строка с двойными кавычками
    if (c === '"') {
      i++;
      while (i < n && src[i] !== '"') {
        if (src[i] === '\\' && i + 1 < n) {
          i += 2;
          continue;
        }
        if (src[i] === '\n') break;
        i++;
      }
      if (i < n && src[i] === '"') i++;
      continue;
    }

    // Литерал символа с одинарными кавычками
    if (c === "'") {
      i++;
      while (i < n && src[i] !== "'") {
        if (src[i] === '\\' && i + 1 < n) {
          i += 2;
          continue;
        }
        if (src[i] === '\n') break;
        i++;
      }
      if (i < n && src[i] === "'") i++;
      continue;
    }

    i++;
  }

  return out.join('');
}

// ---------- Rust ----------

function stripRust(src: string): string {
  const out = src.split('');
  let i = 0;
  const n = src.length;

  while (i < n) {
    const c = src[i]!;
    const c2 = src[i + 1] ?? '';

    // Вложенный блок-комментарий /* ... /* ... */ ... */
    if (c === '/' && c2 === '*') {
      const start = i;
      i += 2;
      let depth = 1;
      while (i < n && depth > 0) {
        if (src[i] === '/' && src[i + 1] === '*') {
          depth++;
          i += 2;
        } else if (src[i] === '*' && src[i + 1] === '/') {
          depth--;
          i += 2;
        } else {
          i++;
        }
      }
      blankRange(out, start, i, src);
      continue;
    }

    // Строковый комментарий
    if (c === '/' && c2 === '/') {
      const start = i;
      while (i < n && src[i] !== '\n') i++;
      blankRange(out, start, i, src);
      continue;
    }

    // Строковые литералы
    if (c === '"') {
      i++;
      while (i < n && src[i] !== '"') {
        if (src[i] === '\\' && i + 1 < n) {
          i += 2;
          continue;
        }
        i++;
      }
      if (i < n && src[i] === '"') i++;
      continue;
    }

    // Литерал символа
    if (c === "'") {
      i++;
      while (i < n && src[i] !== "'") {
        if (src[i] === '\\' && i + 1 < n) {
          i += 2;
          continue;
        }
        if (src[i] === '\n') break;
        i++;
      }
      if (i < n && src[i] === "'") i++;
      continue;
    }

    i++;
  }

  return out.join('');
}

// ---------- Erlang ----------

/**
 * Erlang: `%` начинает строковый комментарий, если он не находится
 * внутри `"string"`, `'quoted atom'`, или литерала символа `$%`.
 */
function stripErlang(src: string): string {
  const out = src.split('');
  let i = 0;
  const n = src.length;

  while (i < n) {
    const c = src[i];

    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      while (i < n && src[i] !== quote) {
        if (src[i] === '\\' && i + 1 < n) {
          i += 2;
          continue;
        }
        i++;
      }
      if (i < n) i++;
      continue;
    }

    // Литерал символа: `$x`, `$\n`, `$%`
    if (c === '$') {
      i++;
      if (i < n && src[i] === '\\') i++;
      i++;
      continue;
    }

    if (c === '%') {
      let end = i;
      while (end < n && src[end] !== '\n') end++;
      blankRange(out, i, end, src);
      i = end;
      continue;
    }

    i++;
  }

  return out.join('');
}
