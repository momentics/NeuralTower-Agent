import type { ITool, ToolSchema } from "../ITool"
import type { ToolResult } from "../../agent/AgentTypes"
import { isInsideWorkspace } from "../../utils/WorkspaceGuard"
import * as path from "path"
import { errorMessage } from "../../core/errors"

/**
 * Базовый класс для инструментов файловой системы.
 * Обеспечивает единый паттерн: валидация → разрешение пути → проверка workspace → выполнение.
 */
export abstract class FilesystemTool implements ITool {
  abstract name: string
  abstract description: string
  abstract category: string
  abstract isSafe: boolean
  abstract schema: ToolSchema

  constructor(protected readonly workDir?: string) {}

  /**
   * Разрешить путь и проверить, что он находится внутри рабочей директории.
   * @returns resolved path или undefined если проверка не пройдена
   */
  protected resolvePath(raw: string): { resolved: string } | { error: string } {
    if (!raw) return { error: "Не указан путь" }
    const resolved = path.resolve(raw)
    if (!isInsideWorkspace(resolved, this.workDir)) {
      return { error: "Доступ запрещён: путь выходит за пределы рабочей директории" }
    }
    return { resolved }
  }

  /**
   * Разрешить два пути (для операций с источником и назначением).
   */
  protected resolveTwoPaths(
    sourceRaw: string,
    destRaw: string,
  ): { source: string; destination: string } | { error: string } {
    if (!sourceRaw) return { error: "Не указан исходный путь" }
    if (!destRaw) return { error: "Не указан путь назначения" }
    const resolvedSrc = path.resolve(sourceRaw)
    const resolvedDst = path.resolve(destRaw)
    if (!isInsideWorkspace(resolvedSrc, this.workDir)) {
      return { error: "Доступ запрещён: исходный путь выходит за пределы рабочей директории" }
    }
    if (!isInsideWorkspace(resolvedDst, this.workDir)) {
      return { error: "Доступ запрещён: путь назначения выходит за пределы рабочей директории" }
    }
    return { source: resolvedSrc, destination: resolvedDst }
  }

  /**
   * Абстрактный метод для выполнения логики инструмента.
   * Вызывается после успешной валидации и разрешения пути.
   */
  protected abstract doExecute(
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<ToolResult>

  /**
   * Стандартный execute с проверкой AbortSignal и workspace.
   */
  async execute(args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
    if (signal?.aborted) return { output: "Операция отменена", success: false }
    try {
      return await this.doExecute(args, signal)
    } catch (err: unknown) {
      return {
        output: `Не удалось выполнить ${this.name}: ${errorMessage(err)}`,
        success: false,
      }
    }
  }
}
