import * as vscode from "vscode"
import { App } from "./core/App"
import { NeuralTowerBackend } from "./backend/NeuralTowerBackend"
import { AgentOrchestrator } from "./agent/AgentOrchestrator"
import { AgentPlanner } from "./agent/AgentPlanner"
import { ToolRegistry } from "./tools/ToolRegistry"
import { SkillManager } from "./skills/SkillManager"
import { ChatProvider } from "./providers/ChatProvider"
import { SettingsProvider } from "./providers/SettingsProvider"
import { TelemetryService } from "./services/telemetry/TelemetryService"
import { PersistentSessionStore } from "./shared/PersistentSessionStore"
import { PermissionManager } from "./services/permission/PermissionManager"
import { GitService } from "./services/git/GitService"
import { NotificationService } from "./services/notification/NotificationService"
import { ReadFileTool } from "./tools/builtins/ReadFileTool"
import { WriteFileTool } from "./tools/builtins/WriteFileTool"
import { BashTool } from "./tools/builtins/BashTool"
import { EditFileTool } from "./tools/builtins/EditFileTool"
import { GlobTool } from "./tools/builtins/GlobTool"
import { GrepTool } from "./tools/builtins/GrepTool"
import { WebFetchTool } from "./tools/builtins/WebFetchTool"

let app: App | undefined

export async function activate(ctx: vscode.ExtensionContext): Promise<void> {
  app = new App(ctx)

  // ── Бэкенд ──────────────────────────────────────────────
  const backend = new NeuralTowerBackend()

  // ── Постоянное хранилище сессий ─────────────────────────
  const sessionStore = new PersistentSessionStore(ctx.globalStorageUri)
  await sessionStore.init()

  // ── Менеджер разрешений ─────────────────────────────────
  const permissionManager = new PermissionManager()
  const vsCfg = vscode.workspace.getConfiguration("nt-agent")
  const autoApproveEnabled = vsCfg.get<boolean>("autoApprove.enabled", false) ?? false
  const autoApproveTools = vsCfg.get<string[]>("autoApprove.tools", []) ?? []
  permissionManager.setAutoApprove({ enabled: autoApproveEnabled, tools: autoApproveTools, maxCost: 0 })

  // ── Git-сервис ──────────────────────────────────────────
  const gitService = new GitService()
  await gitService.init()

  // ── Сервис уведомлений ──────────────────────────────────
  const notificationService = new NotificationService()
  await notificationService.init()

  // ── Планировщик агента ──────────────────────────────────
  const agentPlanner = new AgentPlanner(backend)

  // ── Реестр инструментов ─────────────────────────────────
  const tools = new ToolRegistry()
  tools.register(new ReadFileTool())
  tools.register(new WriteFileTool())
  tools.register(new BashTool())
  tools.register(new EditFileTool())
  tools.register(new GlobTool())
  tools.register(new GrepTool())
  tools.register(new WebFetchTool())

  // ── Менеджер навыков ────────────────────────────────────
  const skills = new SkillManager()

  // ── Оркестратор агента ──────────────────────────────────
  const agent = new AgentOrchestrator(backend, tools, skills)
  agent.setPlanner(agentPlanner)
  agent.setPermissionManager(permissionManager)
  agent.setGitService(gitService)

  if (vscode.workspace.workspaceFolders?.[0]) {
    agent.setWorkingDir(vscode.workspace.workspaceFolders[0].uri.fsPath)
    await gitService.findRoot(vscode.workspace.workspaceFolders[0].uri.fsPath)
  }

  // ── Провайдеры ──────────────────────────────────────────
  const chat = new ChatProvider(ctx.extensionUri, agent, sessionStore, notificationService, permissionManager)
  app.registerProvider(chat)

  // ── Сервисы ─────────────────────────────────────────────
  const telemetry = TelemetryService.get()
  await telemetry.init()

  // ── Команды ─────────────────────────────────────────────

  // Команды чата
  app.registerBoundCommand("nt-agent.newChat", function () {
    chat.broadcastNewChat()
  })

  app.registerCommand("nt-agent.focusChatInput", () => {
    vscode.commands.executeCommand("nt-agent.chat.focus")
  })

  // Настройки
  app.registerCommand("nt-agent.settings", () => {
    SettingsProvider.render(ctx.extensionUri, backend)
  })

  // Действия над кодом
  app.registerCommand("nt-agent.explainCode", async () => {
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

  app.registerCommand("nt-agent.fixCode", async () => {
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

  app.registerCommand("nt-agent.improveCode", async () => {
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

  app.registerCommand("nt-agent.addToContext", async () => {
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

  // Git-команды
  app.registerCommand("nt-agent.generateCommitMessage", async () => {
    if (!vscode.workspace.workspaceFolders?.[0]) return
    const dir = vscode.workspace.workspaceFolders[0].uri.fsPath
    const info = await gitService.generateCommitMessage(dir)
    if (info) {
      const msg = await vscode.window.showInputBox({
        placeHolder: "Сообщение коммита",
        value: info,
        prompt: "Сгенерировать сообщение коммита из добавленных изменений",
      })
      if (msg) {
        vscode.env.clipboard.writeText(msg)
        vscode.window.showInformationMessage(`Сообщение коммита скопировано в буфер обмена: "${msg.slice(0, 50)}..."`)
      }
    } else {
      vscode.window.showInformationMessage("Нет добавленных изменений")
    }
  })

  // Команды сессий
  app.registerCommand("nt-agent.session.list", () => {
    vscode.commands.executeCommand("nt-agent.chat.focus")
  })

  // ── Запуск ──────────────────────────────────────────────
  await app.init()
  telemetry.capture("session_started", { version: "0.1.0" })

  // Сохранить объекты для освобождения
  ctx.subscriptions.push({
    dispose: () => {
      agent.dispose()
      sessionStore.dispose()
      telemetry.dispose()
      notificationService.dispose()
    },
  })
}

export function deactivate(): void {
  app?.dispose()
}

// ── Вспомогательные функции ───────────────────────────────

async function sendAgentQuery(query: string, workDir: string): Promise<void> {
  if (!app) return
  const outputChannel = vscode.window.createOutputChannel("Агент Neural Tower")
  outputChannel.show()
  outputChannel.appendLine(`> ${query.slice(0, 80)}...`)

  const backend = new NeuralTowerBackend()
  const tools = new ToolRegistry()
  tools.register(new ReadFileTool())
  tools.register(new WriteFileTool())
  tools.register(new BashTool())
  tools.register(new EditFileTool())
  tools.register(new GlobTool())
  tools.register(new GrepTool())
  tools.register(new WebFetchTool())
  const skills = new SkillManager()
  const permMgr = new PermissionManager()
  const git = new GitService()
  await git.init()
  const notifier = new NotificationService()
  await notifier.init()
  const orchestrator = new AgentOrchestrator(backend, tools, skills)
  orchestrator.setWorkingDir(workDir)
  orchestrator.setPermissionManager(permMgr)
  orchestrator.setGitService(git)

  try {
    await orchestrator.run(query, (chunk) => {
      process.stdout.write(chunk)
      outputChannel.append(chunk)
    })
    outputChannel.appendLine("\nГотово.")
    notifier.show("agentDone", "Агент завершил задачу")
  } catch (err) {
    outputChannel.appendLine(`\nОшибка: ${err instanceof Error ? err.message : String(err)}`)
    notifier.show("error", String(err))
  } finally {
    setTimeout(() => outputChannel.dispose(), 10000)
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
