/**
 * Обработчики инструментов MCP ntgraph.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { IToolResult, IPropertySchema } from './Errors';
import { textResult, errorResult, NotIndexedError, PathRefusalError, MAX_OUTPUT_LENGTH, MAX_INPUT_LENGTH, MAX_PATH_LENGTH } from './Errors';
import type { NtGraphDb } from '../../repo/ntgraph/index';
import type { INode, IFileRecord } from '../../repo/ntgraph/Types';
import { getExploreOutputBudget } from './Budget';

/** Валидация строки по длине. */
export function validateString(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== 'string') {
    throw new Error(`Параметр "${name}" должен быть строкой`);
  }
  if (value.length > maxLength) {
    throw new Error(`Параметр "${name}" превышает максимальную длину ${maxLength}`);
  }
  return value;
}

/** Валидация опционального пути. */
export function validateOptionalPath(value: unknown, name: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new Error(`Параметр "${name}" должен быть строкой или отсутствовать`);
  }
  if (value.length > MAX_PATH_LENGTH) {
    throw new Error(`Путь "${name}" превышает максимальную длину ${MAX_PATH_LENGTH}`);
  }
  return value;
}

/** Префикс номеров строк. */
function numberSourceLines(content: string, firstLineNumber: number): string {
  const lines = content.split('\n');
  return lines.map((line, i) => `${firstLineNumber + i}\t${line}`).join('\n');
}

/** Заголовок секции файла. */
function fileSectionHeader(filePath: string, suffix?: string): string {
  const s = suffix ? ` ${suffix}` : '';
  return `**\`${filePath}\`${s}`;
}

/** Обработчик ntgraph_search. */
export function searchHandler(db: NtGraphDb, params: Record<string, unknown>): IToolResult {
  try {
    const query = validateString(params.query, 'query', MAX_INPUT_LENGTH);
    const kind = typeof params.kind === 'string' ? params.kind : undefined;
    const limit = typeof params.limit === 'number' ? params.limit : 10;

    const nodes = db.getNodesByName(query);
    const filtered = kind ? nodes.filter((n) => n.kind === kind) : nodes;
    const results = filtered.slice(0, limit);

    const lines = results.map((n) => `- **${n.name}** (${n.kind}) — \`${n.filePath}\`:${n.startLine}`);
    const output = lines.length > 0
      ? `Найдено ${results.length} из ${nodes.length} совпадений:\n\n${lines.join('\n')}`
      : 'Совпадений не найдено';

    return textResult(output.length > MAX_OUTPUT_LENGTH ? output.slice(0, MAX_OUTPUT_LENGTH) + '\n\n... (вывод усечён)' : output);
  } catch (err: unknown) {
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}

/** Обработчик ntgraph_node. */
export function nodeHandler(db: NtGraphDb, projectRoot: string, params: Record<string, unknown>): IToolResult {
  try {
    const symbol = typeof params.symbol === 'string' ? params.symbol : undefined;
    const file = typeof params.file === 'string' ? params.file : undefined;
    const includeCode = params.includeCode === true;
    const offset = typeof params.offset === 'number' ? params.offset : 1;
    const limit = typeof params.limit === 'number' ? params.limit : undefined;
    const symbolsOnly = params.symbolsOnly === true;
    const line = typeof params.line === 'number' ? params.line : undefined;

    // Режим файла
    if (file && !symbol) {
      const filePath = resolveFilePath(db, file);
      if (!filePath) {
        return textResult(`Файл не найден: ${file}`);
      }

      const fullPath = path.join(projectRoot, filePath);
      let content: string;
      try {
        content = fs.readFileSync(fullPath, 'utf-8');
      } catch {
        return textResult(`Не удалось прочитать файл: ${filePath}`);
      }

      const lines = content.split('\n');
      const start = Math.max(0, offset - 1);
      const end = limit ? start + limit : lines.length;
      const selected = lines.slice(start, end);
      const output = numberSourceLines(selected.join('\n'), start + 1);

      return textResult(output.length > MAX_OUTPUT_LENGTH ? output.slice(0, MAX_OUTPUT_LENGTH) + '\n\n... (вывод усечён)' : output);
    }

    // Режим символа
    if (symbol) {
      const nodes = db.getNodesByName(symbol);
      const filtered = file
        ? nodes.filter((n) => n.filePath === file)
        : nodes;

      if (filtered.length === 0) {
        return textResult(`Символ не найден: ${symbol}`);
      }

      const target = line
        ? filtered.find((n) => n.startLine <= line && n.endLine >= line) || filtered[0]
        : filtered[0];

      if (!target) {
        return textResult(`Символ не найден: ${symbol}`);
      }

      let output = `**\`${target.name}\`** (${target.kind})\n\n`;
      output += `- **Файл:** \`${target.filePath}\`\n`;
      output += `- **Строки:** ${target.startLine}–${target.endLine}\n`;
      if (target.signature) output += `- **Подпись:** \`${target.signature}\`\n`;

      if (includeCode) {
        const fullPath = path.join(projectRoot, target.filePath);
        const content = fs.readFileSync(fullPath, 'utf-8');
        const lines = content.split('\n');
        const code = lines.slice(target.startLine - 1, target.endLine).join('\n');
        output += `\n\`\`\`\n${numberSourceLines(code, target.startLine)}\n\`\`\`\n`;
      }

      return textResult(output.length > MAX_OUTPUT_LENGTH ? output.slice(0, MAX_OUTPUT_LENGTH) + '\n\n... (вывод усечён)' : output);
    }

    return textResult('Укажите `file` или `symbol`');
  } catch (err: unknown) {
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}

/** Обработчик ntgraph_explore. */
export function exploreHandler(db: NtGraphDb, projectRoot: string, params: Record<string, unknown>): IToolResult {
  try {
    const query = validateString(params.query, 'query', MAX_INPUT_LENGTH);
    const maxFiles = typeof params.maxFiles === 'number' ? params.maxFiles : 12;
    const fileCount = db.getAllFiles().map((f) => f.path).length;
    const budget = getExploreOutputBudget(fileCount);

    // Поиск по терминам запроса
    const terms = query.split(/\s+/).filter((t) => t.length > 1);
    const allNodes = new Map<string, INode>();

    for (const term of terms) {
      const nodes = db.getNodesByName(term);
      for (const n of nodes) {
        allNodes.set(n.id, n);
      }
    }

    if (allNodes.size === 0) {
      return textResult(`Совпадений не найдено для: ${query}`);
    }

    // Группировка по файлам
    const byFile = new Map<string, INode[]>();
    for (const node of allNodes.values()) {
      const existing = byFile.get(node.filePath) || [];
      existing.push(node);
      byFile.set(node.filePath, existing);
    }

    // Ограничение по файлам
    const sortedFiles = [...byFile.entries()].slice(0, maxFiles);

    let output = `# Результаты поиска: ${query}\n\n`;
    output += `Найдено ${allNodes.size} символов в ${byFile.size} файлах\n\n`;

    for (const [filePath, nodes] of sortedFiles) {
      output += `${fileSectionHeader(filePath)}\n\n`;

      // Карта символов
      for (const n of nodes) {
        output += `- **\`${n.name}\`** (${n.kind}) — строки ${n.startLine}–${n.endLine}\n`;
      }

      // Исходный код (если файл небольшой)
      const fullPath = path.join(projectRoot, filePath);
      let content: string;
      try {
        content = fs.readFileSync(fullPath, 'utf-8');
      } catch {
        output += '\n*(файл не доступен)*\n\n';
        continue;
      }

      if (content.length <= budget.maxCharsPerFile) {
        output += `\n\`\`\`\n${numberSourceLines(content, 1)}\n\`\`\`\n`;
      } else {
        // Показываем только строки символов
        const lines = content.split('\n');
        const relevantLines = new Set<number>();
        for (const n of nodes) {
          for (let i = n.startLine; i <= n.endLine; i++) {
            relevantLines.add(i);
          }
        }

        const selectedLines: string[] = [];
        for (let i = 1; i <= lines.length; i++) {
          if (relevantLines.has(i)) {
            selectedLines.push(`${i}\t${lines[i - 1]}`);
          }
        }

        output += `\n\`\`\`\n${selectedLines.join('\n')}\n\`\`\`\n`;
      }

      output += '\n';
    }

    return textResult(output.length > MAX_OUTPUT_LENGTH ? output.slice(0, MAX_OUTPUT_LENGTH) + '\n\n... (вывод усечён)' : output);
  } catch (err: unknown) {
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}

/** Обработчик ntgraph_impact. */
export function impactHandler(db: NtGraphDb, params: Record<string, unknown>): IToolResult {
  try {
    const symbol = validateString(params.symbol, 'symbol', MAX_INPUT_LENGTH);
    const file = validateOptionalPath(params.file, 'file');
    const depth = typeof params.depth === 'number' ? params.depth : 2;

    const nodes = db.getNodesByName(symbol);
    const filtered = file ? nodes.filter((n) => n.filePath === file) : nodes;

    if (filtered.length === 0) {
      return textResult(`Символ не найден: ${symbol}`);
    }

    let output = `# Радиус воздействия: ${symbol}\n\n`;

    for (const node of filtered) {
      output += `## \`${node.name}\` в \`${node.filePath}\`\n\n`;

      // Входящие рёбра (кто влияет)
      const incoming = db.getIncomingEdges(node.id);
      const callers = incoming.filter((e) => e.kind === 'calls' || e.kind === 'references');
      output += `**Вызывающие (${callers.length}):**\n`;
      for (const edge of callers.slice(0, 20)) {
        const caller = db.getNodeById(edge.source);
        if (caller) {
          output += `- \`${caller.name}\` (${caller.kind}) в \`${caller.filePath}\`:${edge.line}\n`;
        }
      }

      // Исходящие рёбра (на кого влияет)
      const outgoing = db.getOutgoingEdges(node.id);
      const callees = outgoing.filter((e) => e.kind === 'calls' || e.kind === 'references');
      output += `\n**Вызываемые (${callees.length}):**\n`;
      for (const edge of callees.slice(0, 20)) {
        const callee = db.getNodeById(edge.target);
        if (callee) {
          output += `- \`${callee.name}\` (${callee.kind}) в \`${callee.filePath}\`\n`;
        }
      }

      output += '\n';
    }

    return textResult(output.length > MAX_OUTPUT_LENGTH ? output.slice(0, MAX_OUTPUT_LENGTH) + '\n\n... (вывод усечён)' : output);
  } catch (err: unknown) {
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}

/** Обработчик ntgraph_callers. */
export function callersHandler(db: NtGraphDb, params: Record<string, unknown>): IToolResult {
  try {
    const symbol = validateString(params.symbol, 'symbol', MAX_INPUT_LENGTH);
    const file = validateOptionalPath(params.file, 'file');
    const limit = typeof params.limit === 'number' ? params.limit : 20;

    const nodes = db.getNodesByName(symbol);
    const filtered = file ? nodes.filter((n) => n.filePath === file) : nodes;

    if (filtered.length === 0) {
      return textResult(`Символ не найден: ${symbol}`);
    }

    let output = `# Вызывающие: ${symbol}\n\n`;

    for (const node of filtered) {
      const incoming = db.getIncomingEdges(node.id);
      const callers = incoming.filter((e) => e.kind === 'calls' || e.kind === 'references');

      output += `## \`${node.name}\` в \`${node.filePath}\`\n\n`;
      output += `Найдено ${callers.length} вызывающих\n\n`;

      for (const edge of callers.slice(0, limit)) {
        const caller = db.getNodeById(edge.source);
        if (caller) {
          output += `- **\`${caller.name}\`** (${caller.kind}) — \`${caller.filePath}\`:${edge.line ?? '?'}\n`;
        }
      }

      output += '\n';
    }

    return textResult(output.length > MAX_OUTPUT_LENGTH ? output.slice(0, MAX_OUTPUT_LENGTH) + '\n\n... (вывод усечён)' : output);
  } catch (err: unknown) {
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}

/** Обработчик ntgraph_callees. */
export function calleesHandler(db: NtGraphDb, params: Record<string, unknown>): IToolResult {
  try {
    const symbol = validateString(params.symbol, 'symbol', MAX_INPUT_LENGTH);
    const file = validateOptionalPath(params.file, 'file');
    const limit = typeof params.limit === 'number' ? params.limit : 20;

    const nodes = db.getNodesByName(symbol);
    const filtered = file ? nodes.filter((n) => n.filePath === file) : nodes;

    if (filtered.length === 0) {
      return textResult(`Символ не найден: ${symbol}`);
    }

    let output = `# Вызываемые: ${symbol}\n\n`;

    for (const node of filtered) {
      const outgoing = db.getOutgoingEdges(node.id);
      const callees = outgoing.filter((e) => e.kind === 'calls' || e.kind === 'references');

      output += `## \`${node.name}\` в \`${node.filePath}\`\n\n`;
      output += `Найдено ${callees.length} вызываемых\n\n`;

      for (const edge of callees.slice(0, limit)) {
        const callee = db.getNodeById(edge.target);
        if (callee) {
          output += `- **\`${callee.name}\`** (${callee.kind}) — \`${callee.filePath}\`:${edge.line ?? '?'}\n`;
        }
      }

      output += '\n';
    }

    return textResult(output.length > MAX_OUTPUT_LENGTH ? output.slice(0, MAX_OUTPUT_LENGTH) + '\n\n... (вывод усечён)' : output);
  } catch (err: unknown) {
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}

/** Обработчик ntgraph_files. */
export function filesHandler(db: NtGraphDb, params: Record<string, unknown>): IToolResult {
  try {
    const pathFilter = validateOptionalPath(params.path, 'path');
    const pattern = validateOptionalPath(params.pattern, 'pattern');
    const format = typeof params.format === 'string' && ['tree', 'flat', 'grouped'].includes(params.format)
      ? params.format : 'tree';
    const includeMetadata = params.includeMetadata !== false;

    const allFiles = db.getAllFiles().map((f) => f.path);
    const filtered = allFiles.filter((f) => {
      if (pathFilter && !f.startsWith(pathFilter)) return false;
      if (pattern) {
        const re = new RegExp(pattern.replace(/\*/g, '.*'));
        if (!re.test(f)) return false;
      }
      return true;
    });

    let output = '';

    if (format === 'flat') {
      output = filtered.map((f) => {
        const meta = includeMetadata ? ` [${f.split('.').pop()}]` : '';
        return f + meta;
      }).join('\n');
    } else if (format === 'grouped') {
      const byLang = new Map<string, string[]>();
      for (const f of filtered) {
        const ext = f.split('.').pop() || 'unknown';
        const existing = byLang.get(ext) || [];
        existing.push(f);
        byLang.set(ext, existing);
      }
      for (const [lang, files] of byLang.entries()) {
        output += `### ${lang} (${files.length})\n\n`;
        output += files.map((f) => `- ${f}`).join('\n');
        output += '\n\n';
      }
    } else {
      // tree
      const tree = buildFileTree(filtered);
      output = tree;
    }

    return textResult(output.length > MAX_OUTPUT_LENGTH ? output.slice(0, MAX_OUTPUT_LENGTH) + '\n\n... (вывод усечён)' : output);
  } catch (err: unknown) {
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}

/** Обработчик ntgraph_status. */
export function statusHandler(db: NtGraphDb): IToolResult {
  try {
    const stats = db.getStats();

    let output = `# Статистика индекса\n\n`;
    output += `- **Файлы:** ${stats.fileCount}\n`;
    output += `- **Узлы:** ${stats.nodeCount}\n`;
    output += `- **Рёбра:** ${stats.edgeCount}\n`;
    output += `- **Последнее обновление:** ${new Date(stats.lastUpdated).toISOString()}\n`;

    output += `\n### Узлы по видам\n\n`;
    for (const [kind, count] of Object.entries(stats.nodesByKind)) {
      output += `- ${kind}: ${count}\n`;
    }

    output += `\n### Рёбра по видам\n\n`;
    for (const [kind, count] of Object.entries(stats.edgesByKind)) {
      output += `- ${kind}: ${count}\n`;
    }

    output += `\n### Файлы по языкам\n\n`;
    for (const [lang, count] of Object.entries(stats.filesByLanguage)) {
      output += `- ${lang}: ${count}\n`;
    }

    return textResult(output);
  } catch (err: unknown) {
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}

/** Построение иерархического дерева файлов. */
function buildFileTree(files: string[]): string {
  const tree: Record<string, unknown> = {};

  for (const f of files) {
    const parts = f.split('/');
    let current = tree;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (i === parts.length - 1) {
        current[part] = true;
      } else {
        if (!(part in current)) {
          current[part] = {};
        }
        current = current[part] as Record<string, unknown>;
      }
    }
  }

  return renderTree(tree, '');
}

/** Рендер дерева. */
function renderTree(tree: Record<string, unknown>, prefix: string): string {
  let output = '';
  const entries = Object.entries(tree);

  for (let i = 0; i < entries.length; i++) {
    const [name, value] = entries[i];
    const isLast = i === entries.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    const childPrefix = prefix + (isLast ? '    ' : '│   ');

    if (value === true) {
      output += prefix + connector + name + '\n';
    } else {
      output += prefix + connector + name + '/\n';
      output += renderTree(value as Record<string, unknown>, childPrefix);
    }
  }

  return output;
}

/** Разрешение пути файла. */
function resolveFilePath(db: NtGraphDb, file: string): string | null {
  // Точное совпадение
  const allFiles = db.getAllFiles().map((f) => f.path);
  if (allFiles.includes(file)) return file;

  // Поиск по имени файла
  const basename = path.basename(file);
  const matches = allFiles.filter((f) => path.basename(f) === basename);
  if (matches.length === 1) return matches[0];

  // Частичное совпадение
  const partial = allFiles.filter((f) => f.includes(file));
  if (partial.length === 1) return partial[0];

  return null;
}
