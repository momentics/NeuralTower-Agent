/**
 * Тесты извлечения символов.
 *
 * Проверяют: extractSymbolsFromQuery для CamelCase, snake_case,
 * SCREAMING_SNAKE и dot.notation.
 */

import { describe, it, expect } from "vitest"
import { extractSymbolsFromQuery } from "../context/SymbolExtractor"
import { isDistinctiveIdentifier } from "../ntgraph/Utils"

describe("SymbolExtractor", () => {
  describe("extractSymbolsFromQuery", () => {
    it("extracts CamelCase identifiers", () => {
      const symbols = extractSymbolsFromQuery("UserService")
      expect(symbols).toContain("UserService")
    })

    it("extracts snake_case identifiers", () => {
      const symbols = extractSymbolsFromQuery("user_service")
      expect(symbols).toContain("user_service")
    })

    it("extracts SCREAMING_SNAKE identifiers", () => {
      const symbols = extractSymbolsFromQuery("MAX_RETRIES")
      expect(symbols).toContain("MAX_RETRIES")
    })

    it("extracts dot.notation identifiers", () => {
      const symbols = extractSymbolsFromQuery("app.isPackaged")
      expect(symbols).toContain("app.isPackaged")
      // "app" is filtered as common word, but "isPackaged" passes
      expect(symbols).toContain("isPackaged")
    })

    it("filters out common English words", () => {
      const symbols = extractSymbolsFromQuery("the and for with")
      expect(symbols).not.toContain("the")
      expect(symbols).not.toContain("and")
      expect(symbols).not.toContain("for")
      expect(symbols).not.toContain("with")
    })

    it("extracts multiple symbols from a query", () => {
      const symbols = extractSymbolsFromQuery("UserService and CacheManager")
      expect(symbols).toContain("UserService")
      expect(symbols).toContain("CacheManager")
    })

    it("returns empty for common words only", () => {
      const symbols = extractSymbolsFromQuery("find the best way to do this")
      expect(symbols.length).toBe(0)
    })

    it("handles mixed case queries", () => {
      const symbols = extractSymbolsFromQuery("get_user_data from UserService")
      expect(symbols).toContain("get_user_data")
      expect(symbols).toContain("UserService")
    })

    it("handles empty query", () => {
      const symbols = extractSymbolsFromQuery("")
      expect(symbols).toHaveLength(0)
    })

    it("handles single word query", () => {
      const symbols = extractSymbolsFromQuery("UserService")
      expect(symbols).toContain("UserService")
    })
  })
})
