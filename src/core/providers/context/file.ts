import type { ContextProvider, ContextItem } from "./types"
import { detectLanguageDisplay } from "../../../utils/LanguageDetector"

const CONTEXT_MAX_FILE_SIZE = 200_000
const CONTEXT_MAX_CONTENT_CHARS = 100000

/** Создать провайдер контекста для чтения содержимого файлов. */
export function makeFileProvider(
  getWorkDir: () => string,
): ContextProvider {
  return {
    description: {
      name: "file",
      displayTitle: "Файл",
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
        if (stat.size > CONTEXT_MAX_FILE_SIZE) {
          return [{ content: `Файл слишком большой (${(stat.size / 1024).toFixed(0)} КБ): ${filePath}`, name: "file", description: "error" }]
        }
        const content = await fs.readFile(filePath, "utf-8")
        const lang = detectLanguageDisplay(filePath)
        return [{
          content: `Файл: ${filePath}\n\n\`\`\`${lang}\n${content.slice(0, CONTEXT_MAX_CONTENT_CHARS)}\n\`\`\``,
          name: path.default.basename(filePath),
          description: `${(stat.size / 1024).toFixed(1)} КБ, ${lang}`,
        }]
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        return [{ content: `Не удалось прочитать файл ${filePath}: ${msg}`, name: "file", description: "error" }]
      }
    },
  }
}
