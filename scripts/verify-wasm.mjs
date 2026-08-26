// Верификация WASM-грамматик: загрузка из байтов + setLanguage + parse образца.
// Использование: node scripts/verify-wasm.mjs
// (рекомендуется запуск с флагом --liftoff-only: см. план_wasm.md §1.3)
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Parser, Language } = require('web-tree-sitter');

await Parser.init();

const wasmsDir = require.resolve('tree-sitter-wasms/out/tree-sitter-c.wasm')
  .replace(/tree-sitter-c\.wasm$/, '');

// Языки, которые должны работать (совпадает с wasm-manifest.json).
const EXPECTED_OK = new Set([
  'tree-sitter-bash.wasm', 'tree-sitter-c.wasm', 'tree-sitter-c_sharp.wasm',
  'tree-sitter-cpp.wasm', 'tree-sitter-css.wasm', 'tree-sitter-dart.wasm',
  'tree-sitter-elisp.wasm', 'tree-sitter-elixir.wasm',
  'tree-sitter-embedded_template.wasm', 'tree-sitter-go.wasm',
  'tree-sitter-html.wasm', 'tree-sitter-java.wasm',
  'tree-sitter-javascript.wasm', 'tree-sitter-json.wasm',
  'tree-sitter-kotlin.wasm', 'tree-sitter-lua.wasm', 'tree-sitter-objc.wasm',
  'tree-sitter-ocaml.wasm', 'tree-sitter-php.wasm', 'tree-sitter-python.wasm',
  'tree-sitter-rescript.wasm', 'tree-sitter-ruby.wasm', 'tree-sitter-rust.wasm',
  'tree-sitter-scala.wasm', 'tree-sitter-solidity.wasm', 'tree-sitter-swift.wasm',
  'tree-sitter-toml.wasm', 'tree-sitter-tsx.wasm', 'tree-sitter-typescript.wasm',
  'tree-sitter-vue.wasm', 'tree-sitter-zig.wasm',
]);

const SAMPLES = {
  'tree-sitter-bash.wasm': "#!/bin/bash\nfoo() { echo hi; }\nmain() { foo; }\n",
  'tree-sitter-c.wasm': "int add(int a, int b) { return a + b; }\n",
  'tree-sitter-c_sharp.wasm': "class Foo { public int Bar(int x) { return x + 1; } }\n",
  'tree-sitter-cpp.wasm': "#include <vector>\nclass Foo { public: int bar(int x); };\nint Foo::bar(int x) { return x + 1; }\n",
  'tree-sitter-css.wasm': ".foo { color: red; }\n",
  'tree-sitter-dart.wasm': "class Foo { int bar(int x) { return x + 1; } }\nint main() { return 0; }\n",
  'tree-sitter-elisp.wasm': "(defun foo (x) (+ x 1))\n",
  'tree-sitter-elixir.wasm': "defmodule Foo do\n  def bar(x), do: x + 1\nend\n",
  'tree-sitter-embedded_template.wasm': "Hello {{ name }}\n",
  'tree-sitter-go.wasm': "package main\n\nfunc add(a int, b int) int { return a + b }\n",
  'tree-sitter-html.wasm': "<!DOCTYPE html>\n<html><body><div id=\"x\"></div></body></html>\n",
  'tree-sitter-java.wasm': "class Foo { int bar(int x) { return x + 1; } }\n",
  'tree-sitter-javascript.wasm': "function foo(x) { return x + 1; }\nclass Bar {}\n",
  'tree-sitter-json.wasm': "{\n  \"a\": 1\n}\n",
  'tree-sitter-kotlin.wasm': "package com.example\n\nclass Foo {\n    fun bar(x: Int): Int {\n        return x + 1\n    }\n}\n",
  'tree-sitter-lua.wasm': "function foo.bar(x) return x + 1 end\nlocal function baz() end\n",
  'tree-sitter-objc.wasm': "@interface Foo : NSObject\n@end\n@implementation Foo\n- (int)bar { return 1; }\n@end\n",
  'tree-sitter-ocaml.wasm': "let foo x = x + 1\n",
  'tree-sitter-php.wasm': "<?php\nfunction foo($x) { return $x + 1; }\nclass Bar {}\n",
  'tree-sitter-python.wasm': "def foo(x):\n    return x + 1\n\nclass Bar: ...\n",
  'tree-sitter-rescript.wasm': "module Foo = {\n  let bar = (x) => x + 1\n}\n",
  'tree-sitter-ruby.wasm': "def foo(x)\n  x + 1\nend\nclass Bar; end\n",
  'tree-sitter-rust.wasm': "fn add(a: i32, b: i32) -> i32 { a + b }\nstruct Point { x: i32 }\n",
  'tree-sitter-scala.wasm': "class Foo { def bar(x: Int): Int = x + 1 }\nobject Main { def main(args: Array[String]): Unit = {} }\n",
  'tree-sitter-solidity.wasm': "contract Foo { function bar() public pure returns (uint) { return 1; } }\n",
  'tree-sitter-swift.wasm': "class Foo { func bar(_ x: Int) -> Int { x + 1 } }\nfunc baz() {}\n",
  'tree-sitter-toml.wasm': "[foo]\nbar = 1\n",
  'tree-sitter-tsx.wasm': "const Foo = () => <div>hi</div>;\n",
  'tree-sitter-typescript.wasm': "export class Foo { bar(x: number): number { return x + 1; } }\n",
  'tree-sitter-vue.wasm': "<template><div/></template>\n<script>export default { methods: { foo() {} } }</script>\n",
  'tree-sitter-zig.wasm': "fn bar(x: i32) i32 { return x + 1; }\npub fn main() void {}\n",
};

let ok = 0;
let fail = 0;
for (const f of readdirSync(wasmsDir).sort()) {
  if (!f.endsWith('.wasm')) continue;
  const expected = EXPECTED_OK.has(f);
  try {
    const lang = await Language.load(readFileSync(wasmsDir + f));
    const p = new Parser();
    p.setLanguage(lang);
    const tree = p.parse(SAMPLES[f] ?? '// sample');
    const hasError = tree.rootNode.hasError;
    tree.delete();
    p.delete();
    if (expected) {
      if (hasError) { console.log('FAIL(parse) ' + f); fail++; }
      else { console.log('OK          ' + f); ok++; }
    } else {
      console.log('excluded    ' + f + ' (не входит в манифест)');
    }
  } catch (e) {
    if (expected) { console.log('FAIL(load)  ' + f + ' | ' + String(e.message).slice(0, 80)); fail++; }
    else console.log('excluded    ' + f + ' (не входит в манифест)');
  }
}
console.log('---');
console.log('ok: ' + ok + ' fail: ' + fail);
if (fail > 0 || ok !== EXPECTED_OK.size) {
  console.error('НЕ СОВПАДАЕТ с ожидаемой матрицей (' + EXPECTED_OK.size + ' OK)');
  process.exit(1);
}
