import type { ContextProvider, ContextItem } from "./types"

export async function loadRulesFiles(getWorkDir: () => string): Promise<Array<{ name: string; content: string }>> {
  const fs = await import("fs/promises")
  const path = await import("path")
  const workDir = getWorkDir()
  const rules: Array<{ name: string; content: string }> = []
  const ruleDirs = [
    path.default.join(workDir, ".neuraltower", "rules"),
    path.default.join(workDir, ".kilo", "rules"),
  ]

  for (const dir of ruleDirs) {
    try {
      const entries = await fs.readdir(dir)
      const mdFiles = entries.filter((e) => e.endsWith(".md")).sort()
      for (const fname of mdFiles) {
        const content = await fs.readFile(path.default.join(dir, fname), "utf-8")
        rules.push({ name: fname, content: content.trim() })
      }
    } catch {
      // директория может не существовать
    }
  }

  for (const fname of ["AGENTS.md", "CLAUDE.md"]) {
    try {
      const content = await fs.readFile(path.default.join(workDir, fname), "utf-8")
      rules.push({ name: fname, content: content.trim() })
    } catch {
      // файл может не существовать
    }
  }

  return rules
}

export function makeRulesProvider(
  getWorkDir: () => string,
): ContextProvider {
  return {
    description: {
      name: "rules",
      displayTitle: "Rules",
      description: "Правила проекта",
      type: "normal",
    },
    async resolve(_query: string): Promise<ContextItem[]> {
      const rules = await loadRulesFiles(getWorkDir)

      if (rules.length === 0) {
        return [{ content: "Правила проекта не найдены. Создайте .neuraltower/rules/*.md или AGENTS.md", name: "rules", description: "empty" }]
      }

      const parts: string[] = []
      for (const r of rules) {
        parts.push(`## ${r.name}`)
        parts.push(r.content)
        parts.push("")
      }

      return [{
        content: parts.join("\n"),
        name: "Rules",
        description: `${rules.length} правил`,
      }]
    },
  }
}
