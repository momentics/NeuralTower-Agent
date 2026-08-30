/**
 * Имя инструмента в OpenAI-совместимом API: 1-64 символа,
 * буквы, цифры, подчёркивание, дефис.
 */
export const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/

export function isValidToolName(name: string): boolean {
  return TOOL_NAME_PATTERN.test(name)
}

/**
 * Привести имя к валидному виду: недопустимые символы → "_",
 * схлопнуть повторяющиеся подчёркивания, обрезать до 64 символов.
 */
export function sanitizeToolName(name: string): string {
  let s = name
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_+|_+$/g, "")
  if (s.length > 64) s = s.slice(0, 64).replace(/_+$/, "")
  return s || "tool"
}
