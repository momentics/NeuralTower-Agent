/**
 * Функциональные тесты WASM-экстракции: каждый язык реально парсится
 * web-tree-sitter и выдаёт ожидаемые узлы (не parse_error).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadGrammarsForLanguages } from '../WasmRuntime';
import { extractFromSource } from './registry';

interface Case {
  language: string;
  filePath: string;
  content: string;
  /** Имя узла, которое ОБЯЗАТЕЛЬНО должно быть извлечено. */
  expectNodeName: string;
  /** Ожидаемый kind узла. Если экстрактор детерминированно выдаёт другой
   *  kind для того же имени — поправить kind в тесте под реальный вывод
   *  экстрактора. Имя узла и отсутствие parse_error — не обсуждаются. */
  expectKind: string;
}

const CASES: Case[] = [
  {
    language: 'typescript',
    filePath: 'a.ts',
    content: 'export class Greeter { greet(): string { return "hi"; } }',
    expectNodeName: 'Greeter',
    expectKind: 'class',
  },
  {
    language: 'tsx',
    filePath: 'a.tsx',
    content: 'export const Comp = () => <div>hi</div>;',
    expectNodeName: 'Comp',
    expectKind: 'variable',
  },
  {
    language: 'javascript',
    filePath: 'a.js',
    content: 'export function hello() { return "world"; }',
    expectNodeName: 'hello',
    expectKind: 'function',
  },
  {
    language: 'python',
    filePath: 'a.py',
    content: 'class Greeter:\n    def greet(self):\n        return "hi"\n',
    expectNodeName: 'Greeter',
    expectKind: 'class',
  },
  {
    language: 'go',
    filePath: 'a.go',
    content: 'package main\n\nfunc add(a int, b int) int { return a + b }\n',
    expectNodeName: 'add',
    expectKind: 'function',
  },
  {
    language: 'rust',
    filePath: 'a.rs',
    content: 'fn add(a: i32, b: i32) -> i32 { a + b }\nstruct Point { x: i32 }\n',
    expectNodeName: 'add',
    expectKind: 'function',
  },
  {
    language: 'java',
    filePath: 'a.java',
    content: 'class Foo { int bar(int x) { return x + 1; } }',
    expectNodeName: 'Foo',
    expectKind: 'class',
  },
  {
    language: 'c',
    filePath: 'a.c',
    content: 'int add(int a, int b) { return a + b; }',
    expectNodeName: 'add',
    expectKind: 'function',
  },
  {
    // .h детектируется как 'c' и требует двойного парсинга (c + cpp):
    // кейс проверяет, что обе грамматики загружаются для языка 'c'
    // (grammarNamesForLanguage('c') → ['c', 'cpp']).
    language: 'c',
    filePath: 'a.h',
    content: 'int add(int a, int b);\n',
    expectNodeName: 'add',
    expectKind: 'function',
  },
  {
    language: 'cpp',
    filePath: 'a.cpp',
    content: 'class Foo { public: int bar(int x); };\nint Foo::bar(int x) { return x + 1; }',
    expectNodeName: 'Foo',
    expectKind: 'class',
  },
  {
    language: 'csharp',
    filePath: 'a.cs',
    content: 'class Foo { public int Bar(int x) { return x + 1; } }',
    expectNodeName: 'Foo',
    expectKind: 'class',
  },
  {
    language: 'kotlin',
    filePath: 'a.kt',
    content: 'class Foo {\n    fun bar(x: Int): Int {\n        return x + 1\n    }\n}',
    expectNodeName: 'Foo',
    expectKind: 'class',
  },
  {
    language: 'swift',
    filePath: 'a.swift',
    content: 'class Foo { func bar(_ x: Int) -> Int { x + 1 } }',
    expectNodeName: 'Foo',
    expectKind: 'class',
  },
  {
    language: 'php',
    filePath: 'a.php',
    content: '<?php\nfunction foo($x) { return $x + 1; }\nclass Bar {}\n',
    expectNodeName: 'foo',
    expectKind: 'function',
  },
  {
    // Экстрактор Ruby создаёт NodeKind.Method для method_definition
    // (def foo) — проверено в §1.6, ожидание соответствует реальному выводу.
    language: 'ruby',
    filePath: 'a.rb',
    content: 'def foo(x)\n  x + 1\nend\nclass Bar; end\n',
    expectNodeName: 'foo',
    expectKind: 'method',
  },
  {
    language: 'vue',
    filePath: 'a.vue',
    content: '<template><div @click="onTap">x</div></template>\n<script>\nexport function onTap() {}\n</script>\n',
    expectNodeName: 'onTap',
    expectKind: 'function',
  },
  {
    language: 'svelte',
    filePath: 'a.svelte',
    content: '<script>\nexport function hello() { return "world"; }\n</script>\n<h1>hi</h1>\n',
    expectNodeName: 'hello',
    expectKind: 'function',
  },
  {
    language: 'astro',
    filePath: 'a.astro',
    content: '---\nexport const title = "x";\n---\n<h1>hi</h1>\n',
    expectNodeName: 'title',
    expectKind: 'variable',
  },
];

describe('WASM extraction (functional)', () => {
  beforeAll(async () => {
    await loadGrammarsForLanguages(CASES.map((c) => c.language));
  }, 60000);

  for (const c of CASES) {
    it(`${c.language} (${c.filePath})`, () => {
      const result = extractFromSource(c.filePath, c.content, c.language);
      expect(
        result.errors.filter((e) => e.code === 'parse_error'),
        `parse_error для ${c.language}: ${result.errors.map((e) => e.message).join('; ')}`,
      ).toHaveLength(0);
      expect(
        result.nodes.some((n) => n.name === c.expectNodeName),
        `узел "${c.expectNodeName}" не найден; извлечено: ${result.nodes.map((n) => `${n.kind}:${n.name}`).join(', ')}`,
      ).toBe(true);
      const found = result.nodes.find((n) => n.name === c.expectNodeName);
      expect(found!.kind).toBe(c.expectKind);
    });
  }
});
