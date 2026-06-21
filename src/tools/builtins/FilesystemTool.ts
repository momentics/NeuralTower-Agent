import type { ToolSchema } from "../ITool"
import { isInsideWorkspace } from "../../utils/WorkspaceGuard"
import * as path from "path"
import * as fs from "fs/promises"
import { BaseTool } from "./BaseTool"

/**
 * Базовый класс для инструментов файловой системы.
 * Наследует BaseTool и добавляет безопасное разрешение путей с защитой от path traversal.
 *
 * Безопасность:
 * - workDir обязателен: без рабочей директории все операции заблокированы
 * - Все пути проверяются на принадлежность workspace
 * - Символические ссылки разрешаются до реального пути (защита от path traversal через symlink)
 */
export abstract class FilesystemTool extends BaseTool {
  abstract schema: ToolSchema

  constructor(protected readonly workDir: string) {
    super()
  }

  /**
   * Разрешить путь до канонического, используя realpath для существующих
   * и ближайшего существующего родителя для несуществующих.
   * Это устраняет расхождения DOS short paths (MOMENT~1 vs momentics) на Windows.
   */
  protected async resolveToReal(p: string): Promise<string> {
    try {
      return await fs.realpath(p)
    } catch {
      let dir = path.dirname(p)
      let suffix = p.slice(dir.length)
      while (dir !== p) {
        try {
          return (await fs.realpath(dir)) + suffix
        } catch {
          const parent = path.dirname(dir)
          if (parent === dir) break
          dir = parent
          suffix = p.slice(dir.length)
        }
      }
      return p
    }
  }

  /**
   * Разрешить путь и проверить, что он находится внутри рабочей директории.
   * Символические ссылки разрешаются до реального пути для защиты от path traversal.
   * @returns resolved path или undefined если проверка не пройдена
   */
  protected async resolvePath(raw: string): Promise<{ resolved: string } | { error: string }> {
    if (!raw) return { error: "Не указан путь" }
    if (!this.workDir) return { error: "Рабочая директория не установлена" }
    const resolved = path.resolve(this.workDir, raw)
    const real = await this.resolveToReal(resolved)
    const realWorkDir = await this.resolveToReal(this.workDir)
    if (!isInsideWorkspace(real, realWorkDir)) {
      return { error: "Доступ запрещён: путь выходит за пределы рабочей директории" }
    }
    return { resolved: real }
  }

  /**
   * Разрешить два пути (для операций с источником и назначением).
   * Символические ссылки разрешаются до реального пути для защиты от path traversal.
   */
  protected async resolveTwoPaths(
    sourceRaw: string,
    destRaw: string,
  ): Promise<{ source: string; destination: string } | { error: string }> {
    if (!sourceRaw) return { error: "Не указан исходный путь" }
    if (!destRaw) return { error: "Не указан путь назначения" }
    const resolvedSrc = path.resolve(this.workDir, sourceRaw)
    const resolvedDst = path.resolve(this.workDir, destRaw)
    const realWorkDir = await this.resolveToReal(this.workDir)

    const realSrc = await this.resolveToReal(resolvedSrc)
    if (!isInsideWorkspace(realSrc, realWorkDir)) {
      return { error: "Доступ запрещён: исходный путь выходит за пределы рабочей директории" }
    }

    const realDst = await this.resolveToReal(resolvedDst)
    if (!isInsideWorkspace(realDst, realWorkDir)) {
      return { error: "Доступ запрещён: путь назначения выходит за пределы рабочей директории" }
    }

    return { source: realSrc, destination: realDst }
  }
}
