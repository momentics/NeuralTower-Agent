import type { ContextProvider, ContextItem } from "./types"

export interface CodeSearchEntry {
  path: string
  language: string
  size: number
}

const CODE_SEARCH_MAX_FILES = 50
const CODE_SEARCH_MAX_SIZE = 50_000
const CODE_LANGS = new Set(["ts", "tsx", "js", "jsx", "py", "rs", "go", "java", "kt", "rb", "c", "cpp", "cs", "swift", "php", "lua", "dart", "scala"])

function extractSymbols(content: string, query: string): string[] {
  const results: string[] = []
  const lines = content.split("\n")
  const qi = query.toLowerCase()
  const patterns = [
    new RegExp(`(?:export\\s+)?(?:declare\\s+)?(?:abstract\\s+)?(?:async\\s+)?(?:static\\s+)?class\\s+(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "i"),
    new RegExp(`(?:export\\s+)?(?:declare\\s+)?(?:abstract\\s+)?(?:async\\s+)?(?:static\\s+)?function\\s+(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "i"),
    new RegExp(`(?:export\\s+)?(?:const|let|var)\\s+(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})\\s*[:=]`, "i"),
    new RegExp(`(?:export\\s+)?(?:const|let|var)\\s+\\w+\\s*=\\s*(?:async\\s+)?\\(([^)]*)\\)\\s*(?:=>|\\{)`, "i"),
  ]

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.toLowerCase().includes(qi) && line.trim().length > 0 && !line.trim().startsWith("//") && !line.trim().startsWith("*")) {
      for (const p of patterns) {
        if (p.test(line)) {
          results.push(`строка ${i + 1}: ${line.trim().slice(0, 120)}`)
          break
        }
      }
    }
  }

  if (results.length === 0) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line.toLowerCase().includes(qi) && line.trim().length > 0 && !line.trim().startsWith("//")) {
        results.push(`строка ${i + 1}: ${line.trim().slice(0, 120)}`)
        if (results.length >= 5) break
      }
    }
  }

  return results.slice(0, 5)
}

export function makeCodeProvider(
  getWorkDir: () => string,
  getFileIndex: () => { findByPattern(pattern: string): CodeSearchEntry[]; findByLanguage(lang: string): CodeSearchEntry[] },
): ContextProvider {
  return {
    description: {
      name: "code",
      displayTitle: "Code",
      description: "Поиск функций, классов, символов в коде",
      type: "query",
    },
    async resolve(query: string): Promise<ContextItem[]> {
      const fs = await import("fs/promises")
      const trimmed = query.trim()
      if (!trimmed) return []

      const index = getFileIndex()
      const results: string[] = []

      const searchInEntries = async (entries: CodeSearchEntry[]) => {
        for (const entry of entries.slice(0, CODE_SEARCH_MAX_FILES)) {
          if (results.length >= 10) break
          try {
            const stat = await fs.stat(entry.path)
            if (stat.size > CODE_SEARCH_MAX_SIZE) continue
            const content = await fs.readFile(entry.path, "utf-8")
            const matches = extractSymbols(content, trimmed)
            if (matches.length > 0) {
              const lines = matches.slice(0, 5).map((m) => `  ${m}`)
              results.push(`${entry.path} (${entry.language})\n${lines.join("\n")}`)
            }
          } catch {
            // пропустить нечитаемые файлы
          }
        }
      }

      await searchInEntries(index.findByPattern(trimmed))

      if (results.length < 5) {
        for (const lang of CODE_LANGS) {
          if (results.length >= 10) break
          await searchInEntries(index.findByLanguage(lang))
        }
      }

      if (results.length === 0) {
        return [{ content: `Символы для "${trimmed}" не найдены`, name: "code", description: "not found" }]
      }

      return [{
        content: `Результаты поиска кода для "${trimmed}":\n\n${results.join("\n\n")}`,
        name: `Code: ${trimmed}`,
        description: `${results.length} файлов`,
      }]
    },
  }
}
