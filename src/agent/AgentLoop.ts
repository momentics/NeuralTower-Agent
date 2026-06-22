import type { IBackend, ChatMessage } from "../core/IBackend"
import type { ISkill } from "../skills/ISkill"
import type { AgentTurnResult, ToolResult } from "./AgentTypes"
import { AgentMemory } from "./AgentMemory"
import type { AgentModeManager } from "./AgentMode"
import type { AgentModeName } from "./AgentMode"
import { Compactor, type CompactionResult } from "./Compactor"
import type { SessionContext } from "./SessionContext"
import type { Plan } from "./Plan"
import type { AgentContextBuilder } from "./AgentContextBuilder"
import type { AgentToolExecutor } from "./AgentToolExecutor"
import type { AgentPlanner } from "./AgentPlanner"
import { AbortError, errorMessage } from "../core/Errors"
import { loadDefaultAgentConfig } from "../core/Config"
import { createDomainLogger } from "../core/Logger"

const log = createDomainLogger("AgentLoop")

const PLAN_STEP_RESULT_MAX_CHARS = 500
const DEFAULT_MAX_COMPACTIONS = 5

export interface AgentLoopConfig {
  maxIterations?: number
  maxRecoveryAttempts?: number
  replanOnFailure?: boolean
  maxReplanAttempts?: number
  maxCompactions?: number
}

export class AgentLoop {
  private readonly maxIterations: number
  private readonly maxRecoveryAttempts: number
  private readonly replanOnFailure: boolean
  private readonly maxReplanAttempts: number
  private readonly maxCompactions: number

  private pushSessionMessage(msg: ChatMessage): void {
    if (this.sessionContext) {
      this.sessionContext.pushMessage(msg)
    }
  }

  /** Добавить сообщение в память и контекст сессии. */
  private addToMemory(msg: ChatMessage): void {
    this.memory.add(msg)
    this.pushSessionMessage(msg)
  }

  /** Попытка компактизации с обработкой ошибок. */
  private async tryCompact(
    messages: ChatMessage[],
    systemPrompt: string,
  ): Promise<CompactionResult> {
    const emptyResult: CompactionResult = { needsCompaction: false, tokensBefore: 0, tokensAfter: 0 }
    try {
      return await this.compactor.compactIfNeeded(messages.slice(1), systemPrompt)
    } catch (err: unknown) {
      log.warn(`Компактизация не выполнена: ${errorMessage(err)}`)
      return emptyResult
    }
  }

  /** Применение результата компактизации к рабочему контексту. */
  private applyCompaction(
    result: CompactionResult,
    systemPrompt: string,
  ): ChatMessage[] | null {
    if (result.needsCompaction && result.compactedHistory) {
      return [
        { role: "system", content: systemPrompt, timestamp: Date.now() },
        ...result.compactedHistory,
      ]
    }
    return null
  }

  constructor(
    private readonly backend: IBackend,
    private readonly memory: AgentMemory,
    private readonly compactor: Compactor,
    private readonly modeManager: AgentModeManager,
    private readonly sessionContext: SessionContext | null,
    private readonly contextBuilder: AgentContextBuilder,
    private readonly toolExecutor: AgentToolExecutor,
    private readonly planner: AgentPlanner,
    config: AgentLoopConfig = {},
  ) {
    const defaults = loadDefaultAgentConfig()
    this.maxIterations = config.maxIterations ?? defaults.maxIterations
    this.maxRecoveryAttempts = config.maxRecoveryAttempts ?? defaults.maxRecoveryAttempts
    this.replanOnFailure = config.replanOnFailure ?? defaults.replanOnFailure
    this.maxReplanAttempts = config.maxReplanAttempts ?? defaults.maxReplanAttempts
    this.maxCompactions = config.maxCompactions ?? DEFAULT_MAX_COMPACTIONS
  }

  async run(
    query: string,
    activeSkills: ISkill[],
    onChunk: (text: string) => void,
    onToolUse?: (name: string, args: Record<string, unknown>) => void,
    onToolResult?: (name: string, result: ToolResult) => void,
    signal?: AbortSignal,
    onCompaction?: (tokensBefore: number, tokensAfter: number) => void,
  ): Promise<ChatMessage> {
    const currentMode = this.modeManager.getModeName()

    let planContext = ""
    const activePlan = this.planner.getPlan()
    if (activePlan) {
      planContext = activePlan.toText()
    }

    const systemPrompt = (await this.contextBuilder.buildSystemPrompt(activeSkills))
      + "\n\n" + this.modeManager.getSystemPromptAddon()
      + (planContext ? "\n\n" + planContext : "")

    const conversation: ChatMessage[] = [
      { role: "system", content: systemPrompt, timestamp: Date.now() },
      ...this.memory.getRecent(),
      { role: "user", content: query, timestamp: Date.now() },
    ]

    this.addToMemory(conversation[conversation.length - 1])

    const compactionResult = await this.tryCompact(conversation, systemPrompt)
    let workingConversation: ChatMessage[] = this.applyCompaction(compactionResult, systemPrompt) ?? conversation

    let iterations = 0
    let recoveryAttempts = 0
    let compactionCount = 0

    while (iterations < this.maxIterations) {
      iterations++

      if (signal?.aborted) {
        throw new AbortError()
      }

     // Периодическая компактизация контекста перед каждым вызовом бэкенда
      const loopCompactionResult = await this.tryCompact(workingConversation, systemPrompt)
      const compactedConversation = this.applyCompaction(loopCompactionResult, systemPrompt)
      if (compactedConversation) {
        if (compactionCount >= this.maxCompactions) {
          // Слишком много компактизаций — контекст превышает допустимые пределы
          return {
            role: "assistant",
            content: "Контекст превышает допустимые пределы. Задача может быть незавершённой.",
            timestamp: Date.now(),
          }
        }

        compactionCount++
        workingConversation = compactedConversation

        onCompaction?.(loopCompactionResult.tokensBefore ?? 0, loopCompactionResult.tokensAfter ?? 0)

        // Синхронизация памяти после компактизации
        this.memory.restoreFromMessages(workingConversation.slice(1))

        this.sessionContext?.replaceMessages(workingConversation.slice(1))
      }

      // Инъекция шага плана в разговор
      const plan = this.planner.getPlan()
      if (plan && plan.status === "running") {
        const step = plan.currentStep
        if (step && step.status === "pending") {
          workingConversation.push({
            role: "user",
            content: `Выполнить шаг ${plan.currentStepIndex + 1}: ${step.description}${
              step.suggestedTools.length ? ` (предлагаемые инструменты: ${step.suggestedTools.join(", ")})` : ""
            }`,
            timestamp: Date.now(),
          })
        }
      }

      let anyFailed = false
      let failedTools: { name: string; error: string }[] | undefined
      let currentPlan: Plan | null = null

      try {
        const result = await this.toolExecutor.callBackend(workingConversation, onChunk, signal)

        if (result.type === "text") {
          if (result.content) {
            workingConversation.push({
              role: "assistant",
              content: result.content,
              timestamp: Date.now(),
            })
            this.addToMemory(workingConversation[workingConversation.length - 1])

            currentPlan = this.planner.getPlan()
            if (currentPlan && currentPlan.status === "running") {
              currentPlan.markDone(result.content.slice(0, PLAN_STEP_RESULT_MAX_CHARS))
              if (currentPlan.status === "running") {
                continue
              }
            }

            return workingConversation[workingConversation.length - 1] as ChatMessage
          }
        }

        if (result.type === "tool_calls" && result.toolCalls) {
          currentPlan = this.planner.getPlan()
          if (currentPlan && currentPlan.status === "running") {
            currentPlan.markRunning()
          }

          const convLenBefore = workingConversation.length
          const toolResult = await this.toolExecutor.executeToolCalls(
            result.toolCalls,
            currentMode,
            workingConversation,
            signal,
            onToolUse,
            onToolResult,
          )

          // Синхронизация: добавить сообщения вызовов инструментов в память
          for (let i = convLenBefore; i < workingConversation.length; i++) {
            this.addToMemory(workingConversation[i])
          }

          anyFailed = toolResult.anyFailed
          failedTools = toolResult.failedTools

          if (currentPlan) {
            if (anyFailed) {
              currentPlan.markFailed("Инструмент вернул ошибку")
            } else {
              currentPlan.markDone()
            }
          }
        } else {
          break
        }
      } catch (err: unknown) {
        anyFailed = true
        const msg = errorMessage(err)
        failedTools = [{ name: "backend", error: msg }]

        currentPlan = this.planner.getPlan()
        if (currentPlan) {
          currentPlan.markFailed(msg)
        }
      }

      if (anyFailed) {
        if (recoveryAttempts >= this.maxRecoveryAttempts) {
          break
        }

        // Попытка адаптивного репланирования, если шаг провалился окончательно
        if (this.replanOnFailure && currentPlan && currentPlan.currentStep?.status === "failed") {
          const failedStep = currentPlan.currentStep!
          const failedError = failedStep.error ?? "Инструмент вернул ошибку"
          const newPlan = await this.planner.attemptReplan(failedStep, failedError, this.maxReplanAttempts)

          if (newPlan) {
            recoveryAttempts++
            const newPlanText = newPlan.toText()
            workingConversation.push({
              role: "user",
              content: `План пересмотрен после провала шага "${failedStep.description}". Новый план:\n\n${newPlanText}`,
              timestamp: Date.now(),
            })
            this.addToMemory(workingConversation[workingConversation.length - 1])

            continue
          }
        }

        recoveryAttempts++
        const failedNames = failedTools?.map((t) => t.name).join(", ") ?? "неизвестно"
        workingConversation.push({
          role: "user",
          content: `Внимание: инструменты ${failedNames} завершены с ошибкой. Проанализируйте ошибки выше и попробуйте выполнить задачу другим способом. Вы можете: повторить вызов с другими аргументами, использовать другой инструмент, или завершить задачу с описанием ошибки.`,
          timestamp: Date.now(),
        })
        this.addToMemory(workingConversation[workingConversation.length - 1])

        continue
      }

      // Инструменты выполнены успешно — продолжить цикл
      continue
    }

    return {
      role: "assistant",
      content: "Достигнуто максимальное число итераций. Операция может быть незавершённой.",
      timestamp: Date.now(),
    }
  }
}
