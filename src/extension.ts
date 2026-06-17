import * as vscode from "vscode"
import { App } from "./core/App"
import { TelemetryService } from "./services/telemetry/TelemetryService"
import { AgentCodeActionProvider, codeActionProviderMetadata } from "./services/code-actions/AgentCodeActionProvider"
import { DiffViewerProvider } from "./providers/DiffViewerProvider"
import { createDeps } from "./di/container"
import { registerAllCommands } from "./commands/command-bus"
import { disposeOutputChannel } from "./commands/utils"

let app: App | undefined

export async function activate(ctx: vscode.ExtensionContext): Promise<void> {
  app = new App(ctx)
  const deps = await createDeps(ctx)

  // ── Провайдеры ──────────────────────────────────────────
  app.registerProvider(deps.chatProvider)

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
    commitMessageService: deps.commitMessageService,
    extUri: ctx.extensionUri,
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
      deps.setWorkDir(vscode.workspace.workspaceFolders[0].uri.fsPath)
      await deps.gitService.findRoot(vscode.workspace.workspaceFolders[0].uri.fsPath)
      await deps.agent.reload()
    }
  })

  // ── Запуск ──────────────────────────────────────────────
  await app.init()
  const telemetry = TelemetryService.get()
  await telemetry.init()
  telemetry.capture("session_started", { version: "0.1.1" })

  // ── Сохранить объекты для освобождения ──────────────────
  ctx.subscriptions.push({
    dispose: () => {
      deps.agent.dispose()
      deps.sessionStore.dispose()
      telemetry.dispose()
      deps.notificationService.dispose()
      deps.permissionManager.dispose()
      deps.gitService.dispose()
      deps.healthMonitor.dispose()
      deps.commitMessageService.dispose()
      deps.diffViewer.dispose()
      void deps.mcpManager.disconnect()
      disposeOutputChannel()
    },
  })
}

export function deactivate(): void {
  app?.dispose()
}
