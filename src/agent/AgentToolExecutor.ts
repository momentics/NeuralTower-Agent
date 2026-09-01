import type { IBackend, IChatMessage, IToolCall as BackendToolCall } from "../core/IBackend"
import type { IToolRegistry } from "../tools/ToolRegistry"
import type { IPermissionManager } from "../services/permission/PermissionManager"
import type { AgentModeManager } from "./AgentMode"
import type { AgentModeName } from "./AgentMode"
import type { IAgentTurnResult, IAgentToolCall, IToolResult } from "./AgentTypes"
import { makeLocalToolCallId } from "./AgentTypes"
import { AbortError, errorMessage } from "../core/Errors"
import { createDomainLogger } from "../core/Logger"
import { extractJsonBlocks } from "../utils/ExtractJsonBlocks"
import type { ToolOutputTruncator } from "../tools/Truncate"

const log = createDomainLogger("AgentToolExecutor")

export class AgentToolExecutor {
  constructor(
    private readonly backend: IBackend,
    private readonly toolRegistry: IToolRegistry,
    private readonly permissionManager: IPermissionManager | null,
    private readonly modeManager: AgentModeManager,
    private readonly truncator: ToolOutputTruncator,
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

    const msg = await this.backend.chat(conversation, wrappedChunk, tools, signal)
    const content = msg.content

    if (msg.toolCalls && msg.toolCalls.length > 0) {
      const parsed = parseBackendToolCalls(msg.toolCalls)
      if (parsed && parsed.length > 0) {
        // Текст модели, пришедший вместе с вызовами, сохраняется в разговор (D24).
        return { type: "tool_calls", toolCalls: parsed, content }
      }
    }

    const toolCalls = this.extractToolCalls(content)
    if (toolCalls && toolCalls.length > 0) {
      return { type: "tool_calls", toolCalls, content }
    }

    return { type: "text", content }
  }

  async executeToolCalls(
    toolCalls: IAgentToolCall[],
    currentMode: AgentModeName,
    workingConversation: IChatMessage[],
    assistantContent?: string,
    signal?: AbortSignal,
    onToolUse?: (name: string, args: Record<string, unknown>, id: string) => void,
    onToolResult?: (name: string, result: IToolResult, id: string) => void,
  ): Promise<{ anyFailed: boolean; failedTools?: { name: string; error: string }[] }> {
    let anyFailed = false
    const failedTools: { name: string; error: string }[] = []

    // Ассистентское сообщение с вызовами — одно на всю пачку (нативный протокол).
    // assistantContent — текст модели, пришедший вместе с вызовами (D24).
    workingConversation.push({
      role: "assistant",
      content: assistantContent ?? "",
      toolCalls: toolCalls.map((tc) => ({
        id: tc.id,
        toolName: tc.toolName,
        arguments: JSON.stringify(tc.arguments),
      })),
      timestamp: Date.now(),
    })

    for (const tc of toolCalls) {
      try {
        const modePerm = this.modeManager.checkToolPermission(tc.toolName)

        if (modePerm === "deny") {
          const reason = `ЗАБЛОКИРОВАНО режимом ${currentMode}: инструмент ${tc.toolName} недоступен в этом режиме.`
          this.recordBlockedTool(tc.toolName, tc.arguments, reason, tc.id, onToolUse)
          workingConversation.push({
            role: "tool", toolCallId: tc.id, name: tc.toolName, content: reason, timestamp: Date.now(),
          })
          anyFailed = true
          failedTools.push({ name: tc.toolName, error: `Режим ${currentMode} запрещает вызов` })
          continue
        }

        const tool = this.toolRegistry.get(tc.toolName)
        if (!tool) {
          const reason = `Инструмент «${tc.toolName}» не найден. Доступные: ${this.toolRegistry.list().map((t) => t.name).join(", ")}`
          this.recordBlockedTool(tc.toolName, tc.arguments, reason, tc.id, onToolUse)
          workingConversation.push({
            role: "tool", toolCallId: tc.id, name: tc.toolName, content: reason, timestamp: Date.now(),
          })
          anyFailed = true
          failedTools.push({ name: tc.toolName, error: reason })
          continue
        }

        if (this.permissionManager && modePerm !== "allow") {
          const allowed = await this.permissionManager.checkPermission(tool, tc.arguments)
          if (!allowed) {
            const reason = "Пользователь отклонил вызов инструмента."
            this.recordBlockedTool(tc.toolName, tc.arguments, reason, tc.id, onToolUse)
            workingConversation.push({
              role: "tool", toolCallId: tc.id, name: tc.toolName, content: reason, timestamp: Date.now(),
            })
            anyFailed = true
            failedTools.push({ name: tc.toolName, error: "Отказано в доступе" })
            continue
          }
        }

        const resolvedArgs = this.resolveArgs(tc.toolName, tc.arguments)

        onToolUse?.(tc.toolName, resolvedArgs, tc.id)

        let toolResult: IToolResult
        try {
          toolResult = await this.toolRegistry.invoke(tc.toolName, resolvedArgs, signal)
        } catch (err: unknown) {
          const msg = errorMessage(err)
          toolResult = { output: `Ошибка выполнения: ${msg}`, success: false }
        }

        const cappedOutput = await this.truncateOutput(toolResult.output, tc.id)
        onToolResult?.(tc.toolName, { ...toolResult, output: cappedOutput }, tc.id)

        workingConversation.push({
          role: "tool",
          toolCallId: tc.id,
          name: tc.toolName,
          content: cappedOutput,
          timestamp: Date.now(),
        })

        if (!toolResult.success) {
          anyFailed = true
          failedTools.push({ name: tc.toolName, error: cappedOutput })
        }
      } catch (err: unknown) {
        // Непредвиденный сбой внутри итерации (например, в менеджере
        // разрешений) не должен оставлять tool_call без tool-ответа:
        // иначе нарушается инвариант нативного протокола и следующий
        // запрос к API завершится ошибкой.
        const msg = errorMessage(err)
        log.error(`Сбой обработки вызова ${tc.toolName}: ${msg}`)
        workingConversation.push({
          role: "tool",
          toolCallId: tc.id,
          name: tc.toolName,
          content: `Ошибка выполнения: ${msg}`,
          timestamp: Date.now(),
        })
        anyFailed = true
        failedTools.push({ name: tc.toolName, error: msg })
      }
    }

    return { anyFailed, failedTools: anyFailed ? failedTools : undefined }
  }

  private recordBlockedTool(
    toolName: string,
    args: Record<string, unknown>,
    blockReason: string,
    id: string,
    onToolUse?: (name: string, args: Record<string, unknown>, id: string) => void,
  ): void {
    onToolUse?.(toolName, { ...args, _blocked: blockReason }, id)
  }

  private resolveArgs(_toolName: string, args: Record<string, unknown>): Record<string, unknown> {
    return args
  }

  /**
   * Обрезать вывод инструмента: длинный вывод сокращается, полный текст
   * сохраняется в файл (модель перечитывает его через read_file).
   */
  private async truncateOutput(output: string, callId: string): Promise<string> {
    return this.truncator.truncate(output, callId)
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
            id: makeLocalToolCallId(),
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
      id: bc.id && bc.id.length > 0 ? bc.id : makeLocalToolCallId(),
      toolName: bc.toolName,
      arguments: args,
    })
  }
  return calls.length > 0 ? calls : null
}
