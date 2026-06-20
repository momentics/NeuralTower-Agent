import type { App } from "../core/App"
import { sendAgentQuery, detectLanguageDisplay } from "./utils"
import type { IAgentOrchestrator } from "../core/IAgent"
import type { IGitService } from "../services/git/GitService"
import type { DiffViewerProvider } from "../providers/DiffViewerProvider"
import { EDITOR_ACTIONS } from "./action-definitions"

export function registerCodeActionCommands(
  app: App,
  agent: IAgentOrchestrator,
  gitService: IGitService,
  diffViewer: DiffViewerProvider | undefined,
): void {
  for (const action of EDITOR_ACTIONS) {
    app.registerCommand(action.codeActionCommandId, async (...args: unknown[]) => {
      const [text, filePath, diagnostics] = [args[0] as string, args[1] as string, args[2] as string]
      if (!text || !filePath) return
      const lang = detectLanguageDisplay(filePath)
      const prompt = action.codeActionWithDiagnosticsPromptTemplate
        ? action.codeActionWithDiagnosticsPromptTemplate(text, lang, filePath, diagnostics ?? "")
        : action.codeActionPromptTemplate(text, lang, filePath)
      await sendAgentQuery(prompt, filePath, agent, gitService, diffViewer)
    })
  }
}
