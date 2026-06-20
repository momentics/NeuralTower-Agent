import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs/promises"

const LSP_TIMEOUT_MS = 10_000
const MAX_SYMBOL_RESULTS = 50
const MAX_REFERENCE_RESULTS = 30
const MAX_HOVER_CHARS = 4000
const LSP_MAX_DEPTH = 4
const LSP_SNIPPET_LENGTH = 200

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
  maxResults: number = MAX_SYMBOL_RESULTS,
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

/** Выполнить асинхронную функцию с таймаутом. */
export async function withTimeout<T>(fn: () => Promise<T>, label: string, timeoutMs: number = LSP_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`LSP ${label}: таймаут ${timeoutMs}ms`)), timeoutMs)
  })
  try {
    return await Promise.race([fn(), timeoutPromise])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

// ── Приватные вспомогательные функции ────────────────────

function resolveFilePath(filePathRaw: string, getWorkDir: () => string): string {
  if (path.isAbsolute(filePathRaw)) return filePathRaw
  return path.join(getWorkDir(), filePathRaw)
}

async function ensureFileExists(filePath: string): Promise<void> {
  try {
    await fs.access(filePath)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Файл не найден: ${filePath} (${msg})`)
  }
}

async function openDocumentForLsp(uri: vscode.Uri): Promise<void> {
  try {
    await vscode.workspace.openTextDocument(uri)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Не удалось открыть документ для LSP: ${msg}`)
  }
}

function toPosition(line?: number, character?: number): vscode.Position {
  const l = line ? Math.max(0, line - 1) : 0
  const c = character ? Math.max(0, character - 1) : 0
  return new vscode.Position(l, c)
}

function relativePath(absPath: string, getWorkDir: () => string): string {
  const workspaces = vscode.workspace.workspaceFolders
  if (workspaces && workspaces.length > 0) {
    return path.relative(workspaces[0].uri.fsPath, absPath)
  }
  return path.relative(getWorkDir(), absPath)
}

/**
 * Общий шаблон: разрешить путь → проверить существование → открыть документ → выполнить LSP-команду.
 * Принимает колбэк для форматирования результата.
 */
async function executeLspCommand<T>(
  filePathRaw: string,
  command: string,
  label: string,
  args: unknown[],
  getWorkDir: () => string,
  format: (result: T[]) => Promise<{ output: string; success: boolean }> | { output: string; success: boolean },
  notFoundMsg: (filePath: string, position?: vscode.Position) => string,
): Promise<{ output: string; success: boolean }> {
  const filePath = resolveFilePath(filePathRaw, getWorkDir)
  await ensureFileExists(filePath)
  const uri = vscode.Uri.file(filePath)
  await openDocumentForLsp(uri)

  const results = await withTimeout(
    () => Promise.resolve(vscode.commands.executeCommand<T[]>(command, ...args)).then((r) => r ?? []),
    label,
  )

  if (results.length === 0) {
    const position = args[1] as vscode.Position | undefined
    return { output: notFoundMsg(filePath, position), success: true }
  }

  return format(results)
}

/**
 * Общий шаблон для команд с позицией: разрешить путь → проверить → открыть → позиция → выполнить.
 */
async function executeLspPositionCommand<T>(
  filePathRaw: string,
  line: number | undefined,
  character: number | undefined,
  command: string,
  label: string,
  getWorkDir: () => string,
  format: (result: T[]) => Promise<{ output: string; success: boolean }> | { output: string; success: boolean },
  notFoundMsg: (filePath: string, position: vscode.Position) => string,
): Promise<{ output: string; success: boolean }> {
  const position = toPosition(line, character)
  const filePath = resolveFilePath(filePathRaw, getWorkDir)
  await ensureFileExists(filePath)
  const uri = vscode.Uri.file(filePath)
  await openDocumentForLsp(uri)

  const results = await withTimeout(
    () => Promise.resolve(vscode.commands.executeCommand<T[]>(command, uri, position)).then((r) => r ?? []),
    label,
  )

  if (results.length === 0) {
    return { output: notFoundMsg(filePath, position), success: true }
  }

  return format(results)
}

// ── Публичные функции ────────────────────────────────────

export async function executeDocumentSymbol(
  filePathRaw: string,
  getWorkDir: () => string,
): Promise<{ output: string; success: boolean }> {
  const filePath = resolveFilePath(filePathRaw, getWorkDir)
  await ensureFileExists(filePath)
  const uri = vscode.Uri.file(filePath)
  await openDocumentForLsp(uri)

  const symbols = await withTimeout(
    () => Promise.resolve(vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      "vscode.executeDocumentSymbolProvider",
      uri,
    )).then((r) => r ?? []),
    "documentSymbol",
  )

  if (symbols.length === 0) {
    return { output: `Символы не найдены для ${filePath}`, success: true }
  }

  const lines = formatDocumentSymbols(symbols, 0, [])
  const output = lines.slice(0, MAX_SYMBOL_RESULTS)
  return {
    output: `Символы файла ${filePath}:\n\n${output.join("\n")}`,
    success: true,
  }
}

export async function executeWorkspaceSymbol(
  query: string,
  getWorkDir: () => string,
  maxResults: number = MAX_SYMBOL_RESULTS,
): Promise<{ output: string; success: boolean }> {
  const results = await withTimeout(
    () => Promise.resolve(vscode.commands.executeCommand<vscode.SymbolInformation[]>(
      "vscode.executeWorkspaceSymbolProvider",
      query,
    )).then((r) => r ?? []),
    "workspaceSymbol",
  )

  if (results.length === 0) {
    return { output: `Символы workspace для "${query}" не найдены`, success: true }
  }

  const relevantKinds = new Set([
    vscode.SymbolKind.Class,
    vscode.SymbolKind.Function,
    vscode.SymbolKind.Method,
    vscode.SymbolKind.Interface,
    vscode.SymbolKind.Variable,
    vscode.SymbolKind.Constant,
    vscode.SymbolKind.Struct,
    vscode.SymbolKind.Enum,
  ])
  const filtered = results
    .filter((s) => relevantKinds.has(s.kind))
    .slice(0, maxResults)

  if (filtered.length === 0) {
    return {
      output: `Символы workspace для "${query}" не найдены (из ${results.length} результатов нет релевантных видов)`,
      success: true,
    }
  }

  const lines = filtered.map((s) => {
    const kind = lspSymbolKindLabel(s.kind)
    const container = s.containerName ? ` <${s.containerName}>` : ""
    const loc = s.location
    const relPath = relativePath(loc.uri.fsPath, getWorkDir)
    return `${kind} ${s.name}${container} — ${relPath}:${loc.range.start.line + 1}`
  })

  return {
    output: `Символы workspace для "${query}" (${filtered.length} из ${results.length}):\n\n${lines.join("\n")}`,
    success: true,
  }
}

export async function executeGoToDefinition(
  filePathRaw: string,
  line: number | undefined,
  character: number | undefined,
  getWorkDir: () => string,
): Promise<{ output: string; success: boolean }> {
  return executeLspPositionCommand<vscode.Location>(
    filePathRaw,
    line,
    character,
    "vscode.executeDefinitionProvider",
    "definition",
    getWorkDir,
    (locations) => formatLocations(locations, "Определение", getWorkDir),
    (fp, pos) => `Определение не найдено в ${fp}:${pos.line + 1}:${pos.character + 1}`,
  )
}

export async function executeGoToTypeDefinition(
  filePathRaw: string,
  line: number | undefined,
  character: number | undefined,
  getWorkDir: () => string,
): Promise<{ output: string; success: boolean }> {
  return executeLspPositionCommand<vscode.Location>(
    filePathRaw,
    line,
    character,
    "vscode.executeTypeDefinitionProvider",
    "typeDefinition",
    getWorkDir,
    (locations) => formatLocations(locations, "Определение типа", getWorkDir),
    (fp, pos) => `Определение типа не найдено в ${fp}:${pos.line + 1}:${pos.character + 1}`,
  )
}

export async function executeGoToImplementation(
  filePathRaw: string,
  line: number | undefined,
  character: number | undefined,
  getWorkDir: () => string,
): Promise<{ output: string; success: boolean }> {
  return executeLspPositionCommand<vscode.Location>(
    filePathRaw,
    line,
    character,
    "vscode.executeImplementationProvider",
    "implementation",
    getWorkDir,
    (locations) => formatLocations(locations, "Реализация", getWorkDir),
    (fp, pos) => `Реализация не найдена в ${fp}:${pos.line + 1}:${pos.character + 1}`,
  )
}

export async function executeFindReferences(
  filePathRaw: string,
  line: number | undefined,
  character: number | undefined,
  getWorkDir: () => string,
): Promise<{ output: string; success: boolean }> {
  const position = toPosition(line, character)
  const filePath = resolveFilePath(filePathRaw, getWorkDir)
  await ensureFileExists(filePath)
  const uri = vscode.Uri.file(filePath)
  await openDocumentForLsp(uri)

  const references = await withTimeout(
    () => Promise.resolve(vscode.commands.executeCommand<vscode.Location[]>(
      "vscode.executeReferenceProvider",
      uri,
      position,
      { includeDeclaration: true },
    )).then((r) => r ?? []),
    "references",
  )

  if (references.length === 0) {
    return { output: `Ссылки не найдены в ${filePath}:${position.line + 1}:${position.character + 1}`, success: true }
  }

  const grouped = groupLocationsByFile(references.slice(0, MAX_REFERENCE_RESULTS))
  const lines: string[] = [`Ссылки (${references.length} всего):`]

  for (const [file, locs] of Object.entries(grouped)) {
    const relPath = relativePath(file, getWorkDir)
    lines.push(`\n${relPath}:`)
    for (const loc of locs) {
      const snippet = await getLineSnippet(loc)
      lines.push(`  строка ${loc.range.start.line + 1}: ${snippet}`)
    }
  }

  return { output: lines.join("\n"), success: true }
}

export async function executeHover(
  filePathRaw: string,
  line: number | undefined,
  character: number | undefined,
  getWorkDir: () => string,
): Promise<{ output: string; success: boolean }> {
  const position = toPosition(line, character)
  const filePath = resolveFilePath(filePathRaw, getWorkDir)
  await ensureFileExists(filePath)
  const uri = vscode.Uri.file(filePath)
  await openDocumentForLsp(uri)

  const hovers = await withTimeout(
    () => Promise.resolve(vscode.commands.executeCommand<vscode.Hover[]>(
      "vscode.executeHoverProvider",
      uri,
      position,
    )).then((r) => r ?? []),
    "hover",
  )

  if (hovers.length === 0) {
    return { output: `Hover-информация не найдена в ${filePath}:${position.line + 1}:${position.character + 1}`, success: true }
  }

  const lines: string[] = []
  for (const hover of hovers) {
    for (const content of hover.contents) {
      const text = markdownToString(content)
      if (text) {
        lines.push(text.slice(0, MAX_HOVER_CHARS))
      }
    }
  }

  if (lines.length === 0) {
    return { output: `Hover-информация пуста в ${filePath}:${position.line + 1}:${position.character + 1}`, success: true }
  }

  return { output: lines.join("\n\n"), success: true }
}

export async function executeSignatureHelp(
  filePathRaw: string,
  line: number | undefined,
  character: number | undefined,
  getWorkDir: () => string,
): Promise<{ output: string; success: boolean }> {
  const position = toPosition(line, character)
  const filePath = resolveFilePath(filePathRaw, getWorkDir)
  await ensureFileExists(filePath)
  const uri = vscode.Uri.file(filePath)
  await openDocumentForLsp(uri)

  const help = await withTimeout(
    () => Promise.resolve(vscode.commands.executeCommand<vscode.SignatureHelp | undefined>(
      "vscode.executeSignatureHelpProvider",
      uri,
      position,
      "\n",
    )).then((r) => r),
    "signatureHelp",
  )

  if (!help || help.signatures.length === 0) {
    return { output: `Сигнатура не найдена в ${filePath}:${position.line + 1}:${position.character + 1}`, success: true }
  }

  const lines: string[] = []
  for (let i = 0; i < help.signatures.length; i++) {
    const sig = help.signatures[i]
    const label = typeof sig.label === "string" ? sig.label : String(sig.label)
    const active = help.activeSignature === i ? " [активна]" : ""
    lines.push(`${label}${active}`)

    if (sig.documentation) {
      lines.push(markdownToString(sig.documentation))
    }

    if (sig.parameters) {
      for (const param of sig.parameters) {
        const paramLabel = typeof param.label === "string" ? param.label : Array.isArray(param.label) ? `${param.label[0]}-${param.label[1]}` : String(param.label)
        const paramDoc = param.documentation ? markdownToString(param.documentation) : ""
        lines.push(`  ${paramLabel}${paramDoc ? ` \u2014 ${paramDoc}` : ""}`)
      }
    }
  }

  return { output: lines.join("\n"), success: true }
}

async function formatLocations(
  locations: vscode.Location[],
  title: string,
  getWorkDir: () => string,
): Promise<{ output: string; success: boolean }> {
  const lines: string[] = []
  for (const loc of locations) {
    const relPath = relativePath(loc.uri.fsPath, getWorkDir)
    const snippet = await getLineSnippet(loc)
    lines.push(`${title}: ${relPath}:${loc.range.start.line + 1}`)
    if (snippet) {
      lines.push(`  ${snippet}`)
    }
  }
  return { output: lines.join("\n\n"), success: true }
}

/** Вернуть текст строки по LSP-локации. */
export async function getLineSnippet(location: vscode.Location): Promise<string> {
  try {
    const doc = await vscode.workspace.openTextDocument(location.uri)
    const line = doc.lineAt(location.range.start.line)
    return line.text.trim().slice(0, LSP_SNIPPET_LENGTH)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Не удалось получить сниппет строки: ${msg}`)
    return ""
  }
}

function groupLocationsByFile(locations: vscode.Location[]): Record<string, vscode.Location[]> {
  const grouped: Record<string, vscode.Location[]> = {}
  for (const loc of locations) {
    const file = loc.uri.fsPath
    if (!grouped[file]) grouped[file] = []
    grouped[file].push(loc)
  }
  return grouped
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
