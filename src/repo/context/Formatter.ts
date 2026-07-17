/**
 * Форматирование контекста.
 *
 * formatContextAsMarkdown, formatContextAsJson.
 */

import type { TaskContext, ISubgraph, INode, CodeBlock, IEdge, IGraphStats } from '../ntgraph/Types';

/** Расширенная статистика контекста. */
interface IContextStats extends IGraphStats {
  codeBlockCount: number;
  totalCodeSize: number;
}
import { LOW_CONFIDENCE_MARKER } from '../context/Markers';

// =============================================================================
// formatContextAsMarkdown
// =============================================================================

/**
 * Форматирование контекста в Markdown.
 */
export function formatContextAsMarkdown(context: TaskContext): string {
  const lines: string[] = [];

  // Заголовок
  lines.push(`# Контекст задачи: ${context.query}`);
  lines.push('');

  // Резюме
  if (context.summary) {
    lines.push(`## Резюме`);
    lines.push('');
    lines.push(context.summary);
    lines.push('');
  }

  // Статистика
  lines.push(`## Статистика`);
  lines.push('');
lines.push(`- Узлов: ${context.stats.nodeCount}`);
    lines.push(`- Рёбер: ${context.stats.edgeCount}`);
    lines.push(`- Файлов: ${context.stats.fileCount}`);
    lines.push(`- Блоков кода: ${(context.stats as IContextStats).codeBlockCount}`);
    lines.push(`- Общий размер кода: ${(context.stats as IContextStats).totalCodeSize} символов`);
  lines.push('');

  // Точки входа
  if (context.entryPoints.length > 0) {
    lines.push(`## Точки входа (${context.entryPoints.length})`);
    lines.push('');
    for (const ep of context.entryPoints) {
      lines.push(formatNodeAsMarkdown(ep, 0));
    }
    lines.push('');
  }

  // Узлы подграфа
  if (context.subgraph.nodes.size > 0) {
    lines.push(`## Узлы графа (${context.subgraph.nodes.size})`);
    lines.push('');
    for (const [, node] of context.subgraph.nodes) {
      lines.push(formatNodeAsMarkdown(node, 2));
    }
    lines.push('');
  }

  // Рёбра подграфа
  if (context.subgraph.edges.length > 0) {
    lines.push(`## Рёбра (${context.subgraph.edges.length})`);
    lines.push('');
    for (const edge of context.subgraph.edges) {
      lines.push(`- \`${edge.source}\` → \`${edge.target}\` [${edge.kind}]`);
    }
    lines.push('');
  }

  // Блоки кода
  if (context.codeBlocks.length > 0) {
    lines.push(`## Блоки кода (${context.codeBlocks.length})`);
    lines.push('');
    for (const block of context.codeBlocks) {
      lines.push(formatCodeBlockAsMarkdown(block));
    }
    lines.push('');
  }

  // Связанные файлы
  if (context.relatedFiles.length > 0) {
    lines.push(`## Связанные файлы (${context.relatedFiles.length})`);
    lines.push('');
    for (const file of context.relatedFiles) {
      lines.push(`- \`${file}\``);
    }
    lines.push('');
  }

  // Низкая уверенность
  if (context.subgraph.confidence === 'low') {
    lines.push('');
    lines.push(`> ⚠️ ${LOW_CONFIDENCE_MARKER}: Запрос совпал преимущественно с общими словами.`);
    lines.push(`> Рекомендуется использовать точные имена символов для более релевантных результатов.`);
    lines.push('');
  }

  return lines.join('\n');
}

// =============================================================================
// formatContextAsJson
// =============================================================================

/**
 * Форматирование контекста в JSON.
 */
export function formatContextAsJson(context: TaskContext): string {
  const nodes = Array.from(context.subgraph.nodes.entries()).map(([id, node]) => ({
    id,
    kind: node.kind,
    name: node.name,
    qualifiedName: node.qualifiedName,
    filePath: node.filePath,
    language: node.language,
    startLine: node.startLine,
    endLine: node.endLine,
  }));

  const codeBlocks = context.codeBlocks.map((block) => ({
    ...block,
    node: {
      id: block.node.id,
      kind: block.node.kind,
      name: block.node.name,
      filePath: block.node.filePath,
      startLine: block.node.startLine,
      endLine: block.node.endLine,
    },
  }));

  const result = {
    query: context.query,
    summary: context.summary,
    stats: context.stats,
    entryPoints: context.entryPoints.map((n) => ({
      id: n.id,
      kind: n.kind,
      name: n.name,
      filePath: n.filePath,
      startLine: n.startLine,
      endLine: n.endLine,
    })),
    nodes,
    edges: context.subgraph.edges,
    codeBlocks,
    relatedFiles: context.relatedFiles,
    confidence: context.subgraph.confidence,
  };

  return JSON.stringify(result, null, 2);
}

// =============================================================================
// Вспомогательные функции
// =============================================================================

/**
 * Форматирование узла в Markdown.
 */
function formatNodeAsMarkdown(node: INode, indent: number): string {
  const pad = '  '.repeat(indent);
  const location = `${node.filePath}:${node.startLine}`;
  return `${pad}- **${node.name}** (\`${node.kind}\`) — \`${location}\``;
}

/**
 * Форматирование блока кода в Markdown.
 */
function formatCodeBlockAsMarkdown(block: CodeBlock): string {
  const header = `#### \`${block.node.name}\` — ${block.filePath}:${block.startLine}-${block.endLine}`;
  const fence = '```';
  return `${header}\n${fence}${block.language}\n${block.content}\n${fence}`;
}
