import type { IBackend, IChatMessage, IToolCall as BackendToolCall } from "../core/IBackend"
import type { IToolRegistry } from "../tools/ToolRegistry"
import type { IPermissionManager } from "../services/permission/PermissionManager"
import type { AgentModeManager } from "./AgentMode"
import type { AgentModeName } from "./AgentMode"
import type { IAgentTurnResult, IAgentToolCall, IToolResult } from "./AgentTypes"
import { AbortError, errorMessage } from "../core/Errors"
import { createDomainLogger } from "../core/Logger"
import { extractJsonBlocks } from "../utils/ExtractJsonBlocks"

const log = createDomainLogger("AgentToolExecutor")

export class AgentToolExecutor {
  constructor(
    private readonly backend: IBackend,
    private readonly toolRegistry: IToolRegistry,
    private readonly permissionManager: IPermissionManager | null,
    private readonly modeManager: AgentModeManager,
  ) {}

  async callBackend(
    conversation: IChatMessage[],
    onChunk: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<IAgentTurnResult> {
    if (signal?.aborted) {
      throw new AbortError("Задача прервана")
    }

    const wrappedChunk = (text: string) => {
      if (signal?.aborted) return
      onChunk(text)
    }

    const tools = this.toolRegistry.toToolDefinitions()

    const msg = await this.backend.chat(conversation, wrappedChunk, tools)
    const content = msg.content

    if (msg.toolCalls && msg.toolCalls.length > 0) {
      const parsed = parseBackendToolCalls(msg.toolCalls)
      if (parsed && parsed.length > 0) {
        return { type: "tool_calls", toolCalls: parsed }
      }
    }

    const toolCalls = this.extractToolCalls(content)
    if (toolCalls && toolCalls.length > 0) {
      return { type: "tool_calls", toolCalls }
    }

    return { type: "text", content }
  }

  async executeToolCalls(
    toolCalls: IAgentToolCall[],
    currentMode: AgentModeName,
    workingConversation: IChatMessage[],
    signal?: AbortSignal,
    onToolUse?: (name: string, args: Record<string, unknown>) => void,
    onToolResult?: (name: string, result: IToolResult) => void,
  ): Promise<{ anyFailed: boolean; failedTools?: { name: string; error: string }[] }> {
    let anyFailed = false
    const failedTools: { name: string; error: string }[] = []

    for (const tc of toolCalls) {
      const modePerm = this.modeManager.checkToolPermission(tc.toolName)

      if (modePerm === "deny") {
        this.recordBlockedTool(
          tc.toolName, tc.arguments, workingConversation,
          `ЗАБЛОКИРОВАНО режимом ${currentMode}`,
          `режим ${currentMode} запрещает ${tc.toolName}`,
          onToolUse,
        )
        anyFailed = true
        failedTools.push({ name: tc.toolName, error: `Режим ${currentMode} запрещает вызов` })
        continue
      }

      const tool = this.toolRegistry.get(tc.toolName)

      if (this.permissionManager && tool && modePerm !== "allow") {
        const allowed = await this.permissionManager.checkPermission(tool, tc.arguments)
        if (!allowed) {
          this.recordBlockedTool(
            tc.toolName, tc.arguments, workingConversation,
            "ЗАБЛОКИРОВАНО политикой разрешений",
            "отказано в доступе",
            onToolUse,
          )
          anyFailed = true
          failedTools.push({ name: tc.toolName, error: "Отказано в доступе" })
          continue
        }
      }

      const resolvedArgs = this.resolveArgs(tc.toolName, tc.arguments)

      onToolUse?.(tc.toolName, resolvedArgs)

      let toolResult: IToolResult

      try {
        toolResult = await this.toolRegistry.invoke(tc.toolName, resolvedArgs, signal)
      } catch (err: unknown) {
        const msg = errorMessage(err)
        toolResult = { output: `Ошибка выполнения: ${msg}`, success: false }
      }

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

      if (!toolResult.success) {
        anyFailed = true
        failedTools.push({ name: tc.toolName, error: toolResult.output })
      }
    }

    return { anyFailed, failedTools: anyFailed ? failedTools : undefined }
  }

  private recordBlockedTool(
    toolName: string,
    args: Record<string, unknown>,
    conversation: IChatMessage[],
    blockReason: string,
    blockedTag: string,
    onToolUse?: (name: string, args: Record<string, unknown>) => void,
  ): void {
    onToolUse?.(toolName, { ...args, _blocked: blockedTag })
    conversation.push({
      role: "assistant",
      content: `Вызов инструмента: ${toolName} — ${blockReason}`,
      timestamp: Date.now(),
    })
  }

  private resolveArgs(_toolName: string, args: Record<string, unknown>): Record<string, unknown> {
    return args
  }

 private extractToolCalls(content: string): IAgentToolCall[] | null {
 const calls: IAgentToolCall[] = []

    const jsonBlocks = extractJsonBlocks(content)

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
      } catch (err: unknown) {
        const msg = errorMessage(err)
        log.error(`Некорректные данные вызова инструмента: ${msg}`)
      }
    }

    return calls.length > 0 ? calls : null
  }
}

/**
 * Преобразовать нативные tool_calls из бэкенда в формат AgentToolExecutor.
 */
function parseBackendToolCalls(backendCalls: BackendToolCall[]): IAgentToolCall[] | null {
  const calls: IAgentToolCall[] = []
  for (const bc of backendCalls) {
    let args: Record<string, unknown> = {}
    try {
      args = JSON.parse(bc.arguments) as Record<string, unknown>
    } catch (err: unknown) {
      const msg = errorMessage(err)
      log.error(`Невалидный JSON аргументов: ${msg}`)
      continue
    }
    calls.push({
      toolName: bc.toolName,
      arguments: args,
    })
  }
  return calls.length > 0 ? calls : null
}
