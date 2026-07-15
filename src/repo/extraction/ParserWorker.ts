import { Worker } from 'worker_threads';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  WORKER_RECYCLE_INTERVAL,
  PARSE_TIMEOUT_MS,
  PARSE_TIMEOUT_PER_10KB,
  IExtractionResult,
} from '../ntgraph/Types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface PendingParse {
  resolve: (value: IExtractionResult) => void;
  reject: (reason: any) => void;
  timeout: NodeJS.Timeout;
  filePath: string;
  content: string;
  frameworkNames: string[];
  language: string;
  rejected: boolean;
}

/**
 * Вычисляет таймаут парсинга на основе размера файла.
 */
function calcTimeout(content: string): number {
  const sizeKB = content.length / 1024;
  return PARSE_TIMEOUT_MS + (sizeKB / 10) * PARSE_TIMEOUT_PER_10KB;
}

/**
 * Парсит файл в основном процессе (фолбэк без воркеров).
 */
async function parseInProcess(
  language: string,
  content: string,
  filePath: string,
  frameworkNames: string[],
  languages: string[],
): Promise<IExtractionResult> {
  const { loadGrammarsForLanguages } = await import('./Grammars');
  await loadGrammarsForLanguages(languages);

  const { extractFromSource } = await import('./tree-sitter');
  return extractFromSource(filePath, content, language, frameworkNames);
}

class ParserWorkerManager {
  private worker: Worker | null = null;
  private pendingParses = new Map<number, PendingParse>();
  private parseCount = 0;
  private isDestroyed = false;
  private nextRequestId = 0;
  private languages: string[] = [];
  // Путь к скрипту воркера.
  private workerScriptPath = path.join(__dirname, 'ParserWorker.script.js');
  private workerThreadsAvailable: boolean;

  constructor() {
    try {
      require.resolve('worker_threads');
      this.workerThreadsAvailable = true;
    } catch {
      this.workerThreadsAvailable = false;
    }
  }

  private createWorker(): Worker {
    const worker = new Worker(this.workerScriptPath, {
      eval: false,
      workerData: {},
    });

    // Воркер завершился неожиданно.
    worker.on('exit', (code) => {
      if (code !== 0) {
        const pending = Array.from(this.pendingParses.entries());
        this.rejectAllPending(new Error('Воркер завершился с кодом ' + code));
        this.ensureWorker()
          .then(() => this.loadGrammars(this.languages))
          .then(() => {
            for (const [id, req] of pending) {
              this.retryParse(id, req);
            }
          })
          .catch(() => {});
      }
    });

    // Ошибка в воркере.
    worker.on('error', (err) => {
      const pending = Array.from(this.pendingParses.entries());
      this.rejectAllPending(err);
      this.ensureWorker()
        .then(() => this.loadGrammars(this.languages))
        .then(() => {
          for (const [id, req] of pending) {
            this.retryParse(id, req);
          }
        })
        .catch(() => {});
    });

    // Обработка ответов от воркера.
    worker.on('message', (msg: any) => {
      if (msg.type === 'parse-result') {
        const req = this.pendingParses.get(msg.id);
        if (req) {
          this.pendingParses.delete(msg.id);
          req.resolve(msg.result);
        }
      } else if (msg.type === 'error') {
        const req = this.pendingParses.get(msg.id);
        if (req) {
          this.pendingParses.delete(msg.id);
          req.reject(new Error(msg.message));
        }
      }
    });

    return worker;
  }

  public rejectAllPending(reason: Error) {
    for (const [id, req] of this.pendingParses) {
      clearTimeout(req.timeout);
      if (!req.rejected) {
        req.rejected = true;
        req.reject(reason);
      }
    }
    this.pendingParses.clear();
  }

  private rejectAllPendingAbort(reason: Error) {
    for (const [id, req] of this.pendingParses) {
      clearTimeout(req.timeout);
      req.reject(reason);
      this.pendingParses.delete(id);
    }
  }

  /**
   * Пересоздаёт воркер: завершает текущий и создаёт новый.
   */
  public async recycleWorker() {
    if (this.worker) {
      try {
        await this.worker.terminate();
      } catch {
        // Игнорируем ошибки при завершении мёртвого воркера.
      }
      this.worker = null;
    }
    this.worker = this.createWorker();
  }

  /**
   * Обеспечивает наличие воркера: создаёт, если ещё не создан.
   */
  private async ensureWorker(): Promise<void> {
    if (!this.worker) {
      this.worker = this.createWorker();
    }
  }

  async loadGrammars(languages: string[]): Promise<void> {
    this.languages = languages;
    await this.ensureWorker();
    if (!this.worker) {
      throw new Error('Worker is null after ensureWorker');
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Таймаут загрузки грамматик'));
      }, 30000);

      const handler = (msg: any) => {
        if (msg.type === 'grammars-loaded') {
          clearTimeout(timeout);
          this.worker!.off('message', handler);
          resolve();
        }
      };

      this.worker!.on('message', handler);
      this.worker!.postMessage({ type: 'load-grammars', languages });
    });
  }

  private sendParseRequest(
    filePath: string,
    content: string,
    frameworkNames: string[],
    language: string,
    signal?: AbortSignal,
  ): Promise<IExtractionResult> {
    const timeout = calcTimeout(content);
    const requestId = this.nextRequestId++;

    if (signal?.aborted) {
      return Promise.reject(new DOMException('Operation aborted', 'AbortError'));
    }

    return new Promise((resolve, reject) => {
      // Таймаут для запроса.
      const timeoutId = setTimeout(() => {
        this.pendingParses.delete(requestId);
        reject(new Error('Таймаут парсинга: ' + timeout + 'ms'));
        this.worker?.terminate().catch(() => {});
      }, timeout);

      // Abort listener для асинхронной отмены.
      const onAbort = () => {
        this.rejectAllPendingAbort(new DOMException('Operation aborted', 'AbortError'));
        this.worker?.terminate().catch(() => {});
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      const pending: PendingParse = {
        resolve: (value) => {
          signal?.removeEventListener('abort', onAbort);
          clearTimeout(timeoutId);
          resolve(value);
        },
        reject: (reason) => {
          signal?.removeEventListener('abort', onAbort);
          clearTimeout(timeoutId);
          reject(reason);
        },
        timeout: timeoutId,
        filePath,
        content,
        frameworkNames,
        language,
        rejected: false,
      };

      this.pendingParses.set(requestId, pending);

      // Отправляем сообщение воркеру с id запроса.
      this.worker!.postMessage({
        type: 'parse',
        id: requestId,
        filePath,
        content,
        frameworkNames,
        language,
      });
    });
  }

  private retryParse(id: number, req: PendingParse): void {
    // Генерируем новый ID запроса, так как старый устарел после отклонения.
    const newId = this.nextRequestId++;

    // Вычисляем таймаут для повторного запроса.
    const timeout = calcTimeout(req.content);

    // Устанавливаем таймаут для нового запроса.
    const timeoutId = setTimeout(() => {
      this.pendingParses.delete(newId);
      req.reject(new Error('Таймаут парсинга: ' + timeout + 'ms'));
      this.worker?.terminate().catch(() => {});
    }, timeout);

    // Создаём новый PendingParse с обновлённым таймаутом, но теми же resolve/reject.
    const newPending: PendingParse = {
      resolve: (value) => {
        clearTimeout(timeoutId);
        req.resolve(value);
      },
      reject: (reason) => {
        clearTimeout(timeoutId);
        req.reject(reason);
      },
      timeout: timeoutId,
      filePath: req.filePath,
      content: req.content,
      frameworkNames: req.frameworkNames,
      language: req.language,
      rejected: false,
    };

    // Добавляем новый запрос в карту ожидающих парсингов.
    this.pendingParses.set(newId, newPending);

    // Отправляем запрос на парсинг в восстановленный воркер.
    this.worker!.postMessage({
      type: 'parse',
      id: newId,
      filePath: req.filePath,
      content: req.content,
      frameworkNames: req.frameworkNames,
      language: req.language,
    });
  }

  private async parseWithRecovery(
    filePath: string,
    content: string,
    frameworkNames: string[],
    language: string,
    level: number = 0,
    signal?: AbortSignal,
  ): Promise<IExtractionResult> {
    if (signal?.aborted) {
      throw new DOMException('Operation aborted', 'AbortError');
    }

    try {
      // Проверяем, нужно ли пересоздать воркер.
      if (this.parseCount > 0 && this.parseCount % WORKER_RECYCLE_INTERVAL === 0) {
        await this.recycleWorker();
        await this.loadGrammars(this.languages);
      }

      this.parseCount++;

      await this.ensureWorker();

      return await this.sendParseRequest(filePath, content, frameworkNames, language, signal);
    } catch (err: any) {
      // Восстановление после сбоя воркера.
      if (level === 0) {
        // Уровень 1: пересоздание воркера и повторная попытка
        await this.recycleWorker();
        await this.loadGrammars(this.languages);
        return this.parseWithRecovery(filePath, content, frameworkNames, language, 1, signal);
      }

      if (level === 1) {
        // Уровень 2: удаление комментариев и повторная попытка
        const stripped = this.stripComments(content, language);
        return this.parseWithRecovery(filePath, stripped, frameworkNames, language, 2, signal);
      }

      throw err;
    }
  }

  private stripComments(content: string, language: string): string {
    const lines = content.split('\n');

    if (language === 'typescript' || language === 'cpp' || language === 'csharp' || language === 'java') {
      const result: string[] = [];
      let inBlockComment = false;

      for (const line of lines) {
        let processed = line;

        if (inBlockComment) {
          const endIdx = processed.indexOf('*/');
          if (endIdx !== -1) {
            processed = processed.slice(endIdx + 2);
            inBlockComment = false;
          } else {
            result.push('');
            continue;
          }
        }

        const singleLine = processed.indexOf('//');
        if (singleLine !== -1) {
          processed = processed.slice(0, singleLine);
        }

        const blockStart = processed.indexOf('/*');
        if (blockStart !== -1) {
          const blockEnd = processed.indexOf('*/', blockStart + 2);
          if (blockEnd !== -1) {
            processed = processed.slice(0, blockStart) + processed.slice(blockEnd + 2);
          } else {
            processed = processed.slice(0, blockStart);
            inBlockComment = true;
          }
        }

        result.push(processed);
      }

      return result.join('\n');
    }

    if (language === 'python') {
      // Python: # комментарии удаляются, но # внутри тройных кавычек
      // (строки и docstrings) сохраняются
      const result: string[] = [];
      let inTripleSingle = false;
      let inTripleDouble = false;

      for (const line of lines) {
        if (inTripleSingle || inTripleDouble) {
          const quote = inTripleSingle ? "'''" : '"""';
          const endIdx = line.indexOf(quote);
          if (endIdx !== -1) {
            const rest = line.slice(endIdx + 3);
            const stripped = this.stripPythonLineComments(rest);
            result.push(stripped);
            if (inTripleSingle) inTripleSingle = false;
            else inTripleDouble = false;
          } else {
            result.push(line);
          }
          continue;
        }

        const tripleSingleIdx = line.indexOf("'''");
        const tripleDoubleIdx = line.indexOf('"""');

        if (tripleSingleIdx !== -1 || tripleDoubleIdx !== -1) {
          const firstIdx = Math.min(
            tripleSingleIdx !== -1 ? tripleSingleIdx : Infinity,
            tripleDoubleIdx !== -1 ? tripleDoubleIdx : Infinity,
          );

          const quote = firstIdx === tripleSingleIdx ? "'''" : '"""';
          const closeIdx = line.indexOf(quote, firstIdx + 3);

          if (closeIdx !== -1) {
            const before = line.slice(0, firstIdx);
            const after = line.slice(closeIdx + 3);
            const strippedBefore = this.stripPythonLineComments(before);
            const strippedAfter = this.stripPythonLineComments(after);
            result.push(strippedBefore + quote + line.slice(firstIdx + 3, closeIdx) + quote + strippedAfter);
          } else {
            const before = line.slice(0, firstIdx);
            const strippedBefore = this.stripPythonLineComments(before);
            result.push(strippedBefore + line.slice(firstIdx));
            if (quote === "'''") inTripleSingle = true;
            else inTripleDouble = true;
          }
        } else {
          const stripped = this.stripPythonLineComments(line);
          result.push(stripped);
        }
      }

      return result.join('\n');
    }

    if (language === 'go' || language === 'rust') {
      const result: string[] = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('#') || trimmed.startsWith('//')) {
          result.push('');
        } else {
          const commentIdx = line.indexOf('#');
          if (commentIdx !== -1) {
            result.push(line.slice(0, commentIdx));
          } else {
            result.push(line);
          }
        }
      }

      return result.join('\n');
    }

    return content;
  }

  /** Удаляет # комментарии из одной строки Python (вне тройных кавычек). */
  private stripPythonLineComments(line: string): string {
    const ci = line.indexOf('#');
    if (ci !== -1) return line.slice(0, ci);
    return line;
  }

  async parseFile(
    filePath: string,
    content: string,
    frameworkNames: string[],
    language: string,
    languages: string[],
    signal?: AbortSignal,
  ): Promise<IExtractionResult> {
    if (this.isDestroyed) {
      throw new Error('ParserWorkerManager уничтожен');
    }

    if (!this.workerThreadsAvailable) {
      return parseInProcess(language, content, filePath, frameworkNames, languages);
    }

    if (this.languages.length === 0 || languages.some(l => !this.languages.includes(l))) {
      await this.loadGrammars(languages);
    }

    return this.parseWithRecovery(filePath, content, frameworkNames, language, 0, signal);
  }

  async destroy() {
    this.isDestroyed = true;

    if (this.worker) {
      try {
        await this.worker.terminate();
      } catch {
        // Игнорируем.
      }
      this.worker = null;
    }

    this.rejectAllPendingAbort(new Error('ParserWorkerManager уничтожен'));
  }
}

const manager = new ParserWorkerManager();

export async function parseFile(
  filePath: string,
  content: string,
  frameworkNames: string[],
  language: string,
  languages: string[],
  signal?: AbortSignal,
): Promise<IExtractionResult> {
  return manager.parseFile(filePath, content, frameworkNames, language, languages, signal);
}

export async function loadGrammars(languages: string[]): Promise<void> {
  return manager.loadGrammars(languages);
}

export async function destroy(): Promise<void> {
  return manager.destroy();
}

/**
 * Пересоздаёт воркер и перезагружает грамматик.
 */
export async function recycleWorker(): Promise<void> {
  await manager.recycleWorker();
  if (manager['languages'].length > 0) {
    await manager.loadGrammars(manager['languages']);
  }
}

/**
 * Отклоняет все ожидающие запросы на парсинг.
 */
export function rejectAllPending(reason?: Error): void {
  manager.rejectAllPending(reason ?? new Error('Операция отменена'));
}
