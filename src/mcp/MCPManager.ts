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

interface MCPServer {
  config: MCPServerConfig
  ready: boolean
  process: ChildProcess | null
  tools: MCPTool[]
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

        proc.on("error", () => {
          server.ready = false
        })
        proc.on("exit", () => {
          server.ready = false
          server.process = null
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

      let settled = false
      let timer: ReturnType<typeof setTimeout> | undefined
      let handler: ((data: Buffer) => void) | undefined

      const id = Date.now()
      const request = JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params,
      }) + "\n"

      const cleanup = () => {
        if (timer !== undefined) {
          clearTimeout(timer)
          timer = undefined
        }
        if (proc.stdout && handler) {
          proc.stdout.removeListener("data", handler)
        }
      }

      timer = setTimeout(() => {
        if (!settled) {
          settled = true
          cleanup()
          reject(new TimeoutError(`MCP ${method}: истёк таймаут`))
        }
      }, 10000)

      handler = (data: Buffer) => {
        try {
          const resp = JSON.parse(data.toString()) as { id: number; result?: T; error?: { message: string } }
          if (resp.id === id && !settled) {
            settled = true
            cleanup()
            if (resp.error) {
              reject(new ExecutionError(resp.error.message))
            } else {
              resolve(resp.result as T)
            }
          }
        } catch {
          // Игнорировать ошибки разбора для несвязанных данных
        }
      }

      if (proc.stdout) {
        proc.stdout.on("data", handler)
      }
      if (proc.stdin) {
        proc.stdin.write(request)
      }
    })
  }
}
