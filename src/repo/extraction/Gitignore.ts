/**
 * Обработка .gitignore файлов.
 * Чтение паттернов, проверка UTF-8, сопоставление путей с паттернами.
 */

import fs from 'fs';
import { DEFAULT_IGNORE_DIRS, DEFAULT_IGNORE_PATTERNS } from '../ntgraph/Types';

/**
 * Простое сопоставление glob-паттерна с путём файла.
 */
function matchGlob(filePath: string, pattern: string): boolean {
  const pSegs = pattern.split('/');
  const fSegs = filePath.split('/');
  return matchGlobSegs(pSegs, 0, fSegs, 0);
}

function matchGlobSegs(pSegs: string[], pi: number, fSegs: string[], fi: number): boolean {
  if (pi === pSegs.length) return fi === fSegs.length;
  if (fi > fSegs.length) return false;
  const pSeg = pSegs[pi];
  if (pSeg === '**') {
    for (let skip = 0; skip <= fSegs.length - fi; skip++) {
      if (matchGlobSegs(pSegs, pi + 1, fSegs, fi + skip)) return true;
    }
    return false;
  }
  if (fi === fSegs.length) return false;
  if (segMatch(pSeg, fSegs[fi])) {
    return matchGlobSegs(pSegs, pi + 1, fSegs, fi + 1);
  }
  return false;
}

function segMatch(pSeg: string, fSeg: string): boolean {
  let pi = 0;
  let fi = 0;
  let starPi = -1;
  let starFi = -1;
  while (fi < fSeg.length) {
    const pc = pSeg[pi];
    if (pc === '*') {
      starPi = pi + 1;
      starFi = fi;
      pi++;
    } else if (pc === '?' || pc === fSeg[fi]) {
      pi++;
      fi++;
    } else if (starPi !== -1) {
      pi = starPi;
      starFi++;
      fi = starFi;
    } else {
      return false;
    }
  }
  while (pi < pSeg.length && pSeg[pi] === '*') pi++;
  return pi === pSeg.length;
}

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

    let pattern: string;

    // Двойные !! — negation pattern (отмена игнорирования)
    if (line.startsWith('!!')) {
      pattern = '!' + line.slice(1);
    }
    // Отрицательные паттерны
    else if (line.startsWith('!')) {
      pattern = line;
    }
    // Обычные паттерны
    else {
      pattern = line;
    }

    // Validate pattern at read time — drop invalid regex
    if (patternToRegex(pattern) === null) {
      console.warn(`[Gitignore] Пропущен невалидный паттерн: ${pattern}`);
      continue;
    }

    patterns.push(pattern);
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
function patternToRegex(pattern: string): IGitignorePatternResult | null {
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

  try {
    const re = new RegExp(regexSource);
    return { re, isNegation, dirOnly };
  } catch {
    console.warn(`[Gitignore] Неверный regex для паттерна: ${pattern}`);
    return null;
  }
}

/**
 * Сопоставляет путь файла с gitignore-паттерном.
 * Возвращает true, если паттерн совпадает с путём.
 * Негативные паттерны (!) возвращают true — значит "не игнорировать".
 */
export function matchGitignorePattern(filePath: string, pattern: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/');

  // Оборачиваем в try-catch: невалидные паттерны игнорируются
  let result: IGitignorePatternResult | null;
  try {
    result = patternToRegex(pattern);
  } catch {
    console.warn(`[Gitignore] Ошибка обработки паттерна: ${pattern}`);
    return false;
  }
  if (!result) return false;
  const { re, isNegation, dirOnly } = result;

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

/**
 * Класс для управления игнорированием файлов с поддержкой
 * вложенных репозиториев и gitignore-паттернов.
 */
export class ScopeIgnore {
  private readonly _baseDir: string;
  private readonly _embeddedRepoRoots: string[];
  private readonly _customPatterns: Set<string>;

  constructor(baseDir: string, embeddedRepoRoots: string[]) {
    // Нормализуем разделители на POSIX-стиль
    this._baseDir = baseDir.replace(/\\/g, '/').replace(/\/+$/, '');
    this._embeddedRepoRoots = embeddedRepoRoots.map(r =>
      r.replace(/\\/g, '/').replace(/\/+$/, '')
    );
    this._customPatterns = new Set();
  }

  /**
   * Проверяет, следует ли игнорировать указанный файл.
   * Пути сравниваются относительно baseDir.
   * Файлы в вложенных репозиториях не игнорируются.
   */
  shouldIgnore(filePath: string): boolean {
    // Нормализуем разделители
    const norm = filePath.replace(/\\/g, '/').replace(/\/+$/, '');

    // Файлы в вложенных репозиториях не игнорируются
    for (const root of this._embeddedRepoRoots) {
      if (norm === root || norm.startsWith(root + '/')) {
        return false;
      }
    }

    // Проверяем компоненты пути на совпадение с игнорируемыми директориями
    const parts = norm.split('/');
    for (const part of parts) {
      if (DEFAULT_IGNORE_DIRS.has(part)) return true;
    }

    // Проверяем паттерны по умолчанию
    for (const pat of DEFAULT_IGNORE_PATTERNS) {
      if (matchGlob(norm, pat)) return true;
    }

    // Проверяем пользовательские паттерны
    for (const pat of this._customPatterns) {
      if (matchGlob(norm, pat)) return true;
    }

    // Вычисляем относительный путь от baseDir
    const relPath = this._relativePath(norm);
    if (relPath === null) {
      // Путь не находится под baseDir — не игнорируем
      return false;
    }

    // Применяем gitignore-паттерны последовательно (gitignore-логика:
    // последний совпавший паттерн определяет результат)
    let ignored = false;

    for (const pattern of this._customPatterns) {
      if (pattern.startsWith('!')) continue;
      const result = matchGitignorePattern(relPath, pattern);

      if (result) {
        ignored = true;
      }
    }

    return ignored;
  }

  /**
   * Добавляет пользовательский паттерн игнорирования.
   */
  addPattern(pattern: string): void {
    this._customPatterns.add(pattern.replace(/\\/g, '/'));
  }

  /**
   * Вычисляет относительный путь от baseDir.
   * Возвращает null, если путь не находится под baseDir.
   */
  private _relativePath(absPath: string): string | null {
    if (absPath === this._baseDir) {
      return '';
    }

    if (absPath.startsWith(this._baseDir + '/')) {
      return absPath.slice(this._baseDir.length + 1);
    }

    return null;
  }
}
