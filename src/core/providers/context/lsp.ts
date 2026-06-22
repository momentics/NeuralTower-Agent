import * as path from "path"
import * as vscode from "vscode"
import type { ContextProvider, ContextItem } from "./Types"
import {
  lspSymbolKindLabel,
  formatDocumentSymbols,
  executeWorkspaceSymbol,
  executeDocumentSymbol,
} from "../../../lsp/LspClient"
import { withTimeoutAndSignal } from "../../../shared/WithTimeoutAndSignal"
import { errorMessage } from "../../Errors"

const LSP_PROVIDER_MAX_SYMBOLS = 30
const LSP_PROVIDER_MAX_DEFS = 5
const LSP_PROVIDER_MAX_REFS = 15

export function makeLspProvider(
  getWorkDir: () => string,
): ContextProvider {
  return {
    description: {
      name: "lsp",
      displayTitle: "LSP",
      description: "LSP-операции: символы, определения, ссылки, hover",
      type: "query",
    },
    async resolve(query: string): Promise<ContextItem[]> {
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
          if (!path.isAbsolute(filePath)) {
            filePath = path.join(getWorkDir(), filePath)
          }
        } else {
          symbolQuery = possiblePath
        }
      } else {
        symbolQuery = trimmed
      }

      try {
        if (symbolQuery && !filePath) {
          const wsResult = await executeWorkspaceSymbol(symbolQuery, getWorkDir, LSP_PROVIDER_MAX_SYMBOLS)
          return [{
            content: wsResult.output,
            name: `LSP: ${symbolQuery}`,
            description: wsResult.output.includes("не найдены") ? "not found" : `${LSP_PROVIDER_MAX_SYMBOLS} результатов`,
          }]
        }

        if (filePath) {
          if (line && character) {
            const uri = vscode.Uri.file(filePath)
            await vscode.workspace.openTextDocument(uri)
            const position = new vscode.Position(line - 1, character - 1)

            const [definitions, references, hovers] = await Promise.all([
              withTimeoutAndSignal(
                () => Promise.resolve(vscode.commands.executeCommand<vscode.Location[]>(
                  "vscode.executeDefinitionProvider", uri, position,
                )).then((r) => r ?? []),
                10_000,
                "definition",
              ),
              withTimeoutAndSignal(
                () => Promise.resolve(vscode.commands.executeCommand<vscode.Location[]>(
                  "vscode.executeReferenceProvider", uri, position, { includeDeclaration: true },
                )).then((r) => r ?? []),
                10_000,
                "references",
              ),
              withTimeoutAndSignal(
                () => Promise.resolve(vscode.commands.executeCommand<vscode.Hover[]>(
                  "vscode.executeHoverProvider", uri, position,
                )).then((r) => r ?? []),
                10_000,
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
                const rel = path.relative(getWorkDir(), d.uri.fsPath)
                return `  ${rel}:${d.range.start.line + 1}`
              })
              parts.push(`Определение (${definitions.length}):\n${defLines.join("\n")}`)
            }

            if (references.length > 0) {
              const refLines = references.slice(0, LSP_PROVIDER_MAX_REFS).map((r) => {
                const rel = path.relative(getWorkDir(), r.uri.fsPath)
                return `  ${rel}:${r.range.start.line + 1}`
              })
              parts.push(`Ссылки (${references.length}):\n${refLines.join("\n")}`)
            }

            if (parts.length === 0) {
              return [{ content: `LSP-информация не найдена для ${filePath}:${line}:${character}`, name: "lsp", description: "empty" }]
            }

            return [{
              content: parts.join("\n\n"),
              name: `LSP: ${path.basename(filePath)}:${line}:${character}`,
              description: `${definitions.length} def, ${references.length} ref`,
            }]
          }

          const docResult = await executeDocumentSymbol(filePath, getWorkDir)
          return [{
            content: docResult.output,
            name: `LSP: ${path.basename(filePath)}`,
            description: docResult.output.includes("не найдены") ? "empty" : `${LSP_PROVIDER_MAX_SYMBOLS} символов`,
          }]
        }

        return [{ content: `Некорректный запрос: ${trimmed}`, name: "lsp", description: "error" }]
      } catch (err: unknown) {
        const msg = errorMessage(err)
        return [{ content: `LSP-ошибка: ${msg}`, name: "lsp", description: "error" }]
      }
    },
  }
}
