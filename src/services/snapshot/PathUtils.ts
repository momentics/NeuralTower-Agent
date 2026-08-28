/**
 * Утилиты путей сервиса чекпоинтов: нормализация в posix-форме
 * и регистронезависимый ключ сравнения (кроссплатформенность).
 */

/** Платформа с регистронезависимой файловой системой (Windows, macOS по умолчанию). */
export function isCaseInsensitivePlatform(): boolean {
  return process.platform === "win32" || process.platform === "darwin"
}

/** Нормализовать путь в прямые слэши (безопасно для git на всех платформах). */
export function toPosix(p: string): string {
  return p.replace(/\\/g, "/")
}

/**
 * Ключ для сравнения путей (дедупликация, проверка вложенности, сопоставление
 * списков). На регистронезависимых платформах — в нижнем регистре, на Linux — как есть.
 */
export function pathKey(p: string): string {
  const posix = toPosix(p)
  return isCaseInsensitivePlatform() ? posix.toLowerCase() : posix
}
