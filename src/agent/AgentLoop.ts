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
import { AbortError, errorMessage } from "../core/errors"
import { loadDefaultAgentConfig } from "../core/config"
import { createDomainLogger } from "../core/logger"

const log = createDomainLogger("AgentLoop")

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

  constructor(
    private readonly backend: IBackend,
    private readonly memory: AgentMemory,
    private readonly compactor: Compactor,
    private readonly modeManager: AgentModeManager,
    private readonly sessionContext: SessionContext | null,
    private readonly contextBuilder: AgentContextBuilder,
    private readonly toolExecutor: AgentToolExecutor,
    private readonly planner: AgentPlanner,
    maxIterations?: number,
    maxRecoveryAttempts?: number,
    replanOnFailure?: boolean,
    maxReplanAttempts?: number,
    maxCompactions?: number,
  ) {
    const defaults = loadDefaultAgentConfig()
    this.maxIterations = maxIterations ?? defaults.maxIterations
    this.maxRecoveryAttempts = maxRecoveryAttempts ?? defaults.maxRecoveryAttempts
    this.replanOnFailure = replanOnFailure ?? defaults.replanOnFailure
    this.maxReplanAttempts = maxReplanAttempts ?? defaults.maxReplanAttempts
    this.maxCompactions = maxCompactions ?? 5
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

    this.memory.add(conversation[conversation.length - 1])

    this.pushSessionMessage(conversation[conversation.length - 1])

    let compactionResult: CompactionResult = { needsCompaction: false, tokensBefore: 0, tokensAfter: 0 }

    try {
      compactionResult = await this.compactor.compactIfNeeded(
        conversation.slice(1),
        systemPrompt,
      )
    } catch (err: unknown) {
      log.warn(`Компактизация не выполнена: ${errorMessage(err)}`)
      compactionResult = { needsCompaction: false, tokensBefore: 0, tokensAfter: 0 }
    }

    let workingConversation: ChatMessage[]
    if (compactionResult.needsCompaction && compactionResult.compactedHistory) {
      workingConversation = [
        { role: "system", content: systemPrompt, timestamp: Date.now() },
        ...compactionResult.compactedHistory,
      ]
    } else {
      workingConversation = conversation
    }

    let iterations = 0
    let recoveryAttempts = 0
    let compactionCount = 0

    while (iterations < this.maxIterations) {
      iterations++

      if (signal?.aborted) {
        throw new AbortError()
      }

      // Периодическая компактизация контекста перед каждым вызовом бэкенда
      let loopCompactionResult: CompactionResult = { needsCompaction: false, tokensBefore: 0, tokensAfter: 0 }

      try {
        loopCompactionResult = await this.compactor.compactIfNeeded(
          workingConversation.slice(1),
          systemPrompt,
        )
      } catch (err: unknown) {
 log.warn(`Компактизация не выполнена: ${errorMessage(err)}`)
        loopCompactionResult = { needsCompaction: false, tokensBefore: 0, tokensAfter: 0 }
      }

      if (loopCompactionResult.needsCompaction && loopCompactionResult.compactedHistory) {
        if (compactionCount >= this.maxCompactions) {
          // Слишком много компактизаций — контекст превышает допустимые пределы
          return {
            role: "assistant",
            content: "Контекст превышает допустимые пределы. Задача может быть незавершённой.",
            timestamp: Date.now(),
          }
        }

        compactionCount++
        workingConversation = [
          { role: "system", content: systemPrompt, timestamp: Date.now() },
          ...loopCompactionResult.compactedHistory,
        ]

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
            this.memory.add(workingConversation[workingConversation.length - 1])

            this.pushSessionMessage(workingConversation[workingConversation.length - 1])

            currentPlan = this.planner.getPlan()
            if (currentPlan && currentPlan.status === "running") {
              currentPlan.markDone(result.content.slice(0, 500))
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

          const toolResult = await this.toolExecutor.executeToolCalls(
            result.toolCalls,
            currentMode,
            workingConversation,
            signal,
            onToolUse,
            onToolResult,
          )

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
            this.memory.add(workingConversation[workingConversation.length - 1])

            this.pushSessionMessage(workingConversation[workingConversation.length - 1])

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
        this.memory.add(workingConversation[workingConversation.length - 1])

        this.pushSessionMessage(workingConversation[workingConversation.length - 1])

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
