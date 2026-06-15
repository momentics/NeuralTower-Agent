import * as vscode from "vscode"
import { App } from "./core/App"
import { NeuralTowerBackend } from "./backend/NeuralTowerBackend"
import { AgentOrchestrator } from "./agent/AgentOrchestrator"
import { ToolRegistry } from "./tools/ToolRegistry"
import { SkillManager } from "./skills/SkillManager"
import { builtInSkills } from "./skills/builtInSkills"
import { ChatProvider } from "./providers/ChatProvider"
import { SettingsProvider } from "./providers/SettingsProvider"
import { DiffViewerProvider } from "./providers/DiffViewerProvider"
import { TelemetryService } from "./services/telemetry/TelemetryService"
import { PersistentSessionStore } from "./shared/PersistentSessionStore"
import { PermissionManager } from "./services/permission/PermissionManager"
import { GitService } from "./services/git/GitService"
import { NotificationService } from "./services/notification/NotificationService"
import { BackendHealthMonitor } from "./services/health/BackendHealthMonitor"
import { CommitMessageService } from "./services/commit-message/CommitMessageService"
import { AgentCodeActionProvider, codeActionProviderMetadata } from "./services/code-actions/AgentCodeActionProvider"
import { MCPManager } from "./mcp/MCPManager"
import { ReadFileTool } from "./tools/builtins/ReadFileTool"
import { WriteFileTool } from "./tools/builtins/WriteFileTool"
import { BashTool } from "./tools/builtins/BashTool"
import { EditFileTool } from "./tools/builtins/EditFileTool"
import { GlobTool } from "./tools/builtins/GlobTool"
import { GrepTool } from "./tools/builtins/GrepTool"
import { WebFetchTool } from "./tools/builtins/WebFetchTool"
import { TodoWriteTool } from "./tools/builtins/TodoWriteTool"
import { ContextManager } from "./core/ContextManager"
import { SessionContext } from "./agent/SessionContext"
import { SubagentRunner } from "./agent/SubagentRunner"

let app: App | undefined
let backend: NeuralTowerBackend | undefined
let agent: AgentOrchestrator | undefined
let todoTool: TodoWriteTool | undefined
let chatProvider: ChatProvider | undefined
let diffViewer: DiffViewerProvider | undefined
let healthMonitor: BackendHealthMonitor | undefined
let commitMessageService: CommitMessageService | undefined
let gitService: GitService | undefined
let agentOutputChannel: vscode.OutputChannel | undefined
let contextManager: ContextManager | undefined
let subagentRunner: SubagentRunner | undefined

export async function activate(ctx: vscode.ExtensionContext): Promise<void> {
  app = new App(ctx)

  // ── Бэкенд ──────────────────────────────────────────────
  backend = new NeuralTowerBackend()

  // ── Постоянное хранилище сессий ─────────────────────────
  const sessionStore = new PersistentSessionStore(ctx.globalStorageUri)
  await sessionStore.init()

  // ── Менеджер разрешений ─────────────────────────────────
  const permissionManager = new PermissionManager()
  const vsCfg = vscode.workspace.getConfiguration("neuralTowerAgent")
  const autoApproveEnabled = vsCfg.get<boolean>("autoApprove.enabled", false) ?? false
  const autoApproveTools = vsCfg.get<string[]>("autoApprove.tools", []) ?? []
  permissionManager.setAutoApprove({ enabled: autoApproveEnabled, tools: autoApproveTools, maxCost: 0 })

  // ── Git-сервис ──────────────────────────────────────────
  gitService = new GitService()
  await gitService.init()

  // ── Сервис уведомлений ──────────────────────────────────
  const notificationService = new NotificationService()
  await notificationService.init()

  // ── Реестр инструментов ─────────────────────────────────
  const tools = new ToolRegistry()
  todoTool = new TodoWriteTool()
  tools.register(new ReadFileTool())
  tools.register(new WriteFileTool())
  tools.register(new BashTool())
  tools.register(new EditFileTool())
  tools.register(new GlobTool())
  tools.register(new GrepTool())
  tools.register(new WebFetchTool())
  tools.register(todoTool)

  // ── MCP-менеджер ────────────────────────────────────────
  const mcpManager = new MCPManager()
  await mcpManager.connect()
  await mcpManager.syncWithRegistry(tools)

  // ── Менеджер навыков ────────────────────────────────────
  const skills = new SkillManager()
  skills.registerMany(builtInSkills)

  // ── Менеджер контекста ──────────────────────────────────
  contextManager = new ContextManager()

  // ── Оркестратор агента ──────────────────────────────────
  agent = new AgentOrchestrator(backend, tools, skills, contextManager)
  agent.setPermissionManager(permissionManager)
  agent.setGitService(gitService)
  agent.setMCPManager(mcpManager)

  // ── Контекст сессии ─────────────────────────────────────
  const sessionContext = new SessionContext(sessionStore.activeId, contextManager)
  agent.setSessionContext(sessionContext)

  // ── Runner подагентов ───────────────────────────────────
  subagentRunner = new SubagentRunner(backend, tools, skills, contextManager, permissionManager, gitService)
  agent.setSubagentRunner(subagentRunner)

  if (vscode.workspace.workspaceFolders?.[0]) {
    agent.setWorkingDir(vscode.workspace.workspaceFolders[0].uri.fsPath)
    await gitService.findRoot(vscode.workspace.workspaceFolders[0].uri.fsPath)
    await agent.reload()
  }

  // ── Провайдеры ──────────────────────────────────────────
  chatProvider = new ChatProvider(ctx.extensionUri, agent, sessionStore, notificationService, permissionManager)
  app.registerProvider(chatProvider)

  diffViewer = new DiffViewerProvider(ctx.extensionUri)

  // ── Мониторинг здоровья бэкенда ─────────────────────────
  healthMonitor = new BackendHealthMonitor(backend)
  await healthMonitor.init()

  // ── Сервис коммит-сообщений ─────────────────────────────
  commitMessageService = new CommitMessageService(backend, gitService)
  await commitMessageService.init()

  // ── Сервисы ─────────────────────────────────────────────
  const telemetry = TelemetryService.get()
  await telemetry.init()

  // ── Code Actions ────────────────────────────────────────
  const codeActionProvider = new AgentCodeActionProvider(chatProvider!)
  vscode.languages.registerCodeActionsProvider("*", codeActionProvider, codeActionProviderMetadata)

  // ── Команды ─────────────────────────────────────────────

  // Команды чата
  app.registerCommand("neuralTowerAgent.newChat", () => {
    chatProvider?.broadcastNewChat()
    todoTool?.clear()
    agent?.clearPlan()
  })

  app.registerCommand("neuralTowerAgent.focusChatInput", () => {
    vscode.commands.executeCommand("neuralTowerAgent.chat.focus")
  })

  // Настройки
  app.registerCommand("neuralTowerAgent.settings", () => {
    SettingsProvider.render(ctx.extensionUri, backend!)
  })

  // Действия над кодом
  app.registerCommand("neuralTowerAgent.explainCode", async () => {
    const editor = vscode.window.activeTextEditor
    if (!editor) {
      vscode.window.showInformationMessage("Активный редактор отсутствует")
      return
    }
    const selection = editor.selection
    const text = editor.document.getText(selection)
    const filePath = editor.document.uri.fsPath
    if (!text.trim()) {
      vscode.window.showInformationMessage("Выберите код для объяснения")
      return
    }
    await sendAgentQuery(`Объясни этот код:\n\n\`\`\`${getLang(filePath)}\n${text}\n\`\`\``, filePath)
  })

  app.registerCommand("neuralTowerAgent.fixCode", async () => {
    const editor = vscode.window.activeTextEditor
    if (!editor) {
      vscode.window.showInformationMessage("Активный редактор отсутствует")
      return
    }
    const selection = editor.selection
    const text = editor.document.getText(selection)
    const filePath = editor.document.uri.fsPath
    if (!text.trim()) {
      vscode.window.showInformationMessage("Выберите код для исправления")
      return
    }
    await sendAgentQuery(`Исправь ошибки и проблемы в этом коде:\n\n\`\`\`${getLang(filePath)}\n${text}\n\`\`\``, filePath)
  })

  app.registerCommand("neuralTowerAgent.improveCode", async () => {
    const editor = vscode.window.activeTextEditor
    if (!editor) {
      vscode.window.showInformationMessage("Активный редактор отсутствует")
      return
    }
    const selection = editor.selection
    const text = editor.document.getText(selection)
    const filePath = editor.document.uri.fsPath
    if (!text.trim()) {
      vscode.window.showInformationMessage("Выберите код для улучшения")
      return
    }
    await sendAgentQuery(`Улучши этот код по читаемости, производительности и лучшим практикам:\n\n\`\`\`${getLang(filePath)}\n${text}\n\`\`\``, filePath)
  })

  app.registerCommand("neuralTowerAgent.addToContext", async () => {
    const editor = vscode.window.activeTextEditor
    if (!editor) {
      vscode.window.showInformationMessage("Активный редактор отсутствует")
      return
    }
    const selection = editor.selection
    const text = editor.document.getText(selection)
    const filePath = editor.document.uri.fsPath
    await sendAgentQuery(`Вот контекст из файла ${filePath}:\n\n\`\`\`${getLang(filePath)}\n${text}\n\`\`\``, filePath)
  })

  // Code Action команды
  app.registerCommand("neuralTowerAgent.codeAction.fix", async (...args: unknown[]) => {
    const [text, filePath, diagnostics] = [args[0] as string, args[1] as string, args[2] as string]
    if (!text || !filePath) return
    const prompt = `Исправь следующие проблемы в этом коде:\n\nДиагностика:\n${diagnostics}\n\nКод:\n\`\`\`${getLang(filePath)}\n${text}\n\`\`\``
    await sendAgentQuery(prompt, filePath)
  })

  app.registerCommand("neuralTowerAgent.codeAction.explain", async (...args: unknown[]) => {
    const [text, filePath] = [args[0] as string, args[1] as string]
    if (!text || !filePath) return
    await sendAgentQuery(`Объясни этот код:\n\n\`\`\`${getLang(filePath)}\n${text}\n\`\`\``, filePath)
  })

  app.registerCommand("neuralTowerAgent.codeAction.improve", async (...args: unknown[]) => {
    const [text, filePath] = [args[0] as string, args[1] as string]
    if (!text || !filePath) return
    await sendAgentQuery(`Улучши этот код:\n\n\`\`\`${getLang(filePath)}\n${text}\n\`\`\``, filePath)
  })

  app.registerCommand("neuralTowerAgent.codeAction.addToContext", async (...args: unknown[]) => {
    const [text, filePath] = [args[0] as string, args[1] as string]
    if (!text || !filePath) return
    await sendAgentQuery(`Вот контекст из ${filePath}:\n\`\`\`${getLang(filePath)}\n${text}\n\`\`\``, filePath)
  })

  // Git-команды
  app.registerCommand("neuralTowerAgent.generateCommitMessage", async () => {
    if (!vscode.workspace.workspaceFolders?.[0]) return
    const dir = vscode.workspace.workspaceFolders[0].uri.fsPath
    const msg = await commitMessageService!.generate(dir)
    if (msg) {
      const confirmed = await vscode.window.showInputBox({
        placeHolder: "Сообщение коммита",
        value: msg,
        prompt: "Сгенерировать сообщение коммита из добавленных изменений",
      })
      if (confirmed) {
        vscode.env.clipboard.writeText(confirmed)
        vscode.window.showInformationMessage(`Сообщение коммита скопировано: "${confirmed.slice(0, 50)}${confirmed.length > 50 ? "..." : ""}"`)
      }
    } else {
      vscode.window.showInformationMessage("Нет добавленных изменений")
    }
  })

  // Команды сессий
  app.registerCommand("neuralTowerAgent.session.list", () => {
    vscode.commands.executeCommand("neuralTowerAgent.chat.focus")
  })

  // Diff Viewer
  app.registerCommand("neuralTowerAgent.openDiffViewer", async () => {
    if (!vscode.workspace.workspaceFolders?.[0] || !gitService) return
    const dir = vscode.workspace.workspaceFolders[0].uri.fsPath
    const diff = await gitService.getDiff(dir)
    diffViewer?.openPanel(diff)
  })

  // ── Webview Panel Serializers ───────────────────────────
  vscode.window.registerWebviewPanelSerializer(
    DiffViewerProvider.viewType,
    {
      deserializeWebviewPanel(panel: vscode.WebviewPanel) {
        panel.dispose()
        return Promise.resolve()
      },
    },
  )

  // ── Слушатель изменений рабочей директории ─────────────
  vscode.workspace.onDidChangeWorkspaceFolders(async () => {
    if (vscode.workspace.workspaceFolders?.[0]) {
      agent?.setWorkingDir(vscode.workspace.workspaceFolders[0].uri.fsPath)
      await gitService?.findRoot(vscode.workspace.workspaceFolders[0].uri.fsPath)
      await agent?.reload()
    }
  })

  // ── Запуск ──────────────────────────────────────────────
  await app.init()
  telemetry.capture("session_started", { version: "0.1.1" })

  // ── Сохранить объекты для освобождения ──────────────────
  ctx.subscriptions.push({
    dispose: () => {
      agent?.dispose()
      sessionStore.dispose()
      telemetry.dispose()
      notificationService.dispose()
      permissionManager.dispose()
      gitService?.dispose()
      healthMonitor?.dispose()
      commitMessageService?.dispose()
      diffViewer?.dispose()
      void mcpManager.disconnect()
    },
  })
}

export function deactivate(): void {
  app?.dispose()
}

// ── Вспомогательные функции ───────────────────────────────

async function sendAgentQuery(query: string, workDir: string): Promise<void> {
  if (!app || !agent) return
  if (!agentOutputChannel) {
    agentOutputChannel = vscode.window.createOutputChannel("NeuralTower Agent", { log: true })
  }
  agentOutputChannel.show()
  agentOutputChannel.appendLine(`> ${query.slice(0, 80)}...`)

  try {
    await agent.run(query, (chunk) => {
      agentOutputChannel!.append(chunk)
    })
    agentOutputChannel.appendLine("\nГотово.")

    if (gitService) {
      const diff = await gitService.getDiff(workDir)
      diffViewer?.openPanel(diff)
    }
  } catch (err) {
    agentOutputChannel.appendLine(`\nОшибка: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function getLang(filepath: string): string {
  const ext = filepath.split(".").pop()?.toLowerCase() ?? ""
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    py: "python", rs: "rust", go: "go", java: "java", kt: "kotlin",
    rb: "ruby", c: "c", h: "c", cpp: "cpp", cs: "csharp",
    html: "html", css: "css", json: "json", yaml: "yaml", yml: "yaml",
    md: "markdown", sh: "bash", ps1: "powershell",
  }
  return map[ext] ?? ""
}
