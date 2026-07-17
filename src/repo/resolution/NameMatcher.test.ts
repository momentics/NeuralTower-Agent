/**
 * Тесты сопоставления имён.
 *
 * Проверяют: matchReference, matchFunctionRef, sameLanguageFamily, crossesKnownFamily.
 */

import { describe, it, expect } from "vitest"
import { sameLanguageFamily, crossesKnownFamily } from "../resolution/NameMatcher"

describe("NameMatcher", () => {
  describe("sameLanguageFamily", () => {
    it("TypeScript and JavaScript are same family", () => {
      expect(sameLanguageFamily('typescript', 'javascript')).toBe(true)
      expect(sameLanguageFamily('tsx', 'jsx')).toBe(true)
      expect(sameLanguageFamily('typescript', 'jsx')).toBe(true)
    })

    it("JVM languages are same family", () => {
      expect(sameLanguageFamily('java', 'kotlin')).toBe(true)
      expect(sameLanguageFamily('java', 'scala')).toBe(true)
      expect(sameLanguageFamily('kotlin', 'scala')).toBe(true)
    })

    it("C languages are same family", () => {
      expect(sameLanguageFamily('c', 'cpp')).toBe(true)
      expect(sameLanguageFamily('c', 'objc')).toBe(true)
    })

    it("Different families return false", () => {
      expect(sameLanguageFamily('python', 'go')).toBe(false)
      expect(sameLanguageFamily('java', 'csharp')).toBe(false)
      expect(sameLanguageFamily('python', 'javascript')).toBe(false)
    })

    it("Same language returns true", () => {
      expect(sameLanguageFamily('python', 'python')).toBe(true)
      expect(sameLanguageFamily('go', 'go')).toBe(true)
      expect(sameLanguageFamily('rust', 'rust')).toBe(true)
    })

    it("Unknown languages are compared literally", () => {
      expect(sameLanguageFamily('unknown', 'unknown')).toBe(true)
      expect(sameLanguageFamily('unknown', 'python')).toBe(false)
    })
  })

  describe("crossesKnownFamily", () => {
    it("returns true for cross-family references", () => {
      expect(crossesKnownFamily('python', 'go')).toBe(true)
      expect(crossesKnownFamily('java', 'csharp')).toBe(true)
    })

    it("returns false for same-family references", () => {
      expect(crossesKnownFamily('typescript', 'javascript')).toBe(false)
      expect(crossesKnownFamily('java', 'kotlin')).toBe(false)
    })

    it("returns false for same language", () => {
      expect(crossesKnownFamily('python', 'python')).toBe(false)
    })
  })
})
