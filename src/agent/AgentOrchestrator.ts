import * as vscode from "vscode"
import type { IAgentOrchestrator, ChatMessage } from "../core"
import type { IBackend } from "../core/IBackend"
import type { ISkill } from "../skills/ISkill"
import type { ToolRegistry } from "../tools/ToolRegistry"
import type { SkillManager } from "../skills/SkillManager"
import type { AgentTurnResult, ToolResult } from "./AgentTypes"
import type { PermissionManager } from "../services/permission/PermissionManager"
import type { GitService } from "../services/git/GitService"
import type { MCPManager } from "../mcp/MCPManager"
import { AgentMemory } from "./AgentMemory"
import { RepoAnalyzer } from "../repo/RepoAnalyzer"
import { FileIndex } from "../repo/FileIndex"
import { ContextManager } from "../core/ContextManager"
import {
  makeEnvironmentSource,
  makeRepoSource,
  makeFileIndexSource,
  makeProjectMemorySource,
  makeGitDiffSource,
} from "../core/ContextSources"
import {
  makeCurrentFileSource,
  makeOpenFilesSource,
  makeProblemsSource,
  makeClipboardSource,
  makeDebuggerSource,
  makeTerminalSource,
  makeOSSource,
  makeRulesSource,
  makeRepoMapSource,
} from "../core/ContextSources.vscode"
import {
  ContextProviderRegistry,
  makeUrlProvider,
  makeWebSearchProvider,
  makeActiveFileProblemsProvider,
  makeFileProvider,
  makeCodeProvider,
  makeTreeProvider,
  makeRepoMapProvider,
  makeRulesProvider,
  makeMCPProvider,
  type ContextProvider,
  type ContextItem,
  type MCPToolListFn,
} from "../core/ContextProvider"
import { Plan } from "./Plan"
import { AgentModeManager, builtInModes, type AgentModeName } from "./AgentMode"
import { Compactor } from "./Compactor"
import { SessionContext } from "./SessionContext"
import { SubagentRunner } from "./SubagentRunner"

export class AgentOrchestrator implements IAgentOrchestrator {
  private workDir = "."
  private permissionManager: PermissionManager | null = null
  private gitService: GitService | null = null
  private mcpManager: MCPManager | null = null
  private memory: AgentMemory = new AgentMemory()
  private repoAnalyzer: RepoAnalyzer = new RepoAnalyzer()
  private fileIndex: FileIndex = new FileIndex()
  private disposables: vscode.Disposable[] = []
  private disposed = false

  private contextManager: ContextManager
  private modeManager: AgentModeManager = new AgentModeManager()
  private compactor: Compactor
  private providerRegistry: ContextProviderRegistry
  private sessionContext: SessionContext | null = null
  private subagentRunner: SubagentRunner | null = null
  private currentPlan: Plan | null = null

  constructor(
    private readonly backend: IBackend,
    private readonly toolRegistry: ToolRegistry,
    private readonly skillManager: SkillManager,
    contextManager?: ContextManager,
  ) {
    this.contextManager = contextManager ?? new ContextManager()
    this.compactor = new Compactor(backend)
    this.providerRegistry = new ContextProviderRegistry()
    this.providerRegistry.register(makeUrlProvider())
    this.providerRegistry.register(makeWebSearchProvider())
    this.providerRegistry.register(makeActiveFileProblemsProvider())
    this.providerRegistry.register(makeFileProvider(() => this.workDir))
    this.providerRegistry.register(makeCodeProvider(() => this.workDir, () => this.fileIndex))
    this.providerRegistry.register(makeTreeProvider(() => this.workDir))
    this.providerRegistry.register(makeRepoMapProvider(
      () => this.workDir,
      () => this.fileIndex,
      () => this.repoAnalyzer.analyze(this.workDir),
    ))
    this.providerRegistry.register(makeRulesProvider(() => this.workDir))
    const mcpListFn: MCPToolListFn = async () => {
      if (!this.mcpManager) return []
      try {
        await this.mcpManager.discover()
        const result: Array<{ server: string; tool: { name: string; description: string; schema: Record<string, unknown> } }> = []
        for (const { server, tools } of this.mcpManager.getToolsByServer()) {
          for (const t of tools) {
            result.push({ server, tool: t })
          }
        }
        return result
      } catch {
        return []
      }
    }
    this.providerRegistry.register(makeMCPProvider(mcpListFn))
  }

  setWorkingDir(dir: string): void {
    this.workDir = dir
  }

  setPermissionManager(pm: PermissionManager): void {
    this.permissionManager = pm
  }

  setGitService(git: GitService): void {
    this.gitService = git
  }

  setMCPManager(mcp: MCPManager): void {
    this.mcpManager = mcp
  }

  /**
   * Установить контекст сессии.
   */
  setSessionContext(sc: SessionContext): void {
    this.sessionContext = sc
  }

  /**
   * Установить runner подагентов.
   */
  setSubagentRunner(runner: SubagentRunner): void {
    this.subagentRunner = runner
  }

  /**
   * Переключить режим агента.
   */
  switchMode(mode: AgentModeName): boolean {
    return this.modeManager.switchMode(mode)
  }

  /**
   * Вернуть текущий режим.
   */
  getMode(): AgentModeName {
    return this.modeManager.getModeName()
  }

  getProviderRegistry(): ContextProviderRegistry {
    return this.providerRegistry
  }

  async resolveContextProvider(name: string, query: string): Promise<ContextItem[]> {
    const provider = this.providerRegistry.get(name)
    if (!provider) return []
    return provider.resolve(query)
  }

  async reload(): Promise<void> {
    if (this.sessionContext?.getEpoch()) return
    if (this.workDir && !this.disposed) {
      try {
        await this.fileIndex.build(this.workDir)
        const summary = await this.repoAnalyzer.analyze(this.workDir)
        this.memory.setProject({
          repo: this.workDir.split(/[\\/]/).pop() ?? this.workDir,
          languages: Object.keys(summary.languages).filter(
            (l) => summary.languages[l] > 3,
          ),
          commands: this.extractCommands(summary.buildSystems),
        })

        this.registerContextSources()
      } catch {
        // анализ не критичен
      }
    }
  }

  dispose(): void {
    this.disposed = true
    this.memory.clear()
    this.fileIndex.clear()
    this.contextManager.reset()
    this.subagentRunner?.cancelAll()
    for (const d of this.disposables) d.dispose()
    this.disposables = []
  }

  // ── Регистрация источников контекста ────────────────────

  private registerContextSources(): void {
    this.contextManager.reset()

    const workDirFn = () => this.workDir
    const modelFn = async () => {
      try {
        return (await this.backend.getConfig()).model
      } catch {
        return "unknown"
      }
    }

    this.contextManager.register(
      makeEnvironmentSource(workDirFn, modelFn, this.gitService),
    )
    this.contextManager.register(makeRepoSource(workDirFn, this.repoAnalyzer))
    this.contextManager.register(makeProjectMemorySource(this.memory))
    this.contextManager.register(makeFileIndexSource(this.fileIndex))

    if (this.gitService) {
      this.contextManager.register(makeGitDiffSource(workDirFn, this.gitService))
    }

    this.contextManager.register(makeCurrentFileSource())
    this.contextManager.register(makeOpenFilesSource())
    this.contextManager.register(makeProblemsSource())
    this.contextManager.register(makeClipboardSource())
    this.contextManager.register(makeDebuggerSource())
    this.contextManager.register(makeTerminalSource())
    this.contextManager.register(makeOSSource())
    this.contextManager.register(makeRulesSource(workDirFn))
    this.contextManager.register(makeRepoMapSource(workDirFn, () => this.repoAnalyzer.analyze(this.workDir)))
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

    const currentMode = this.modeManager.getModeName()
    const activeSkills = this.skillManager.match(query)

    let systemPrompt = ""

    if (this.sessionContext) {
      try {
        const epoch = await this.sessionContext.prepare(currentMode)
        systemPrompt = epoch.baseline
      } catch {
        systemPrompt = await this.buildLegacySystemPrompt(activeSkills)
      }
    } else {
      systemPrompt = await this.buildLegacySystemPrompt(activeSkills)
    }

    systemPrompt += "\n\n" + this.modeManager.getSystemPromptAddon()

    const conversation: ChatMessage[] = [
      { role: "system", content: systemPrompt, timestamp: Date.now() },
      ...this.memory.getRecent(),
      { role: "user", content: query, timestamp: Date.now() },
    ]

    this.memory.add(conversation[conversation.length - 1])

    if (this.sessionContext) {
      this.sessionContext.pushMessage(conversation[conversation.length - 1])
    }

    const compactionResult = await this.compactor.compactIfNeeded(
      conversation.slice(1),
      systemPrompt,
    )

    let workingConversation: ChatMessage[]
    if (compactionResult.needsCompaction && compactionResult.compactedHistory) {
      workingConversation = [
        { role: "system", content: systemPrompt, timestamp: Date.now() },
        ...compactionResult.compactedHistory,
      ]
    } else {
      workingConversation = conversation
    }

    const maxIter = vscode.workspace.getConfiguration("neuralTowerAgent").get<number>("agent.maxIterations", 20)

    let iterations = 0

    while (iterations < maxIter) {
      iterations++

      if (signal?.aborted) {
        throw new DOMException("Task aborted", "AbortError")
      }

      if (this.currentPlan && this.currentPlan.status === "running") {
        const step = this.currentPlan.currentStep
        if (step && step.status === "pending") {
          workingConversation.push({
            role: "user",
            content: `Выполнить шаг ${this.currentPlan.currentStepIndex + 1}: ${step.description}${
              step.suggestedTools.length ? ` (предлагаемые инструменты: ${step.suggestedTools.join(", ")})` : ""
            }`,
            timestamp: Date.now(),
          })
        }
      }

      const result = await this.callBackend(workingConversation, onChunk, signal)

      if (result.type === "text") {
        if (result.content) {
          workingConversation.push({
            role: "assistant",
            content: result.content,
            timestamp: Date.now(),
          })
          this.memory.add(workingConversation[workingConversation.length - 1])

          if (this.sessionContext) {
            this.sessionContext.pushMessage(workingConversation[workingConversation.length - 1])
          }

          if (this.currentPlan && this.currentPlan.status === "running") {
            this.currentPlan.markDone(result.content.slice(0, 500))
            if (this.currentPlan.status === "running") {
              continue
            }
          }

          return workingConversation[workingConversation.length - 1] as ChatMessage
        }
      }

      if (result.type === "tool_calls" && result.toolCalls) {
        let anyFailed = false

        if (this.currentPlan && this.currentPlan.status === "running") {
          this.currentPlan.markRunning()
        }

        for (const tc of result.toolCalls) {
          if (signal?.aborted) {
            throw new DOMException("Task aborted", "AbortError")
          }

          const modePerm = this.modeManager.checkToolPermission(tc.toolName)

          if (modePerm === "deny") {
            onToolUse?.(tc.toolName, { ...tc.arguments, _blocked: `mode ${currentMode} denies ${tc.toolName}` })
            workingConversation.push({
              role: "assistant",
              content: `Вызов инструмента: ${tc.toolName} — ЗАБЛОКИРОВАНО режимом ${currentMode}`,
              timestamp: Date.now(),
            })
            anyFailed = true
            continue
          }

          const tool = this.toolRegistry.get(tc.toolName)

          if (this.permissionManager && tool && modePerm !== "allow") {
            const allowed = await this.permissionManager.checkPermission(tool, tc.arguments)
            if (!allowed) {
              onToolUse?.(tc.toolName, { ...tc.arguments, _blocked: "permission denied" })
              workingConversation.push({
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

          workingConversation.push({
            role: "assistant",
            content: `Вызов инструмента: ${tc.toolName}(${JSON.stringify(tc.arguments)})`,
            timestamp: Date.now(),
          })
          workingConversation.push({
            role: "user",
            content: `Результат инструмента:\n${toolResult.output}`,
            timestamp: Date.now(),
          })

          this.memory.add(workingConversation[workingConversation.length - 1])

          if (this.sessionContext) {
            this.sessionContext.pushMessage(workingConversation[workingConversation.length - 1])
          }

          if (!toolResult.success) anyFailed = true
        }

        if (this.currentPlan) {
          if (anyFailed) {
            this.currentPlan.markFailed("Инструмент вернул ошибку")
          } else {
            this.currentPlan.markDone()
          }
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

  // ── Планирование ─────────────────────────────────────────

  /**
   * Создать и запустить план для задачи.
   */
  async createPlan(
    query: string,
    onChunk: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<Plan> {
    const toolList = this.toolRegistry
      .list()
      .map((t) => `- ${t.name}: ${t.description}`)
      .join("\n")

    const planningPrompt = `Вы — планировщик задач. Получив пользовательский запрос и доступные инструменты,
разбейте задачу на последовательные шаги. Каждый шаг должен быть конкретным и выполнимым.
Доступные инструменты:
${toolList}

Ответьте корректным объектом JSON:
{
  "reasoning": "краткое обоснование вашего плана",
  "steps": [
    {
      "description": "что выполнить на этом шаге",
      "suggestedTools": ["имя_инструмента"],
      "dependsOn": []
    }
  ]
}

Держите план лаконичным. Обычно достаточно 3-7 шагов. Если шаг не требует конкретных инструментов, оставьте suggestedTools пустым.`

    try {
      const result = await this.backend.chatJson<{
        reasoning: string
        steps: { description: string; suggestedTools: string[]; dependsOn?: number[] }[]
      }>([
        { role: "system", content: planningPrompt, timestamp: Date.now() },
        { role: "user", content: query, timestamp: Date.now() },
      ])

      const plan = new Plan({
        title: query.slice(0, 80),
        reasoning: result.reasoning,
        steps: result.steps,
      })

      this.currentPlan = plan
      plan.start()

      if (this.sessionContext) {
        this.sessionContext.setPlan(plan)
      }

      return plan
    } catch {
      const plan = new Plan({
        title: query.slice(0, 80),
        reasoning: "Простой одношаговый план",
        steps: [{ description: query, suggestedTools: [] }],
      })
      this.currentPlan = plan
      plan.start()
      return plan
    }
  }

  /**
   * Сбросить текущий план.
   */
  clearPlan(): void {
    this.currentPlan = null
    if (this.sessionContext) {
      this.sessionContext.clearPlan()
    }
  }

  /**
   * Вернуть текущий план.
   */
  getPlan(): Plan | null {
    return this.currentPlan
  }

  // ── Подагенты ────────────────────────────────────────────

  /**
   * Запустить подагента для исследования.
   */
  async spawnExplore(
    task: string,
    onChunk?: (text: string) => void,
  ): Promise<string> {
    if (!this.subagentRunner) {
      return "SubagentRunner не настроен"
    }

    const results = await this.subagentRunner.spawnAll(
      [
        {
          name: "explore",
          task,
          mode: "explore",
          workDir: this.workDir,
          maxIterations: 10,
        },
      ],
      (_id, text) => onChunk?.(text),
    )

    return results[0]?.output ?? "Подагент не вернул результат"
  }

  // ── Формирование контекста (legacy) ──────────────────────

  private async buildLegacySystemPrompt(skills: ISkill[]): Promise<string> {
    const base = this.baseSystemPrompt()
    const envBlock = await this.buildEnvironmentBlock()
    const skillCtx = this.skillManager.buildContext(skills)
    const toolCtx = this.toolRegistry.toSchemaList()
    const projectCtx = this.memory.projectContext()
    const indexStats = this.fileIndex.stats()
    const indexInfo =
      indexStats.totalFiles > 0
        ? `\nИндекс файлов: ${indexStats.totalFiles} файлов, ${indexStats.languages} языков`
        : ""

    let gitContext = ""
    if (
      this.gitService &&
      vscode.workspace.getConfiguration("neuralTowerAgent").get<boolean>("git.injectDiffContext", true)
    ) {
      gitContext = await this.gitService.getDiffContext(this.workDir)
    }

    const parts = [envBlock, base, projectCtx, skillCtx, toolCtx, indexInfo, gitContext].filter(Boolean)
    return parts.join("\n\n")
  }

  private async buildEnvironmentBlock(): Promise<string> {
    try {
      const cfg = await this.backend.getConfig()
      const branchInfo = this.gitService
        ? await this.gitService.getBranchInfo(this.workDir)
        : null
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

    const jsonBlocks = this.extractJsonBlocks(content)

    for (const block of jsonBlocks) {
      try {
        const parsed = JSON.parse(block) as Record<string, unknown>
        if (
          parsed.tool &&
          typeof parsed.tool === "string" &&
          parsed.args &&
          typeof parsed.args === "object"
        ) {
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

    const cleaned = content
      .replace(/```(?:json)?\s*\n?/g, "")
      .replace(/```\s*\n?/g, "")

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
