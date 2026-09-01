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

/**
 * Глобальный обработчик необработанных отказов промисов.
 * VS Code убивает расширение при unhandled rejection, поэтому
 * ловим все отклонения и логируем их для диагностики.
 */
function setupUnhandledRejectionHandler(): void {
  process.on("unhandledRejection", (reason: unknown, promise: Promise<unknown>) => {
    const msg = errorMessage(reason)
    log.error(`UNHANDLED REJECTION: ${msg}`)
    log.error(`  Stack: ${reason instanceof Error ? reason.stack : "N/A"}`)
    vscode.window.showErrorMessage(`NeuralTower Agent: внутренняя ошибка: ${msg}`)
  })
}

let initInProgress = false

export async function activate(ctx: vscode.ExtensionContext): Promise<void> {
  const currentApp = new App(ctx)
  ctx.subscriptions.push(currentApp)
  setupUnhandledRejectionHandler()
  const deps = await createDeps(ctx)
  const outputChannel = createOutputChannel()

  registerProviders(currentApp, deps)
  registerLanguageFeatures(deps)
  registerCommands(currentApp, deps, outputChannel)
  registerWebviewSerializers()
  registerWorkspaceListeners(deps)
  registerConfigChangeListener(deps)
  setupDisposal(ctx, deps, outputChannel)

  await currentApp.init()
  deps.telemetry.capture("session_started", { version: currentApp.version() })

  initInBackground(deps).catch((err: unknown) => {
    const msg = errorMessage(err)
    log.error(`Фоновая инициализация не выполнена: ${msg}`)
  })
}

/**
 * Зарегистрировать UI-провайдеры.
 */
function registerProviders(app: App, deps: Awaited<ReturnType<typeof createDeps>>): void {
  app.registerProvider(deps.chatProvider)
}

/**
 * Зарегистрировать языковые возможности (автодополнение, code actions).
 */
function registerLanguageFeatures(deps: Awaited<ReturnType<typeof createDeps>>): void {
  vscode.languages.registerInlineCompletionItemProvider(
    { pattern: "**/*" },
    deps.autocompleteService,
  )

  const codeActionProvider = new AgentCodeActionProvider(deps.chatProvider)
  vscode.languages.registerCodeActionsProvider("*", codeActionProvider, codeActionProviderMetadata)
}

/**
 * Зарегистрировать команды.
 */
function registerCommands(
  app: App,
  deps: Awaited<ReturnType<typeof createDeps>>,
  outputChannel: vscode.OutputChannel,
): void {
  registerAllCommands(
    { app, agent: deps.agent, gitService: deps.gitService, diffViewer: deps.diffViewer, outputChannel },
    { app, chatProvider: deps.chatProvider, todoStore: deps.todoStore, agent: deps.agent, gitService: deps.gitService, diffViewer: deps.diffViewer, settingsProvider: deps.settingsProvider },
    { app, commitMessageService: deps.commitMessageService },
    { app, codebaseIndexer: deps.codebaseIndexer },
  )
}

/**
 * Зарегистрировать сериализаторы веб-представлений.
 */
function registerWebviewSerializers(): void {
  vscode.window.registerWebviewPanelSerializer(
    DiffViewerProvider.viewType,
    {
      deserializeWebviewPanel(panel: vscode.WebviewPanel) {
        panel.dispose()
        return Promise.resolve()
      },
    },
  )
}

/**
 * Зарегистрировать слушатель изменений конфигурации.
 * Синхронизирует изменения из settings.json с в-памяти конфигом бэкенда.
 */
function registerConfigChangeListener(deps: Awaited<ReturnType<typeof createDeps>>): void {
  if (typeof vscode.workspace.onDidChangeConfiguration !== "function") return
  vscode.workspace.onDidChangeConfiguration(async (e) => {
    if (!e.affectsConfiguration("neuralTowerAgent")) return
    const cfg = vscode.workspace.getConfiguration("neuralTowerAgent")
    const current = await deps.backend.getConfig()
    const updates: Record<string, unknown> = {}
    const url = cfg.get<string>("neuralTowerUrl")
    if (url && url !== current.url) updates.url = url
    const model = cfg.get<string>("model")
    if (model !== undefined && model !== current.model) updates.model = model
    const maxRetries = cfg.get<number>("maxRetries")
    if (maxRetries !== undefined && maxRetries !== current.maxRetries) updates.maxRetries = maxRetries
    const timeoutMs = cfg.get<number>("timeoutMs")
    if (timeoutMs !== undefined && timeoutMs !== current.timeoutMs) updates.timeoutMs = timeoutMs
    const temperature = cfg.get<number | null>("temperature")
    if (temperature !== undefined && temperature !== current.temperature) updates.temperature = temperature
    if (Object.keys(updates).length > 0) {
      try {
        await deps.backend.updateConfig(updates)
        log.info(`Конфигурация обновлена из settings.json: ${Object.keys(updates).join(", ")}`)
        if ("url" in updates) {
          deps.healthMonitor.resume()
        }
      } catch (err: unknown) {
        log.error(`Ошибка обновления конфигурации из settings.json: ${errorMessage(err)}`)
      }
    }
  })
}

/**
 * Зарегистрировать слушатели событий рабочей области.
 */
function registerWorkspaceListeners(deps: Awaited<ReturnType<typeof createDeps>>): void {
  vscode.workspace.onDidChangeWorkspaceFolders(async () => {
    if (vscode.workspace.workspaceFolders?.[0]) {
      const newDir = vscode.workspace.workspaceFolders[0].uri.fsPath
      try {
        deps.setWorkDir(newDir)
        deps.gitService.resetRoot()
        await deps.gitService.findRoot(newDir)
        await deps.fileIndex.build(newDir)
        await deps.agent.reload()
      } catch (err: unknown) {
        const msg = errorMessage(err)
        log.error(`Ошибка при изменении рабочей области: ${msg}`)
      }
    }
  })
}

/**
 * Настроить освобождение ресурсов при деактивации.
 */
function setupDisposal(
  ctx: vscode.ExtensionContext,
  deps: Awaited<ReturnType<typeof createDeps>>,
  outputChannel: vscode.OutputChannel,
): void {
  ctx.subscriptions.push({
    dispose: () => {
      const toDispose: (() => void | Promise<void>)[] = [
        () => deps.agent.dispose(),
        () => deps.diffViewer.dispose(),
        () => deps.settingsProvider.dispose(),
        () => deps.healthMonitor.dispose(),
        () => deps.indexingStatusBar.dispose(),
        () => deps.commitMessageService.dispose(),
        () => deps.autocompleteService.dispose(),
        () => deps.notificationService.dispose(),
        () => deps.permissionManager.dispose(),
        () => deps.sessionStore.dispose(),
        () => deps.snapshotService?.dispose(),
        () => deps.snapshotStore?.dispose(),
        () => deps.codebaseIndexer.dispose(),
        () => deps.mcpManager.disconnect(),
        () => { try { deps.graphDb?.close() } catch { /* уже закрыта */ } },
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

/**
 * Фоновая инициализация: индексация кодовой базы.
 * Выполняется после показа UI с прогресс-индикатором.
 * Защищена от повторного запуска через флаг initInProgress.
 */
async function initInBackground(deps: Awaited<ReturnType<typeof createDeps>>): Promise<void> {
  if (initInProgress) {
    log.info("Фоновая инициализация уже запущена, пропускаем")
    return
  }
  initInProgress = true

  const workDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  if (!workDir) {
    initInProgress = false
    return
  }

  const progressOptions: vscode.ProgressOptions = {
    location: vscode.ProgressLocation.Window,
    title: "NeuralTower Agent: инициализация",
  }

  try {
    await vscode.window.withProgress(progressOptions, async (progress) => {
      progress.report({ message: "Индексация кодовой базы..." })
      try {
        await deps.codebaseIndexer.start(vscode.workspace.workspaceFolders![0].uri)
      } catch (err: unknown) {
        const msg = errorMessage(err)
        log.error(`Индексация кодовой базы не выполнена: ${msg}`)
      }
    })
  } finally {
    initInProgress = false
  }
}

export function deactivate(): void {
  initInProgress = false
}
