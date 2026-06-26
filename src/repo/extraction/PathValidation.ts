/**
 * Валидация и фильтрация путей файлов для индексации.
 * Определяет, должен ли файл быть проиндексирован.
 */

import fs from 'fs';
import path from 'path';
import { DEFAULT_IGNORE_DIRS, DEFAULT_IGNORE_PATTERNS, MAX_FILE_SIZE } from '../ntgraph/Types';

/**
 * Проверяет, содержит ли буфер бинарные данные.
 * Файл считается бинарным, если содержит нулевой байт или
 * доля непечатных символов превышает порог.
 */
export function isBinaryFile(content: Buffer): boolean {
  if (content.length === 0) return false;

  // Наличие нулевого байта — признак бинарного файла
  if (content.indexOf(0) !== -1) return true;

  const threshold = 0.3;
  let nonPrintable = 0;

  for (let i = 0; i < content.length; i++) {
    const byte = content[i];
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) {
      nonPrintable++;
    }
  }

  return nonPrintable / content.length > threshold;
}

/**
 * Проверяет, превышает ли размер файла допустимый лимит.
 */
export function isTooLarge(size: number): boolean {
  return size > MAX_FILE_SIZE;
}

/**
 * Вычисляет относительный путь от корня проекта.
 */
export function resolveRelativePath(filePath: string, projectRoot: string): string {
  return path.relative(projectRoot, filePath);
}

/**
 * Определяет, должен ли файл быть проиндексирован.
 * Проверяет игнорируемые директории, паттерны, бинарность и размер.
 */
export function shouldIndexFile(
  filePath: string,
  ignoreDirs: ReadonlySet<string> = DEFAULT_IGNORE_DIRS,
  ignorePatterns: string[] = DEFAULT_IGNORE_PATTERNS
): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/');

  // Проверка на игнорируемые родительские директории
  const segments = normalizedPath.split('/');
  for (const segment of segments) {
    if (ignoreDirs.has(segment)) {
      return false;
    }
  }

  // Проверка на игнорируемые паттерны
  for (const pattern of ignorePatterns) {
    if (normalizedPath.includes(pattern)) {
      return false;
    }
  }

  return true;
}

/**
 * Защита от path traversal атак.
 * Проверяет, что разрешённый путь находится внутри rootDir.
 * Если путь выходит за пределы rootDir, бросает ошибку с кодом 'path_traversal'.
 * Опция allowSymlinkEscape позволяет выходить за пределы через symlink (по умолчанию false).
 */
export function validatePathWithinRoot(
  rootDir: string,
  relativePath: string,
  options?: { allowSymlinkEscape?: boolean },
): void {
  const resolved = path.resolve(rootDir, relativePath);

  // Нормализуем rootDir для корректного сравнения
  const normalizedRoot = path.resolve(rootDir);

  // Проверяем, что путь находится внутри rootDir
  if (!resolved.startsWith(normalizedRoot + path.sep) && resolved !== normalizedRoot) {
    throw Object.assign(
      new Error(`Обнаружен path traversal: ${resolved} находится вне ${normalizedRoot}`),
      { code: 'path_traversal' },
    );
  }

  // Если symlink escape запрещён, проверяем реальный путь
  if (options?.allowSymlinkEscape !== true) {
    try {
      const realRoot = fs.realpathSync(normalizedRoot);
      const realResolved = fs.realpathSync(resolved);

      if (
        !realResolved.startsWith(realRoot + path.sep) &&
        realResolved !== realRoot
      ) {
        throw Object.assign(
          new Error(`Обнаружен symlink escape: ${realResolved} находится вне ${realRoot}`),
          { code: 'path_traversal' },
        );
      }
    } catch (err: unknown) {
      // Если ошибка не path_traversal, это может быть ошибка доступа — пропускаем
      if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'path_traversal') {
        throw err;
      }
    }
  }
}

/**
 * Нормализация пути: замена обратных слешей на прямые,
 * разрешение '..' и '.' сегментов.
 */
export function normalizePath(filePath: string): string {
  return path.normalize(filePath).replace(/\\/g, '/');
}
