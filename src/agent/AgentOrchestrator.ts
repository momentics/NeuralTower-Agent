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
    onToolResult?: (name: string, result: { output: string; success: boolean }) => void,
    signal?: AbortSignal,
  ): Promise<ChatMessage> {
    if (this.disposed) throw new Error("Агент освобождён")

    const activeSkills = this.skillManager.match(query)

    let gitContext = ""
    if (this.gitService && vscode.workspace.getConfiguration("neuralTowerAgent").get<boolean>("git.injectDiffContext", true)) {
      gitContext = await this.gitService.getDiffContext(this.workDir)
    }

    const projectCtx = this.memory.projectContext()
    const systemPrompt = await this.buildSystemPrompt(activeSkills, gitContext, projectCtx)

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

    const maxIter = vscode.workspace.getConfiguration("neuralTowerAgent").get<number>("agent.maxIterations", 20)

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
           onToolResult?.(tc.toolName, toolResult)

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

  private async buildSystemPrompt(skills: ISkill[], gitContext: string, projectContext: string): Promise<string> {
    const base = this.baseSystemPrompt()
    const envBlock = await this.buildEnvironmentBlock()
    const skillCtx = this.skillManager.buildContext(skills)
    const toolCtx = this.toolRegistry.toSchemaList()
    const indexStats = this.fileIndex.stats()
    const indexInfo = indexStats.totalFiles > 0
      ? `\nИндекс файлов: ${indexStats.totalFiles} файлов, ${indexStats.languages} языков`
      : ""
    const parts = [envBlock, base, projectContext, skillCtx, toolCtx, indexInfo, gitContext].filter(Boolean)
    return parts.join("\n\n")
  }

  private async buildEnvironmentBlock(): Promise<string> {
    try {
      const cfg = await this.backend.getConfig()
      const branchInfo = this.gitService ? await this.gitService.getBranchInfo(this.workDir) : null
      return `<env>
  Модель: ${cfg.model}
  Рабочая директория: ${this.workDir}
  Платформа: ${process.platform}
  Дата: ${new Date().toISOString()}
  Ветка: ${branchInfo?.name ?? "неизвестно"}
</env>`
    } catch {
      return `<env>
  Рабочая директория: ${this.workDir}
  Платформа: ${process.platform}
  Дата: ${new Date().toISOString()}
</env>`
    }
  }

 private baseSystemPrompt(): string {
    return `Вы — агент Neural Tower, высококвалифицированный ИИ-помощник для разработки программного обеспечения.

# Личность

- Ваша цель — выполнить задачу пользователя, а не вести беседу.
- Вы выполняете задачи итеративно, разбивая их на чёткие шаги.
- Не запрашивайте лишнюю информацию. Используйте доступные инструменты эффективно.
- НЕ начинайте ответы с "Отлично", "Конечно", "Хорошо". Будьте прямолинейны и технически точны.
- НИКОГДА не заканчивайте ответ вопросом или предложением дальнейшей помощи.
- Минимизируйте токены вывода. Отвечайте кратко: 1-3 строки, если пользователь не просит подробности.

# Инструменты

У вас есть доступ к инструментам для работы с файлами, выполнения команд и поиска кода.
Когда нужно вызвать инструмент, ответите JSON-блоком:
\{"tool": "имя_инструмента", "args": \{"ключ": "значение"\}\}
Когда у вас есть окончательный ответ, ответите обычным текстом.
Вы можете вызывать несколько инструментов в одном ответе, разместив несколько JSON-блоков.

# Стиль кода

- При изменении кода сначала изучите conventions файла.
- НЕ добавляйте комментарии, если пользователь не попросил явно.
- Следуйте best practices безопасности. Не логируйте секреты.

# Выполнение задач

- Используйте инструменты поиска для понимания кодовой базы.
- Реализуйте решение с использованием всех доступных инструментов.
- Никогда не коммитьте изменения, если пользователь не попросил явно.`
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

    // Извлечь JSON-блоки из ответа (включая блоки в markdown)
    const jsonBlocks = this.extractJsonBlocks(content)

    for (const block of jsonBlocks) {
      try {
        const parsed = JSON.parse(block) as Record<string, unknown>
        if (parsed.tool && typeof parsed.tool === "string" && parsed.args && typeof parsed.args === "object") {
          calls.push({
            toolName: parsed.tool,
            arguments: parsed.args as Record<string, unknown>,
          })
        }
      } catch {
        // пропустить некорректные данные
      }
    }

    return calls.length > 0 ? calls : null
  }

 private extractJsonBlocks(content: string): string[] {
    const blocks: string[] = []

    // Удалить markdown-обёртки для JSON-блоков
    const cleaned = content.replace(/```(?:json)?\s*\n?/g, "").replace(/```\s*\n?/g, "")

    // Найти все JSON-объекты с учётом вложенности
    let depth = 0
    let start = -1
    for (let i = 0; i < cleaned.length; i++) {
      const ch = cleaned[i]
      if (ch === "{") {
        if (depth === 0) start = i
        depth++
      } else if (ch === "}") {
        depth--
        if (depth === 0 && start !== -1) {
          blocks.push(cleaned.slice(start, i + 1))
          start = -1
        }
      } else if (ch === '"') {
        // Пропустить строковые литералы
        i++
        while (i < cleaned.length && cleaned[i] !== '"') {
          if (cleaned[i] === "\\") i++
          i++
        }
      }
      if (depth < 0) depth = 0
    }

    return blocks
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
