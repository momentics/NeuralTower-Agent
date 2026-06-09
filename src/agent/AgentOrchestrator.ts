import type { IAgentOrchestrator, ChatMessage } from "../core"
import type { IBackend } from "../core/IBackend"
import type { ISkill } from "../skills/ISkill"
import type { ToolRegistry } from "../tools/ToolRegistry"
import type { SkillManager } from "../skills/SkillManager"
import type { AgentTurnResult, ToolResult } from "./AgentTypes"
import type { AgentPlanner, AgentPlan } from "./AgentPlanner"
import type { PermissionManager } from "../services/permission/PermissionManager"
import type { GitService } from "../services/git/GitService"

export class AgentOrchestrator implements IAgentOrchestrator {
  private workDir = "."
  private planner: AgentPlanner | null = null
  private permissionManager: PermissionManager | null = null
  private gitService: GitService | null = null

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

  async reload(): Promise<void> {}

  dispose(): void {}

  // ── Цикл агента ──────────────────────────────────────────

  async run(
    query: string,
    onChunk: (text: string) => void,
    onToolUse?: (name: string, args: Record<string, unknown>) => void,
  ): Promise<ChatMessage> {
    const activeSkills = this.skillManager.match(query)

    let gitContext = ""
    if (this.gitService) {
      gitContext = await this.gitService.getDiffContext(this.workDir)
    }

    const systemPrompt = this.buildSystemPrompt(activeSkills, gitContext)

    let plan: AgentPlan | null = null
    let currentStep = 0

    if (this.planner) {
      plan = await this.planner.plan(query, this.toolRegistry.list())
    }

    const conversation: ChatMessage[] = [
      { role: "system", content: systemPrompt, timestamp: Date.now() },
      { role: "user", content: query, timestamp: Date.now() },
    ]

    if (plan && plan.steps.length > 1) {
      const planMsg = `План:\n${plan.steps.map((s, i) => `${i + 1}. ${s.description}`).join("\n")}`
      conversation.push({ role: "assistant", content: planMsg, timestamp: Date.now() })
    }

    let iterations = 0
    const maxIter = 20

    while (iterations < maxIter) {
      iterations++

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

      const result = await this.callBackend(conversation, onChunk)

      if (result.type === "text") {
        if (result.content) {
          conversation.push({
            role: "assistant",
            content: result.content,
            timestamp: Date.now(),
          })
          return conversation[conversation.length - 1] as ChatMessage
        }
      }

      if (result.type === "tool_calls" && result.toolCalls) {
        let anyFailed = false
        for (const tc of result.toolCalls) {
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

  private buildSystemPrompt(skills: ISkill[], gitContext: string): string {
    const base = this.baseSystemPrompt()
    const skillCtx = this.skillManager.buildContext(skills)
    const toolCtx = this.toolRegistry.toSchemaList()
    const parts = [base, skillCtx, toolCtx]
    if (gitContext) parts.push(gitContext)
    return parts.filter(Boolean).join("\n\n")
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
  ): Promise<AgentTurnResult> {
    const msg = await this.backend.chat(conversation, onChunk)
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
}
