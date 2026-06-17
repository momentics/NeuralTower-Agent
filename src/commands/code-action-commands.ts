import type { App } from "../core/App"
import { sendAgentQuery, getLang } from "./utils"
import type { IAgentOrchestrator } from "../core/IAgent"
import type { GitService } from "../services/git/GitService"
import type { DiffViewerProvider } from "../providers/DiffViewerProvider"

export function registerCodeActionCommands(
  app: App,
  agent: IAgentOrchestrator,
  gitService: GitService,
  diffViewer: DiffViewerProvider | undefined,
): void {
  app.registerCommand("neuralTowerAgent.codeAction.fix", async (...args: unknown[]) => {
    const [text, filePath, diagnostics] = [args[0] as string, args[1] as string, args[2] as string]
    if (!text || !filePath) return
    const prompt = `Исправь следующие проблемы в этом коде:\n\nДиагностика:\n${diagnostics}\n\nКод:\n\`\`\`${getLang(filePath)}\n${text}\n\`\`\``
    await sendAgentQuery(prompt, filePath, agent, gitService, diffViewer)
  })

  app.registerCommand("neuralTowerAgent.codeAction.explain", async (...args: unknown[]) => {
    const [text, filePath] = [args[0] as string, args[1] as string]
    if (!text || !filePath) return
    await sendAgentQuery(`Объясни этот код:\n\n\`\`\`${getLang(filePath)}\n${text}\n\`\`\``, filePath, agent, gitService, diffViewer)
  })

  app.registerCommand("neuralTowerAgent.codeAction.improve", async (...args: unknown[]) => {
    const [text, filePath] = [args[0] as string, args[1] as string]
    if (!text || !filePath) return
    await sendAgentQuery(`Улучши этот код:\n\n\`\`\`${getLang(filePath)}\n${text}\n\`\`\``, filePath, agent, gitService, diffViewer)
  })

  app.registerCommand("neuralTowerAgent.codeAction.addToContext", async (...args: unknown[]) => {
    const [text, filePath] = [args[0] as string, args[1] as string]
    if (!text || !filePath) return
    await sendAgentQuery(`Вот контекст из ${filePath}:\n\`\`\`${getLang(filePath)}\n${text}\n\`\`\``, filePath, agent, gitService, diffViewer)
  })
}
