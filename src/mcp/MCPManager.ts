import { spawn, type ChildProcess } from "child_process"
import type { ITool } from "../tools/ITool"
import { ToolRegistry } from "../tools/ToolRegistry"
import { MCPToolAdapter } from "./MCPToolAdapter"
import { ExecutionError, TimeoutError } from "../core/errors"

export interface MCPServerConfig {
  name: string
  transport: "stdio" | "http"
  command: string
  args?: string[]
  env?: Record<string, string>
}

export interface MCPTool {
  name: string
  description: string
  schema: Record<string, unknown>
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
}

interface MCPServer {
  config: MCPServerConfig
  ready: boolean
  process: ChildProcess | null
  tools: MCPTool[]
  nextRequestId: number
  pendingRequests: Map<number, PendingRequest> | null
}

/**
 * Интерфейс MCPManager — методы, используемые через AgentDependencies.
 */
export interface IMCPManager {
  register(config: MCPServerConfig): void
  connect(): Promise<void>
  discover(): Promise<MCPTool[]>
  callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<{ output: string; success: boolean }>
  syncWithRegistry(registry: ToolRegistry): Promise<void>
  listServers(): MCPServerConfig[]
  getReadyServers(): string[]
  getToolsByServer(): Array<{ server: string; tools: MCPTool[] }>
  disconnect(): Promise<void>
}

export class MCPManager implements IMCPManager {
  private servers: MCPServer[] = []
  private toolAdapter = new MCPToolAdapter()

  register(config: MCPServerConfig): void {
    this.servers.push({
      config,
      ready: false,
      process: null,
      tools: [],
      nextRequestId: 0,
      pendingRequests: null,
    })
  }

  async connect(): Promise<void> {
    for (const server of this.servers) {
      if (server.config.transport !== "stdio") continue
      try {
        const env: Record<string, string> = {
          ...(process.env as Record<string, string>),
          ...(server.config.env ?? {}),
        }
        const proc = spawn(server.config.command, server.config.args ?? [], {
          env,
          stdio: ["pipe", "pipe", "pipe"],
        })
        server.process = proc
        server.ready = true
        server.nextRequestId = 0
        server.pendingRequests = new Map()

        if (proc.stdout) {
          proc.stdout.on("data", (data: Buffer) => {
            const pending = server.pendingRequests
            if (!pending) return
            try {
              const resp = JSON.parse(data.toString()) as { id: number; result?: unknown; error?: { message: string } }
              const req = pending.get(resp.id)
              if (req) {
                pending.delete(resp.id)
                if (resp.error) {
                  req.reject(new ExecutionError(resp.error.message))
                } else {
                  req.resolve(resp.result)
                }
              }
            } catch {
              // Игнорировать ошибки разбора для несвязанных данных
            }
          })
        }

        proc.on("error", () => {
          server.ready = false
        })
        proc.on("exit", () => {
          server.ready = false
          server.process = null
          const pending = server.pendingRequests
          if (pending) {
            for (const req of pending.values()) {
              req.reject(new ExecutionError("MCP-процесс завершил работу"))
            }
            pending.clear()
          }
          server.pendingRequests = null
        })
      } catch {
        server.ready = false
      }
    }
  }

  async discover(): Promise<MCPTool[]> {
    const all: MCPTool[] = []
    for (const server of this.servers) {
      if (!server.ready || !server.process) continue
      try {
        const result = await this.sendJSONRPC<Record<string, unknown>>(server, "tools/list", {})
        if (result && typeof result === "object" && Array.isArray((result as Record<string, unknown>).tools)) {
          server.tools = (result as unknown as { tools: MCPTool[] }).tools
          all.push(...server.tools)
        }
      } catch {
        // Сервер может не поддерживать tools/list
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
    if (!server || !server.ready || !server.process) {
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
    } catch (err) {
      return {
        output: `Вызов MCP-инструмента не выполнен: ${err instanceof Error ? err.message : String(err)}`,
        success: false,
      }
    }
  }

  async syncWithRegistry(registry: ToolRegistry): Promise<void> {
    for (const server of this.servers) {
      if (!server.ready || !server.process) continue
      registry.registerMany(
        this.toolAdapter.adaptAll(server.tools, server.config.name, this.callTool.bind(this)),
      )
    }
  }

  listServers(): MCPServerConfig[] {
    return this.servers.map((s) => s.config)
  }

  getReadyServers(): string[] {
    return this.servers.filter((s) => s.ready).map((s) => s.config.name)
  }

  getToolsByServer(): Array<{ server: string; tools: MCPTool[] }> {
    return this.servers
      .filter((s) => s.ready)
      .map((s) => ({ server: s.config.name, tools: s.tools }))
  }

  async disconnect(): Promise<void> {
    for (const server of this.servers) {
      if (server.process) {
        server.process.kill()
        server.process = null
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
    server: MCPServer,
    method: string,
    params: Record<string, unknown>,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const proc = server.process
      if (!proc) {
        reject(new ExecutionError("Сервер не подключён"))
        return
      }

      if (!proc.stdout) {
        reject(new ExecutionError("stdout недоступен"))
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
      }, 10000)

      if (proc.stdin) {
        proc.stdin.write(request)
      }
    })
  }
}
