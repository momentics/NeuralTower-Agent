import type { ITool, ToolSchema, ToolParam } from "../tools/ITool"
import type { ToolResult } from "../agent/AgentTypes"

export interface MCPToolDefinition {
  name: string
  description: string
  schema: Record<string, unknown>
}

export type CallToolFn = (
  serverName: string,
  toolName: string,
  args: Record<string, unknown>,
) => Promise<{ output: string; success: boolean }>

/**
 * Адаптер инструментов MCP к интерфейсу ITool.
 * Инструменты MCP работают удалённо; этот адаптер оборачивает
 * их в локальный прокси, пересылающий вызовы на MCP-сервер.
 */
export class MCPToolAdapter {
  /**
   * Преобразовать определение MCPTool в экземпляр ITool.
   */
  adapt(
    mcpTool: MCPToolDefinition,
    serverName: string,
    callToolFn: CallToolFn,
  ): ITool {
    const fullName = `${serverName}:${mcpTool.name}`
    return {
      name: fullName,
      description: mcpTool.description || `MCP-инструмент из ${serverName}`,
      category: "mcp",
      schema: this.toSchema(mcpTool, serverName),
      isSafe: true,
      execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
        const start = Date.now()
        const result = await callToolFn(serverName, mcpTool.name, args)
        return {
          output: result.output,
          success: result.success,
          durationMs: Date.now() - start,
        }
      },
    }
  }

  /** Адаптировать несколько инструментов MCP. */
  adaptAll(
    mcpTools: MCPToolDefinition[],
    serverName: string,
    callToolFn: CallToolFn,
  ): ITool[] {
    return mcpTools.map((t) => this.adapt(t, serverName, callToolFn))
  }

  private toSchema(tool: MCPToolDefinition, serverName: string): ToolSchema {
    const params: Record<string, ToolParam> = {}
    if (tool.schema && typeof tool.schema === "object" && "inputSchema" in tool.schema) {
      const inputSchema = tool.schema.inputSchema as Record<string, unknown>
      if (inputSchema && typeof inputSchema === "object") {
        const props = (inputSchema.properties as Record<string, { type: string; description?: string; enum?: string[] }>) ?? {}
        for (const [k, p] of Object.entries(props)) {
          params[k] = {
            type: p.type as ToolParam["type"],
            description: typeof p.description === "string" ? p.description : undefined,
            enum: Array.isArray(p.enum) ? p.enum : undefined,
          }
        }
      }
    }
    return {
      name: `${serverName}:${tool.name}`,
      description: tool.description || "",
      parameters: params,
      required: [],
    }
  }
}
