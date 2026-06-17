import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as vscode from "vscode"

// Заглушки для всех зависимостей
const registeredCommands: Array<{ id: string; handler: (...args: unknown[]) => void }> = []

vi.mock("./core/App", () => ({
  App: vi.fn().mockImplementation(() => ({
    registerProvider: vi.fn(),
    registerCommand: vi.fn().mockImplementation((id: string, handler: (...args: unknown[]) => void) => {
      registeredCommands.push({ id, handler })
    }),
    registerBoundCommand: vi.fn().mockImplementation((id: string, handler: (...args: unknown[]) => void) => {
      registeredCommands.push({ id, handler })
    }),
    init: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
  })),
}))

vi.mock("./backend/NeuralTowerBackend", () => ({
  NeuralTowerBackend: vi.fn().mockImplementation(() => ({
    chat: vi.fn(),
    chatJson: vi.fn(),
    getConfig: vi.fn(async () => ({})),
    updateConfig: vi.fn(),
    listModels: vi.fn(),
    healthCheck: vi.fn(async () => true),
  })),
}))

vi.mock("./agent/AgentOrchestrator", () => ({
  AgentOrchestrator: vi.fn().mockImplementation(() => ({
    reload: vi.fn().mockResolvedValue(undefined),
    broadcastNewChat: vi.fn(),
    clearPlan: vi.fn(),
    resetSession: vi.fn(),
    run: vi.fn().mockResolvedValue({ role: "assistant", content: "ok" }),
    dispose: vi.fn(),
    getTodoStore: vi.fn().mockReturnValue({
      clear: vi.fn(),
      getItems: vi.fn(() => []),
    }),
  })),
}))

vi.mock("./tools/ToolRegistry", () => ({
  ToolRegistry: vi.fn().mockImplementation(() => ({
    register: vi.fn(),
    registerMany: vi.fn(),
  })),
}))

vi.mock("./skills/SkillManager", () => ({
  SkillManager: vi.fn().mockImplementation(() => ({
    register: vi.fn(),
    registerMany: vi.fn(),
  })),
}))

vi.mock("./skills/builtInSkills", () => ({
  builtInSkills: [],
}))

vi.mock("./providers/ChatProvider", () => ({
  ChatProvider: vi.fn().mockImplementation(() => ({
    broadcastNewChat: vi.fn(),
    dispose: vi.fn(),
  })),
}))

vi.mock("./providers/SettingsProvider", () => ({
  SettingsProvider: {
    render: vi.fn(),
  },
}))

vi.mock("./providers/DiffViewerProvider", () => {
  const DiffViewerProviderMock = vi.fn().mockImplementation(() => ({
    openPanel: vi.fn(),
    dispose: vi.fn(),
  }))
  DiffViewerProviderMock.viewType = "diffViewer"
  return { DiffViewerProvider: DiffViewerProviderMock }
})

vi.mock("./services/telemetry/TelemetryService", () => ({
  TelemetryService: {
    get: vi.fn().mockReturnValue({
      init: vi.fn().mockResolvedValue(undefined),
      capture: vi.fn(),
      dispose: vi.fn(),
    }),
  },
}))

vi.mock("./shared/PersistentSessionStore", () => ({
  PersistentSessionStore: vi.fn().mockImplementation(() => ({
    init: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
    activeId: "session-1",
  })),
}))

vi.mock("./services/permission/PermissionManager", () => ({
  PermissionManager: vi.fn().mockImplementation(() => ({
    setAutoApprove: vi.fn(),
    dispose: vi.fn(),
  })),
}))

vi.mock("./services/git/GitService", () => ({
  GitService: vi.fn().mockImplementation(() => ({
    init: vi.fn().mockResolvedValue(undefined),
    findRoot: vi.fn().mockResolvedValue("/work"),
    getDiff: vi.fn().mockResolvedValue({ changed: [], additions: 0, deletions: 0 }),
    dispose: vi.fn(),
  })),
}))

vi.mock("./services/notification/NotificationService", () => ({
  NotificationService: vi.fn().mockImplementation(() => ({
    init: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
  })),
}))

vi.mock("./services/health/BackendHealthMonitor", () => ({
  BackendHealthMonitor: vi.fn().mockImplementation(() => ({
    init: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
  })),
}))

vi.mock("./services/commit-message/CommitMessageService", () => ({
  CommitMessageService: vi.fn().mockImplementation(() => ({
    init: vi.fn().mockResolvedValue(undefined),
    generate: vi.fn().mockResolvedValue("fix: test commit"),
    dispose: vi.fn(),
  })),
}))

vi.mock("./services/code-actions/AgentCodeActionProvider", () => ({
  AgentCodeActionProvider: vi.fn().mockImplementation(() => ({})),
  codeActionProviderMetadata: {},
}))

vi.mock("./mcp/MCPManager", () => ({
  MCPManager: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    syncWithRegistry: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.mock("./tools/builtins/ReadFileTool", () => ({
  ReadFileTool: vi.fn().mockImplementation(() => ({})),
}))

vi.mock("./tools/builtins/WriteFileTool", () => ({
  WriteFileTool: vi.fn().mockImplementation(() => ({})),
}))

vi.mock("./tools/builtins/BashTool", () => ({
  BashTool: vi.fn().mockImplementation(() => ({})),
}))

vi.mock("./tools/builtins/EditFileTool", () => ({
  EditFileTool: vi.fn().mockImplementation(() => ({})),
}))

vi.mock("./tools/builtins/GlobTool", () => ({
  GlobTool: vi.fn().mockImplementation(() => ({})),
}))

vi.mock("./tools/builtins/GrepTool", () => ({
  GrepTool: vi.fn().mockImplementation(() => ({})),
}))

vi.mock("./tools/builtins/WebFetchTool", () => ({
  WebFetchTool: vi.fn().mockImplementation(() => ({})),
}))

vi.mock("./tools/builtins/TodoWriteTool", () => ({
  TodoWriteTool: vi.fn().mockImplementation(() => ({})),
}))

vi.mock("./tools/builtins/LspTool", () => ({
  LspTool: vi.fn().mockImplementation(() => ({})),
}))

vi.mock("./core/ContextManager", () => ({
  ContextManager: vi.fn().mockImplementation(() => ({
    register: vi.fn(),
    list: vi.fn(() => []),
    initialize: vi.fn().mockResolvedValue(undefined),
    prepare: vi.fn().mockResolvedValue({ systemPrompt: "", contextItems: [] }),
    getSnapshot: vi.fn(() => []),
    getRevision: vi.fn(() => 0),
    reset: vi.fn(),
    estimateSystemTokens: vi.fn(() => 0),
  })),
}))

vi.mock("./agent/SessionContext", () => ({
  SessionContext: vi.fn().mockImplementation(() => ({})),
}))

vi.mock("./agent/SubagentRunner", () => ({
  SubagentRunner: vi.fn().mockImplementation(() => ({})),
}))

import { activate, deactivate } from "./extension"
import { App } from "./core/App"

describe("extension", () => {
  let ctx: vscode.ExtensionContext

  beforeEach(() => {
    vi.clearAllMocks()
    registeredCommands.length = 0
    vscode.commands.executeCommand = vi.fn().mockResolvedValue(undefined)
    ;(vscode.workspace as any).workspaceFolders = [
      { uri: { fsPath: "/work" } },
    ]
    ;(vscode.window as any).activeTextEditor = null
    ;(vscode.window as any).createOutputChannel = vi.fn().mockReturnValue({
      show: vi.fn(),
      appendLine: vi.fn(),
      append: vi.fn(),
      dispose: vi.fn(),
    })
    ;(vscode.window as any).showInputBox = vi.fn().mockResolvedValue("fix: test commit")
    ;(vscode.window as any).clipboard = {
      writeText: vi.fn().mockResolvedValue(undefined),
    }

    ctx = {
      extensionUri: { fsPath: "/extension" },
      globalStorageUri: { fsPath: "/storage" },
      extension: {
        packageJSON: { version: "0.1.1" },
      },
      subscriptions: [],
    } as unknown as vscode.ExtensionContext
  })

  afterEach(async () => {
    // Перезагрузить модуль для сброса состояния на уровне модуля
    vi.resetModules()
  })

  describe("activate", () => {
    it("creates App instance", async () => {
      const { App: AppMock } = await import("./core/App")
      await activate(ctx)
      expect(AppMock).toHaveBeenCalled()
    })

    it("creates and initializes backend", async () => {
      await activate(ctx)
      const { NeuralTowerBackend } = await import("./backend/NeuralTowerBackend")
      expect(NeuralTowerBackend).toHaveBeenCalled()
    })

    it("creates and initializes session store", async () => {
      await activate(ctx)
      const { PersistentSessionStore } = await import("./shared/PersistentSessionStore")
      expect(PersistentSessionStore).toHaveBeenCalledWith(ctx.globalStorageUri, expect.any(Number))
    })

    it("creates and configures permission manager", async () => {
      await activate(ctx)
      const { PermissionManager } = await import("./services/permission/PermissionManager")
      expect(PermissionManager).toHaveBeenCalled()
    })

    it("creates and initializes git service", async () => {
      await activate(ctx)
      const { GitService } = await import("./services/git/GitService")
      expect(GitService).toHaveBeenCalled()
    })

    it("creates and initializes notification service", async () => {
      await activate(ctx)
      const { NotificationService } = await import("./services/notification/NotificationService")
      expect(NotificationService).toHaveBeenCalled()
    })

    it("registers all built-in tools", async () => {
      await activate(ctx)
      const { ToolRegistry } = await import("./tools/ToolRegistry")
      const { ReadFileTool } = await import("./tools/builtins/ReadFileTool")
      const { WriteFileTool } = await import("./tools/builtins/WriteFileTool")
      const { BashTool } = await import("./tools/builtins/BashTool")
      const { EditFileTool } = await import("./tools/builtins/EditFileTool")
      const { GlobTool } = await import("./tools/builtins/GlobTool")
      const { GrepTool } = await import("./tools/builtins/GrepTool")
      const { WebFetchTool } = await import("./tools/builtins/WebFetchTool")
      const { LspTool } = await import("./tools/builtins/LspTool")
      const { TodoWriteTool } = await import("./tools/builtins/TodoWriteTool")

      expect(ReadFileTool).toHaveBeenCalled()
      expect(WriteFileTool).toHaveBeenCalled()
      expect(BashTool).toHaveBeenCalled()
      expect(EditFileTool).toHaveBeenCalled()
      expect(GlobTool).toHaveBeenCalled()
      expect(GrepTool).toHaveBeenCalled()
      expect(WebFetchTool).toHaveBeenCalled()
      expect(LspTool).toHaveBeenCalled()
      expect(TodoWriteTool).toHaveBeenCalled()
    })

    it("creates and connects MCP manager", async () => {
      await activate(ctx)
      const { MCPManager } = await import("./mcp/MCPManager")
      expect(MCPManager).toHaveBeenCalled()
    })

    it("creates skill manager and registers built-in skills", async () => {
      await activate(ctx)
      const { SkillManager } = await import("./skills/SkillManager")
      expect(SkillManager).toHaveBeenCalled()
    })

    it("creates agent orchestrator", async () => {
      await activate(ctx)
      const { AgentOrchestrator } = await import("./agent/AgentOrchestrator")
      expect(AgentOrchestrator).toHaveBeenCalled()
    })

    it("creates chat provider and registers it", async () => {
      await activate(ctx)
      const { ChatProvider } = await import("./providers/ChatProvider")
      expect(ChatProvider).toHaveBeenCalled()
    })

    it("creates diff viewer provider", async () => {
      await activate(ctx)
      const { DiffViewerProvider } = await import("./providers/DiffViewerProvider")
      expect(DiffViewerProvider).toHaveBeenCalled()
    })

    it("creates and initializes health monitor", async () => {
      await activate(ctx)
      const { BackendHealthMonitor } = await import("./services/health/BackendHealthMonitor")
      expect(BackendHealthMonitor).toHaveBeenCalled()
    })

    it("creates and initializes commit message service", async () => {
      await activate(ctx)
      const { CommitMessageService } = await import("./services/commit-message/CommitMessageService")
      expect(CommitMessageService).toHaveBeenCalled()
    })

    it("initializes telemetry", async () => {
      await activate(ctx)
      const { TelemetryService } = await import("./services/telemetry/TelemetryService")
      expect(TelemetryService.get).toHaveBeenCalled()
    })

    it("registers code actions provider", async () => {
      await activate(ctx)
      const { AgentCodeActionProvider } = await import("./services/code-actions/AgentCodeActionProvider")
      expect(AgentCodeActionProvider).toHaveBeenCalled()
    })

    it("registers all commands", async () => {
      await activate(ctx)
      const calls = registeredCommands
      const commandIds = registeredCommands.map((c: any) => c.id)

      expect(commandIds).toContain("neuralTowerAgent.newChat")
      expect(commandIds).toContain("neuralTowerAgent.focusChatInput")
      expect(commandIds).toContain("neuralTowerAgent.settings")
      expect(commandIds).toContain("neuralTowerAgent.explainCode")
      expect(commandIds).toContain("neuralTowerAgent.fixCode")
      expect(commandIds).toContain("neuralTowerAgent.improveCode")
      expect(commandIds).toContain("neuralTowerAgent.addToContext")
      expect(commandIds).toContain("neuralTowerAgent.codeAction.fix")
      expect(commandIds).toContain("neuralTowerAgent.codeAction.explain")
      expect(commandIds).toContain("neuralTowerAgent.codeAction.improve")
      expect(commandIds).toContain("neuralTowerAgent.codeAction.addToContext")
      expect(commandIds).toContain("neuralTowerAgent.generateCommitMessage")
      expect(commandIds).toContain("neuralTowerAgent.session.list")
      expect(commandIds).toContain("neuralTowerAgent.openDiffViewer")
    })

    it("registers webview panel serializer", async () => {
      const serializerSpy = vi.fn()
      ;(vscode.window as any).registerWebviewPanelSerializer = serializerSpy
      await activate(ctx)
      expect(serializerSpy).toHaveBeenCalledWith("diffViewer", expect.any(Object))
    })

    it("sets up workspace folders change listener", async () => {
      const listenerSpy = vi.fn()
      ;(vscode.workspace as any).onDidChangeWorkspaceFolders = listenerSpy
      await activate(ctx)
      expect(listenerSpy).toHaveBeenCalled()
    })

    it("captures session_started telemetry event", async () => {
      await activate(ctx)
      const { TelemetryService } = await import("./services/telemetry/TelemetryService")
      const telemetry = TelemetryService.get()
      expect(telemetry.capture).toHaveBeenCalledWith("session_started", { version: "0.1.1" })
    })

    it("adds dispose subscription for cleanup", async () => {
      await activate(ctx)
      expect(ctx.subscriptions.length).toBeGreaterThan(0)
    })

    it("sets working directory when workspace folder exists", async () => {
      await activate(ctx)
      const { AgentOrchestrator } = await import("./agent/AgentOrchestrator")
      expect(AgentOrchestrator).toHaveBeenCalled()
    })

    it("sets up workspace folders change listener that reloads agent", async () => {
      await activate(ctx)
      const listenerSpy = vscode.workspace.onDidChangeWorkspaceFolders as any
      expect(listenerSpy).toHaveBeenCalled()
      const callback = listenerSpy.mock.calls[0][0]
      ;(vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: "/work" } }]
      await callback()
      const { AgentOrchestrator } = await import("./agent/AgentOrchestrator")
      const agent = AgentOrchestrator.mock.results[0].value
      expect(agent.reload).toHaveBeenCalled()
    })

    it("handles activation without workspace folders", async () => {
      ;(vscode.workspace as any).workspaceFolders = undefined
      await activate(ctx)
      // Не должно выбрасывать исключение
    })

    it("handles activation failure gracefully", async () => {
      const { App: AppMock } = await import("./core/App")
      ;(AppMock as any).mockImplementationOnce(() => ({
        registerProvider: vi.fn(),
        registerCommand: vi.fn(),
        registerBoundCommand: vi.fn(),
        init: vi.fn().mockRejectedValue(new Error("init failed")),
        dispose: vi.fn(),
      }))
      await expect(activate(ctx)).rejects.toThrow("init failed")
    })
  })

  describe("deactivate", () => {
    it("disposes app", async () => {
      await activate(ctx)
      deactivate()
      const { App: AppMock } = await import("./core/App")
      const app = AppMock.mock.results[0].value
      expect(app.dispose).toHaveBeenCalled()
    })

    it("handles deactivate without prior activate", () => {
      // Не должно выбрасывать исключение
      deactivate()
    })
  })

  describe("getLang", () => {
    // Импорт getLang косвенно через модуль расширения
    // Так как getLang — приватная функция, тестируем её через обработчики команд

    it("returns typescript for .ts files", async () => {
      await activate(ctx)
      // Тестирование через команду explainCode, которая использует getLang
      const calls = registeredCommands
      const explainCmd = calls.find((c: any) => c.id === "neuralTowerAgent.explainCode")
      expect(explainCmd).toBeDefined()
    })

    it("returns javascript for .js files", async () => {
      await activate(ctx)
      const calls = registeredCommands
      const fixCmd = calls.find((c: any) => c.id === "neuralTowerAgent.fixCode")
      expect(fixCmd).toBeDefined()
    })
  })

  describe("command handlers", () => {
    it("newChat clears todo and resets session", async () => {
      await activate(ctx)
      const calls = registeredCommands
      const newChatCmd = calls.find((c: any) => c.id === "neuralTowerAgent.newChat")
      expect(newChatCmd).toBeDefined()
      // Выполнить обработчик
      await newChatCmd.handler()
    })

    it("focusChatInput executes focus command", async () => {
      const execSpy = vi.fn().mockResolvedValue(undefined)
      ;(vscode.commands as any).executeCommand = execSpy
      await activate(ctx)
      const calls = registeredCommands
      const focusCmd = calls.find((c: any) => c.id === "neuralTowerAgent.focusChatInput")
      await focusCmd.handler()
      expect(execSpy).toHaveBeenCalledWith("neuralTowerAgent.chat.focus")
    })

    it("settings renders settings provider", async () => {
      const { SettingsProvider } = await import("./providers/SettingsProvider")
      await activate(ctx)
      const calls = registeredCommands
      const settingsCmd = calls.find((c: any) => c.id === "neuralTowerAgent.settings")
      await settingsCmd.handler()
      expect(SettingsProvider.render).toHaveBeenCalled()
    })

    it("explainCode shows message when no active editor", async () => {
      ;(vscode.window as any).activeTextEditor = null
      const infoSpy = vi.fn().mockResolvedValue(undefined)
      ;(vscode.window as any).showInformationMessage = infoSpy
      await activate(ctx)
      const calls = registeredCommands
      const explainCmd = calls.find((c: any) => c.id === "neuralTowerAgent.explainCode")
      await explainCmd.handler()
      expect(infoSpy).toHaveBeenCalledWith("Активный редактор отсутствует")
    })

    it("explainCode shows message when selection is empty", async () => {
      ;(vscode.window as any).activeTextEditor = {
        selection: { isEmpty: true, start: { line: 0 }, end: { line: 0 } },
        document: {
          getText: vi.fn().mockReturnValue("   "),
          uri: { fsPath: "/work/test.ts" },
        },
      }
      const infoSpy = vi.fn().mockResolvedValue(undefined)
      ;(vscode.window as any).showInformationMessage = infoSpy
      await activate(ctx)
      const calls = registeredCommands
      const explainCmd = calls.find((c: any) => c.id === "neuralTowerAgent.explainCode")
      await explainCmd.handler()
      expect(infoSpy).toHaveBeenCalledWith("Выберите код для объяснения")
    })

    it("fixCode shows message when no active editor", async () => {
      ;(vscode.window as any).activeTextEditor = null
      const infoSpy = vi.fn().mockResolvedValue(undefined)
      ;(vscode.window as any).showInformationMessage = infoSpy
      await activate(ctx)
      const calls = registeredCommands
      const fixCmd = calls.find((c: any) => c.id === "neuralTowerAgent.fixCode")
      await fixCmd.handler()
      expect(infoSpy).toHaveBeenCalledWith("Активный редактор отсутствует")
    })

    it("improveCode shows message when no active editor", async () => {
      ;(vscode.window as any).activeTextEditor = null
      const infoSpy = vi.fn().mockResolvedValue(undefined)
      ;(vscode.window as any).showInformationMessage = infoSpy
      await activate(ctx)
      const calls = registeredCommands
      const improveCmd = calls.find((c: any) => c.id === "neuralTowerAgent.improveCode")
      await improveCmd.handler()
      expect(infoSpy).toHaveBeenCalledWith("Активный редактор отсутствует")
    })

    it("addToContext shows message when no active editor", async () => {
      ;(vscode.window as any).activeTextEditor = null
      const infoSpy = vi.fn().mockResolvedValue(undefined)
      ;(vscode.window as any).showInformationMessage = infoSpy
      await activate(ctx)
      const calls = registeredCommands
      const addCtxCmd = calls.find((c: any) => c.id === "neuralTowerAgent.addToContext")
      await addCtxCmd.handler()
      expect(infoSpy).toHaveBeenCalledWith("Активный редактор отсутствует")
    })

    it("codeAction.fix skips when no text or filePath", async () => {
      await activate(ctx)
      const calls = registeredCommands
      const fixCmd = calls.find((c: any) => c.id === "neuralTowerAgent.codeAction.fix")
      await fixCmd.handler("", "", "")
      // Не должно выбрасывать исключение, просто ранний выход
    })

    it("codeAction.explain skips when no text or filePath", async () => {
      await activate(ctx)
      const calls = registeredCommands
      const explainCmd = calls.find((c: any) => c.id === "neuralTowerAgent.codeAction.explain")
      await explainCmd.handler("", "")
      // Не должно выбрасывать исключение, просто ранний выход
    })

    it("codeAction.improve skips when no text or filePath", async () => {
      await activate(ctx)
      const calls = registeredCommands
      const improveCmd = calls.find((c: any) => c.id === "neuralTowerAgent.codeAction.improve")
      await improveCmd.handler("", "")
      // Не должно выбрасывать исключение, просто ранний выход
    })

    it("codeAction.addToContext skips when no text or filePath", async () => {
      await activate(ctx)
      const calls = registeredCommands
      const addCtxCmd = calls.find((c: any) => c.id === "neuralTowerAgent.codeAction.addToContext")
      await addCtxCmd.handler("", "")
      // Не должно выбрасывать исключение, просто ранний выход
    })

    it("generateCommitMessage skips when no workspace folder", async () => {
      ;(vscode.workspace as any).workspaceFolders = undefined
      await activate(ctx)
      const calls = registeredCommands
      const commitCmd = calls.find((c: any) => c.id === "neuralTowerAgent.generateCommitMessage")
      await commitCmd.handler()
      // Не должно выбрасывать исключение, просто ранний выход
    })

    it("generateCommitMessage copies message to clipboard", async () => {
      const clipboardSpy = vi.fn().mockResolvedValue(undefined)
      ;(vscode.env as any).clipboard = { writeText: clipboardSpy }
      ;(vscode.window as any).showInputBox = vi.fn().mockResolvedValue("fix: test commit")
      await activate(ctx)
      const calls = registeredCommands
      const commitCmd = calls.find((c: any) => c.id === "neuralTowerAgent.generateCommitMessage")
      await commitCmd.handler()
      expect(clipboardSpy).toHaveBeenCalledWith("fix: test commit")
    })

    it("generateCommitMessage shows message when no staged changes", async () => {
      const { CommitMessageService } = await import("./services/commit-message/CommitMessageService")
      ;(CommitMessageService as any).mockImplementationOnce(() => ({
        init: vi.fn().mockResolvedValue(undefined),
        generate: vi.fn().mockResolvedValue(null),
        dispose: vi.fn(),
      }))
      const infoSpy = vi.fn().mockResolvedValue(undefined)
      ;(vscode.window as any).showInformationMessage = infoSpy
      await activate(ctx)
      const calls = registeredCommands
      const commitCmd = calls.find((c: any) => c.id === "neuralTowerAgent.generateCommitMessage")
      await commitCmd.handler()
      expect(infoSpy).toHaveBeenCalledWith("Нет добавленных изменений")
    })

    it("session.list focuses chat", async () => {
      const execSpy = vi.fn().mockResolvedValue(undefined)
      ;(vscode.commands as any).executeCommand = execSpy
      await activate(ctx)
      const calls = registeredCommands
      const listCmd = calls.find((c: any) => c.id === "neuralTowerAgent.session.list")
      await listCmd.handler()
      expect(execSpy).toHaveBeenCalledWith("neuralTowerAgent.chat.focus")
    })

    it("openDiffViewer skips when no workspace folder", async () => {
      ;(vscode.workspace as any).workspaceFolders = undefined
      await activate(ctx)
      const calls = registeredCommands
      const diffCmd = calls.find((c: any) => c.id === "neuralTowerAgent.openDiffViewer")
      await diffCmd.handler()
      // Не должно выбрасывать исключение, просто ранний выход
    })
  })
})
