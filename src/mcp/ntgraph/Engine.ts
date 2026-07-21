/**
 * Двигатель MCP ntgraph с ленивой инициализацией.
 */

import type { ToolHandler } from './ToolHandler';

/** Опции двигателя MCP. */
export interface IMCPEngineOptions {
  watch?: boolean;
  debounceMs?: number;
  idleTimeout?: number;
  socketPath?: string;
}

/**
 * Двигатель MCP ntgraph.
 */
export class MCPEngine {
  private toolHandler: ToolHandler | null = null;
  private initPromise: Promise<void> | null = null;
  private projectPathHint: string | null = null;
  private readonly opts: IMCPEngineOptions;

  constructor(opts?: IMCPEngineOptions) {
    this.opts = opts ?? {};
  }

  /** Обеспечить инициализацию. */
  async ensureInitialized(searchFrom: string): Promise<void> {
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.initialize(searchFrom);
    return this.initPromise;
  }

  /** Синхронный повтор инициализации. */
  retryInitializeSync(searchFrom: string): void {
    // Для проектов, появившихся после старта
    if (!this.toolHandler) {
      this.initialize(searchFrom);
    }
  }

  /** Установить подсказку пути к проекту. */
  setProjectPathHint(projectRoot: string): void {
    this.projectPathHint = projectRoot;
  }

  /** Догоняющая синхронизация. */
  catchUpSync(): void {
    // One-shot gate
    if (this.toolHandler) {
      this.toolHandler.setCatchUpGate(Promise.resolve());
    }
  }

  /** Остановить двигатель. */
  stop(): void {
    if (this.toolHandler) {
      this.toolHandler.closeAll();
    }
    this.initPromise = null;
  }

  /** Получить обработчик инструментов. */
  getToolHandler(): ToolHandler {
    if (!this.toolHandler) {
      throw new Error('ToolHandler не инициализирован. Вызовите ensureInitialized()');
    }
    return this.toolHandler!;
  }

  /** Инициализация. */
  private async initialize(_searchFrom: string): Promise<void> {
    const { ToolHandler: TH } = await import('./ToolHandler');
    this.toolHandler = new TH();

    if (this.projectPathHint && this.toolHandler) {
      this.toolHandler.setDefaultProjectHint(this.projectPathHint);
    }
  }
}
