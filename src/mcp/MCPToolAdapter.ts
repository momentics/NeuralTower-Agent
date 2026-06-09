import type { ITool, ToolSchema } from "../tools/ITool"
import type { ToolResult } from "../agent/AgentTypes"
import type { MCPTool } from "./MCPManager"

/**
 * Адаптер инструментов MCP к интерфейсу ITool.
 * Инструменты MCP работают удалённо; этот адаптер оборачивает
 * их в локальный прокси, пересылающий вызовы на MCP-сервер.
 */
export class MCPToolAdapter {
  /**
   * Преобразовать определение MCPTool в экземпляр ITool.
   */
  adapt(mcpTool: MCPTool): ITool {
    return {
      name: mcpTool.name,
      description: mcpTool.description ?? "MCP-инструмент",
      category: "mcp",
      schema: this.toSchema(mcpTool),
      isSafe: true,
      execute: async (_args: Record<string, unknown>): Promise<ToolResult> => {
        // В полной реализации вызов пересылается на MCP-сервер.
        // Пока возвращается заглушка.
        return {
          output: `MCP-инструмент "${mcpTool.name}" — сервер ещё не подключён`,
          success: false,
        }
      },
    }
  }

  /** Адаптировать несколько инструментов MCP. */
  adaptAll(mcpTools: MCPTool[]): ITool[] {
    return mcpTools.map((t) => this.adapt(t))
  }

  private toSchema(tool: MCPTool): ToolSchema {
    return {
      name: tool.name,
      description: tool.description ?? "",
      parameters: {},
    }
  }
}

// Псевдоним типа для преобразования схем
type ToolParam = {
  type: string
  description?: string
  enum?: string[]
}
