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
  ) {
    this.maxIterations = maxIterations ?? loadDefaultAgentConfig().maxIterations
    this.maxRecoveryAttempts = maxRecoveryAttempts ?? loadDefaultAgentConfig().maxRecoveryAttempts
  }

  async run(
    query: string,
    activeSkills: ISkill[],
    onChunk: (text: string) => void,
    onToolUse?: (name: string, args: Record<string, unknown>) => void,
    onToolResult?: (name: string, result: { output: string; success: boolean }) => void,
    signal?: AbortSignal,
  ): Promise<ChatMessage> {
    const currentMode = this.modeManager.getModeName()

    const systemPrompt = (await this.contextBuilder.buildSystemPrompt(activeSkills))
      + "\n\n" + this.modeManager.getSystemPromptAddon()

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

    while (iterations < this.maxIterations) {
      iterations++

      if (signal?.aborted) {
        throw new AbortError("Task aborted")
      }

      if (this.planner.getPlan()?.status === "running") {
        const step = this.planner.getPlan()!.currentStep
        if (step && step.status === "pending") {
          workingConversation.push({
            role: "user",
            content: `Выполнить шаг ${this.planner.getPlan()!.currentStepIndex + 1}: ${step.description}${
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

          const plan = this.planner.getPlan()
          if (plan && plan.status === "running") {
            plan.markDone(result.content.slice(0, 500))
            if (plan.status === "running") {
              continue
            }
          }

          return workingConversation[workingConversation.length - 1] as ChatMessage
        }
      }

      if (result.type === "tool_calls" && result.toolCalls) {
        const plan = this.planner.getPlan()
        if (plan && plan.status === "running") {
          plan.markRunning()
        }

        const { anyFailed, failedTools } = await this.toolExecutor.executeToolCalls(
          result.toolCalls,
          currentMode,
          workingConversation,
          signal,
          onToolUse,
          onToolResult,
        )

        if (plan) {
          if (anyFailed) {
            plan.markFailed("Инструмент вернул ошибку")
          } else {
            plan.markDone()
          }
        }

        if (anyFailed) {
          if (recoveryAttempts >= this.maxRecoveryAttempts) {
            break
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
