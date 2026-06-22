import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs/promises"
import { createDomainLogger } from "../core/Logger"
import { errorMessage } from "../core/Errors"
import { withTimeoutAndSignal } from "../shared/WithTimeoutAndSignal"
import { LSP_TIMEOUT_MS, LSP_MAX_SYMBOL_RESULTS, LSP_MAX_DEPTH, LSP_SNIPPET_LENGTH } from "../core/Config"

const log = createDomainLogger("LSP")

/** Вернуть текстовую метку для вида LSP-символа. */
export function lspSymbolKindLabel(kind: vscode.SymbolKind): string {
  const map: Record<number, string> = {
    [vscode.SymbolKind.File]: "file",
    [vscode.SymbolKind.Module]: "module",
    [vscode.SymbolKind.Namespace]: "namespace",
    [vscode.SymbolKind.Package]: "package",
    [vscode.SymbolKind.Class]: "class",
    [vscode.SymbolKind.Method]: "method",
    [vscode.SymbolKind.Property]: "property",
    [vscode.SymbolKind.Field]: "field",
    [vscode.SymbolKind.Constructor]: "constructor",
    [vscode.SymbolKind.Enum]: "enum",
    [vscode.SymbolKind.Interface]: "interface",
    [vscode.SymbolKind.Function]: "function",
    [vscode.SymbolKind.Variable]: "variable",
    [vscode.SymbolKind.Constant]: "constant",
    [vscode.SymbolKind.String]: "string",
    [vscode.SymbolKind.Number]: "number",
    [vscode.SymbolKind.Boolean]: "boolean",
    [vscode.SymbolKind.Array]: "array",
    [vscode.SymbolKind.Object]: "object",
    [vscode.SymbolKind.Key]: "key",
    [vscode.SymbolKind.Null]: "null",
    [vscode.SymbolKind.EnumMember]: "enum_member",
    [vscode.SymbolKind.Struct]: "struct",
    [vscode.SymbolKind.Event]: "event",
    [vscode.SymbolKind.Operator]: "operator",
    [vscode.SymbolKind.TypeParameter]: "type_param",
  }
  return map[kind] ?? `kind:${kind}`
}

/** Форматировать дерево символов документа в строки с отступами. */
export function formatDocumentSymbols(
  symbols: vscode.DocumentSymbol[],
  depth: number,
  results: string[],
  maxResults: number = LSP_MAX_SYMBOL_RESULTS,
): string[] {
  const indent = "  ".repeat(depth)

  for (const sym of symbols) {
    if (results.length >= maxResults) break
    const kindLabel = lspSymbolKindLabel(sym.kind)
    const range = `${sym.range.start.line + 1}-${sym.range.end.line + 1}`
    const detail = sym.detail ? ` (${sym.detail})` : ""
    results.push(`${indent}${kindLabel} ${sym.name}${detail} [${range}]`)

    if (sym.children && sym.children.length > 0 && depth < LSP_MAX_DEPTH && results.length < maxResults) {
      formatDocumentSymbols(sym.children, depth + 1, results, maxResults)
    }
  }

  return results
}

/** Преобразовать Markdown-содержимое LSP в обычный текст. */
export function markdownToString(content: vscode.MarkdownString | vscode.MarkedString | vscode.MarkedString[]): string {
  if (Array.isArray(content)) {
    return content.map((c) => markdownToString(c)).filter(Boolean).join("\n\n")
  }

  if (content instanceof vscode.MarkdownString) {
    return content.value
  }

  if (typeof content === "string") {
    return content
  }

  if ("value" in content && typeof content.value === "string") {
    return content.value
  }

  if ("language" in content && "value" in content) {
    return content.value
  }

  return String(content)
}

/** Вернуть текст строки по LSP-локации. */
export async function getLineSnippet(location: vscode.Location): Promise<string> {
  try {
    const doc = await vscode.workspace.openTextDocument(location.uri)
    const line = doc.lineAt(location.range.start.line)
    return line.text.trim().slice(0, LSP_SNIPPET_LENGTH)
  } catch (err: unknown) {
    const msg = errorMessage(err)
    log.error(`Не удалось получить сниппет строки: ${msg}`)
    return ""
  }
}

/** Сгруппировать локации по файлам. */
export function groupLocationsByFile(locations: vscode.Location[]): Record<string, vscode.Location[]> {
  const grouped: Record<string, vscode.Location[]> = {}
  for (const loc of locations) {
    const file = loc.uri.fsPath
    if (!grouped[file]) grouped[file] = []
    grouped[file].push(loc)
  }
  return grouped
}

// ── Приватные вспомогательные функции ────────────────────

export function resolveFilePath(filePathRaw: string, getWorkDir: () => string): string {
  if (path.isAbsolute(filePathRaw)) return filePathRaw
  return path.join(getWorkDir(), filePathRaw)
}

export async function ensureFileExists(filePath: string): Promise<void> {
  try {
    await fs.access(filePath)
  } catch (err: unknown) {
    const msg = errorMessage(err)
    throw new Error(`Файл не найден: ${filePath} (${msg})`)
  }
}

export async function openDocumentForLsp(uri: vscode.Uri): Promise<void> {
  try {
    await vscode.workspace.openTextDocument(uri)
  } catch (err: unknown) {
    const msg = errorMessage(err)
    log.error(`Не удалось открыть документ для LSP: ${msg}`)
  }
}

export function toPosition(line?: number, character?: number): vscode.Position {
  const l = line ? Math.max(0, line - 1) : 0
  const c = character ? Math.max(0, character - 1) : 0
  return new vscode.Position(l, c)
}

export function relativePath(absPath: string, getWorkDir: () => string): string {
  const workspaces = vscode.workspace.workspaceFolders
  if (workspaces && workspaces.length > 0) {
    return path.relative(workspaces[0].uri.fsPath, absPath)
  }
  return path.relative(getWorkDir(), absPath)
}

/**
 * Общий шаблон: разрешить путь → проверить существование → открыть документ → выполнить LSP-команду.
 */
export async function executeLspCommand<T>(
  filePathRaw: string,
  command: string,
  label: string,
  args: unknown[],
  getWorkDir: () => string,
  format: (result: T[]) => Promise<{ output: string; success: boolean }> | { output: string; success: boolean },
  notFoundMsg: (filePath: string, position?: vscode.Position) => string,
  signal?: AbortSignal,
): Promise<{ output: string; success: boolean }> {
  const filePath = resolveFilePath(filePathRaw, getWorkDir)
  await ensureFileExists(filePath)
  const uri = vscode.Uri.file(filePath)
  await openDocumentForLsp(uri)

  const results = await withTimeoutAndSignal(
    () => Promise.resolve(vscode.commands.executeCommand<T[]>(command, ...args)).then((r) => r ?? []),
    LSP_TIMEOUT_MS,
    label,
    signal,
  )

  if (results.length === 0) {
    const position = args[1] as vscode.Position | undefined
    return { output: notFoundMsg(filePath, position), success: true }
  }

  return format(results)
}

/**
 * Общий шаблон для команд с позицией.
 */
export async function executeLspPositionCommand<T>(
  filePathRaw: string,
  line: number | undefined,
  character: number | undefined,
  command: string,
  label: string,
  getWorkDir: () => string,
  format: (result: T[]) => Promise<{ output: string; success: boolean }> | { output: string; success: boolean },
  notFoundMsg: (filePath: string, position: vscode.Position) => string,
  signal?: AbortSignal,
): Promise<{ output: string; success: boolean }> {
  const position = toPosition(line, character)
  const filePath = resolveFilePath(filePathRaw, getWorkDir)
  await ensureFileExists(filePath)
  const uri = vscode.Uri.file(filePath)
  await openDocumentForLsp(uri)

  const results = await withTimeoutAndSignal(
    () => Promise.resolve(vscode.commands.executeCommand<T[]>(command, uri, position)).then((r) => r ?? []),
    LSP_TIMEOUT_MS,
    label,
    signal,
  )

  if (results.length === 0) {
    return { output: notFoundMsg(filePath, position), success: true }
  }

  return format(results)
}
