import * as vscode from "vscode"
import type { IAgentOrchestrator } from "../core/IAgent"
import { AbortError, BackendError, NeuralTowerError } from "../core/errors"
import type { GitService } from "../services/git/GitService"
import type { DiffViewerProvider } from "../providers/DiffViewerProvider"
import { detectLanguageDisplay } from "../utils/LanguageDetector"

let agentOutputChannel: vscode.OutputChannel | undefined

export function getOutputChannel(): vscode.OutputChannel {
  if (!agentOutputChannel) {
    agentOutputChannel = vscode.window.createOutputChannel("NeuralTower Agent", { log: true })
  }
  return agentOutputChannel
}

export function disposeOutputChannel(): void {
  agentOutputChannel?.dispose()
  agentOutputChannel = undefined
}

export async function sendAgentQuery(
  query: string,
  workDir: string,
  agent: IAgentOrchestrator,
  gitService: GitService,
  diffViewer: DiffViewerProvider | undefined,
): Promise<void> {
  const channel = getOutputChannel()
  channel.show()
  channel.appendLine(`> ${query.slice(0, 80)}...`)

  try {
    await agent.run(query, (chunk: string) => {
      channel.append(chunk)
    })
    channel.appendLine("\nГотово.")

    const diff = await gitService.getDiff(workDir)
    diffViewer?.openPanel(diff)
  } catch (err) {
    if (err instanceof AbortError) {
      channel.appendLine("\nЗадача остановлена пользователем")
    } else if (err instanceof BackendError) {
      channel.appendLine(`\nОшибка бэкенда: ${err.message}`)
    } else if (err instanceof NeuralTowerError) {
      channel.appendLine(`\n${err.name}: ${err.message}`)
    } else {
      channel.appendLine(`\nОшибка: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

export { detectLanguageDisplay }
