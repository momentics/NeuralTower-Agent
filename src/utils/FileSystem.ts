import * as fs from "fs/promises"
import * as path from "path"

export interface IWalkOptions {
  /** Максимальное число файлов */
  maxFiles?: number
  /** Пропускать скрытые директории и файлы (начинающиеся с .) */
  skipHidden?: boolean
  /** Пропускать node_modules */
  skipNodeModules?: boolean
  /** Сигнал отмены */
  signal?: AbortSignal
}

const DEFAULT_WALK_OPTIONS: Omit<Required<IWalkOptions>, "signal"> = {
  maxFiles: 20000,
  skipHidden: true,
  skipNodeModules: true,
}

/**
 * Рекурсивно обходить директорию и вернуть список файлов.
 * Пропускает скрытые файлы/директории и node_modules.
 */
export async function walkDirectory(
  dir: string,
  options: IWalkOptions = {},
): Promise<string[]> {
  const opts = { ...DEFAULT_WALK_OPTIONS, ...options }
  const files: string[] = []

  const walk = async (current: string): Promise<void> => {
    if (files.length >= opts.maxFiles) return
    if (opts.signal?.aborted) return
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (files.length >= opts.maxFiles) return
      if (opts.signal?.aborted) return
      if (opts.skipHidden && entry.name.startsWith(".")) continue
      if (opts.skipNodeModules && entry.name === "node_modules") continue
      const full = path.join(current, entry.name)
      // Пропускать символические ссылки — они могут создавать циклы
      // и приводить к бесконечному обходу или выходу за пределы рабочей области.
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        await walk(full)
      } else if (entry.isFile()) {
        files.push(full)
      }
    }
  }

  await walk(dir)
  return files
}
