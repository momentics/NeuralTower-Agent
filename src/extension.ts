import * as vscode from "vscode"
import { App } from "./core/App"
import { AgentCodeActionProvider, codeActionProviderMetadata } from "./services/code-actions/AgentCodeActionProvider"
import { DiffViewerProvider } from "./providers/DiffViewerProvider"
import { createDeps } from "./di/Container"
import { registerAllCommands } from "./commands/CommandBus"
import { createOutputChannel } from "./commands/Utils"
import { createDomainLogger } from "./core/Logger"
import { errorMessage } from "./core/Errors"

const log = createDomainLogger("Extension")

let app: App | undefined

export async function activate(ctx: vscode.ExtensionContext): Promise<void> {
  app = new App(ctx)
  const deps = await createDeps(ctx)

  // ── Канал вывода ────────────────────────────────────────
  const outputChannel = createOutputChannel()

  // ── Провайдеры ──────────────────────────────────────────
  app.registerProvider(deps.chatProvider)

  // ── Автодополнение ──────────────────────────────────────
  vscode.languages.registerInlineCompletionItemProvider(
    { pattern: "**/*" },
    deps.autocompleteService,
  )

  // ── Действия кода ────────────────────────────────────────
  const codeActionProvider = new AgentCodeActionProvider(deps.chatProvider)
  vscode.languages.registerCodeActionsProvider("*", codeActionProvider, codeActionProviderMetadata)

  // ── Команды ─────────────────────────────────────────────
  registerAllCommands({
    app,
    agent: deps.agent,
    chatProvider: deps.chatProvider,
    todoStore: deps.todoStore,
    backend: deps.backend,
    gitService: deps.gitService,
    diffViewer: deps.diffViewer,
    settingsProvider: deps.settingsProvider,
    commitMessageService: deps.commitMessageService,
    extUri: ctx.extensionUri,
    codebaseIndexer: deps.codebaseIndexer,
    outputChannel,
  })

  // ── Сериализаторы панелей Webview ─────────────────────────────
  vscode.window.registerWebviewPanelSerializer(
    DiffViewerProvider.viewType,
    {
      deserializeWebviewPanel(panel: vscode.WebviewPanel) {
        panel.dispose()
        return Promise.resolve()
      },
    },
  )

  // ── Слушатель изменений рабочей директории ──────────────
  vscode.workspace.onDidChangeWorkspaceFolders(async () => {
    if (vscode.workspace.workspaceFolders?.[0]) {
      const newDir = vscode.workspace.workspaceFolders[0].uri.fsPath
      deps.setWorkDir(newDir)
      deps.gitService.resetRoot()
      await deps.gitService.findRoot(newDir)
      await deps.fileIndex.build(newDir)
      await deps.agent.reload()
    }
  })

  // ── Запуск ──────────────────────────────────────────────
  await app.init()
  deps.telemetry.capture("session_started", { version: app.version() })

  // ── Сохранить объекты для освобождения ──────────────────
  ctx.subscriptions.push({
    dispose: () => {
      const toDispose: (() => void | Promise<void>)[] = [
        // Агенты (созданы последними)
        () => deps.agent.dispose(),
        // UI-провайдеры
        () => deps.diffViewer.dispose(),
        () => deps.settingsProvider.dispose(),
        // Мониторинг
        () => deps.healthMonitor.dispose(),
        () => deps.indexingStatusBar.dispose(),
        () => deps.commitMessageService.dispose(),
        () => deps.autocompleteService.dispose(),
        // Сервисы
        () => deps.notificationService.dispose(),
        () => deps.permissionManager.dispose(),
        () => deps.sessionStore.dispose(),
        // Инфраструктура
        () => deps.codebaseIndexer.dispose(),
        () => deps.mcpManager.disconnect(),
        () => deps.telemetry.dispose(),
        () => outputChannel.dispose(),
      ]

      for (const fn of toDispose) {
        try {
          fn()
        } catch (err: unknown) {
          const msg = errorMessage(err)
          log.error(`Ошибка при освобождении ресурса: ${msg}`)
        }
      }
    },
  })
}

export function deactivate(): void {
  app?.dispose()
}
