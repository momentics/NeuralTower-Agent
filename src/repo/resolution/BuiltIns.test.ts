/**
 * Тесты встроенных символов.
 *
 * Проверяют фильтрацию встроенных символов по языкам.
 */

import { describe, it, expect } from "vitest"
import { isBuiltInSymbol, JS_BUILT_INS, REACT_HOOKS, PYTHON_BUILT_INS, GO_BUILT_INS, PASCAL_BUILT_INS, C_BUILT_INS, CPP_BUILT_INS } from "../resolution/BuiltIns"

describe("BuiltIns", () => {
  describe("isBuiltInSymbol", () => {
    it("detects JavaScript built-ins", () => {
      expect(isBuiltInSymbol('console', 'javascript')).toBe(true)
      expect(isBuiltInSymbol('Promise', 'typescript')).toBe(true)
      expect(isBuiltInSymbol('window', 'tsx')).toBe(true)
      expect(isBuiltInSymbol('document', 'jsx')).toBe(true)
      expect(isBuiltInSymbol('parseInt', 'javascript')).toBe(true)
      expect(isBuiltInSymbol('setTimeout', 'typescript')).toBe(true)
    })

    it("detects React hooks", () => {
      expect(isBuiltInSymbol('useState', 'typescript')).toBe(true)
      expect(isBuiltInSymbol('useEffect', 'javascript')).toBe(true)
      expect(isBuiltInSymbol('useContext', 'tsx')).toBe(true)
      expect(isBuiltInSymbol('useReducer', 'jsx')).toBe(true)
    })

    it("detects Python built-ins", () => {
      expect(isBuiltInSymbol('print', 'python')).toBe(true)
      expect(isBuiltInSymbol('len', 'python')).toBe(true)
      expect(isBuiltInSymbol('range', 'python')).toBe(true)
      expect(isBuiltInSymbol('isinstance', 'python')).toBe(true)
      expect(isBuiltInSymbol('super', 'python')).toBe(true)
    })

    it("detects Go built-ins", () => {
      expect(isBuiltInSymbol('make', 'go')).toBe(true)
      expect(isBuiltInSymbol('len', 'go')).toBe(true)
      expect(isBuiltInSymbol('panic', 'go')).toBe(true)
      expect(isBuiltInSymbol('nil', 'go')).toBe(true)
    })

    it("detects Pascal built-ins", () => {
      expect(isBuiltInSymbol('WriteLn', 'pascal')).toBe(true)
      expect(isBuiltInSymbol('ReadLn', 'pascal')).toBe(true)
      expect(isBuiltInSymbol('Trim', 'pascal')).toBe(true)
    })

    it("detects C built-ins", () => {
      expect(isBuiltInSymbol('printf', 'c')).toBe(true)
      expect(isBuiltInSymbol('malloc', 'c')).toBe(true)
      expect(isBuiltInSymbol('strlen', 'c')).toBe(true)
    })

    it("detects C++ built-ins", () => {
      expect(isBuiltInSymbol('cout', 'cpp')).toBe(true)
      expect(isBuiltInSymbol('vector', 'cpp')).toBe(true)
      expect(isBuiltInSymbol('printf', 'cpp')).toBe(true)
    })

    it("returns false for non-built-in symbols", () => {
      expect(isBuiltInSymbol('myFunction', 'javascript')).toBe(false)
      expect(isBuiltInSymbol('CustomClass', 'python')).toBe(false)
      expect(isBuiltInSymbol('handleClick', 'typescript')).toBe(false)
    })

    it("returns false for unknown languages", () => {
      expect(isBuiltInSymbol('console', 'rust')).toBe(false)
      expect(isBuiltInSymbol('print', 'unknown')).toBe(false)
    })
  })

  describe("JS_BUILT_INS set", () => {
    it("contains all expected symbols", () => {
      expect(JS_BUILT_INS.has('console')).toBe(true)
      expect(JS_BUILT_INS.has('Promise')).toBe(true)
      expect(JS_BUILT_INS.has('Array')).toBe(true)
      expect(JS_BUILT_INS.has('JSON')).toBe(true)
      expect(JS_BUILT_INS.has('setTimeout')).toBe(true)
      expect(JS_BUILT_INS.has('clearInterval')).toBe(true)
      expect(JS_BUILT_INS.has('myCustomFunc')).toBe(false)
    })
  })

  describe("REACT_HOOKS set", () => {
    it("contains all expected hooks", () => {
      expect(REACT_HOOKS.has('useState')).toBe(true)
      expect(REACT_HOOKS.has('useEffect')).toBe(true)
      expect(REACT_HOOKS.has('useContext')).toBe(true)
      expect(REACT_HOOKS.has('useCallback')).toBe(true)
      expect(REACT_HOOKS.has('useRef')).toBe(true)
      expect(REACT_HOOKS.has('useMemo')).toBe(true)
      expect(REACT_HOOKS.has('myCustomHook')).toBe(false)
    })
  })

  describe("PYTHON_BUILT_INS set", () => {
    it("contains all expected symbols", () => {
      expect(PYTHON_BUILT_INS.has('print')).toBe(true)
      expect(PYTHON_BUILT_INS.has('len')).toBe(true)
      expect(PYTHON_BUILT_INS.has('isinstance')).toBe(true)
      expect(PYTHON_BUILT_INS.has('super')).toBe(true)
      expect(PYTHON_BUILT_INS.has('myFunction')).toBe(false)
    })
  })

  describe("GO_BUILT_INS set", () => {
    it("contains all expected symbols", () => {
      expect(GO_BUILT_INS.has('make')).toBe(true)
      expect(GO_BUILT_INS.has('len')).toBe(true)
      expect(GO_BUILT_INS.has('panic')).toBe(true)
      expect(GO_BUILT_INS.has('nil')).toBe(true)
      expect(GO_BUILT_INS.has('myFunction')).toBe(false)
    })
  })

  describe("PASCAL_BUILT_INS set", () => {
    it("contains all expected symbols", () => {
      expect(PASCAL_BUILT_INS.has('WriteLn')).toBe(true)
      expect(PASCAL_BUILT_INS.has('ReadLn')).toBe(true)
      expect(PASCAL_BUILT_INS.has('Trim')).toBe(true)
      expect(PASCAL_BUILT_INS.has('myFunction')).toBe(false)
    })
  })

  describe("C_BUILT_INS set", () => {
    it("contains all expected symbols", () => {
      expect(C_BUILT_INS.has('printf')).toBe(true)
      expect(C_BUILT_INS.has('malloc')).toBe(true)
      expect(C_BUILT_INS.has('strlen')).toBe(true)
      expect(C_BUILT_INS.has('myFunction')).toBe(false)
    })
  })

  describe("CPP_BUILT_INS set", () => {
    it("contains all expected symbols", () => {
      expect(CPP_BUILT_INS.has('cout')).toBe(true)
      expect(CPP_BUILT_INS.has('vector')).toBe(true)
      expect(CPP_BUILT_INS.has('shared_ptr')).toBe(true)
      expect(CPP_BUILT_INS.has('myFunction')).toBe(false)
    })
  })
})
