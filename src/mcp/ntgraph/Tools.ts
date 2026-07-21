/**
 * Определения инструментов MCP ntgraph.
 */

import type { IToolDefinition, IPropertySchema } from './Errors';
import { READ_ONLY_ANNOTATIONS } from './Errors';

/** Схема свойства: строка с описанием. */
function str(desc: string): IPropertySchema {
  return { type: 'string', description: desc };
}

/** Схема свойства: число с описанием. */
function num(desc: string, def?: number): IPropertySchema {
  return { type: 'number', description: desc, default: def };
}

/** Схема свойства: булево с описанием. */
function bool(desc: string, def?: boolean): IPropertySchema {
  return { type: 'boolean', description: desc, default: def };
}

/** Определения всех 8 инструментов. */
export const TOOL_DEFINITIONS: IToolDefinition[] = [
  {
    name: 'ntgraph_search',
    description: 'Quick symbol search by name. Returns locations only (no code). Use ntgraph_explore instead to get the actual source / understand an area in one call.',
    inputSchema: {
      type: 'object',
      properties: {
        query: str('Symbol name or partial name (e.g., "auth", "signIn", "UserService")'),
        kind: {
          type: 'string',
          description: 'Filter by node kind',
          enum: ['function', 'method', 'class', 'interface', 'type', 'variable', 'route', 'component'],
        },
        limit: num('Maximum results (default: 10)', 10),
        projectPath: str('Absolute path to the project to query'),
      },
      required: ['query'],
    },
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: 'ntgraph_node',
    description: 'Two modes. (1) READ A FILE — use INSTEAD of the Read tool: pass `file` (a path or basename) with no `symbol` and it returns that file\'s current on-disk source with line numbers. (2) ONE SYMBOL you can name — its location, signature, verbatim source (includeCode=true) and caller/callee trail in one call.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: str('Name of the symbol to read (symbol mode). Omit it and pass `file` alone to read a whole file.'),
        includeCode: bool('Symbol mode: include the symbol\'s full body', false),
        file: str('A file path or basename. Pass it ALONE (no symbol) to READ the file. Or pass it WITH a symbol to disambiguate.'),
        offset: num('File mode: 1-based line to start reading from'),
        limit: num('File mode: maximum number of lines to return'),
        symbolsOnly: bool('File mode: return just the file\'s symbol map + dependents', false),
        line: num('Symbol mode only: disambiguate to the definition at/around this line'),
        projectPath: str('Absolute path to the project to query'),
      },
      required: [],
    },
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: 'ntgraph_explore',
    description: 'PRIMARY TOOL — call FIRST for almost any question OR before an edit: how does X work, architecture, a bug, where/what is X. Returns the verbatim source of the relevant symbols grouped by file in ONE capped call.',
    inputSchema: {
      type: 'object',
      properties: {
        query: str('Symbol names, file names, or short code terms to explore'),
        maxFiles: num('Maximum number of files to include source code from (default: 12)', 12),
        projectPath: str('Absolute path to the project to query'),
      },
      required: ['query'],
    },
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: 'ntgraph_impact',
    description: 'List symbols affected by changing <symbol>. Use before a refactor.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: str('Name of the symbol to analyze impact for'),
        file: str('Narrow to the definition in this file'),
        depth: num('How many levels of dependencies to traverse (default: 2)', 2),
        projectPath: str('Absolute path to the project to query'),
      },
      required: ['symbol'],
    },
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: 'ntgraph_callers',
    description: 'List functions that call <symbol>. For the full flow, use ntgraph_explore.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: str('Name of the function, method, or class to find callers for'),
        file: str('Narrow to the definition in this file'),
        limit: num('Maximum number of callers to return (default: 20)', 20),
        projectPath: str('Absolute path to the project to query'),
      },
      required: ['symbol'],
    },
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: 'ntgraph_callees',
    description: 'List functions that <symbol> calls. For the full flow, use ntgraph_explore.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: str('Name of the function, method, or class to find callees for'),
        file: str('Narrow to the definition in this file'),
        limit: num('Maximum number of callees to return (default: 20)', 20),
        projectPath: str('Absolute path to the project to query'),
      },
      required: ['symbol'],
    },
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: 'ntgraph_files',
    description: 'Indexed file tree with language + symbol counts. Faster than Glob for project layout.',
    inputSchema: {
      type: 'object',
      properties: {
        path: str('Filter to files under this directory path'),
        pattern: str('Filter files matching this glob pattern'),
        format: {
          type: 'string',
          description: 'Output format: "tree" (hierarchical, default), "flat" (simple list), "grouped" (by language)',
          enum: ['tree', 'flat', 'grouped'],
          default: 'tree',
        },
        includeMetadata: bool('Include file metadata like language and symbol count', true),
        maxDepth: num('Maximum directory depth to show'),
        projectPath: str('Absolute path to the project to query'),
      },
      required: [],
    },
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: 'ntgraph_status',
    description: 'Index health check (files / nodes / edges). Skip unless debugging.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: str('Absolute path to the project to query'),
      },
      required: [],
    },
    annotations: READ_ONLY_ANNOTATIONS,
  },
];
