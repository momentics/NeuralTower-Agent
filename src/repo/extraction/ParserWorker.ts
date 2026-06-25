import { Worker, isMainThread } from 'worker_threads';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  WORKER_RECYCLE_INTERVAL,
  PARSE_TIMEOUT_MS,
  PARSE_TIMEOUT_PER_100KB,
} from '../ntgraph/Types';

// Путь к директории текущего модуля.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Промис, ожидающий ответа от воркера для текущего запроса.
interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
}

/**
 * Вычисляет таймаут парсинга на основе размера содержимого.
 */
function calcTimeout(content: string): number {
  const sizeKB = content.length / 1024;
  const extraChunks = Math.floor(sizeKB / 100);
  return PARSE_TIMEOUT_MS + extraChunks * PARSE_TIMEOUT_PER_100KB;
}

/**
 * Парсит файл в основном потоке (фолбэк, если worker_threads недоступен).
 */
async function parseInProcess(
  language: string,
  content: string,
  filePath: string,
): Promise<any> {
  const ts = await import('tree-sitter');
  const parser = new ts.Parser();

  const pkg = await import('tree-sitter-' + language);
  let grammar;

  if (language === 'typescript') {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.tsx') {
      grammar = pkg.TSXGrammar || pkg.default;
    } else {
      grammar = pkg.TSGrammar || pkg.default;
    }
  } else {
    grammar = pkg.default || pkg;
  }

  if (!grammar) {
    throw new Error('Не удалось загрузить грамматику для языка: ' + language);
  }

  parser.setLanguage(grammar);
  const tree = parser.parse(content);

  return {
    root: {
      type: tree.rootNode.type,
      start: tree.rootNode.startPosition,
      end: tree.rootNode.endPosition,
      childCount: tree.rootNode.childCount,
    },
    tree: tree.rootNode,
  };
}

/**
 * Управляет воркером для парсинга файлов через tree-sitter.
 * Поддерживает пересоздание воркера, восстановление после сбоев и фолбэк.
 */
class ParserWorkerManager {
  private worker: Worker | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private parseCount = 0;
  private isDestroyed = false;
  private nextRequestId = 0;

  // Путь к скрипту воркера.
  private workerScriptPath = path.join(__dirname, 'ParserWorker.script.js');

  /**
   * Создаёт новый воркер.
   */
  private createWorker(): Worker {
    const worker = new Worker(this.workerScriptPath, {
      eval: false,
      workerData: {},
    });

    // Воркер завершился unexpectedly.
    worker.on('exit', (code) => {
      const err = new Error('Воркер завершился с кодом ' + code);
      this.rejectAllPending(err);
    });

    // Ошибка в воркере.
    worker.on('error', (err) => {
      this.rejectAllPending(err);
    });

    // Обработка ответов от воркера.
    worker.on('message', (msg: any) => {
      if (msg.type === 'result') {
        const req = this.pendingRequests.get(msg.id);
        if (req) {
          this.pendingRequests.delete(msg.id);
          req.resolve(msg.tree);
        }
      } else if (msg.type === 'error') {
        const req = this.pendingRequests.get(msg.id);
        if (req) {
          this.pendingRequests.delete(msg.id);
          req.reject(new Error(msg.message));
        }
      }
    });

    return worker;
  }

  /**
   * Отклоняет все ожидающие запросы.
   */
  private rejectAllPending(reason: Error) {
    for (const [id, req] of this.pendingRequests) {
      req.reject(reason);
      this.pendingRequests.delete(id);
    }
  }

  /**
   * Пересоздаёт воркер для освобождения WASM-памяти.
   */
  private async recycleWorker() {
    if (this.worker) {
      try {
        await this.worker.terminate();
      } catch {
        // Игнорируем ошибки при завершении.
      }
      this.worker = null;
    }
    this.worker = this.createWorker();
  }

  /**
   * Отправляет запрос на парсинг воркеру.
   */
  private sendParseRequest(
    language: string,
    content: string,
    filePath: string,
    signal?: AbortSignal,
  ): Promise<any> {
    const timeout = calcTimeout(content);
    const requestId = String(this.nextRequestId++);

    return new Promise((resolve, reject) => {
      // Таймаут для запроса.
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Таймаут парсинга: ' + timeout + 'ms'));
      }, timeout);

      // Обработка отмены через AbortSignal.
      if (signal) {
        signal.addEventListener('abort', () => {
          this.pendingRequests.delete(requestId);
          clearTimeout(timeoutId);
          reject(new Error('Парсинг отменён'));
        });
      }

      const pending: PendingRequest = {
        resolve: (value) => {
          clearTimeout(timeoutId);
          resolve(value);
        },
        reject: (reason) => {
          clearTimeout(timeoutId);
          reject(reason);
        },
      };

      this.pendingRequests.set(requestId, pending);

      // Отправляем сообщение воркеру с id запроса.
      this.worker!.postMessage({
        type: 'parse',
        id: requestId,
        language,
        content,
        filePath,
      });
    });
  }

  /**
   * Парсит файл через воркер с восстановлением после сбоев.
   */
  private async parseWithRecovery(
    language: string,
    content: string,
    filePath: string,
    signal?: AbortSignal,
    retries: number = 1,
  ): Promise<any> {
    try {
      // Проверяем, нужно ли пересоздать воркер.
      if (this.parseCount > 0 && this.parseCount % WORKER_RECYCLE_INTERVAL === 0) {
        await this.recycleWorker();
      }

      this.parseCount++;

      // Если воркер не создан, создаём.
      if (!this.worker) {
        this.worker = this.createWorker();
      }

      return await this.sendParseRequest(language, content, filePath, signal);
    } catch (err: any) {
      // Восстановление после сбоя воркера.
      if (retries > 0) {
        if (this.worker) {
          try {
            await this.worker.terminate();
          } catch {
            // Игнорируем ошибки при завершении мёртвого воркера.
          }
          this.worker = null;
        }
        this.worker = this.createWorker();

        return this.parseWithRecovery(language, content, filePath, signal, retries - 1);
      }

      throw err;
    }
  }

  /**
   * Парсит файл и возвращает дерево tree-sitter.
   */
  async parseFile(
    language: string,
    content: string,
    filePath: string,
    signal?: AbortSignal,
  ): Promise<any> {
    if (this.isDestroyed) {
      throw new Error('ParserWorkerManager уничтожен');
    }

    // Фолбэк: worker_threads недоступен.
    if (!isMainThread) {
      return parseInProcess(language, content, filePath);
    }

    return this.parseWithRecovery(language, content, filePath, signal);
  }

  /**
   * Завершает воркер и освобождает ресурсы.
   */
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

    this.rejectAllPending(new Error('ParserWorkerManager уничтожен'));
  }
}

// Одиночка для управления воркером.
const manager = new ParserWorkerManager();

/**
 * Парсит файл и возвращает дерево tree-sitter.
 * Использует воркер-поток для изоляции WASM-памяти.
 */
export async function parseFile(
  language: string,
  content: string,
  filePath: string,
  signal?: AbortSignal,
): Promise<any> {
  return manager.parseFile(language, content, filePath, signal);
}

/**
 * Завершает воркер и освобождает ресурсы.
 */
export async function destroy(): Promise<void> {
  return manager.destroy();
}
