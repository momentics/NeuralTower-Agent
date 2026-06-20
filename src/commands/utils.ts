import * as vscode from "vscode"
import type { IAgentOrchestrator } from "../core/IAgent"
import { handleBackendError } from "../core/errors"
import type { IGitService } from "../services/git/GitService"
import type { DiffViewerProvider } from "../providers/DiffViewerProvider"
import { detectLanguageDisplay } from "../utils/LanguageDetector"

const LOG_TRUNCATE_LENGTH = 80

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

/** Отправить запрос агенту с выводом в канал логов и открытием diff-viewer. */
export async function sendAgentQuery(
  query: string,
  workDir: string,
  agent: IAgentOrchestrator,
  gitService: IGitService,
  diffViewer: DiffViewerProvider | undefined,
): Promise<void> {
  const channel = getOutputChannel()
  channel.show()
   channel.appendLine(`> ${query.slice(0, LOG_TRUNCATE_LENGTH)}...`)

  try {
    await agent.run(query, (chunk: string) => {
      channel.append(chunk)
    })
    channel.appendLine("\nГотово.")

    const diff = await gitService.getDiff(workDir)
    diffViewer?.openPanel(diff)
  } catch (err: unknown) {
     handleBackendError(err, (msg) => channel.appendLine(`\n${msg}`))
  }
}

export { detectLanguageDisplay }
