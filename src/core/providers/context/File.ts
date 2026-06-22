import * as fs from "fs/promises"
import type { Stats } from "fs"
import * as path from "path"
import type { IContextProvider } from "./Types"
import { detectLanguageDisplay } from "../../../utils/LanguageDetector"
import { createContextProvider } from "./WithErrorHandling"
import { errorMessage } from "../../Errors"

const CONTEXT_MAX_FILE_SIZE = 200_000
const CONTEXT_MAX_CONTENT_CHARS = 100000

/** Создать провайдер контекста для чтения содержимого файлов. */
export function makeFileProvider(
  getWorkDir: () => string,
): IContextProvider {
  return createContextProvider(
    {
      name: "file",
      displayTitle: "Файл",
      description: "Содержимое файла по пути",
      type: "query",
    },
    async (trimmed) => {
      let filePath = trimmed
      if (!path.isAbsolute(trimmed)) {
        filePath = path.join(getWorkDir(), trimmed)
      }

      let stat: Stats
      try {
        stat = await fs.stat(filePath)
      } catch (err: unknown) {
        return [{ content: `Не удалось прочитать файл: ${errorMessage(err)}`, name: "file", description: "error" }]
      }

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
        name: path.basename(filePath),
        description: `${(stat.size / 1024).toFixed(1)} КБ, ${lang}`,
      }]
    },
  )
}
