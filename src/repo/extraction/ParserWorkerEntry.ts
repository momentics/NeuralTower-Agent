/**
 * Точка входа воркера парсинга (бандлится в out/ParserWorker.js).
 *
 * Протокол (main → worker):
 *   {type:'load-grammars', languages: string[]}
 *   {type:'parse', id: number, filePath: string, content: string,
 *    language: string, frameworkNames?: string[]}
 * Worker → main:
 *   {type:'grammars-loaded'}
 *   {type:'parse-result', id: number, result: IExtractionResult, parseMs: number}
 *
 * Грамматики воркер читает с диска сам (WasmRuntime.resolveWasmDir):
 * в бандле это out/wasm/, рядом с out/ParserWorker.js. Ошибки парсинга
 * НЕ роняют воркер — возвращаются как result.errors (parse_error).
 */

import { parentPort } from 'worker_threads';
import { loadGrammarsForLanguages } from './WasmRuntime';
import { extractFromSource } from './extractors/registry';
import type { IExtractionResult } from '../ntgraph/Types';

if (!parentPort) {
  throw new Error('ParserWorkerEntry должен запуститься как worker thread');
}
const port = parentPort;

type InMessage =
  | { type: 'load-grammars'; languages: string[] }
  | { type: 'parse'; id: number; filePath: string; content: string; language: string; frameworkNames?: string[] };

port.on('message', (msg: InMessage) => {
  if (msg.type === 'load-grammars') {
    // Ошибки отдельных грамматик изолированы внутри loadGrammarWasm —
    // сообщаем 'grammars-loaded' в любом случае, чтобы пул не завис.
    loadGrammarsForLanguages(msg.languages)
      .catch(() => { /* нет доступных грамматик — экстракторы вернут parse_error */ })
      .finally(() => port.postMessage({ type: 'grammars-loaded' }));
    return;
  }
  if (msg.type === 'parse') {
    const start = Date.now();
    let result: IExtractionResult;
    try {
      result = extractFromSource(msg.filePath, msg.content, msg.language, msg.frameworkNames);
    } catch (err) {
      result = {
        nodes: [],
        edges: [],
        unresolvedReferences: [],
        errors: [{
          message: err instanceof Error ? err.message : String(err),
          filePath: msg.filePath,
          severity: 'error',
          code: 'parse_error',
        }],
        durationMs: Date.now() - start,
      };
    }
    port.postMessage({ type: 'parse-result', id: msg.id, result, parseMs: Date.now() - start });
  }
});
