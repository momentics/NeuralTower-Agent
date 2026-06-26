/**
 * Обработка .gitignore файлов.
 * Чтение паттернов, проверка UTF-8, сопоставление путей с паттернами.
 */

import fs from 'fs';

/**
 * Проверяет, является ли буфер корректной UTF-8 последовательностью.
 * Если обнаружены заменители (U+FFFD), возвращает false как признак
 * возможной DLP-encryption.
 */
export function isValidUtf8(buf: Buffer): boolean {
  const text = buf.toString('utf8');
  return !text.includes('\uFFFD');
}

/**
 * Читает .gitignore файл и возвращает массив паттернов.
 * Пропускает пустые строки и комментарии (#).
 * Двойные !! обрабатываются как negation с префиксом !.
 */
export function readGitignorePatterns(giPath: string): string[] {
  let content: string;

  try {
    const buf = fs.readFileSync(giPath);
    if (!isValidUtf8(buf)) {
      console.warn(`[Gitignore] Файл не содержит корректный UTF-8: ${giPath}`);
      return [];
    }
    content = buf.toString('utf8');
  } catch {
    console.warn(`[Gitignore] Не удалось прочитать файл: ${giPath}`);
    return [];
  }

  const patterns: string[] = [];

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trimEnd();

    // Пропускаем пустые строки
    if (line.length === 0) continue;

    // Пропускаем комментарии
    if (line.startsWith('#')) continue;

    // Двойные !! — negation pattern (отмена игнорирования)
    if (line.startsWith('!!')) {
      patterns.push('!' + line.slice(1));
      continue;
    }

    // Отрицательные паттерны — возвращаем как есть
    if (line.startsWith('!')) {
      patterns.push(line);
      continue;
    }

    // Обычные паттерны
    patterns.push(line);
  }

  return patterns;
}

/**
 * Результат трансляции gitignore-паттерна.
 */
interface IGitignorePatternResult {
  re: RegExp;
  isNegation: boolean;
  dirOnly: boolean;
}

/**
 * Транслирует gitignore-паттерн в регулярное выражение.
 * Поддерживает *, **, ? и анкоринг.
 */
function patternToRegex(pattern: string): IGitignorePatternResult {
  let isNegation = false;

  if (pattern.startsWith('!')) {
    isNegation = true;
    pattern = pattern.slice(1);
  }

  let dirOnly = false;

  // Паттерн, заканчивающийся /, совпадает только с директориями
  if (pattern.endsWith('/')) {
    dirOnly = true;
    pattern = pattern.slice(0, -1);
  }

  const hasSlash = pattern.includes('/');

  let regexSource = '';

  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];

    if (ch === '*') {
      if (i + 1 < pattern.length && pattern[i + 1] === '*') {
        // ** — любые символы включая /
        if (i + 2 < pattern.length && pattern[i + 2] === '/') {
          // **/ — ноль или более директорий
          regexSource += '(?:.+/)?';
          i += 2;
        } else if (i === 0 || pattern[i - 1] === '/') {
          // ** в конце или после /
          regexSource += '.*';
          i += 1;
        } else {
          regexSource += '.*';
          i += 1;
        }
      } else {
        // * — любые символы кроме /
        regexSource += '[^/]*';
      }
    } else if (ch === '?') {
      regexSource += '[^/]';
    } else if (ch === '.') {
      regexSource += '\\.';
    } else if (ch === '[') {
      regexSource += '[';
    } else if (ch === ']') {
      regexSource += ']';
    } else if (ch === '\\') {
      if (i + 1 < pattern.length) {
        regexSource += '\\' + pattern[i + 1];
        i += 1;
      } else {
        regexSource += '\\\\';
      }
    } else {
      regexSource += ch;
    }
  }

  // Паттерн без / (кроме конца) совпадает с любым компонентом пути
  if (!hasSlash) {
    regexSource = '^(?:.*/)?' + regexSource + '(?:/.*)?$';
  } else {
    regexSource = '^' + regexSource + '(?:/.*)?$';
  }

  const re = new RegExp(regexSource);

  return { re, isNegation, dirOnly };
}

/**
 * Сопоставляет путь файла с gitignore-паттерном.
 * Возвращает true, если паттерн совпадает с путём.
 * Негативные паттерны (!) возвращают true — значит "не игнорировать".
 */
export function matchGitignorePattern(filePath: string, pattern: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/');

  const { re, isNegation, dirOnly } = patternToRegex(pattern);

  if (dirOnly) {
    // Паттерн только для директорий — путь должен заканчиваться / или
    // быть префиксом (т.е. совпадать как директория)
    const dirPath = normalizedPath.endsWith('/') ? normalizedPath : normalizedPath + '/';
    if (!re.test(dirPath)) {
      return false;
    }
  } else {
    if (!re.test(normalizedPath)) {
      return false;
    }
  }

  return true;
}
