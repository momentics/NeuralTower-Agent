/**
 * Валидация и фильтрация путей файлов для индексации.
 * Определяет, должен ли файл быть проиндексирован.
 */

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
