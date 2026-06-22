import * as vscode from "vscode"
import { withTimeoutAndSignal } from "../shared/WithTimeoutAndSignal"
import {
  LSP_TIMEOUT_MS,
  LSP_MAX_SYMBOL_RESULTS,
  LSP_MAX_REFERENCE_RESULTS,
  LSP_MAX_HOVER_CHARS,
} from "../core/Config"
import {
  lspSymbolKindLabel,
  formatDocumentSymbols,
  markdownToString,
  getLineSnippet,
  groupLocationsByFile,
  resolveFilePath,
  ensureFileExists,
  openDocumentForLsp,
  toPosition,
  relativePath,
  executeLspCommand,
  executeLspPositionCommand,
} from "./LspUtils"

// ── Публичные функции ────────────────────────────────────

export {
  lspSymbolKindLabel,
  formatDocumentSymbols,
  markdownToString,
  getLineSnippet,
}

export async function executeDocumentSymbol(
  filePathRaw: string,
  getWorkDir: () => string,
  signal?: AbortSignal,
): Promise<{ output: string; success: boolean }> {
  return executeLspCommand<vscode.DocumentSymbol>(
    filePathRaw,
    "vscode.executeDocumentSymbolProvider",
    "documentSymbol",
    [vscode.Uri.file(resolveFilePath(filePathRaw, getWorkDir))],
    getWorkDir,
    (symbols) => {
      const lines = formatDocumentSymbols(symbols, 0, [])
      const output = lines.slice(0, LSP_MAX_SYMBOL_RESULTS)
      return {
        output: `Символы файла ${resolveFilePath(filePathRaw, getWorkDir)}:\n\n${output.join("\n")}`,
        success: true,
      }
    },
    (filePath) => `Символы не найдены для ${filePath}`,
    signal,
  )
}

export async function executeWorkspaceSymbol(
  query: string,
  getWorkDir: () => string,
  maxResults: number = LSP_MAX_SYMBOL_RESULTS,
  signal?: AbortSignal,
): Promise<{ output: string; success: boolean }> {
  const results = await withTimeoutAndSignal(
    () => Promise.resolve(vscode.commands.executeCommand<vscode.SymbolInformation[]>(
      "vscode.executeWorkspaceSymbolProvider",
      query,
    )).then((r) => r ?? []),
    LSP_TIMEOUT_MS,
    "workspaceSymbol",
    signal,
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

/**
 * Фабрика для создания LSP-команд навигации (GoTo).
 */
function createGoToCommand(
  command: string,
  label: string,
  title: string,
): (filePathRaw: string, line: number | undefined, character: number | undefined, getWorkDir: () => string, signal?: AbortSignal) => Promise<{ output: string; success: boolean }> {
  return (filePathRaw, line, character, getWorkDir, signal) =>
    executeLspPositionCommand<vscode.Location>(
      filePathRaw,
      line,
      character,
      command,
      label,
      getWorkDir,
      (locations) => formatLocations(locations, title, getWorkDir),
      (fp, pos) => `${title} не найдено в ${fp}:${pos.line + 1}:${pos.character + 1}`,
      signal,
    )
}

export const executeGoToDefinition = createGoToCommand(
  "vscode.executeDefinitionProvider",
  "definition",
  "Определение",
)

export const executeGoToTypeDefinition = createGoToCommand(
  "vscode.executeTypeDefinitionProvider",
  "typeDefinition",
  "Определение типа",
)

export const executeGoToImplementation = createGoToCommand(
  "vscode.executeImplementationProvider",
  "implementation",
  "Реализация",
)

/**
 * Подготовка LSP-команды с позицией: разрешить путь, проверить файл, открыть документ.
 */
async function prepareLspPosition(
  filePathRaw: string,
  line: number | undefined,
  character: number | undefined,
  getWorkDir: () => string,
): Promise<{ position: vscode.Position; filePath: string; uri: vscode.Uri }> {
  const position = toPosition(line, character)
  const filePath = resolveFilePath(filePathRaw, getWorkDir)
  await ensureFileExists(filePath)
  const uri = vscode.Uri.file(filePath)
  await openDocumentForLsp(uri)
  return { position, filePath, uri }
}

/**
 * Фабрика для LSP-команд с позицией и одиночным результатом.
 */
function createPositionCommand<T>(
  command: string,
  label: string,
  extraArgs: unknown[],
  format: (result: T | undefined, filePath: string, position: vscode.Position) => Promise<{ output: string; success: boolean }> | { output: string; success: boolean },
  notFoundMsg: (filePath: string, position: vscode.Position) => string,
): (filePathRaw: string, line: number | undefined, character: number | undefined, getWorkDir: () => string, signal?: AbortSignal) => Promise<{ output: string; success: boolean }> {
  return async (filePathRaw, line, character, getWorkDir, signal) => {
    const { position, filePath, uri } = await prepareLspPosition(filePathRaw, line, character, getWorkDir)

    const result = await withTimeoutAndSignal(
      () => Promise.resolve(vscode.commands.executeCommand<T>(command, uri, position, ...extraArgs)).then((r) => r),
      LSP_TIMEOUT_MS,
      label,
      signal,
    )

    if (!result) {
      return { output: notFoundMsg(filePath, position), success: true }
    }

    return format(result, filePath, position)
  }
}

/**
 * Фабрика для LSP-команд с позицией и массивом результатов.
 */
function createPositionArrayCommand<T>(
  command: string,
  label: string,
  extraArgs: unknown[],
  format: (results: T[], filePath: string, position: vscode.Position, getWorkDir: () => string) => Promise<{ output: string; success: boolean }> | { output: string; success: boolean },
  notFoundMsg: (filePath: string, position: vscode.Position) => string,
): (filePathRaw: string, line: number | undefined, character: number | undefined, getWorkDir: () => string, signal?: AbortSignal) => Promise<{ output: string; success: boolean }> {
  return async (filePathRaw, line, character, getWorkDir, signal) => {
    const { position, filePath, uri } = await prepareLspPosition(filePathRaw, line, character, getWorkDir)

    const results = await withTimeoutAndSignal(
      () => Promise.resolve(vscode.commands.executeCommand<T[]>(command, uri, position, ...extraArgs)).then((r) => r ?? []),
      LSP_TIMEOUT_MS,
      label,
      signal,
    )

    if (results.length === 0) {
      return { output: notFoundMsg(filePath, position), success: true }
    }

    return format(results, filePath, position, getWorkDir)
  }
}

export const executeFindReferences = createPositionArrayCommand<vscode.Location>(
  "vscode.executeReferenceProvider",
  "references",
  [{ includeDeclaration: true }],
  async (references, filePath, position, getWorkDir) => {
    const grouped = groupLocationsByFile(references.slice(0, LSP_MAX_REFERENCE_RESULTS))
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
  },
  (filePath, position) => `Ссылки не найдены в ${filePath}:${position.line + 1}:${position.character + 1}`,
)

export const executeHover = createPositionArrayCommand<vscode.Hover>(
  "vscode.executeHoverProvider",
  "hover",
  [],
  (hovers, filePath, position) => {
    const lines: string[] = []
    for (const hover of hovers) {
      for (const content of hover.contents) {
        const text = markdownToString(content)
        if (text) {
          lines.push(text.slice(0, LSP_MAX_HOVER_CHARS))
        }
      }
    }

    if (lines.length === 0) {
      return { output: `Hover-информация пуста в ${filePath}:${position.line + 1}:${position.character + 1}`, success: true }
    }

    return { output: lines.join("\n\n"), success: true }
  },
  (filePath, position) => `Hover-информация не найдена в ${filePath}:${position.line + 1}:${position.character + 1}`,
)

export const executeSignatureHelp = createPositionCommand(
  "vscode.executeSignatureHelpProvider",
  "signatureHelp",
  ["\n"],
  async (result: vscode.SignatureHelp | undefined, filePath, position) => {
    if (!result || result.signatures.length === 0) {
      return { output: `Сигнатура не найдена в ${filePath}:${position.line + 1}:${position.character + 1}`, success: true }
    }

    const lines: string[] = []
    for (let i = 0; i < result.signatures.length; i++) {
      const sig = result.signatures[i]
      const label = typeof sig.label === "string" ? sig.label : String(sig.label)
      const active = result.activeSignature === i ? " [активна]" : ""
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
  },
  (filePath, position) => `Сигнатура не найдена в ${filePath}:${position.line + 1}:${position.character + 1}`,
)

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
