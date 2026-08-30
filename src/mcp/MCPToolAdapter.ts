import type { ITool, IToolSchema, IToolParam } from "../tools/ITool"
import type { IToolResult } from "../agent/AgentTypes"
import { sanitizeToolName } from "../tools/ToolNames"

export interface IMCPToolDefinition {
  name: string
  description: string
  schema: Record<string, unknown>
}

/** Определение инструмента ntgraph. */
export interface INtGraphToolDefinition {
  name: string
  description: string
  inputSchema: {
    type: "object"
    properties: Record<string, { type: string; description: string; default?: unknown; enum?: string[] }>
    required?: string[]
  }
}

export type CallToolFn = (
  serverName: string,
  toolName: string,
  args: Record<string, unknown>,
) => Promise<{ output: string; success: boolean }>

type ToolParamType = "string" | "number" | "boolean" | "array" | "object"

const VALID_TOOL_PARAM_TYPES = new Set<ToolParamType>(["string", "number", "boolean", "array", "object"])

/** Безопасно преобразовать строку к типу IToolParam["type"]. */
function safeToolParamType(raw: unknown): ToolParamType {
  if (typeof raw === "string" && VALID_TOOL_PARAM_TYPES.has(raw as ToolParamType)) {
    return raw as ToolParamType
  }
  return "string"
}

/**
 * Адаптер инструментов MCP к интерфейсу ITool.
 * Инструменты MCP работают удалённо; этот адаптер оборачивает
 * их в локальный прокси, пересылающий вызовы на MCP-сервер.
 *
 * По умолчанию MCP-инструменты считаются небезопасными (isSafe: false),
 * что требует явного разрешения пользователя для каждого вызова.
 */
export class MCPToolAdapter {
  /**
   * Преобразовать определение IMCPToolDefinition в экземпляр ITool.
   */
  adapt(
    mcpTool: IMCPToolDefinition,
    serverName: string,
    callToolFn: CallToolFn,
  ): ITool {
    const fullName = sanitizeToolName(`${serverName}_${mcpTool.name}`)
    return {
      name: fullName,
      description: mcpTool.description || `MCP-инструмент из ${serverName}`,
      category: "mcp",
      schema: this.toSchema(mcpTool, serverName),
      isSafe: false,
      execute: async (args: Record<string, unknown>, _signal?: AbortSignal): Promise<IToolResult> => {
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
    mcpTools: IMCPToolDefinition[],
    serverName: string,
    callToolFn: CallToolFn,
  ): ITool[] {
    return mcpTools.map((t) => this.adapt(t, serverName, callToolFn))
  }

  /** Адаптировать инструмент ntgraph к ITool. */
  adaptNtGraphTool(
    toolDef: INtGraphToolDefinition,
    callToolFn: CallToolFn,
  ): ITool {
    const fullName = sanitizeToolName(toolDef.name)
    return {
      name: fullName,
      description: toolDef.description,
      category: "ntgraph",
      schema: this.toNtGraphSchema(toolDef),
      isSafe: true,
      execute: async (args: Record<string, unknown>, _signal?: AbortSignal): Promise<IToolResult> => {
        const start = Date.now()
        const result = await callToolFn("ntgraph", toolDef.name, args)
        return {
          output: result.output,
          success: result.success,
          durationMs: Date.now() - start,
        }
      },
    }
  }

  /** Адаптировать несколько инструментов ntgraph. */
  adaptNtGraphAll(
    toolDefs: INtGraphToolDefinition[],
    callToolFn: CallToolFn,
  ): ITool[] {
    return toolDefs.map((t) => this.adaptNtGraphTool(t, callToolFn))
  }

  private toNtGraphSchema(tool: INtGraphToolDefinition): IToolSchema {
    const params: Record<string, IToolParam> = {}
    const props = tool.inputSchema.properties
    for (const [k, p] of Object.entries(props)) {
      params[k] = {
        type: safeToolParamType(p.type),
        description: p.description,
        enum: p.enum,
        default: p.default,
      }
    }
    return {
      name: sanitizeToolName(tool.name),
      description: tool.description,
      parameters: params,
      required: tool.inputSchema.required,
    }
  }

  private toSchema(tool: IMCPToolDefinition, serverName: string): IToolSchema {
    const params: Record<string, IToolParam> = {}
    if (tool.schema && typeof tool.schema === "object" && "inputSchema" in tool.schema) {
      const inputSchema = tool.schema.inputSchema as Record<string, unknown>
      if (inputSchema && typeof inputSchema === "object") {
        const props = (inputSchema.properties as Record<string, { type?: unknown; description?: unknown; enum?: unknown }>) ?? {}
        for (const [k, p] of Object.entries(props)) {
          params[k] = {
            type: safeToolParamType(p.type),
            description: typeof p.description === "string" ? p.description : undefined,
            enum: Array.isArray(p.enum) ? p.enum : undefined,
          }
        }
      }
    }
    return {
      name: sanitizeToolName(`${serverName}_${tool.name}`),
      description: tool.description || "",
      parameters: params,
      required: [],
    }
  }
}
