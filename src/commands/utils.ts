import * as vscode from "vscode"
import type { IAgentOrchestrator } from "../core/IAgent"
import { handleBackendError } from "../core/errors"
import type { IGitService } from "../services/git/GitService"
import type { DiffViewerProvider } from "../providers/DiffViewerProvider"
import { detectLanguageDisplay } from "../utils/LanguageDetector"

const LOG_TRUNCATE_LENGTH = 80

/**
 * Создать канал вывода для агента.
 * Вызывается один раз при инициализации расширения.
 */
export function createOutputChannel(): vscode.OutputChannel {
  return vscode.window.createOutputChannel("NeuralTower Agent", { log: true })
}

/** Отправить запрос агенту с выводом в канал логов и открытием diff-viewer. */
export async function sendAgentQuery(
  query: string,
  workDir: string,
  agent: IAgentOrchestrator,
  gitService: IGitService,
  diffViewer: DiffViewerProvider | undefined,
  channel: vscode.OutputChannel,
): Promise<void> {
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
