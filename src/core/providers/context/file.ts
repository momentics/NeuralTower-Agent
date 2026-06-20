import type { ContextProvider, ContextItem } from "./types"
import { detectLanguageDisplay } from "../../../utils/LanguageDetector"

export function makeFileProvider(
  getWorkDir: () => string,
): ContextProvider {
  return {
    description: {
      name: "file",
      displayTitle: "File",
      description: "Содержимое файла по пути",
      type: "query",
    },
    async resolve(query: string): Promise<ContextItem[]> {
      const fs = await import("fs/promises")
      const path = await import("path")
      const trimmed = query.trim()
      if (!trimmed) return []

      let filePath = trimmed
      if (!path.default.isAbsolute(trimmed)) {
        filePath = path.default.join(getWorkDir(), trimmed)
      }

      try {
        const stat = await fs.stat(filePath)
        if (stat.isDirectory()) {
          return [{ content: `Это директория, не файл: ${filePath}`, name: "file", description: "error" }]
        }
        if (stat.size > 200_000) {
          return [{ content: `Файл слишком большой (${(stat.size / 1024).toFixed(0)} КБ): ${filePath}`, name: "file", description: "error" }]
        }
        const content = await fs.readFile(filePath, "utf-8")
        const lang = detectLanguageDisplay(filePath)
        return [{
          content: `Файл: ${filePath}\n\n\`\`\`${lang}\n${content.slice(0, 100000)}\n\`\`\``,
          name: path.default.basename(filePath),
          description: `${(stat.size / 1024).toFixed(1)} КБ, ${lang}`,
        }]
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return [{ content: `Не удалось прочитать файл ${filePath}: ${msg}`, name: "file", description: "error" }]
      }
    },
  }
}
