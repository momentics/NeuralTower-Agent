const EXT_MAP: Record<string, { short: string; display: string; full: string }> = {
  ".ts": { short: "ts", display: "typescript", full: "TypeScript" },
  ".tsx": { short: "tsx", display: "typescript", full: "TypeScript" },
  ".mts": { short: "mts", display: "typescript", full: "TypeScript" },
  ".cts": { short: "cts", display: "typescript", full: "TypeScript" },
  ".js": { short: "js", display: "javascript", full: "JavaScript" },
  ".jsx": { short: "jsx", display: "javascript", full: "JavaScript" },
  ".mjs": { short: "mjs", display: "javascript", full: "JavaScript" },
  ".cjs": { short: "cjs", display: "javascript", full: "JavaScript" },
  ".py": { short: "py", display: "python", full: "Python" },
  ".rs": { short: "rs", display: "rust", full: "Rust" },
  ".go": { short: "go", display: "go", full: "Go" },
  ".java": { short: "java", display: "java", full: "Java" },
  ".kt": { short: "kt", display: "kotlin", full: "Kotlin" },
  ".rb": { short: "rb", display: "ruby", full: "Ruby" },
  ".c": { short: "c", display: "c", full: "C" },
  ".h": { short: "c", display: "c", full: "C" },
  ".cpp": { short: "cpp", display: "cpp", full: "CPP" },
  ".cxx": { short: "cpp", display: "cpp", full: "CPP" },
  ".cc": { short: "cpp", display: "cpp", full: "CPP" },
  ".hpp": { short: "cpp", display: "cpp", full: "CPP" },
  ".hh": { short: "cpp", display: "cpp", full: "CPP" },
  ".cs": { short: "cs", display: "csharp", full: "C#" },
  ".swift": { short: "swift", display: "swift", full: "Swift" },
  ".php": { short: "php", display: "php", full: "PHP" },
  ".lua": { short: "lua", display: "lua", full: "Lua" },
  ".dart": { short: "dart", display: "dart", full: "Dart" },
  ".scala": { short: "scala", display: "scala", full: "Scala" },
  ".html": { short: "html", display: "html", full: "HTML" },
  ".htm": { short: "html", display: "html", full: "HTML" },
  ".css": { short: "css", display: "css", full: "CSS" },
  ".scss": { short: "scss", display: "scss", full: "CSS" },
  ".sass": { short: "sass", display: "sass", full: "CSS" },
  ".less": { short: "less", display: "less", full: "CSS" },
  ".json": { short: "json", display: "json", full: "JSON" },
  ".toml": { short: "toml", display: "toml", full: "TOML" },
  ".yaml": { short: "yaml", display: "yaml", full: "YAML" },
  ".yml": { short: "yaml", display: "yaml", full: "YAML" },
  ".md": { short: "md", display: "markdown", full: "Markdown" },
  ".sh": { short: "sh", display: "bash", full: "Shell" },
  ".bash": { short: "sh", display: "bash", full: "Shell" },
  ".zsh": { short: "zsh", display: "zsh", full: "Shell" },
  ".ps1": { short: "ps1", display: "powershell", full: "PowerShell" },
  ".psm1": { short: "psm1", display: "powershell", full: "PowerShell" },
  ".sql": { short: "sql", display: "sql", full: "SQL" },
  ".xml": { short: "xml", display: "xml", full: "XML" },
  ".svg": { short: "xml", display: "xml", full: "XML" },
  ".tf": { short: "tf", display: "hcl", full: "HCL" },
  ".tfvars": { short: "tfvars", display: "hcl", full: "HCL" },
}

function getExt(filePath: string): string {
  const dotIdx = filePath.lastIndexOf(".")
  if (dotIdx === -1) return ""
  return filePath.substring(dotIdx).toLowerCase()
}

export function detectLanguageShort(filePath: string): string {
  const ext = getExt(filePath)
  return EXT_MAP[ext]?.short ?? ext.replace(".", "")
}

export function detectLanguageDisplay(filePath: string): string {
  const ext = getExt(filePath)
  return EXT_MAP[ext]?.display ?? ext.replace(".", "") ?? "text"
}

export function detectLanguageFull(filePath: string): string {
  const ext = getExt(filePath)
  return EXT_MAP[ext]?.full ?? ext.replace(".", "") ?? "Unknown"
}

export function isCodeFile(filePath: string): boolean {
  const ext = getExt(filePath)
  return ext in EXT_MAP
}
