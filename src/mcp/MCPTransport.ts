import { EventEmitter } from "events"
import { spawn, type ChildProcess } from "child_process"
import type { MCPServerConfig } from "./MCPManager"
import { ExecutionError } from "../core/Errors"
import { createDomainLogger } from "../core/Logger"

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
  private connected = false
  private stdoutListener: ((data: Buffer) => void) | null = null
  private errorListener: ((err: Error) => void) | null = null
  private exitListener: ((code: number | null, signal: string | null) => void) | null = null

  constructor(private readonly config: MCPServerConfig) {
    super()
  }

  connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this.connected) {
        resolve()
        return
      }

      this.cleanupListeners()

      const env: Record<string, string> = {
        ...(process.env as Record<string, string>),
        ...(this.config.env ?? {}),
      }

      const proc = spawn(this.config.command, this.config.args ?? [], {
        env,
        stdio: ["pipe", "pipe", "pipe"],
      })

      this.process = proc
      this.connected = true

      this.stdoutListener = (data: Buffer) => {
        this.emit(MCP_TRANSPORT_EVENTS.message, data.toString())
      }

      this.errorListener = (err: Error) => {
        log.error(`Ошибка stdio-транспорта: ${err.message}`)
        this.emit(MCP_TRANSPORT_EVENTS.error, err)
        reject(new ExecutionError(`MCP-процесс не запущен: ${err.message}`))
      }

      this.exitListener = (code, signal) => {
        this.process = null
        this.connected = false
        this.emit(
          MCP_TRANSPORT_EVENTS.close,
          new ExecutionError(`MCP-процесс завершён (code: ${code}, signal: ${signal})`),
        )
      }

      if (proc.stdout) {
        proc.stdout.on("data", this.stdoutListener)
      }

      proc.on("error", this.errorListener)
      proc.on("exit", this.exitListener)

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
    return this.connected && this.process !== null && this.process.exitCode == null
  }

  private cleanupListeners(): void {
    const proc = this.process
    if (proc && proc.stdout && this.stdoutListener && typeof proc.stdout.removeListener === "function") {
      proc.stdout.removeListener("data", this.stdoutListener)
    }
    if (proc && this.errorListener && typeof proc.removeListener === "function") {
      proc.removeListener("error", this.errorListener)
    }
    if (proc && this.exitListener && typeof proc.removeListener === "function") {
      proc.removeListener("exit", this.exitListener)
    }
    this.stdoutListener = null
    this.errorListener = null
    this.exitListener = null
  }

  close(): void {
    this.connected = false
    this.cleanupListeners()
    const proc = this.process
    if (proc) {
      proc.kill()
      this.process = null
    }
  }
}
