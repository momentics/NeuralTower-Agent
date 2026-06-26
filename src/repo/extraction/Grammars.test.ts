import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initGrammars, loadGrammarsForLanguages, loadAllGrammars } from './Grammars';

// --- initGrammars ---
// Тесты для инициализации WASM-грамматик через web-tree-sitter
describe('initGrammars', () => {
  // Сбрасываем модули перед каждым тестом для корректного мокинга
  beforeEach(() => {
    vi.resetModules();
  });

  // Восстанавливаем все моки после каждого теста
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should not throw on successful WASM initialization', async () => {
    // Мокаем web-tree-sitter с успешной инициализацией
    vi.doMock('web-tree-sitter', () => ({
      default: {
        init: vi.fn().mockResolvedValue(undefined),
      },
    }));

    const { initGrammars: fn } = await import('./Grammars');
    await expect(fn()).resolves.not.toThrow();
  });

  it('should not throw on WASM initialization failure', async () => {
    // Мокаем web-tree-sitter с ошибкой инициализации — функция должна обработать ошибку
    vi.doMock('web-tree-sitter', () => ({
      default: {
        init: vi.fn().mockRejectedValue(new Error('WASM init failed')),
      },
    }));

    const { initGrammars: fn } = await import('./Grammars');
    await expect(fn()).resolves.not.toThrow();
  });

  it('should not throw when web-tree-sitter module import fails', async () => {
    // Мокаем сценарий, когда модуль web-tree-sitter недоступен
    vi.doMock('web-tree-sitter', () => {
      throw new Error('Module not found');
    });

    const { initGrammars: fn } = await import('./Grammars');
    await expect(fn()).resolves.not.toThrow();
  });
});

// --- loadGrammarsForLanguages ---
// Тесты для загрузки грамматик для указанного списка языков
describe('loadGrammarsForLanguages', () => {
  it('should execute without errors for a list of languages', async () => {
    await expect(loadGrammarsForLanguages(['typescript', 'python'])).resolves.not.toThrow();
  });

  it('should execute without errors for an empty list', async () => {
    await expect(loadGrammarsForLanguages([])).resolves.not.toThrow();
  });

  it('should execute without errors for a single language', async () => {
    await expect(loadGrammarsForLanguages(['go'])).resolves.not.toThrow();
  });

  it('should execute without errors for all supported languages', async () => {
    // Проверяем все 8 поддерживаемых языков одновременно
    const allLangs = ['typescript', 'python', 'go', 'rust', 'java', 'cpp', 'c', 'csharp'];
    await expect(loadGrammarsForLanguages(allLangs)).resolves.not.toThrow();
  });

  it('should return undefined', async () => {
    const result = await loadGrammarsForLanguages(['typescript']);
    expect(result).toBeUndefined();
  });
});

// --- loadAllGrammars ---
// Тесты для загрузки всех грамматик сразу
describe('loadAllGrammars', () => {
  it('should execute without errors', async () => {
    await expect(loadAllGrammars()).resolves.not.toThrow();
  });

  it('should return undefined', async () => {
    const result = await loadAllGrammars();
    expect(result).toBeUndefined();
  });

  it('should be safe for multiple calls', async () => {
    // Вызываем три раза подряд — функция должна быть идемпотентной
    await expect(loadAllGrammars()).resolves.not.toThrow();
    await expect(loadAllGrammars()).resolves.not.toThrow();
    await expect(loadAllGrammars()).resolves.not.toThrow();
  });
});
