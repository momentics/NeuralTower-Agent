import type { ContextProvider, ContextItem } from "./types"

function detectLanguageFromPath(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? ""
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
    js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
    py: "python", rs: "rust", go: "go", java: "java", kt: "kotlin",
    rb: "ruby", cs: "csharp",
    c: "c", h: "c", cpp: "cpp", cxx: "cpp", cc: "cpp", hpp: "cpp",
    html: "html", htm: "html", css: "css", scss: "scss", sass: "sass",
    json: "json", toml: "toml", yaml: "yaml", yml: "yaml",
    md: "markdown", sh: "bash", bash: "bash", zsh: "zsh",
    sql: "sql", xml: "xml", svg: "xml",
    tf: "hcl", tfvars: "hcl",
    lua: "lua", php: "php", swift: "swift", dart: "dart",
  }
  return map[ext] ?? ext ?? "text"
}

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
        const lang = detectLanguageFromPath(filePath)
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
