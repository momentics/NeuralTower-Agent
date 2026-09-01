import { describe, it, expect } from 'vitest';
import { GenericAstExtractor, YamlExtractor } from './GenericAst';
import { GENERIC_SPECS } from './generic-specs';

describe('GenericAstExtractor', () => {
  it('нет загруженной грамматики — parse_error', () => {
    const extractor = new GenericAstExtractor(GENERIC_SPECS.solidity);
    const result = extractor.extract('contract X {}', 'a.sol');
    // В среде без инициализированного WASM-рантайма парсер не загружен
    expect(result.errors.some((e) => e.code === 'parse_error')).toBe(true);
  });

  it('YamlExtractor: верхнеуровневые ключи — узлы', () => {
    const extractor = new YamlExtractor();
    const result = extractor.extract('name: demo\nnested:\n  a: 1\nversion: 1.0.0\n', 'a.yaml');
    // Проверяем только variable-узлы: module-узел тоже называется 'a' (от имени файла)
    const names = result.nodes.filter((n) => n.kind === 'variable').map((n) => n.name);
    expect(names).toContain('name');
    expect(names).toContain('version');
    // Вложенные ключи не раскрываются
    expect(names).not.toContain('a');
    expect(result.errors).toHaveLength(0);
  });

  it('YamlExtractor: пустой документ — только file/module', () => {
    const extractor = new YamlExtractor();
    const result = extractor.extract('', 'a.yaml');
    expect(result.nodes.filter((n) => n.kind !== 'file' && n.kind !== 'module')).toHaveLength(0);
  });
});
