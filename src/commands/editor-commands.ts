import type { App } from "../core/App"
import type { IAgentOrchestrator } from "../core/IAgent"
import type { GitService } from "../services/git/GitService"
import type { DiffViewerProvider } from "../providers/DiffViewerProvider"
import { createEditorCommand } from "./index"

export function registerEditorCommands(
  app: App,
  agent: IAgentOrchestrator,
  gitService: GitService,
  diffViewer: DiffViewerProvider | undefined,
): void {
  createEditorCommand(app, {
    name: "explainCode",
    noSelectionMessage: "Выберите код для объяснения",
    requireSelection: true,
    promptTemplate: (text, lang) => `Объясни этот код:\n\n\`\`\`${lang}\n${text}\n\`\`\``,
  }, agent, gitService, diffViewer)

  createEditorCommand(app, {
    name: "fixCode",
    noSelectionMessage: "Выберите код для исправления",
    requireSelection: true,
    promptTemplate: (text, lang) => `Исправь ошибки и проблемы в этом коде:\n\n\`\`\`${lang}\n${text}\n\`\`\``,
  }, agent, gitService, diffViewer)

  createEditorCommand(app, {
    name: "improveCode",
    noSelectionMessage: "Выберите код для улучшения",
    requireSelection: true,
    promptTemplate: (text, lang) => `Улучши этот код по читаемости, производительности и лучшим практикам:\n\n\`\`\`${lang}\n${text}\n\`\`\``,
  }, agent, gitService, diffViewer)

  createEditorCommand(app, {
    name: "addToContext",
    noSelectionMessage: "",
    requireSelection: false,
    promptTemplate: (text, lang, filePath) => `Вот контекст из файла ${filePath}:\n\n\`\`\`${lang}\n${text}\n\`\`\``,
  }, agent, gitService, diffViewer)
}
