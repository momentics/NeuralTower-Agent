import * as vscode from "vscode"
import type { ContextProvider, ContextItem } from "./types"

const LSP_PROVIDER_TIMEOUT_MS = 10_000
const LSP_PROVIDER_MAX_SYMBOLS = 30
const LSP_PROVIDER_MAX_DEFS = 5
const LSP_PROVIDER_MAX_REFS = 15

function lspSymbolKindLabel(kind: vscode.SymbolKind): string {
  const map: Record<number, string> = {
    [vscode.SymbolKind.Class]: "class",
    [vscode.SymbolKind.Function]: "function",
    [vscode.SymbolKind.Method]: "method",
    [vscode.SymbolKind.Interface]: "interface",
    [vscode.SymbolKind.Variable]: "variable",
    [vscode.SymbolKind.Constant]: "constant",
    [vscode.SymbolKind.Struct]: "struct",
    [vscode.SymbolKind.Enum]: "enum",
    [vscode.SymbolKind.Property]: "property",
    [vscode.SymbolKind.Field]: "field",
    [vscode.SymbolKind.Constructor]: "constructor",
    [vscode.SymbolKind.Module]: "module",
    [vscode.SymbolKind.Namespace]: "namespace",
    [vscode.SymbolKind.Package]: "package",
    [vscode.SymbolKind.TypeParameter]: "type_param",
  }
  return map[kind] ?? `kind:${kind}`
}

function formatDocSymbols(symbols: vscode.DocumentSymbol[], depth: number, results: string[]): string[] {
  const indent = "  ".repeat(depth)

  for (const sym of symbols) {
    if (results.length >= 100) break
    const kind = lspSymbolKindLabel(sym.kind)
    const range = `${sym.range.start.line + 1}-${sym.range.end.line + 1}`
    const detail = sym.detail ? ` (${sym.detail})` : ""
    results.push(`${indent}${kind} ${sym.name}${detail} [${range}]`)

    if (sym.children && sym.children.length > 0 && depth < 4 && results.length < 100) {
      formatDocSymbols(sym.children, depth + 1, results)
    }
  }

  return results
}

export function makeLspProvider(
  getWorkDir: () => string,
): ContextProvider {
  const withTimeout = <T>(fn: () => Promise<T>, label: string): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeoutP = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`LSP ${label}: таймаут ${LSP_PROVIDER_TIMEOUT_MS}ms`)), LSP_PROVIDER_TIMEOUT_MS)
    })
    return Promise.race([fn(), timeoutP]).finally(() => { if (timer) clearTimeout(timer) })
  }

  return {
    description: {
      name: "lsp",
      displayTitle: "LSP",
      description: "LSP-операции: символы, определения, ссылки, hover",
      type: "query",
    },
    async resolve(query: string): Promise<ContextItem[]> {
      const path = await import("path")
      const trimmed = query.trim()
      if (!trimmed) return []

      let filePath: string | undefined
      let line: number | undefined
      let character: number | undefined
      let symbolQuery: string | undefined

      const posMatch = trimmed.match(/^(.+?)(?::(\d+)(?::(\d+))?)?$/)
      if (posMatch) {
        const possiblePath = posMatch[1]
        line = posMatch[2] ? parseInt(posMatch[2], 10) : undefined
        character = posMatch[3] ? parseInt(posMatch[3], 10) : undefined

        if (possiblePath.includes("/") || possiblePath.includes("\\")) {
          filePath = possiblePath
          if (!path.default.isAbsolute(filePath)) {
            filePath = path.default.join(getWorkDir(), filePath)
          }
        } else {
          symbolQuery = possiblePath
        }
      } else {
        symbolQuery = trimmed
      }

      try {
        if (symbolQuery && !filePath) {
          const results = await withTimeout(
            () => Promise.resolve(vscode.commands.executeCommand<vscode.SymbolInformation[]>(
              "vscode.executeWorkspaceSymbolProvider",
              symbolQuery,
            )).then((r) => r ?? []),
            "workspaceSymbol",
          )

          if (results.length === 0) {
            return [{ content: `Символы workspace для "${symbolQuery}" не найдены`, name: "lsp", description: "not found" }]
          }

          const lines = results.slice(0, LSP_PROVIDER_MAX_SYMBOLS).map((s) => {
            const kindLabel = lspSymbolKindLabel(s.kind)
            const container = s.containerName ? ` <${s.containerName}>` : ""
            const loc = s.location
            return `${kindLabel} ${s.name}${container} — ${loc.uri.fsPath}:${loc.range.start.line + 1}`
          })

          return [{
            content: `Символы workspace для "${symbolQuery}" (${results.length}):\n\n${lines.join("\n")}`,
            name: `LSP: ${symbolQuery}`,
            description: `${results.length} результатов`,
          }]
        }

        if (filePath) {
          const uri = vscode.Uri.file(filePath)
          await vscode.workspace.openTextDocument(uri)

          if (line && character) {
            const position = new vscode.Position(line - 1, character - 1)

            const [definitions, references, hovers] = await Promise.all([
              withTimeout(
                () => Promise.resolve(vscode.commands.executeCommand<vscode.Location[]>(
                  "vscode.executeDefinitionProvider", uri, position,
                )).then((r) => r ?? []),
                "definition",
              ),
              withTimeout(
                () => Promise.resolve(vscode.commands.executeCommand<vscode.Location[]>(
                  "vscode.executeReferenceProvider", uri, position, { includeDeclaration: true },
                )).then((r) => r ?? []),
                "references",
              ),
              withTimeout(
                () => Promise.resolve(vscode.commands.executeCommand<vscode.Hover[]>(
                  "vscode.executeHoverProvider", uri, position,
                )).then((r) => r ?? []),
                "hover",
              ),
            ])

            const parts: string[] = []

            if (hovers.length > 0) {
              for (const hover of hovers) {
                for (const content of hover.contents) {
                  const text = typeof content === "string" ? content :
                    (content instanceof vscode.MarkdownString ? content.value : String(content))
                  if (text) parts.push(`Hover:\n${text.slice(0, 2000)}`)
                }
              }
            }

            if (definitions.length > 0) {
              const defLines = definitions.slice(0, LSP_PROVIDER_MAX_DEFS).map((d) => {
                const rel = path.default.relative(getWorkDir(), d.uri.fsPath)
                return `  ${rel}:${d.range.start.line + 1}`
              })
              parts.push(`Определение (${definitions.length}):\n${defLines.join("\n")}`)
            }

            if (references.length > 0) {
              const refLines = references.slice(0, LSP_PROVIDER_MAX_REFS).map((r) => {
                const rel = path.default.relative(getWorkDir(), r.uri.fsPath)
                return `  ${rel}:${r.range.start.line + 1}`
              })
              parts.push(`Ссылки (${references.length}):\n${refLines.join("\n")}`)
            }

            if (parts.length === 0) {
              return [{ content: `LSP-информация не найдена для ${filePath}:${line}:${character}`, name: "lsp", description: "empty" }]
            }

            return [{
              content: parts.join("\n\n"),
              name: `LSP: ${path.default.basename(filePath)}:${line}:${character}`,
              description: `${definitions.length} def, ${references.length} ref`,
            }]
          }

          const symbols = await withTimeout(
            () => Promise.resolve(vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
              "vscode.executeDocumentSymbolProvider", uri,
            )).then((r) => r ?? []),
            "documentSymbol",
          )

          if (symbols.length === 0) {
            return [{ content: `Символы не найдены для ${filePath}`, name: "lsp", description: "empty" }]
          }

          const lines = formatDocSymbols(symbols, 0, []).slice(0, 50)
          return [{
            content: `Символы файла ${filePath}:\n\n${lines.join("\n")}`,
            name: `LSP: ${path.default.basename(filePath)}`,
            description: `${symbols.length} символов`,
          }]
        }

        return [{ content: `Некорректный запрос: ${trimmed}`, name: "lsp", description: "error" }]
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return [{ content: `LSP-ошибка: ${msg}`, name: "lsp", description: "error" }]
      }
    },
  }
}
