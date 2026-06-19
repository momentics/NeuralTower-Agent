import type { IBackend, ChatMessage } from "../core/IBackend"
import type { ISkill } from "../skills/ISkill"
import type { AgentTurnResult, ToolResult } from "./AgentTypes"
import { AgentMemory } from "./AgentMemory"
import type { AgentModeManager } from "./AgentMode"
import type { AgentModeName } from "./AgentMode"
import { Compactor } from "./Compactor"
import type { SessionContext } from "./SessionContext"
import type { Plan } from "./Plan"
import type { AgentContextBuilder } from "./AgentContextBuilder"
import type { AgentToolExecutor } from "./AgentToolExecutor"
import type { AgentPlanner } from "./AgentPlanner"
import { AbortError } from "../core/errors"
import { loadDefaultAgentConfig } from "../core/config"

export class AgentLoop {
  private readonly maxIterations: number
  private readonly maxRecoveryAttempts: number
  private readonly replanOnFailure: boolean
  private readonly maxReplanAttempts: number
  private readonly maxCompactions: number

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
    onToolResult?: (name: string, result: { output: string; success: boolean }) => void,
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

    let iterations = 0
    let recoveryAttempts = 0
    let compactionCount = 0

    while (iterations < this.maxIterations) {
      iterations++

      if (signal?.aborted) {
        throw new AbortError("Task aborted")
      }

      // Периодическая компактизация контекста перед каждым вызовом бэкенда
      const compactionResult = await this.compactor.compactIfNeeded(
        workingConversation.slice(1),
        systemPrompt,
      )

      if (compactionResult.needsCompaction && compactionResult.compactedHistory) {
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
          ...compactionResult.compactedHistory,
        ]

        onCompaction?.(compactionResult.tokensBefore, compactionResult.tokensAfter)

        // Синхронизация памяти после компактизации
        this.memory.restoreFromMessages(workingConversation.slice(1))

        if (this.sessionContext) {
          this.sessionContext.replaceMessages(workingConversation.slice(1))
        }
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

      const result = await this.toolExecutor.callBackend(workingConversation, onChunk, signal)

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

          const currentPlan = this.planner.getPlan()
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
        const currentPlan = this.planner.getPlan()
        if (currentPlan && currentPlan.status === "running") {
          currentPlan.markRunning()
        }

        const { anyFailed, failedTools } = await this.toolExecutor.executeToolCalls(
          result.toolCalls,
          currentMode,
          workingConversation,
          signal,
          onToolUse,
          onToolResult,
        )

        if (currentPlan) {
          if (anyFailed) {
            currentPlan.markFailed("Инструмент вернул ошибку")
          } else {
            currentPlan.markDone()
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

              if (this.sessionContext) {
                this.sessionContext.pushMessage(workingConversation[workingConversation.length - 1])
              }

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

          if (this.sessionContext) {
            this.sessionContext.pushMessage(workingConversation[workingConversation.length - 1])
          }

          continue
        }

        // Инструменты выполнены успешно — продолжить цикл
        continue
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
}
