/**
 * Проверка, что путь находится внутри рабочей директории.
 */
export function isInsideWorkspace(resolved: string, workDir?: string): boolean {
  if (!workDir) return true
  const normalized = resolved.replace(/\\/g, "/").replace(/\/+$/, "")
  const root = workDir.replace(/\\/g, "/").replace(/\/+$/, "")
  return normalized === root || normalized.startsWith(root + "/")
}
