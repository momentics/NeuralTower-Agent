import { spawn, type SpawnOptions, type ChildProcess } from "child_process"
import type { IProcessRunner, IProcessRunOptions, IProcessRunResult } from "../core/IProcessRunner"

const DEFAULT_PROCESS_MAX_BUFFER = 1024 * 1024

export interface IProcessRunnerOptions {
  cwd?: string
  timeout?: number
  maxBuffer?: number
  shell?: boolean
  env?: Record<string, string>
  signal?: AbortSignal
}

export interface IProcessResult {
  stdout: string
  stderr: string
  code: number | null
}

/**
 * Реализация IProcessRunner через child_process.spawn.
 * Поддерживает лимиты буфера, таймаут и корректную очистку.
 */
export class DefaultProcessRunner implements IProcessRunner {
  async run(
    command: string,
    args: string[],
    options: IProcessRunOptions = {},
  ): Promise<IProcessRunResult> {
    return runProcess(command, args, options as IProcessRunnerOptions)
  }
}

/**
 * Run an external process with buffer limits, timeout, and proper cleanup.
 * Shared between BashTool, GitService, and any future process-based tools.
 */
export function runProcess(
  command: string,
  args: string[],
  options: IProcessRunnerOptions = {},
): Promise<IProcessResult> {
  const {
    cwd,
    timeout,
    maxBuffer = DEFAULT_PROCESS_MAX_BUFFER,
    shell = false,
    env = process.env,
    signal,
  } = options

  if (signal?.aborted) {
    return Promise.reject(new Error("Операция отменена"))
  }

  return new Promise((resolve, reject) => {
    let settled = false
    const settle = (
      value: IProcessResult | undefined,
      error: Error | undefined,
    ) => {
      if (settled) return
      settled = true
      if (error) reject(error)
      else if (value) resolve(value)
    }

    const opts: SpawnOptions = { cwd, timeout, shell, env }

    const proc: ChildProcess = spawn(command, args, opts)

    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let stdoutSize = 0
    let stderrSize = 0

    proc.stdout?.on("data", (chunk: Buffer) => {
      stdoutSize += chunk.length
      if (stdoutSize > maxBuffer) {
        proc.kill()
        return settle(undefined, new Error(`Превышен лимит вывода (${maxBuffer} байт)`))
      }
      stdoutChunks.push(chunk)
    })

    proc.stderr?.on("data", (chunk: Buffer) => {
      stderrSize += chunk.length
      if (stderrSize > maxBuffer) {
        proc.kill()
        return settle(undefined, new Error(`Превышен лимит вывода ошибок (${maxBuffer} байт)`))
      }
      stderrChunks.push(chunk)
    })

    proc.on("error", (err: Error) => settle(undefined, err))

    proc.on("close", (code: number | null) => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf-8")
      const stderr = Buffer.concat(stderrChunks).toString("utf-8")
      settle({ stdout, stderr, code }, undefined)
    })

    if (signal) {
      signal.addEventListener("abort", () => {
        proc.kill()
        settle(undefined, new Error("Операция отменена"))
      }, { once: true })
    }
  })
}
