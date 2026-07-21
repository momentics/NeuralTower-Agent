/**
 * Диспетчер инструментов MCP ntgraph.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { IToolDefinition, IToolResult } from './Errors';
import { textResult, errorResult, NotIndexedError, PathRefusalError, MAX_INPUT_LENGTH, MAX_PATH_LENGTH } from './Errors';
import { TOOL_DEFINITIONS } from './Tools';
import {
  searchHandler, nodeHandler, exploreHandler, impactHandler,
  callersHandler, calleesHandler, filesHandler, statusHandler,
  validateString, validateOptionalPath,
} from './Handlers';
import { NtGraphDb } from '../../repo/ntgraph/index';
import { SENSITIVE_PATHS } from '../../repo/ntgraph/Types';

/** Кэш соединений с БД. */
const projectCache = new Map<string, NtGraphDb>();

/**
 * Диспетчер инструментов MCP ntgraph.
 */
export class ToolHandler {
  private catchUpGate: Promise<void> | null = null;
  private defaultProjectHint: string | null = null;
  private _toolAllowlist: Set<string> | null = null;

  /** Получить определения инструментов. */
  getTools(): IToolDefinition[] {
    const envTools = process.env.NTGRAPH_MCP_TOOLS;
    if (envTools) {
      const allowed = new Set(envTools.split(',').map((t) => t.trim()));
      return TOOL_DEFINITIONS.filter((t) => allowed.has(t.name));
    }
    return TOOL_DEFINITIONS;
  }

  /** Выполнить инструмент. */
  async execute(toolName: string, params: Record<string, unknown>): Promise<IToolResult> {
    // Catch-up gate
    await this.awaitCatchUpGate();

    // Проверка allowlist
    if (!this.isToolAllowed(toolName)) {
      return errorResult(`Инструмент "${toolName}" не разрешён`);
    }

    // Разрешение проекта
    const projectPath = this.resolveProjectPath(params);
    if (!projectPath) {
      return errorResult('Не удалось определить путь к проекту');
    }

    const db = this.getNtGraph(projectPath);

    try {
      switch (toolName) {
        case 'ntgraph_search':
          return searchHandler(db, params);
        case 'ntgraph_node':
          return nodeHandler(db, projectPath, params);
        case 'ntgraph_explore':
          return exploreHandler(db, projectPath, params);
        case 'ntgraph_impact':
          return impactHandler(db, params);
        case 'ntgraph_callers':
          return callersHandler(db, params);
        case 'ntgraph_callees':
          return calleesHandler(db, params);
        case 'ntgraph_files':
          return filesHandler(db, params);
        case 'ntgraph_status':
          return statusHandler(db);
        default:
          return errorResult(`Неизвестный инструмент: ${toolName}`);
      }
    } catch (err: unknown) {
      if (err instanceof NotIndexedError) {
        return textResult('Индекс не доступен. Выполните индексацию проекта.');
      }
      if (err instanceof PathRefusalError) {
        return errorResult('Отказ по безопасности: доступ к указанному пути запрещён');
      }
      return errorResult(err instanceof Error ? err.message : String(err));
    }
  }

  /** Получить или создать соединение с БД. */
  getNtGraph(startPath: string): NtGraphDb {
    const cached = projectCache.get(startPath);
    if (cached) {
      this.freshen(startPath);
      return cached;
    }

    const dbPath = findNtGraphRoot(startPath);
    if (!dbPath) {
      throw new NotIndexedError(`Индекс не найден для: ${startPath}`);
    }

    const db = new NtGraphDb(dbPath);
    projectCache.set(dbPath, db);
    return db;
  }

  /** Проверить и обновить соединение. */
  freshen(startPath: string): void {
    const dbPath = findNtGraphRoot(startPath);
    if (!dbPath) return;

    const cached = projectCache.get(dbPath);
    if (!cached) return;

    // Проверяем, существует ли БД
    if (!fs.existsSync(path.join(dbPath, 'ntgraph.db'))) {
      projectCache.delete(dbPath);
    }
  }

  /** Закрыть все кэшированные соединения. */
  closeAll(): void {
    for (const [key, db] of projectCache) {
      try {
        db.close();
      } catch {
        // Игнорируем ошибки закрытия
      }
    }
    projectCache.clear();
  }

  /** Группировка определений по файлам. */
  groupDefinitions(nodes: Array<{ filePath: string }>): Map<string, Array<{ filePath: string }>> {
    const groups = new Map<string, Array<{ filePath: string }>>();
    for (const node of nodes) {
      const key = `${node.filePath}`;
      const existing = groups.get(key) || [];
      existing.push(node);
      groups.set(key, existing);
    }
    return groups;
  }

  /** Аннотация несоответствия worktree. */
  withWorktreeNotice(text: string, startPath: string): string {
    const dbPath = findNtGraphRoot(startPath);
    if (!dbPath) return text;

    const notice = `[⚠️ Индекс из ${dbPath}]`;
    return text + '\n\n' + notice;
  }

  /** Аннотация устаревания файлов. */
  withStalenessNotice(text: string, startPath: string): string {
    const dbPath = findNtGraphRoot(startPath);
    if (!dbPath) return text;

    const db = projectCache.get(dbPath);
    if (!db) return text;

    try {
      const pending = db.getUnresolvedReferences();
      if (pending.length > 0) {
        return text + `\n\n[⚠️ ${pending.length} неразрешённых ссылок]`;
      }
    } catch {
      // Игнорируем ошибки
    }

    return text;
  }

  /** Ожидание catch-up gate. */
  async awaitCatchUpGate(): Promise<void> {
    if (!this.catchUpGate) return;

    const timeout = Number(process.env.NTGRAPH_CATCHUP_GATE_TIMEOUT_MS) || 3000;
    if (timeout === 0) {
      await this.catchUpGate;
      return;
    }

    try {
      await Promise.race([
        this.catchUpGate,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Catch-up timeout')), timeout)),
      ]);
    } catch {
      // Таймаут — продолжаем без ожидания
    }
  }

  /** Установить catch-up gate. */
  setCatchUpGate(promise: Promise<void>): void {
    this.catchUpGate = promise;
  }

  /** Получить подсказку пути к проекту. */
  getDefaultProjectHint(): string | null {
    return this.defaultProjectHint;
  }

  /** Установить подсказку пути к проекту. */
  setDefaultProjectHint(hint: string): void {
    this.defaultProjectHint = hint;
  }

  /** Получить allowlist инструментов. */
  toolAllowlist(): Set<string> {
    if (!this._toolAllowlist) {
      const envTools = process.env.NTGRAPH_MCP_TOOLS;
      if (envTools) {
        this._toolAllowlist = new Set(envTools.split(',').map((t) => t.trim()));
      } else {
        this._toolAllowlist = new Set(TOOL_DEFINITIONS.map((t) => t.name));
      }
    }
    return this._toolAllowlist;
  }

  /** Проверка: инструмент разрешён. */
  isToolAllowed(toolName: string): boolean {
    return this.toolAllowlist().has(toolName);
  }

  /** Поиск символов. */
  findAllSymbols(symbol: string, _options?: { file?: string; line?: number }): { nodes: Array<{ id: string; name: string; filePath: string }>; note: string } {
    // Заглушка — реальный поиск через QueryBuilder
    return { nodes: [], note: '' };
  }

  /** Разрешение пути к проекту. */
  private resolveProjectPath(params: Record<string, unknown>): string | null {
    const projectPath = params.projectPath as string | undefined;

    if (projectPath) {
      // Проверка безопасности
      for (const sensitive of SENSITIVE_PATHS) {
        if (projectPath.startsWith(sensitive)) {
          throw new PathRefusalError(`Доступ запрещён: ${projectPath}`);
        }
      }
      return projectPath;
    }

    if (this.defaultProjectHint) {
      return this.defaultProjectHint;
    }

    return null;
  }
}

/** Поиск корня ntgraph через walk-up. */
function findNtGraphRoot(startPath: string): string | null {
  let current = startPath;

  while (current) {
    const dbPath = path.join(current, '.ntgraph');
    if (fs.existsSync(dbPath) && fs.statSync(dbPath).isDirectory()) {
      return dbPath;
    }

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return null;
}
