import * as fs from "fs/promises"
import * as path from "path"
import type { ISkill } from "./ISkill"

/**
 * Загрузить навыки из каталога: каждая поддиректория содержит файл
 * SKILL.md с frontmatter (name, description, triggers) и телом —
 * инструкциями. Директории без SKILL.md пропускаются.
 */
export async function loadSkillsFromDir(dir: string): Promise<ISkill[]> {
  let entries: import("fs").Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const skills: ISkill[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const file = path.join(dir, entry.name, "SKILL.md")
    let content: string
    try {
      content = await fs.readFile(file, "utf-8")
    } catch {
      continue
    }
    const skill = parseSkillFile(content, entry.name)
    if (skill) skills.push(skill)
  }
  return skills
}

/**
 * Разобрать файл SKILL.md.
 *
 * Формат:
 * ---
 * name: имя-навыка
 * description: краткое описание
 * triggers: слово1, слово2
 * ---
 * Тело с инструкциями...
 *
 * Без frontmatter весь текст — инструкции, имя — имя каталога,
 * описание — первая строка (до 200 символов).
 */
export function parseSkillFile(content: string, fallbackName: string): ISkill | null {
  const text = content.replace(/^\uFEFF/, "")
  const meta: Record<string, string> = {}
  let body = text

  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (m) {
    body = text.slice(m[0].length)
    for (const line of m[1].split(/\r?\n/)) {
      const idx = line.indexOf(":")
      if (idx <= 0) continue
      const key = line.slice(0, idx).trim().toLowerCase()
      const value = line.slice(idx + 1).trim()
      if (key && value) meta[key] = value
    }
  }

  const instructions = body.trim()
  if (!instructions) return null

  const rawName = meta.name || fallbackName
  const name = rawName.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase() || fallbackName
  const description = meta.description || instructions.split(/\r?\n/)[0].slice(0, 200)
  const triggers = meta.triggers
    ? meta.triggers.split(",").map((t) => t.trim()).filter(Boolean)
    : []

  return {
    name,
    description,
    triggers,
    instructions,
    source: "file",
  }
}
