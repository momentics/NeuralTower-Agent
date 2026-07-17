/**
 * Тесты извлечения импортов.
 *
 * Проверяют: extractImportMappings для JavaScript, Python, Go, JVM, Rust.
 */

import { describe, it, expect } from "vitest"
import { extractImportMappings, extractReExports, isPhpIncludePathRef } from "../resolution/ImportResolver"

describe("ImportResolver", () => {
  describe("extractImportMappings", () => {
    describe("JavaScript/TypeScript", () => {
      it("extracts named imports", () => {
        const content = `import { Foo, Bar as Baz } from './module'`
        const mappings = extractImportMappings('file.ts', content, 'typescript')
        expect(mappings).toHaveLength(2)
        expect(mappings[0]).toMatchObject({ localName: 'Foo', exportedName: 'Foo', source: './module' })
        expect(mappings[1]).toMatchObject({ localName: 'Bar', exportedName: 'Baz', source: './module' })
      })

      it("extracts default imports", () => {
        const content = `import Foo from './module'`
        const mappings = extractImportMappings('file.ts', content, 'typescript')
        expect(mappings).toHaveLength(1)
        expect(mappings[0]).toMatchObject({ localName: 'Foo', isDefault: true })
      })

      it("extracts namespace imports", () => {
        const content = `import * as Foo from './module'`
        const mappings = extractImportMappings('file.ts', content, 'typescript')
        expect(mappings).toHaveLength(1)
        expect(mappings[0]).toMatchObject({ localName: 'Foo', isNamespace: true })
      })
    })

    describe("Python", () => {
      it("extracts from imports", () => {
        const content = `from os import path, getcwd`
        const mappings = extractImportMappings('file.py', content, 'python')
        expect(mappings).toHaveLength(2)
        expect(mappings[0]).toMatchObject({ localName: 'path', source: 'os' })
        expect(mappings[1]).toMatchObject({ localName: 'getcwd', source: 'os' })
      })

      it("extracts plain imports", () => {
        const content = `import os.path`
        const mappings = extractImportMappings('file.py', content, 'python')
        expect(mappings).toHaveLength(1)
        expect(mappings[0]).toMatchObject({ localName: 'path', source: 'os.path' })
      })
    })

    describe("Go", () => {
      it("extracts block imports", () => {
        const content = `import (\n\t"fmt"\n\t"path/filepath"\n)`
        const mappings = extractImportMappings('file.go', content, 'go')
        expect(mappings).toHaveLength(2)
        expect(mappings[0]).toMatchObject({ localName: 'fmt', source: 'fmt' })
        expect(mappings[1]).toMatchObject({ localName: 'filepath', source: 'path/filepath' })
      })

      it("extracts aliased imports", () => {
        const content = `import (\n\tf "fmt"\n)`
        const mappings = extractImportMappings('file.go', content, 'go')
        expect(mappings).toHaveLength(1)
        expect(mappings[0]).toMatchObject({ localName: 'f', source: 'fmt' })
      })
    })

    describe("JVM", () => {
      it("extracts Java imports", () => {
        const content = `import java.util.List;\nimport static org.junit.Assert.*;`
        const mappings = extractImportMappings('File.java', content, 'java')
        expect(mappings).toHaveLength(2)
        expect(mappings[0]).toMatchObject({ localName: 'List', source: 'java.util.List' })
      })
    })

    describe("Rust", () => {
      it("extracts Rust use statements", () => {
        const content = `use std::collections::HashMap;`
        const mappings = extractImportMappings('file.rs', content, 'rust')
        expect(mappings).toHaveLength(1)
        expect(mappings[0]).toMatchObject({ localName: 'HashMap', source: 'std::collections::HashMap' })
      })
    })

    describe("PHP", () => {
      it("extracts PHP use statements", () => {
        const content = `use App\\Models\\User;`
        const mappings = extractImportMappings('file.php', content, 'php')
        expect(mappings).toHaveLength(1)
        expect(mappings[0]).toMatchObject({ localName: 'User', source: 'App\\Models\\User' })
      })
    })

    describe("C#", () => {
      it("extracts C# using statements", () => {
        const content = `using System.Collections.Generic;`
        const mappings = extractImportMappings('file.cs', content, 'csharp')
        expect(mappings).toHaveLength(1)
        expect(mappings[0]).toMatchObject({ localName: 'Generic', source: 'System.Collections.Generic' })
      })
    })

    describe("C/C++", () => {
      it("extracts C includes", () => {
        const content = `#include <stdio.h>\n#include "myheader.h"`
        const mappings = extractImportMappings('file.c', content, 'c')
        expect(mappings).toHaveLength(2)
        expect(mappings[0]).toMatchObject({ exportedName: 'stdio.h', source: 'stdio.h' })
        expect(mappings[1]).toMatchObject({ exportedName: 'myheader.h', source: 'myheader.h' })
      })
    })
  })

  describe("extractReExports", () => {
    it("extracts named re-exports", () => {
      const content = `export { Foo, Bar as Baz } from './module'`
      const reExports = extractReExports(content, 'typescript')
      expect(reExports).toHaveLength(2)
      expect((reExports[0] as any).kind).toBe('named')
      expect((reExports[0] as any).exportedName).toBe('Foo')
      expect((reExports[1] as any).exportedName).toBe('Bar')
    })

    it("extracts wildcard re-exports", () => {
      const content = `export * from './module'`
      const reExports = extractReExports(content, 'typescript')
      expect(reExports).toHaveLength(1)
      expect((reExports[0] as any).kind).toBe('wildcard')
    })

    it("returns empty for non-JavaScript languages", () => {
      const content = `from os import path`
      const reExports = extractReExports(content, 'python')
      expect(reExports).toHaveLength(0)
    })
  })

  describe("isPhpIncludePathRef", () => {
    it("returns true for PHP include path references", () => {
      const ref = { referenceName: 'vendor/autoload.php', language: 'php' } as any
      expect(isPhpIncludePathRef(ref)).toBe(true)
    })

    it("returns true for PHP references with path separators", () => {
      const ref = { referenceName: 'src/Utils.php', language: 'php' } as any
      expect(isPhpIncludePathRef(ref)).toBe(true)
    })

    it("returns false for non-PHP languages", () => {
      const ref = { referenceName: 'vendor/autoload.php', language: 'javascript' } as any
      expect(isPhpIncludePathRef(ref)).toBe(false)
    })

    it("returns false for PHP references without path", () => {
      const ref = { referenceName: 'autoload', language: 'php' } as any
      expect(isPhpIncludePathRef(ref)).toBe(false)
    })
  })
})
