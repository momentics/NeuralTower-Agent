import type { ITool } from "../tools/ITool"
import type { IToolRegistry } from "../tools/ToolRegistry"
import { MCPToolAdapter } from "./MCPToolAdapter"
import { ExecutionError, TimeoutError, errorMessage } from "../core/Errors"
import { createDomainLogger } from "../core/Logger"
import type { IMCPTransport } from "./MCPTransport"
import { StdioMCPTransport, MCP_TRANSPORT_EVENTS } from "./MCPTransport"

const log = createDomainLogger("MCP")

const MCP_REQUEST_TIMEOUT_MS = 10000

/** Конфигурация MCP-сервера для подключения. */
export interface IMCPServerConfig {
  name: string
  transport: "stdio" | "http"
  command: string
  args?: string[]
  env?: Record<string, string>
}

/** Описание инструмента, обнаруженного на MCP-сервере. */
export interface IMCPTool {
  name: string
  description: string
  schema: Record<string, unknown>
}

interface IPendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
}

interface IMCPServer {
  config: IMCPServerConfig
  ready: boolean
  transport: IMCPTransport | null
 tools: IMCPTool[]
  nextRequestId: number
  pendingRequests: Map<number, IPendingRequest> | null
}

/**
 * Интерфейс MCPManager — методы, используемые через IAgentDependencies.
 */
export interface IMCPManager {
 register(config: IMCPServerConfig): void
  connect(): Promise<void>
 discover(): Promise<IMCPTool[]>
  callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<{ output: string; success: boolean }>
  syncWithRegistry(registry: IToolRegistry): Promise<void>
 listServers(): IMCPServerConfig[]
  getReadyServers(): string[]
 getToolsByServer(): Array<{ server: string; tools: IMCPTool[] }>
  disconnect(): Promise<void>
}

/**
 * Создать транспорт для конфигурации сервера.
 * Для добавления нового типа транспорта достаточно расширить switch (KISS).
 */
function createTransport(config: IMCPServerConfig): IMCPTransport | null {
  switch (config.transport) {
    case "stdio":
      return new StdioMCPTransport(config)
    default:
      log.error(`Неподдерживаемый транспорт: ${config.transport}`)
      return null
  }
}

export class MCPManager implements IMCPManager {
  private servers: IMCPServer[] = []
  private toolAdapter = new MCPToolAdapter()

  register(config: IMCPServerConfig): void {
    this.servers.push({
      config,
      ready: false,
      transport: null,
      tools: [],
      nextRequestId: 0,
      pendingRequests: null,
    })
  }

  async connect(): Promise<void> {
    for (const server of this.servers) {
      const transport = createTransport(server.config)
      if (!transport) {
        server.ready = false
        continue
      }

      server.transport = transport
      server.ready = true
      server.nextRequestId = 0
      server.pendingRequests = new Map()

      transport.on(MCP_TRANSPORT_EVENTS.message, (data: string) => {
        const pending = server.pendingRequests
        if (!pending) return
        try {
          const resp = JSON.parse(data) as { id: number; result?: unknown; error?: { message: string } }
          const req = pending.get(resp.id)
          if (req) {
            pending.delete(resp.id)
            if (resp.error) {
              req.reject(new ExecutionError(resp.error.message))
            } else {
              req.resolve(resp.result)
            }
          }
        } catch (err: unknown) {
          const msg = errorMessage(err)
          log.error(`Ошибка разбора MCP-ответа: ${msg}`)
          for (const req of pending.values()) {
            req.reject(new ExecutionError(`Некорректный MCP-ответ: ${msg}`))
          }
          pending.clear()
        }
      })

      transport.on(MCP_TRANSPORT_EVENTS.error, () => {
        server.ready = false
      })

      transport.on(MCP_TRANSPORT_EVENTS.close, () => {
        server.ready = false
        server.transport = null
        const pending = server.pendingRequests
        if (pending) {
          for (const req of pending.values()) {
            req.reject(new ExecutionError("MCP-процесс завершил работу"))
          }
          pending.clear()
        }
        server.pendingRequests = null
      })

      try {
        await transport.connect()
      } catch (err: unknown) {
        const msg = errorMessage(err)
        log.error(`MCP-сервер недоступен: ${msg}`)
        server.ready = false
      }
    }
  }

  async discover(): Promise<IMCPTool[]> {
    const all: IMCPTool[] = []
    for (const server of this.servers) {
      if (!server.ready || !server.transport) continue
      try {
        const result = await this.sendJSONRPC<Record<string, unknown>>(server, "tools/list", {})
        if (result && typeof result === "object" && Array.isArray((result as Record<string, unknown>).tools)) {
          server.tools = (result as unknown as { tools: IMCPTool[] }).tools
          all.push(...server.tools)
        }
      } catch (err: unknown) {
        const msg = errorMessage(err)
        log.error(`MCP-сервер не поддерживает tools/list: ${msg}`)
      }
    }
    return all
  }

  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{ output: string; success: boolean }> {
    const server = this.servers.find((s) => s.config.name === serverName)
    if (!server || !server.ready || !server.transport) {
      return { output: `MCP-сервер "${serverName}" недоступен`, success: false }
    }
    try {
      const result = await this.sendJSONRPC<Record<string, unknown>>(server, "tools/call", {
        name: toolName,
        arguments: args,
      })
      if (result && typeof result === "object") {
        const r = result as Record<string, unknown>
        if (Array.isArray(r.content)) {
          const texts = r.content
            .filter((c: unknown) => typeof c === "object" && c !== null && "text" in c)
            .map((c: Record<string, unknown>) => String(c.text ?? ""))
          return { output: texts.join("\n"), success: !(r.isError as boolean) }
        }
      }
      return { output: "Содержимое не возвращено", success: true }
    } catch (err: unknown) {
      return {
        output: `Вызов MCP-инструмента не выполнен: ${errorMessage(err)}`,
        success: false,
      }
    }
  }

  async syncWithRegistry(registry: IToolRegistry): Promise<void> {
    for (const server of this.servers) {
      if (!server.ready || !server.transport) continue
      registry.registerMany(
        this.toolAdapter.adaptAll(server.tools, server.config.name, this.callTool.bind(this)),
      )
    }
  }

  listServers(): IMCPServerConfig[] {
    return this.servers.map((s) => s.config)
  }

  getReadyServers(): string[] {
    return this.servers.filter((s) => s.ready).map((s) => s.config.name)
  }

  getToolsByServer(): Array<{ server: string; tools: IMCPTool[] }> {
    return this.servers
      .filter((s) => s.ready)
      .map((s) => ({ server: s.config.name, tools: s.tools }))
  }

  async disconnect(): Promise<void> {
    for (const server of this.servers) {
      if (server.transport) {
        server.transport.removeAllListeners()
        server.transport.close()
        server.transport = null
      }
      server.ready = false
      server.tools = []
      if (server.pendingRequests) {
        for (const req of server.pendingRequests.values()) {
          req.reject(new ExecutionError("MCP-сервер отключён"))
        }
        server.pendingRequests.clear()
        server.pendingRequests = null
      }
    }
  }

  // ── Приватные методы ────────────────────────────────────

  private sendJSONRPC<T>(
    server: IMCPServer,
    method: string,
    params: Record<string, unknown>,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const transport = server.transport
      if (!transport || !transport.isConnected()) {
        reject(new ExecutionError("Сервер не подключён"))
        return
      }

      const pending = server.pendingRequests
      if (!pending) {
        reject(new ExecutionError("Сервер не инициализирован"))
        return
      }

      const id = ++server.nextRequestId
      const request = JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params,
      }) + "\n"

      let timer: ReturnType<typeof setTimeout> | undefined

      pending.set(id, {
        resolve: (value: unknown) => {
          if (timer !== undefined) {
            clearTimeout(timer)
            timer = undefined
          }
          resolve(value as T)
        },
        reject: (reason: Error) => {
          if (timer !== undefined) {
            clearTimeout(timer)
            timer = undefined
          }
          reject(reason)
        },
      })

      timer = setTimeout(() => {
        const req = pending.get(id)
        if (req) {
          pending.delete(id)
          req.reject(new TimeoutError(`MCP ${method}: истёк таймаут`))
        }
      }, MCP_REQUEST_TIMEOUT_MS)

      try {
        transport.send(request)
      } catch (err: unknown) {
        if (timer !== undefined) {
          clearTimeout(timer)
          timer = undefined
        }
        pending.delete(id)
        reject(err as Error)
      }
    })
  }
}
