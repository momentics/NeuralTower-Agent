import * as vscode from "vscode"
import type { ContextProvider, ContextItem } from "./types"

export function makeActiveFileProblemsProvider(): ContextProvider {
  return {
    description: {
      name: "problems",
      displayTitle: "Problems",
      description: "Проблемы в активном файле",
      type: "normal",
    },
    async resolve(_query: string): Promise<ContextItem[]> {
      const editor = vscode.window.activeTextEditor
      if (!editor) return [{ content: "Нет активного редактора", name: "problems" }]

      const diagnostics = vscode.languages.getDiagnostics(editor.document.uri)
      if (diagnostics.length === 0) {
        return [{ content: `В файле ${editor.document.uri.fsPath} проблем нет`, name: "problems" }]
      }

      const severityMap: Record<number, string> = { 0: "error", 1: "warning", 2: "info", 3: "hint" }
      const lines: string[] = []
      for (const d of diagnostics) {
        const line = d.range.start.line + 1
        const sev = severityMap[d.severity] ?? "unknown"
        const snippet = editor.document.lineAt(d.range.start).text.trim().slice(0, 120)
        lines.push(`[${sev}] строка ${line}: ${d.message}`)
        lines.push(`  > ${snippet}`)
      }

      return [{
        content: `Проблемы в ${editor.document.uri.fsPath}:\n\n${lines.join("\n")}`,
        name: "problems",
        description: `${diagnostics.length} проблем`,
      }]
    },
  }
}
