/**
 * Извлечение символов из запроса.
 *
 * Распознаёт CamelCase, snake_case, SCREAMING_SNAKE_CASE
 * и dot.notation идентификаторы.
 */

import { isDistinctiveIdentifier } from '../ntgraph/Utils';

// =============================================================================
// extractSymbolsFromQuery
// =============================================================================

/**
 * Извлекает символы из запроса.
 *
 * 1. CamelCase: \b([A-Z][a-z]+(?:[A-Z][a-z]*)*|[a-z]+(?:[A-Z][a-z]*)+)\b
 * 2. snake_case: \b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b
 * 3. SCREAMING_SNAKE: \b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b
 * 4. dot.notation: \b([a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)+)\b
 * 5. Фильтрация обычных английских слов через isDistinctiveIdentifier()
 */
export function extractSymbolsFromQuery(query: string): string[] {
  const symbols = new Set<string>();

  // dot.notation — извлекаем обе части
  const dotMatches = query.match(/\b([a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)+)\b/g);
  if (dotMatches) {
    for (const match of dotMatches) {
      const parts = match.split('.');
      for (const part of parts) {
        if (isDistinctiveIdentifier(part)) {
          symbols.add(part);
        }
      }
      symbols.add(match);
    }
  }

  // SCREAMING_SNAKE_CASE
  const screamingMatches = query.match(/\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b/g);
  if (screamingMatches) {
    for (const match of screamingMatches) {
      if (isDistinctiveIdentifier(match)) {
        symbols.add(match);
      }
    }
  }

  // snake_case
  const snakeMatches = query.match(/\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/g);
  if (snakeMatches) {
    for (const match of snakeMatches) {
      if (isDistinctiveIdentifier(match)) {
        symbols.add(match);
      }
    }
  }

  // CamelCase / PascalCase
  const camelMatches = query.match(/\b([A-Z][a-z]+(?:[A-Z][a-z]*)*|[a-z]+(?:[A-Z][a-z]*)+)\b/g);
  if (camelMatches) {
    for (const match of camelMatches) {
      if (isDistinctiveIdentifier(match)) {
        symbols.add(match);
      }
    }
  }

  return Array.from(symbols);
}
