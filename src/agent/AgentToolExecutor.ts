import type { IBackend, ChatMessage } from "../core/IBackend"
import type { ToolRegistry } from "../tools/ToolRegistry"
import type { PermissionManager } from "../services/permission/PermissionManager"
import type { AgentModeManager } from "./AgentMode"
import type { AgentModeName } from "./AgentMode"
import type { AgentTurnResult, ToolCall, ToolResult } from "./AgentTypes"
import { AgentMemory } from "./AgentMemory"
import type { SessionContext } from "./SessionContext"
import type { TodoStore } from "./TodoStore"

export class AgentToolExecutor {
  constructor(
    private readonly backend: IBackend,
    private readonly toolRegistry: ToolRegistry,
    private readonly permissionManager: PermissionManager | null,
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

  async executeToolCalls(
    toolCalls: ToolCall[],
    currentMode: AgentModeName,
    workingConversation: ChatMessage[],
    signal?: AbortSignal,
    onToolUse?: (name: string, args: Record<string, unknown>) => void,
    onToolResult?: (name: string, result: ToolResult) => void,
  ): Promise<{ anyFailed: boolean }> {
    let anyFailed = false

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

      const resolvedArgs = this.resolveArgs(tc.toolName, tc.arguments)

      onToolUse?.(tc.toolName, resolvedArgs)

      const toolResult = await this.toolRegistry.invoke(tc.toolName, resolvedArgs)
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

    return { anyFailed }
  }

  private resolveArgs(toolName: string, args: Record<string, unknown>): Record<string, unknown> {
    if (toolName === "todowrite" && this.todoStore) {
      return { ...args, _todoStore: this.todoStore }
    }
    return args
  }

  private extractToolCalls(content: string): ToolCall[] | null {
    const calls: ToolCall[] = []

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
