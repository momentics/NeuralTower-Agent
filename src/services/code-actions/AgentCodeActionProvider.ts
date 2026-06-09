import * as vscode from "vscode"
import type { IAgentOrchestrator } from "../../core/IAgent"
import type { ChatProvider } from "../../providers/ChatProvider"

export const codeActionProviderMetadata: vscode.CodeActionProviderMetadata = {
  providedCodeActionKinds: [
    vscode.CodeActionKind.QuickFix,
    vscode.CodeActionKind.RefactorRewrite,
  ],
}

export class AgentCodeActionProvider implements vscode.CodeActionProvider {
  constructor(
    private readonly chatProvider: ChatProvider,
  ) {}

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] | undefined {
    if (range.isEmpty) return undefined

    const actions: vscode.CodeAction[] = []
    const selection = document.getText(range)
    const filePath = document.uri.fsPath

    const hasDiagnostics = context.diagnostics.length > 0

    if (hasDiagnostics) {
      const diagnosticsText = context.diagnostics
        .map((d) => `${d.severity}: ${d.message}`)
        .join("\n")

      const fix = new vscode.CodeAction(
        "Исправить с помощью агента",
        vscode.CodeActionKind.QuickFix,
      )
      fix.command = {
        command: "neuralTowerAgent.codeAction.fix",
        title: "Исправить с помощью агента",
        arguments: [selection, filePath, diagnosticsText],
      }
      fix.isPreferred = true
      actions.push(fix)
    }

    const explain = new vscode.CodeAction(
      "Объяснить код",
      vscode.CodeActionKind.RefactorRewrite,
    )
    explain.command = {
      command: "neuralTowerAgent.codeAction.explain",
      title: "Объяснить код",
      arguments: [selection, filePath],
    }
    actions.push(explain)

    const improve = new vscode.CodeAction(
      "Улучшить код",
      vscode.CodeActionKind.RefactorRewrite,
    )
    improve.command = {
      command: "neuralTowerAgent.codeAction.improve",
      title: "Улучшить код",
      arguments: [selection, filePath],
    }
    actions.push(improve)

    const addToContext = new vscode.CodeAction(
      "Добавить в контекст агента",
      vscode.CodeActionKind.RefactorRewrite,
    )
    addToContext.command = {
      command: "neuralTowerAgent.codeAction.addToContext",
      title: "Добавить в контекст",
      arguments: [selection, filePath],
    }
    actions.push(addToContext)

    return actions
  }
}
