/**
 * Удалить маркеры кода (```...```) и кавычки из результата LLM.
 */
export function stripCodeFences(content: string): string {
  let result = content.trim()
  result = result.replace(/^```[\w]*\n?/, "").replace(/\n?```$/, "")
  result = result.replace(/^["']|["']$/g, "")
  return result.trim()
}
