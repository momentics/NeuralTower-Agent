/**
 * Интерфейс для запуска внешних процессов.
 * Позволяет внедрить моки для тестирования и изолировать
 * зависимости от child_process.
 */

export interface IProcessRunner {
  run(command: string, args: string[], options?: IProcessRunOptions): Promise<IProcessRunResult>
}

export interface IProcessRunOptions {
  cwd?: string
  timeout?: number
  maxBuffer?: number
  shell?: boolean
  env?: Record<string, string>
  /** Данные для stdin процесса (например, NUL-разделённые пути). */
  stdin?: string
  signal?: AbortSignal
}

export interface IProcessRunResult {
  stdout: string
  stderr: string
  code: number | null
}
