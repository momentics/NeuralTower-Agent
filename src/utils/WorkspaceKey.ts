import { createHash } from "crypto"

/**
 * Стабильный идентификатор workspace: 16 hex-символов sha256
 * нормализованного пути. На Windows путь приводится к нижнему
 * регистру (регистронезависимость файловой системы).
 *
 * Общий для всех компонентов, которым нужен ключ по workspace
 * (снапшоты, память проекта).
 */
export function workspaceKey(workspaceRoot: string): string {
  let normalized = workspaceRoot.replace(/\\/g, "/").replace(/\/+$/, "")
  if (process.platform === "win32") {
    normalized = normalized.toLowerCase()
  }
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16)
}
