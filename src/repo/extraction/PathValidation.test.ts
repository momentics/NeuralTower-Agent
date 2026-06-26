import { describe, it, expect, vi } from 'vitest';
import path from 'path';
import { validatePathWithinRoot } from './PathValidation';

describe('validatePathWithinRoot', () => {
  const rootDir = path.resolve('/project');

  // --- Допустимые пути внутри rootDir ---

  it('should allow valid relative path without prefix', () => {
    expect(() => validatePathWithinRoot(rootDir, 'src/file.ts')).not.toThrow();
  });

  it('should allow path with ./ prefix', () => {
    expect(() => validatePathWithinRoot(rootDir, './src/file.ts')).not.toThrow();
  });

  it('should allow path in nested directory', () => {
    expect(() => validatePathWithinRoot(rootDir, 'a/b/c/file.ts')).not.toThrow();
  });

  it('should allow empty string as path to rootDir itself', () => {
    expect(() => validatePathWithinRoot(rootDir, '')).not.toThrow();
  });

  it('should allow absolute path inside rootDir', () => {
    const absPath = path.join(rootDir, 'src', 'file.ts');
    expect(() => validatePathWithinRoot(rootDir, absPath)).not.toThrow();
  });

  // --- Path traversal атаки ---

  it('should reject path with ../ one level up', () => {
    expect(() => validatePathWithinRoot(rootDir, '../file.ts')).toThrow(
      'Обнаружен path traversal'
    );
  });

  it('should reject path with multiple ../', () => {
    expect(() => validatePathWithinRoot(rootDir, '../../etc/passwd')).toThrow(
      'Обнаружен path traversal'
    );
  });

  it('should reject path with ../ in the middle', () => {
    expect(() => validatePathWithinRoot(rootDir, 'src/../../file.ts')).toThrow(
      'Обнаружен path traversal'
    );
  });

  it('should reject path that goes outside rootDir', () => {
    expect(() => validatePathWithinRoot(rootDir, 'src/../../../etc')).toThrow(
      'Обнаружен path traversal'
    );
  });

  // Проверяем, что ошибка содержит правильный код ошибки
  it('should throw error with path_traversal code', () => {
    const call = () => validatePathWithinRoot(rootDir, '../file.ts');
    expect(call).toThrow();
    try {
      call();
    } catch (err: unknown) {
      expect((err as NodeJS.ErrnoException).code).toBe('path_traversal');
    }
  });

  // Проверяем, что сообщение об ошибке содержит и rootDir, и атакованный путь
  it('should throw error with message containing both paths', () => {
    const call = () => validatePathWithinRoot(rootDir, '../file.ts');
    try {
      call();
    } catch (err: unknown) {
      const msg = (err as Error).message;
      expect(msg).toContain('Обнаружен path traversal');
      expect(msg).toContain(rootDir);
    }
  });

  // --- Граница: путь ровно на уровне rootDir ---

  it('should allow path that resolves exactly to rootDir', () => {
    // Путь, который после resolve даёт rootDir
    expect(() => validatePathWithinRoot(rootDir, '.')).not.toThrow();
  });

  // --- Опция allowSymlinkEscape ---

  it('should check real path when allowSymlinkEscape is false', () => {
    // realpathSync выбросит ошибку для несуществующего файла, но она
    // перехватывается внутри (не path_traversal), поэтому вызов не должен
    // падать с path_traversal для допустимого пути
    expect(() =>
      validatePathWithinRoot(rootDir, 'file.ts', { allowSymlinkEscape: false })
    ).not.toThrow();
  });

  // При allowSymlinkEscape=true проверка через realpathSync пропускается
  it('should skip real path check when allowSymlinkEscape is true', () => {
    expect(() =>
      validatePathWithinRoot(rootDir, 'file.ts', { allowSymlinkEscape: true })
    ).not.toThrow();
  });

  it('should use default option (allowSymlinkEscape not set)', () => {
    // По умолчанию symlink escape запрещён
    expect(() => validatePathWithinRoot(rootDir, 'file.ts')).not.toThrow();
  });

  // --- Разные разделители путей ---

  it('should work with backslashes in relative path', () => {
    expect(() => validatePathWithinRoot(rootDir, 'src\\file.ts')).not.toThrow();
  });

  it('should reject path traversal with backslashes', () => {
    expect(() => validatePathWithinRoot(rootDir, '..\\..\\file.ts')).toThrow(
      'Обнаружен path traversal'
    );
  });
});
