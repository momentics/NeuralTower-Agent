/**
 * Извлечь JSON-блоки из текста с поддержкой вложенных структур
 * и экранирования кавычек. Использует посимвольный парсер
 * с отслеживанием глубины фигурных скобок.
 */
export function extractJsonBlocks(content: string): string[] {
  const blocks: string[] = []

  const cleaned = content
    .replace(/```(?:json)?\s*\n?/g, "")
    .replace(/```\s*\n?/g, "")

  let depth = 0
  let start = -1
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i]
    if (ch === "{") {
      if (depth === 0) start = i
      depth++
    } else if (ch === "}") {
      depth--
      if (depth === 0 && start !== -1) {
        blocks.push(cleaned.slice(start, i + 1))
        start = -1
      }
    } else if (ch === '"') {
      i++
      while (i < cleaned.length && cleaned[i] !== '"') {
        if (cleaned[i] === "\\") i++
        i++
      }
    }
    if (depth < 0) depth = 0
  }

  return blocks
}
