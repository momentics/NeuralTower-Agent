import * as vscode from "vscode"
import type { IAgentOrchestrator, ChatMessage } from "../core"
import type { IBackend } from "../core/IBackend"
import type { ISkill } from "../skills/ISkill"
import type { ToolRegistry } from "../tools/ToolRegistry"
import type { SkillManager } from "../skills/SkillManager"
import type { AgentTurnResult, ToolResult } from "./AgentTypes"
import type { AgentPlanner, AgentPlan } from "./AgentPlanner"
import type { PermissionManager } from "../services/permission/PermissionManager"
import type { GitService } from "../services/git/GitService"
import { AgentMemory } from "./AgentMemory"
import { RepoAnalyzer } from "../repo/RepoAnalyzer"
import { FileIndex } from "../repo/FileIndex"

export class AgentOrchestrator implements IAgentOrchestrator {
  private workDir = "."
  private planner: AgentPlanner | null = null
  private permissionManager: PermissionManager | null = null
  private gitService: GitService | null = null
  private memory: AgentMemory = new AgentMemory()
  private repoAnalyzer: RepoAnalyzer = new RepoAnalyzer()
  private fileIndex: FileIndex = new FileIndex()
  private disposables: vscode.Disposable[] = []
  private disposed = false

  constructor(
    private readonly backend: IBackend,
    private readonly toolRegistry: ToolRegistry,
    private readonly skillManager: SkillManager,
  ) {}

  setWorkingDir(dir: string): void {
    this.workDir = dir
  }

  setPlanner(planner: AgentPlanner): void {
    this.planner = planner
  }

  setPermissionManager(pm: PermissionManager): void {
    this.permissionManager = pm
  }

  setGitService(git: GitService): void {
    this.gitService = git
  }

  async reload(): Promise<void> {
    if (this.workDir && !this.disposed) {
      try {
        await this.fileIndex.build(this.workDir)
        const summary = await this.repoAnalyzer.analyze(this.workDir)
        this.memory.setProject({
          repo: this.workDir.split("/").pop() ?? this.workDir,
          languages: Object.keys(summary.languages).filter(
            (l) => summary.languages[l] > 3,
          ),
          commands: this.extractCommands(summary.buildSystems),
        })
      } catch {
        // анализ не критичен
      }
    }
  }

  dispose(): void {
    this.disposed = true
    this.memory.clear()
    this.fileIndex.clear()
    for (const d of this.disposables) d.dispose()
    this.disposables = []
  }

  // ── Цикл агента ──────────────────────────────────────────

  async run(
    query: string,
    onChunk: (text: string) => void,
    onToolUse?: (name: string, args: Record<string, unknown>) => void,
    signal?: AbortSignal,
  ): Promise<ChatMessage> {
    if (this.disposed) throw new Error("Агент освобождён")

    const activeSkills = this.skillManager.match(query)

    let gitContext = ""
    if (this.gitService && vscode.workspace.getConfiguration("nt-agent").get<boolean>("git.injectDiffContext", true)) {
      gitContext = await this.gitService.getDiffContext(this.workDir)
    }

    const projectCtx = this.memory.projectContext()
    const systemPrompt = this.buildSystemPrompt(activeSkills, gitContext, projectCtx)

    let plan: AgentPlan | null = null
    let currentStep = 0

    if (this.planner) {
      plan = await this.planner.plan(query, this.toolRegistry.list())
    }

    const conversation: ChatMessage[] = [
      { role: "system", content: systemPrompt, timestamp: Date.now() },
      ...this.memory.getRecent(),
      { role: "user", content: query, timestamp: Date.now() },
    ]

    this.memory.add(conversation[conversation.length - 1])

    if (plan && plan.steps.length > 1) {
      const planMsg = `План:\n${plan.steps.map((s, i) => `${i + 1}. ${s.description}`).join("\n")}`
      conversation.push({ role: "assistant", content: planMsg, timestamp: Date.now() })
    }

    const maxIter = vscode.workspace.getConfiguration("nt-agent").get<number>("agent.maxIterations", 20)

    let iterations = 0

    while (iterations < maxIter) {
      iterations++

      if (signal?.aborted) {
        throw new DOMException("Task aborted", "AbortError")
      }

      if (plan && currentStep < plan.steps.length) {
        const step = plan.steps[currentStep]
        conversation.push({
          role: "user",
          content: `Выполнить шаг ${currentStep + 1}: ${step.description}${
            step.suggestedTools.length ? ` (предлагаемые инструменты: ${step.suggestedTools.join(", ")})` : ""
          }`,
          timestamp: Date.now(),
        })
      }

      const result = await this.callBackend(conversation, onChunk, signal)

      if (result.type === "text") {
        if (result.content) {
          conversation.push({
            role: "assistant",
            content: result.content,
            timestamp: Date.now(),
          })
          this.memory.add(conversation[conversation.length - 1])
          return conversation[conversation.length - 1] as ChatMessage
        }
      }

      if (result.type === "tool_calls" && result.toolCalls) {
        let anyFailed = false
        for (const tc of result.toolCalls) {
          if (signal?.aborted) {
            throw new DOMException("Task aborted", "AbortError")
          }

          const tool = this.toolRegistry.get(tc.toolName)

          if (this.permissionManager && tool) {
            const allowed = await this.permissionManager.checkPermission(tool, tc.arguments)
            if (!allowed) {
              onToolUse?.(tc.toolName, { ...tc.arguments, _blocked: "permission denied" })
              conversation.push({
                role: "assistant",
                content: `Вызов инструмента: ${tc.toolName} — ЗАБЛОКИРОВАНО политикой разрешений`,
                timestamp: Date.now(),
              })
              anyFailed = true
              continue
            }
          }

          onToolUse?.(tc.toolName, tc.arguments)

          const toolResult = await this.toolRegistry.invoke(tc.toolName, tc.arguments)

          conversation.push({
            role: "assistant",
            content: `Вызов инструмента: ${tc.toolName}(${JSON.stringify(tc.arguments)})`,
            timestamp: Date.now(),
          })
          conversation.push({
            role: "user",
            content: `Результат инструмента:\n${toolResult.output}`,
            timestamp: Date.now(),
          })

          this.memory.add(conversation[conversation.length - 1])

          if (!toolResult.success) anyFailed = true
        }

        if (plan && anyFailed && this.planner?.shouldReplan(currentStep, false)) {
          currentStep = Math.max(0, currentStep - 1)
        } else if (plan && !anyFailed) {
          currentStep++
        }
      } else {
        break
      }
    }

    return {
      role: "assistant",
      content: "Достигнуто максимальное число итераций. Операция может быть незавершённой.",
      timestamp: Date.now(),
    }
  }

  // ── Формирование контекста ──────────────────────────────

  private buildSystemPrompt(skills: ISkill[], gitContext: string, projectContext: string): string {
    const base = this.baseSystemPrompt()
    const skillCtx = this.skillManager.buildContext(skills)
    const toolCtx = this.toolRegistry.toSchemaList()
    const indexStats = this.fileIndex.stats()
    const indexInfo = indexStats.totalFiles > 0
      ? `\nИндекс файлов: ${indexStats.totalFiles} файлов, ${indexStats.languages} языков`
      : ""
    const parts = [base, projectContext, skillCtx, toolCtx, indexInfo, gitContext].filter(Boolean)
    return parts.join("\n\n")
  }

  private baseSystemPrompt(): string {
    return `Вы — агент Neural Tower, ИИ-помощник для разработки.
У вас есть доступ к инструментам для работы с файлами, выполнения команд оболочки и поиска кода.
Когда пользователь просит что-то сделать, используйте инструменты для выполнения задачи.
Когда нужно вызвать инструмент, ответите блоком JSON:
{"tool": "имя_инструмента", "args": {"ключ": "значение"}}
Когда у вас есть окончательный ответ, ответите обычным текстом.
Всегда будьте кратки. Не повторяйте информацию, которая уже известна пользователю.
Рабочая директория: ${this.workDir}`
  }

  // ── Вызов бэкенда с определением вызова инструментов ────

  private async callBackend(
    conversation: ChatMessage[],
    onChunk: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<AgentTurnResult> {
    if (signal?.aborted) {
      throw new DOMException("Task aborted", "AbortError")
    }

    const wrappedChunk = (text: string) => {
      if (signal?.aborted) return
      onChunk(text)
    }

    const msg = await this.backend.chat(conversation, wrappedChunk)
    const content = msg.content

    const toolCalls = this.extractToolCalls(content)
    if (toolCalls && toolCalls.length > 0) {
      return { type: "tool_calls", toolCalls }
    }

    return { type: "text", content }
  }

  private extractToolCalls(content: string): import("./AgentTypes").ToolCall[] | null {
    const calls: import("./AgentTypes").ToolCall[] = []
    const jsonRegex = /\{"tool"\s*:\s*"([^"]+)"\s*,\s*"args"\s*:\s*(\{[^}]+\})\}/g
    let match: RegExpExecArray | null

    while ((match = jsonRegex.exec(content)) !== null) {
      try {
        calls.push({
          toolName: match[1],
          arguments: JSON.parse(match[2]),
        })
      } catch {
        // пропустить некорректные данные
      }
    }

    return calls.length > 0 ? calls : null
  }

  private extractCommands(buildSystems: string[]): Record<string, string> {
    const commands: Record<string, string> = {}
    if (buildSystems.includes("npm")) {
      commands["build"] = "npm run build"
      commands["test"] = "npm test"
    }
    if (buildSystems.includes("cargo")) {
      commands["build"] = "cargo build"
      commands["test"] = "cargo test"
    }
    if (buildSystems.includes("maven")) {
      commands["build"] = "mvn compile"
      commands["test"] = "mvn test"
    }
    if (buildSystems.includes("go")) {
      commands["build"] = "go build ./..."
      commands["test"] = "go test ./..."
    }
    return commands
  }
}
