import type { IBackend, IChatMessage } from "../core/IBackend"
import type { ISkill } from "../skills/ISkill"
import type { IAgentTurnResult, IToolResult } from "./AgentTypes"
import { AgentMemory } from "./AgentMemory"
import type { AgentModeManager } from "./AgentMode"
import type { AgentModeName } from "./AgentMode"
import { Compactor, type ICompactionResult } from "./Compactor"
import type { SessionContext } from "./SessionContext"
import type { Plan } from "./Plan"
import type { AgentContextBuilder } from "./AgentContextBuilder"
import type { AgentToolExecutor } from "./AgentToolExecutor"
import type { AgentPlanner } from "./AgentPlanner"
import { AbortError, errorMessage } from "../core/Errors"
import { loadDefaultAgentConfig } from "../core/Config"
import { createDomainLogger } from "../core/Logger"
import type { ISnapshotService, ISnapshotPatch } from "../services/snapshot/SnapshotTypes"

const log = createDomainLogger("AgentLoop")

const PLAN_STEP_RESULT_MAX_CHARS = 500
const DEFAULT_MAX_COMPACTIONS = 5
const MAX_COMPACTIONS_ERROR = Symbol("MAX_COMPACTIONS")

export interface IAgentLoopConfig {
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
  private readonly snapshot: ISnapshotService | null

  private pushSessionMessage(msg: IChatMessage): void {
    if (this.sessionContext) {
      this.sessionContext.pushMessage(msg)
    }
  }

  /** Добавить сообщение в память и контекст сессии. */
  private addToMemory(msg: IChatMessage): void {
    this.memory.add(msg)
    this.pushSessionMessage(msg)
  }

  /** Попытка компактизации с обработкой ошибок. */
  private async tryCompact(
    messages: IChatMessage[],
    systemPrompt: string,
  ): Promise<ICompactionResult> {
    const emptyResult: ICompactionResult = { needsCompaction: false, tokensBefore: 0, tokensAfter: 0 }
    try {
      return await this.compactor.compactIfNeeded(messages.slice(1), systemPrompt)
    } catch (err: unknown) {
      log.warn(`Компактизация не выполнена: ${errorMessage(err)}`)
      return emptyResult
    }
  }

  /** Применение результата компактизации к рабочему контексту. */
  private applyCompaction(
    result: ICompactionResult,
    systemPrompt: string,
  ): IChatMessage[] | null {
    if (result.needsCompaction && result.compactedHistory) {
      return [
        { role: "system", content: systemPrompt, timestamp: Date.now() },
        ...result.compactedHistory,
      ]
    }
    return null
  }

  /**
   * Выполнить компактизацию в цикле: попытаться компактировать, применить результат,
   * синхронизировать память и контекст сессии.
   * @returns true если компактизация была применена
   */
  private async tryLoopCompact(
    conversation: IChatMessage[],
    systemPrompt: string,
    compactionCount: number,
    onCompaction?: (tokensBefore: number, tokensAfter: number) => void,
  ): Promise<{ compacted: boolean; conversation: IChatMessage[] }> {
    const loopCompactionResult = await this.tryCompact(conversation, systemPrompt)
    const compactedConversation = this.applyCompaction(loopCompactionResult, systemPrompt)

    if (!compactedConversation) {
      return { compacted: false, conversation }
    }

    if (compactionCount >= this.maxCompactions) {
      throw MAX_COMPACTIONS_ERROR
    }

    // Синхронизация памяти после компактизации
    this.memory.restoreFromMessages(compactedConversation.slice(1))
    this.sessionContext?.replaceMessages(compactedConversation.slice(1))

    onCompaction?.(loopCompactionResult.tokensBefore ?? 0, loopCompactionResult.tokensAfter ?? 0)

    return { compacted: true, conversation: compactedConversation }
  }

  /**
   * Встроить шаг плана в разговор, если план активен и текущий шаг ожидает выполнения.
   */
  private injectPlanStep(
    conversation: IChatMessage[],
    plan: Plan | null,
  ): void {
    if (!plan || plan.status !== "running") return
    const step = plan.currentStep
    if (!step || step.status !== "pending") return

    conversation.push({
      role: "user",
      content: `Выполнить шаг ${plan.currentStepIndex + 1}: ${step.description}${
        step.suggestedTools.length ? ` (предлагаемые инструменты: ${step.suggestedTools.join(", ")})` : ""
      }`,
      timestamp: Date.now(),
    })
  }

  /** Сохранить активный план на диск (статус меняется после каждого хода). */
  private async persistActivePlan(): Promise<void> {
    const plan = this.planner.getPlan()
    if (!plan) return
    if (this.sessionContext) {
      plan.sessionId = this.sessionContext.sessionID
    }
    await this.planner.persistPlan()
  }

  /**
   * Выполнить один ход: вызвать бэкенд, обработать ответ (текст или инструменты).
   */
  private async executeTurn(
    conversation: IChatMessage[],
    currentMode: AgentModeName,
    onChunk: (text: string) => void,
    signal?: AbortSignal,
    onToolUse?: (name: string, args: Record<string, unknown>, id: string) => void,
    onToolResult?: (name: string, result: IToolResult, id: string) => void,
  ): Promise<{
    type: "text" | "tool_calls" | "error"
    content?: string
    anyFailed?: boolean
    failedTools?: { name: string; error: string }[]
    plan?: Plan | null
    /** Оригинальный объект ошибки (для type: "error"). */
    error?: unknown
  }> {
    let currentPlan: Plan | null = null

    // Сбой бэкенда — отдельный catch: он не восстанавливается повторными
    // итерациями и должен немедленно дойти до UI (D10).
    let result: IAgentTurnResult
    try {
      result = await this.toolExecutor.callBackend(conversation, onChunk, signal)
    } catch (err: unknown) {
      // Отмена пользователем — пробрасываем как есть (не ошибка бэкенда).
      if (err instanceof AbortError) throw err
      if (err instanceof DOMException && err.name === "AbortError") throw new AbortError()
      const msg = errorMessage(err)
      log.error(`Ошибка бэкенда: ${msg}`)
      currentPlan = this.planner.getPlan()
      if (currentPlan) {
        currentPlan.markFailed(msg)
      }
      await this.persistActivePlan()
      return {
        type: "error",
        anyFailed: true,
        failedTools: [{ name: "backend", error: msg }],
        plan: currentPlan,
        error: err,
      }
    }

    try {
      if (result.type === "text") {
        if (result.content) {
          conversation.push({
            role: "assistant",
            content: result.content,
            timestamp: Date.now(),
          })
          this.addToMemory(conversation[conversation.length - 1])

          currentPlan = this.planner.getPlan()
          if (currentPlan && currentPlan.status === "running") {
            currentPlan.markDone(result.content.slice(0, PLAN_STEP_RESULT_MAX_CHARS))
          }
          await this.persistActivePlan()

          return { type: "text", content: result.content, plan: currentPlan }
        }
      }

      if (result.type === "tool_calls" && result.toolCalls) {
        currentPlan = this.planner.getPlan()
        if (currentPlan && currentPlan.status === "running") {
          currentPlan.markRunning()
        }

        const convLenBefore = conversation.length
        const toolResult = await this.toolExecutor.executeToolCalls(
          result.toolCalls,
          currentMode,
          conversation,
          result.content,
          signal,
          onToolUse,
          onToolResult,
        )

        // Синхронизация: добавить сообщения вызовов инструментов в память
        for (let i = convLenBefore; i < conversation.length; i++) {
          this.addToMemory(conversation[i])
        }

        if (currentPlan) {
          if (toolResult.anyFailed) {
            currentPlan.markFailed("Инструмент вернул ошибку")
          } else {
            currentPlan.markDone()
          }
        }
        await this.persistActivePlan()

        return {
          type: "tool_calls",
          anyFailed: toolResult.anyFailed,
          failedTools: toolResult.failedTools,
          plan: currentPlan,
        }
      }

      return { type: "text", plan: currentPlan }
    } catch (err: unknown) {
      // Сбой выполнения инструментов — не сбой бэкенда: run() направит его
      // в handleTurnFailure, а не в немедленный выход (D10).
      const msg = errorMessage(err)
      log.error(`Ошибка выполнения инструментов: ${msg}`)
      currentPlan = this.planner.getPlan()
      if (currentPlan) {
        currentPlan.markFailed(msg)
      }
      await this.persistActivePlan()
      return {
        type: "error",
        anyFailed: true,
        failedTools: [{ name: "tool_executor", error: msg }],
        plan: currentPlan,
      }
    }
  }

  /**
   * Обработать провал хода: попытка репланирования или добавление сообщения об ошибке.
   */
  private async handleTurnFailure(
    conversation: IChatMessage[],
    anyFailed: boolean,
    failedTools: { name: string; error: string }[] | undefined,
    currentPlan: Plan | null,
    recoveryAttempts: number,
  ): Promise<{
    recoveryAttempts: number
    shouldBreak: boolean
    shouldReplan: boolean
  }> {
    if (!anyFailed) return { recoveryAttempts, shouldBreak: false, shouldReplan: false }

    if (recoveryAttempts >= this.maxRecoveryAttempts) {
      return { recoveryAttempts, shouldBreak: true, shouldReplan: false }
    }

    // Попытка адаптивного репланирования
    if (this.replanOnFailure && currentPlan && currentPlan.currentStep?.status === "failed") {
      const failedStep = currentPlan.currentStep!
      const failedError = failedStep.error ?? "Инструмент вернул ошибку"
      const newPlan = await this.planner.attemptReplan(failedStep, failedError, this.maxReplanAttempts)

      if (newPlan) {
        recoveryAttempts++
        const newPlanText = newPlan.toText()
        conversation.push({
          role: "user",
          content: `План пересмотрен после провала шага "${failedStep.description}". Новый план:\n\n${newPlanText}`,
          timestamp: Date.now(),
        })
        this.addToMemory(conversation[conversation.length - 1])

        return { recoveryAttempts, shouldBreak: false, shouldReplan: true }
      }
    }

    recoveryAttempts++
    const details = failedTools?.map((t) => `${t.name}: ${t.error}`).join("; ") ?? "неизвестно"
    conversation.push({
      role: "user",
      content: `Внимание: ${details}. Проанализируйте ошибки выше и попробуйте выполнить задачу другим способом. Вы можете: повторить вызов с другими аргументами, использовать другой инструмент, или завершить задачу с описанием ошибки.`,
      timestamp: Date.now(),
    })
    this.addToMemory(conversation[conversation.length - 1])

    return { recoveryAttempts, shouldBreak: false, shouldReplan: false }
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
    config: IAgentLoopConfig = {},
    snapshot: ISnapshotService | null = null,
  ) {
    const defaults = loadDefaultAgentConfig()
    this.maxIterations = config.maxIterations ?? defaults.maxIterations
    this.maxRecoveryAttempts = config.maxRecoveryAttempts ?? defaults.maxRecoveryAttempts
    this.replanOnFailure = config.replanOnFailure ?? defaults.replanOnFailure
    this.maxReplanAttempts = config.maxReplanAttempts ?? defaults.maxReplanAttempts
    this.maxCompactions = config.maxCompactions ?? DEFAULT_MAX_COMPACTIONS
    this.snapshot = snapshot
  }

  /**
   * Вычислить патч снимка на пути выхода и уведомить колбэк.
   * Ошибки снапшотов не влияют на результат выполнения.
   */
  private async finishWithSnapshot(
    snapshotHash: string | null,
    onSnapshot?: (patch: ISnapshotPatch | null) => void,
  ): Promise<void> {
    if (!onSnapshot) return
    if (!snapshotHash || !this.snapshot) {
      onSnapshot(null)
      return
    }
    let patch: ISnapshotPatch | null = null
    try {
      patch = await this.snapshot.patch(snapshotHash)
    } catch (err: unknown) {
      log.warn(`Не удалось вычислить изменения запроса: ${errorMessage(err)}`)
    }
    onSnapshot(patch)
  }

  async run(
    query: string,
    activeSkills: ISkill[],
    onChunk: (text: string) => void,
    onToolUse?: (name: string, args: Record<string, unknown>, id: string) => void,
    onToolResult?: (name: string, result: IToolResult, id: string) => void,
    signal?: AbortSignal,
    onCompaction?: (tokensBefore: number, tokensAfter: number) => void,
    onSnapshot?: (patch: ISnapshotPatch | null) => void,
    revertNote?: string,
  ): Promise<IChatMessage> {
    const currentMode = this.modeManager.getModeName()

    let planContext = ""
    const activePlan = this.planner.getPlan()
    if (activePlan) {
      planContext = activePlan.toText()
    }

    let systemPrompt = (await this.contextBuilder.buildSystemPrompt(activeSkills))
      + "\n\n" + this.modeManager.getSystemPromptAddon()
      + (planContext ? "\n\n" + planContext : "")

    if (revertNote) {
      systemPrompt = systemPrompt + "\n\n" + revertNote
    }

    const conversation: IChatMessage[] = [
      { role: "system", content: systemPrompt, timestamp: Date.now() },
      ...this.memory.getRecent(),
      { role: "user", content: query, timestamp: Date.now() },
    ]

    this.addToMemory(conversation[conversation.length - 1])

    const compactionResult = await this.tryCompact(conversation, systemPrompt)
    let workingConversation: IChatMessage[] = this.applyCompaction(compactionResult, systemPrompt) ?? conversation

    // Снимок состояния до начала выполнения (до любого изменения файлов,
    // включая изменения субагентов). Сбой не прерывает запрос.
    let snapshotHash: string | null = null
    if (!signal?.aborted) {
      try {
        snapshotHash = (await this.snapshot?.track()) ?? null
      } catch (err: unknown) {
        log.warn(`Не удалось снять снимок состояния: ${errorMessage(err)}`)
      }
    }

    let iterations = 0
    let recoveryAttempts = 0
    let compactionCount = 0

    while (iterations < this.maxIterations) {
      iterations++

      if (signal?.aborted) {
        throw new AbortError()
      }

      // Периодическая компактизация контекста
      try {
        const compactResult = await this.tryLoopCompact(
          workingConversation, systemPrompt, compactionCount, onCompaction,
        )
        if (compactResult.compacted) {
          compactionCount++
          workingConversation = compactResult.conversation
        }
      } catch (err: unknown) {
        if (err === MAX_COMPACTIONS_ERROR) {
          await this.finishWithSnapshot(snapshotHash, onSnapshot)
          const msg: IChatMessage = {
            role: "assistant",
            content: "Контекст превышает допустимые пределы. Задача может быть незавершённой.",
            timestamp: Date.now(),
          }
          onChunk(msg.content)
          return msg
        }
        throw err
      }

      // Инъекция шага плана
      this.injectPlanStep(workingConversation, this.planner.getPlan())

      // Выполнение хода
      const turn = await this.executeTurn(
        workingConversation, currentMode, onChunk, signal, onToolUse, onToolResult,
      )

      if (turn.type === "text") {
        if (turn.content) {
          await this.finishWithSnapshot(snapshotHash, onSnapshot)
          return workingConversation[workingConversation.length - 1] as IChatMessage
        }
        // Пустой ответ: выход через общий return после цикла
        break
      }

      if (turn.type === "tool_calls") {
        const { anyFailed, failedTools, plan: currentPlan } = turn
        if (!anyFailed) continue

        const recovery = await this.handleTurnFailure(
          workingConversation, anyFailed, failedTools, currentPlan ?? null, recoveryAttempts,
        )
        recoveryAttempts = recovery.recoveryAttempts

        // Выход через общий return после цикла
        if (recovery.shouldBreak) break
        if (recovery.shouldReplan) continue
        continue
      }

      // Ошибка
      const { failedTools, plan: currentPlan, error: turnError } = turn
      if (failedTools?.some((t) => t.name === "backend")) {
        // Сбой бэкенда не восстанавливается повторными итерациями —
        // выходим с оригинальной ошибкой, она дойдёт до UI.
        await this.finishWithSnapshot(snapshotHash, onSnapshot)
        throw turnError instanceof Error ? turnError : new Error(String(turnError ?? "Ошибка бэкенда"))
      }
      const recovery = await this.handleTurnFailure(
        workingConversation, true, failedTools, currentPlan ?? null, recoveryAttempts,
      )
      recoveryAttempts = recovery.recoveryAttempts

      // Выход через общий return после цикла
      if (recovery.shouldBreak) break
    }

    await this.finishWithSnapshot(snapshotHash, onSnapshot)
    const finalMsg: IChatMessage = {
      role: "assistant",
      content: "Достигнуто максимальное число итераций. Операция может быть незавершённой.",
      timestamp: Date.now(),
    }
    onChunk(finalMsg.content)
    return finalMsg
  }
}
