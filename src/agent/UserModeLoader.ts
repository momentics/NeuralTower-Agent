import * as fs from "fs/promises"
import * as path from "path"
import type { IAgentMode, IToolRule } from "./AgentMode"
import type { PermissionLevel } from "../shared/PermissionTypes"

/**
 * Загрузить пользовательские режимы из каталога: каждый *.md-файл —
 * режим. Имя режима — имя файла без расширения.
 *
 * Формат:
 * ---
 * description: Обзор кода
 * displayName: Ревью
 * transitions: build
 * tools:
 *   read_file: allow
 *   edit_file: deny
 *   "*": deny
 * ---
 * Системный промпт режима...
 */
export async function loadUserModes(dir: string): Promise<IAgentMode[]> {
  let files: string[]
  try {
    files = (await fs.readdir(dir)).filter((f) => f.endsWith(".md"))
  } catch {
    return []
  }
  const modes: IAgentMode[] = []
  for (const file of files) {
    const name = path.basename(file, ".md").replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase()
    if (!name) continue
    let content: string
    try {
      content = await fs.readFile(path.join(dir, file), "utf-8")
    } catch {
      continue
    }
    const mode = parseUserMode(content, name)
    if (mode) modes.push(mode)
  }
  return modes
}

/** Разобрать один файл режима. */
export function parseUserMode(content: string, name: string): IAgentMode | null {
  const text = content.replace(/^\uFEFF/, "")
  const meta: Record<string, string> = {}
  const toolRules: IToolRule[] = []
  let body = text
  let inTools = false

  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (m) {
    body = text.slice(m[0].length)
    for (const rawLine of m[1].split(/\r?\n/)) {
      const line = rawLine.replace(/\s+$/, "")
      const trimmed = line.trim()
      if (trimmed === "tools:") {
        inTools = true
        continue
      }
      if (inTools) {
        if (line.startsWith("  ") || line.startsWith("\t")) {
          const idx = trimmed.indexOf(":")
          if (idx > 0) {
            const tool = trimmed.slice(0, idx).trim().replace(/^"|"$/g, "")
            const level = trimmed.slice(idx + 1).trim()
            if (level === "allow" || level === "ask" || level === "deny") {
              toolRules.push({ tool, level: level as PermissionLevel })
            }
          }
          continue
        }
        inTools = false
      }
      const idx = line.indexOf(":")
      if (idx > 0) {
        const key = line.slice(0, idx).trim().toLowerCase()
        const value = line.slice(idx + 1).trim()
        if (key && value) meta[key] = value
      }
    }
  }

  const prompt = body.trim()
  if (!prompt) return null

  // Без явного списка переходов режим доступен из любого встроенного.
  const transitions = meta.transitions
    ? meta.transitions.split(",").map((t) => t.trim()).filter(Boolean)
    : ["build", "plan", "explore", "ask"]

  if (toolRules.length === 0) {
    toolRules.push({ tool: "*", level: "ask" })
  }

  return {
    name,
    displayName: meta.displayname || meta.display_name || name,
    description: meta.description || "Пользовательский режим",
    toolRules,
    transitions,
    systemPromptAddon: prompt,
    priority: 1,
  }
}
