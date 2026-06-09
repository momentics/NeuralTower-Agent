import { spawn, type ChildProcess } from "child_process"
import type { ITool } from "../tools/ITool"
import { ToolRegistry } from "../tools/ToolRegistry"
import { MCPToolAdapter } from "./MCPToolAdapter"

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

export class MCPManager {
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
    const tools = await this.discover()
    registry.registerMany(this.toolAdapter.adaptAll(tools))
  }

  listServers(): MCPServerConfig[] {
    return this.servers.map((s) => s.config)
  }

  getReadyServers(): string[] {
    return this.servers.filter((s) => s.ready).map((s) => s.config.name)
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
        reject(new Error("Сервер не подключён"))
        return
      }

      const id = Date.now()
      const request = JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params,
      }) + "\n"

      const timer = setTimeout(() => {
        reject(new Error(`MCP ${method}: истёк тайм-аут`))
      }, 10000)

      const handler = (data: Buffer) => {
        try {
          const resp = JSON.parse(data.toString()) as { id: number; result?: T; error?: { message: string } }
          if (resp.id === id) {
            clearTimeout(timer)
            if (resp.error) {
              reject(new Error(resp.error.message))
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
