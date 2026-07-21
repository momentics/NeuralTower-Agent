/**
 * Типы данных и ошибки для MCP-инструментов ntgraph.
 */

import type { INode } from '../../repo/ntgraph/Types';

/** Определение инструмента MCP. */
export interface IToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, IPropertySchema>;
    required?: string[];
  };
  /** Поведенческие подсказки для клиентов (readOnlyHint и т.д.). */
  annotations?: IToolAnnotations;
}

/** Схема свойства. */
export interface IPropertySchema {
  type: string;
  description: string;
  default?: unknown;
  items?: IPropertySchema;
  enum?: string[];
}

/** Поведенческие подсказки инструмента. */
export interface IToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/** Результат выполнения инструмента. */
export interface IToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

/** Адаптивный бюджет вывода explore. */
export interface IExploreOutputBudget {
  /** Жёсткий лимит общих символов вывода. */
  maxOutputChars: number;
  /** Дефолтное maxFiles, когда вызывающий не указал. */
  defaultMaxFiles: number;
  /** Лимит непрерывного исходного кода на файл. */
  maxCharsPerFile: number;
  /** Порог пропуска в строках — более плотный кластеринг на малых проектах. */
  gapThreshold: number;
  /** Макс символов в заголовке файла. */
  maxSymbolsInFileHeader: number;
  /** Макс рёбер на вид отношения в секции Relationships. */
  maxEdgesPerRelationshipKind: number;
  /** Включить секцию "Relationships". */
  includeRelationships: boolean;
  /** Включить список "Additional relevant files". */
  includeAdditionalFiles: boolean;
  /** Включить напоминание "Complete source code is included above…". */
  includeCompletenessSignal: boolean;
  /** Включить напоминание о бюджете в конце. */
  includeBudgetNote: boolean;
  /** Жёсткое исключение test/spec/icon/i18n файлов. */
  excludeLowValueFiles: boolean;
}

/** Ожидаемое, восстанавливаемое условие "индекс не доступен". */
export class NotIndexedError extends Error {
  constructor(message = 'Индекс не доступен') {
    super(message);
    this.name = 'NotIndexedError';
  }
}

/** Отказ по безопасности (чувствительный системный путь). */
export class PathRefusalError extends Error {
  constructor(message = 'Отказ по безопасности') {
    super(message);
    this.name = 'PathRefusalError';
  }
}

/** Успешный результат без isError. */
export function textResult(text: string): IToolResult {
  return { content: [{ type: 'text', text }] };
}

/** Ошибка с isError: true. */
export function errorResult(text: string): IToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

/** Параметры поиска символов. */
export interface FindSymbolsOptions {
  file?: string;
  line?: number;
}

/** Результат поиска символов. */
export interface FindSymbolsResult {
  nodes: INode[];
  note: string;
}

/** Аннотации для read-only инструментов. */
export const READ_ONLY_ANNOTATIONS: IToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

/** Макс длина вывода (символы). */
export const MAX_OUTPUT_LENGTH = 15000;

/** Макс длина входных строк. */
export const MAX_INPUT_LENGTH = 10_000;

/** Макс длина путей. */
export const MAX_PATH_LENGTH = 4_096;

/** Порог для tiny репозиториев. */
export const TINY_REPO_FILE_THRESHOLD = 500;

/** Инструменты для tiny репозиториев. */
export const TINY_REPO_CORE_TOOLS = new Set([
  'ntgraph_explore',
  'ntgraph_search',
  'ntgraph_node',
]);

/** Инструменты по умолчанию. */
export const DEFAULT_MCP_TOOLS = new Set(['explore']);
