import { EventEmitter } from "events"
import { spawn, type ChildProcess } from "child_process"
import type { MCPServerConfig } from "./MCPManager"
import { ExecutionError } from "../core/errors"
import { createDomainLogger } from "../core/logger"

const log = createDomainLogger("MCPTransport")

/**
 * Абстракция транспорта MCP — позволяет подключать разные
 * виды транспорта (stdio, HTTP и т.д.) без изменения MCPManager (DIP).
 */
export interface IMCPTransport extends EventEmitter {
  connect(): Promise<void>
  send(data: string): void
  isConnected(): boolean
  close(): void
}

/**
 * События, эмиттируемые транспортом.
 */
export const MCP_TRANSPORT_EVENTS = {
  message: "message",
  error: "error",
  close: "close",
} as const

/**
 * Транспорт MCP через stdio (запуск внешнего процесса).
 */
export class StdioMCPTransport extends EventEmitter implements IMCPTransport {
  private process: ChildProcess | null = null

  constructor(private readonly config: MCPServerConfig) {
    super()
  }

  connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this.process) {
        resolve()
        return
      }

      const env: Record<string, string> = {
        ...(process.env as Record<string, string>),
        ...(this.config.env ?? {}),
      }

      const proc = spawn(this.config.command, this.config.args ?? [], {
        env,
        stdio: ["pipe", "pipe", "pipe"],
      })

      this.process = proc

      if (proc.stdout) {
        proc.stdout.on("data", (data: Buffer) => {
          this.emit(MCP_TRANSPORT_EVENTS.message, data.toString())
        })
      }

      proc.on("error", (err: Error) => {
        log.error(`Ошибка stdio-транспорта: ${err.message}`)
        this.emit(MCP_TRANSPORT_EVENTS.error, err)
        reject(new ExecutionError(`MCP-процесс не запущен: ${err.message}`))
      })

      proc.on("exit", (code, signal) => {
        this.process = null
        this.emit(
          MCP_TRANSPORT_EVENTS.close,
          new ExecutionError(`MCP-процесс завершён (code: ${code}, signal: ${signal})`),
        )
      })

      resolve()
    })
  }

  send(data: string): void {
    const proc = this.process
    if (!proc) {
      throw new ExecutionError("Транспорт не подключён")
    }
    if (!proc.stdin) {
      throw new ExecutionError("stdin недоступен")
    }
    proc.stdin.write(data)
  }

  isConnected(): boolean {
    return this.process !== null && this.process.exitCode == null
  }

  close(): void {
    const proc = this.process
    if (proc) {
      proc.kill()
      this.process = null
    }
  }
}
