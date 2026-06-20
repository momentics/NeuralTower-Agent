import type { IBackend, ChatMessage, ToolCall as BackendToolCall } from "../core/IBackend"
import type { ToolRegistry } from "../tools/ToolRegistry"
import type { IPermissionManager } from "../services/permission/PermissionManager"
import type { AgentModeManager } from "./AgentMode"
import type { AgentModeName } from "./AgentMode"
import type { AgentTurnResult, AgentToolCall, ToolResult } from "./AgentTypes"
import { AgentMemory } from "./AgentMemory"
import type { SessionContext } from "./SessionContext"
import type { TodoStore } from "./TodoStore"
import { AbortError } from "../core/errors"

export class AgentToolExecutor {
  constructor(
    private readonly backend: IBackend,
    private readonly toolRegistry: ToolRegistry,
    private readonly permissionManager: IPermissionManager | null,
    private readonly modeManager: AgentModeManager,
    private readonly memory: AgentMemory,
    private readonly sessionContext: SessionContext | null,
    private readonly todoStore: TodoStore | null = null,
  ) {}

  async callBackend(
    conversation: ChatMessage[],
    onChunk: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<AgentTurnResult> {
    if (signal?.aborted) {
      throw new AbortError("Task aborted")
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
    toolCalls: AgentToolCall[],
    currentMode: AgentModeName,
    workingConversation: ChatMessage[],
    signal?: AbortSignal,
    onToolUse?: (name: string, args: Record<string, unknown>) => void,
    onToolResult?: (name: string, result: ToolResult) => void,
  ): Promise<{ anyFailed: boolean; failedTools?: { name: string; error: string }[] }> {
    let anyFailed = false
    const failedTools: { name: string; error: string }[] = []

    for (const tc of toolCalls) {
      const modePerm = this.modeManager.checkToolPermission(tc.toolName)

      if (modePerm === "deny") {
        onToolUse?.(tc.toolName, { ...tc.arguments, _blocked: `mode ${currentMode} denies ${tc.toolName}` })
        workingConversation.push({
          role: "assistant",
          content: `Вызов инструмента: ${tc.toolName} — ЗАБЛОКИРОВАНО режимом ${currentMode}`,
          timestamp: Date.now(),
        })
        anyFailed = true
        failedTools.push({ name: tc.toolName, error: `Режим ${currentMode} запрещает вызов` })
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
          failedTools.push({ name: tc.toolName, error: "Отказано в доступе" })
          continue
        }
      }

      const resolvedArgs = this.resolveArgs(tc.toolName, tc.arguments)

      onToolUse?.(tc.toolName, resolvedArgs)

      let toolResult: ToolResult

      try {
        toolResult = await this.toolRegistry.invoke(tc.toolName, resolvedArgs)
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        toolResult = { output: `Ошибка выполнения: ${errorMessage}`, success: false }
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

      this.memory.add(workingConversation[workingConversation.length - 1])

      if (this.sessionContext) {
        this.sessionContext.pushMessage(workingConversation[workingConversation.length - 1])
      }

      if (!toolResult.success) {
        anyFailed = true
        failedTools.push({ name: tc.toolName, error: toolResult.output })
      }
    }

    return { anyFailed, failedTools: anyFailed ? failedTools : undefined }
  }

  private resolveArgs(toolName: string, args: Record<string, unknown>): Record<string, unknown> {
    if (toolName === "todowrite" && this.todoStore) {
      return { ...args, _todoStore: this.todoStore }
    }
    return args
  }

  private extractToolCalls(content: string): AgentToolCall[] | null {
const calls: AgentToolCall[] = []

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
}

/**
 * Преобразовать нативные tool_calls из бэкенда в формат AgentToolExecutor.
 */
function parseBackendToolCalls(backendCalls: BackendToolCall[]): AgentToolCall[] | null {
  const calls: AgentToolCall[] = []
  for (const bc of backendCalls) {
    let args: Record<string, unknown> = {}
    try {
      args = JSON.parse(bc.arguments) as Record<string, unknown>
    } catch {
      // невалидный JSON — пропустить
      continue
    }
    calls.push({
      toolName: bc.toolName,
      arguments: args,
    })
  }
  return calls.length > 0 ? calls : null
}
