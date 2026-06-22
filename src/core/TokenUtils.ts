/**
 * Единый коэффициент оценки токенов: 1 токен ≈ 4 символа.
 * Используется во всех модулях для расчёта потребления контекста.
 */
export const TOKENS_PER_CHAR = 0.25

/**
 * Оценить число токенов в тексте.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length * TOKENS_PER_CHAR)
}
