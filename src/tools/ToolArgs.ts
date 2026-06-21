/**
 * Утилиты для валидации аргументов инструментов.
 * Обеспечивают единый паттерн извлечения и проверки параметров.
 */

/** Извлечь строку из аргументов. Возвращает пустую строку, если значение не строка. */
export function str(args: Record<string, unknown>, key: string): string {
  const v = args[key]
  if (typeof v === "string") return v
  if (v === null || v === undefined) return ""
  return String(v)
}

/** Извлечь строку из аргументов. Возвращает undefined, если значение не строка. */
export function strOpt(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key]
  if (typeof v === "string") return v
  if (v === null || v === undefined) return undefined
  return String(v)
}

/** Извлечь число из аргументов. Возвращает дефолтное значение, если не число. */
export function num(args: Record<string, unknown>, key: string, def: number = 0): number {
  const v = args[key]
  if (typeof v === "number" && isFinite(v)) return v
  return def
}

/** Извлечь число из аргументов. Возвращает undefined, если не число. */
export function numOpt(args: Record<string, unknown>, key: string): number | undefined {
  const v = args[key]
  if (typeof v === "number" && isFinite(v)) return v
  return undefined
}

/** Извлечь булево из аргументов. Возвращает дефолтное значение, если не булево. */
export function bool(args: Record<string, unknown>, key: string, def: boolean = false): boolean {
  const v = args[key]
  if (typeof v === "boolean") return v
  return def
}

/** Извлечь массив из аргументов. Возвращает пустой массив, если не массив. */
export function arr<T>(args: Record<string, unknown>, key: string): T[] {
  const v = args[key]
  if (Array.isArray(v)) return v as T[]
  return []
}

/** Проверить, что строка не пуста. */
export function requiredStr(args: Record<string, unknown>, key: string): string | null {
  const v = str(args, key)
  return v || null
}

/** Проверить, что число положительное. Возвращает null, если не проходит. */
export function positiveNum(args: Record<string, unknown>, key: string): number | null {
  const v = num(args, key)
  return v > 0 ? v : null
}

/** Ограничить число диапазоном [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
