/**
 * WASM-рантайм tree-sitter (web-tree-sitter 0.25.x).
 *
 * Единый модуль для основного потока и воркеров парсинга: инициализация
 * рантайма, загрузка грамматик из .wasm-файлов (только из байтов),
 * выдача готовых синхронных Parser-инстансов экстракторам.
 *
 * Расположение wasm-файлов:
 * - бандл (out/extension.js, out/ParserWorker.js): out/wasm/ (копируется
 *   сборкой, scripts/copy-wasm-assets.mjs); рантайм tree-sitter.wasm лежит
 *   рядом с бандлом (out/tree-sitter.wasm) — CJS-сборка web-tree-sitter
 *   находит его по __dirname без аргументов у Parser.init();
 * - dev (vitest, исходники TS): node_modules/tree-sitter-wasms/out и
 *   node_modules/web-tree-sitter (свой tree-sitter.wasm рядом с кодом).
 */

import * as fs from 'fs';
import * as path from 'path';
import { Parser, Language } from 'web-tree-sitter';
import { WASM_MANIFEST, grammarNamesForLanguage } from './wasm-manifest';

let initPromise: Promise<void> | null = null;
const loadedLanguages = new Map<string, Language>();
const parsers = new Map<string, Parser>();

/** Инициализирует WASM-рантайм (идемпотентно). */
export function initWasmRuntime(): Promise<void> {
  if (!initPromise) {
    initPromise = Parser.init().catch((err) => {
      initPromise = null; // после сбоя разрешаем повторную попытку
      throw err;
    });
  }
  return initPromise;
}

/** Директория с файлами tree-sitter-*.wasm (или null, если не найдена). */
export function resolveWasmDir(): string | null {
  // Бандл (CJS): __dirname = out/. Dev (vitest): каталог исходников —
  // поэтому dev-кандидат ведёт от корня репо (тесты запускаются из корня).
  const here = typeof __dirname !== 'undefined' ? __dirname : process.cwd();
  const candidates = [
    path.join(here, 'wasm'), // бандл: out/wasm
    path.join(process.cwd(), 'node_modules', 'tree-sitter-wasms', 'out'), // dev: корень/node_modules
  ];
  for (const c of candidates) {
    try {
      if (fs.statSync(path.join(c, 'tree-sitter-typescript.wasm')).isFile()) return c;
    } catch {
      // кандидата нет — пробуем следующий
    }
  }
  return null;
}

/**
 * Загружает грамматику по имени (идемпотентно).
 * Возвращает false, если грамматика недоступна (файл не найден, краш
 * загрузки) — экстрактор тогда вернёт быстрый parse_error.
 */
export async function loadGrammarWasm(grammarName: string): Promise<boolean> {
  if (loadedLanguages.has(grammarName)) return true;
  const file = WASM_MANIFEST[grammarName];
  if (!file) return false;
  const dir = resolveWasmDir();
  if (!dir) return false;
  try {
    const bytes = fs.readFileSync(path.join(dir, file));
    await initWasmRuntime();
    const lang = await Language.load(bytes);
    const p = new Parser();
    p.setLanguage(lang);
    loadedLanguages.set(grammarName, lang);
    parsers.set(grammarName, p);
    return true;
  } catch {
    return false;
  }
}

/** Загружает все грамматики, необходимые для указанных языков. */
export async function loadGrammarsForLanguages(languages: string[]): Promise<void> {
  const names = new Set<string>();
  for (const lang of languages) {
    for (const name of grammarNamesForLanguage(lang)) names.add(name);
  }
  await Promise.all([...names].map((n) => loadGrammarWasm(n)));
}

/** Готовый синхронный парсер для имени грамматики (или null). */
export function getParser(grammarName: string): Parser | null {
  return parsers.get(grammarName) ?? null;
}

/**
 * Готовый синхронный парсер для языка и пути к файлу (или null).
 * Разбирает варианты ts/tsx/js/jsx, vue/svelte/astro и c/cpp.
 */
export function getParserForFile(language: string, filePath: string): Parser | null {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  const isTsFamily =
    language === 'typescript' || language === 'javascript' ||
    language === 'tsx' || language === 'jsx';
  const name = isTsFamily
    ? (ext === '.tsx' || ext === '.jsx' ? 'tsx' : 'typescript')
    : (language === 'vue' || language === 'svelte' || language === 'astro'
        ? 'typescript'
        : language);
  return parsers.get(name) ?? null;
}

/** Загружена ли грамматика. */
export function isGrammarLoaded(grammarName: string): boolean {
  return loadedLanguages.has(grammarName);
}
