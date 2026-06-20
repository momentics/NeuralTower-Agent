import * as fs from "fs/promises"
import * as path from "path"
import type { ContextProvider, ContextItem } from "./types"
import { createDomainLogger } from "../../logger"

const log = createDomainLogger("RulesProvider")

export async function loadRulesFiles(getWorkDir: () => string): Promise<Array<{ name: string; content: string }>> {
  const workDir = getWorkDir()
  const rules: Array<{ name: string; content: string }> = []
  const ruleDirs = [
    path.join(workDir, ".neuraltower", "rules"),
    path.join(workDir, ".kilo", "rules"),
  ]

  for (const dir of ruleDirs) {
    try {
      const entries = await fs.readdir(dir)
      const mdFiles = entries.filter((e) => e.endsWith(".md")).sort()
      for (const fname of mdFiles) {
        const content = await fs.readFile(path.join(dir, fname), "utf-8")
        rules.push({ name: fname, content: content.trim() })
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error(`Не удалось прочитать директорию правил: ${msg}`)
    }
  }

  for (const fname of ["AGENTS.md", "CLAUDE.md"]) {
    try {
      const content = await fs.readFile(path.join(workDir, fname), "utf-8")
      rules.push({ name: fname, content: content.trim() })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error(`Не удалось прочитать ${fname}: ${msg}`)
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
      displayTitle: "Правила",
      description: "Правила проекта",
      type: "normal",
      priority: 99,
    },
    async resolve(_query: string): Promise<ContextItem[]> {
      const rules = await loadRulesFiles(getWorkDir)

      if (rules.length === 0) {
        return [{ content: "", name: "rules", description: "empty" }]
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
