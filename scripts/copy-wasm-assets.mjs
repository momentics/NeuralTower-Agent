// Копирует WASM-ассеты в out/:
//   1) рантайм web-tree-sitter: node_modules/web-tree-sitter/tree-sitter.wasm
//      → out/tree-sitter.wasm (CJS-бандл находит его по __dirname);
//   2) грамматики из манифеста: node_modules/tree-sitter-wasms/out/<file>
//      → out/wasm/<file> (WasmRuntime.resolveWasmDir в бандле).
// Использование: node scripts/copy-wasm-assets.mjs
import { cpSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, 'out');

// 1) Рантайм web-tree-sitter
const runtimeSrc = path.join(root, 'node_modules', 'web-tree-sitter', 'tree-sitter.wasm');
if (!existsSync(runtimeSrc)) {
  console.error('Не найден ' + runtimeSrc + ' — выполните npm install');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
cpSync(runtimeSrc, path.join(outDir, 'tree-sitter.wasm'));

// 2) Грамматики из манифеста
const manifest = JSON.parse(
  readFileSync(path.join(root, 'src', 'repo', 'extraction', 'wasm-manifest.json'), 'utf8')
);
const wasmsDir = path.join(root, 'node_modules', 'tree-sitter-wasms', 'out');
const destDir = path.join(outDir, 'wasm');
mkdirSync(destDir, { recursive: true });
let copied = 0;
for (const [lang, file] of Object.entries(manifest.grammars)) {
  const src = path.join(wasmsDir, file);
  if (!existsSync(src)) {
    console.error(`Не найдена грамматика "${lang}": ${src}`);
    process.exit(1);
  }
  cpSync(src, path.join(destDir, file));
  copied++;
}
console.log(`WASM-ассеты: рантайм + ${copied} грамматик → out/`);
