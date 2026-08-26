import { describe, it, expect } from 'vitest';
import {
  initWasmRuntime,
  resolveWasmDir,
  loadGrammarWasm,
  loadGrammarsForLanguages,
  getParser,
  getParserForFile,
  isGrammarLoaded,
} from './WasmRuntime';
import { grammarNamesForLanguage } from './wasm-manifest';

describe('WasmRuntime', () => {
  it('resolves wasm directory', () => {
    expect(resolveWasmDir()).not.toBeNull();
  });

  it('initializes the runtime (idempotent)', async () => {
    await expect(initWasmRuntime()).resolves.toBeUndefined();
    await expect(initWasmRuntime()).resolves.toBeUndefined();
  });

  it('loads a real grammar from bytes and returns a working parser', async () => {
    expect(isGrammarLoaded('python')).toBe(false);
    const ok = await loadGrammarWasm('python');
    expect(ok).toBe(true);
    expect(isGrammarLoaded('python')).toBe(true);

    const p = getParser('python');
    expect(p).not.toBeNull();
    const tree = p!.parse('def foo():\n    return 1\n');
    expect(tree.rootNode.hasError).toBe(false);
    tree.delete();
  });

  it('is idempotent on repeat load', async () => {
    expect(await loadGrammarWasm('python')).toBe(true);
    expect(isGrammarLoaded('python')).toBe(true);
  });

  it('returns false for unknown grammar name', async () => {
    expect(await loadGrammarWasm('nonexistent')).toBe(false);
  });

  it('loadGrammarsForLanguages loads the ts family', async () => {
    await loadGrammarsForLanguages(['typescript']);
    expect(isGrammarLoaded('typescript')).toBe(true);
    expect(isGrammarLoaded('tsx')).toBe(true);

    const p = getParserForFile('typescript', 'src/a.ts');
    expect(p).not.toBeNull();
    const tree = p!.parse('export const x = 1;');
    expect(tree.rootNode.hasError).toBe(false);
    tree.delete();
  });

  it('picks tsx grammar for .tsx files', async () => {
    await loadGrammarsForLanguages(['typescript']);
    const p = getParserForFile('tsx', 'src/a.tsx');
    expect(p).toBe(getParser('tsx'));
  });

  it('grammarNamesForLanguage maps c/cpp/vue correctly', () => {
    // 'c' всегда даёт обе грамматики (для .h нужен двойной парсинг),
    // независимо от filePath.
    expect(grammarNamesForLanguage('c', 'a.h')).toEqual(['c', 'cpp']);
    expect(grammarNamesForLanguage('c', 'a.c')).toEqual(['c', 'cpp']);
    expect(grammarNamesForLanguage('c')).toEqual(['c', 'cpp']);
    expect(grammarNamesForLanguage('cpp', 'a.cpp')).toEqual(['cpp']);
    expect(grammarNamesForLanguage('vue', 'a.vue')).toEqual(['typescript']);
    expect(grammarNamesForLanguage('svelte', 'a.svelte')).toEqual(['typescript']);
    expect(grammarNamesForLanguage('astro', 'a.astro')).toEqual(['typescript']);
    expect(grammarNamesForLanguage('kotlin', 'a.kt')).toEqual(['kotlin']);
    expect(grammarNamesForLanguage('unknown-lang')).toEqual([]);
  });
});
