import { describe, it, expect, beforeAll, afterAll } from "vitest"
import * as os from "os"
import * as path from "path"
import * as fs from "fs/promises"
import { execFileSync } from "child_process"
import { NtGraphDb } from "../ntgraph/index"
import { ExtractionOrchestrator, IndexOptions } from "../extraction/Orchestrator"
import { detectLanguage } from "../extraction/LanguageDetector"
import { shouldIndexFile, isBinaryFile, isTooLarge, resolveRelativePath } from "../extraction/PathValidation"
import { NodeKind, EdgeKind, DEFAULT_IGNORE_DIRS, MAX_FILE_SIZE } from "../ntgraph/Types"

let treeSitterAvailable = false
try {
  const Parser = require("tree-sitter")
  const tsGrammar = require("tree-sitter-typescript")
  const p = new Parser()
  p.setLanguage(tsGrammar.TSTypeScript)
  treeSitterAvailable = true
} catch {
  // tree-sitter недоступен
}

function initGit(dir: string): void {
  try {
    execFileSync("git", ["init"], { cwd: dir, stdio: "pipe" })
    execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: dir, stdio: "pipe" })
    execFileSync("git", ["config", "user.name", "Test"], { cwd: dir, stdio: "pipe" })
  } catch {
    // git недоступен
  }
}

describe("extraction pipeline", () => {
  let tmpDir: string

  beforeAll(async () => {
    tmpDir = path.join(os.tmpdir(), `ntgraph-extract-test-${Date.now()}`)
    await fs.mkdir(tmpDir, { recursive: true })
  })

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  // --- Детектор языка ---

  describe("LanguageDetector", () => {
    it("detects TypeScript from .ts extension", () => {
      expect(detectLanguage("src/file.ts")).toBe("typescript")
    })

    it("detects TypeScript from .tsx extension", () => {
      expect(detectLanguage("src/file.tsx")).toBe("typescript")
    })

    it("detects JavaScript from .js extension", () => {
      expect(detectLanguage("src/file.js")).toBe("typescript")
    })

    it("detects Python from .py extension", () => {
      expect(detectLanguage("src/file.py")).toBe("python")
    })

    it("detects Go from .go extension", () => {
      expect(detectLanguage("src/file.go")).toBe("go")
    })

    it("detects Rust from .rs extension", () => {
      expect(detectLanguage("src/file.rs")).toBe("rust")
    })

    it("detects Java from .java extension", () => {
      expect(detectLanguage("src/file.java")).toBe("java")
    })

    it("detects C++ from .cpp extension", () => {
      expect(detectLanguage("src/file.cpp")).toBe("cpp")
    })

    it("detects C# from .cs extension", () => {
      expect(detectLanguage("src/file.cs")).toBe("csharp")
    })

    it("detects Python from shebang", () => {
      expect(detectLanguage("script", "#!/usr/bin/env python3\nprint(1)")).toBe("python")
    })

    it("returns unknown for unrecognized extension", () => {
      expect(detectLanguage("src/file.xyz")).toBe("unknown")
    })
  })

  // --- Валидация путей ---

  describe("PathValidation", () => {
    it("rejects files in node_modules", () => {
      expect(shouldIndexFile("node_modules/pkg/index.js")).toBe(false)
    })

    it("rejects files in __pycache__", () => {
      expect(shouldIndexFile("src/__pycache__/module.cpython-39.pyc")).toBe(false)
    })

    it("rejects files in target directory", () => {
      expect(shouldIndexFile("target/release/main")).toBe(false)
    })

    it("rejects files in dist directory", () => {
      expect(shouldIndexFile("dist/bundle.js")).toBe(false)
    })

    it("allows files in source directory", () => {
      expect(shouldIndexFile("src/index.ts")).toBe(true)
    })

    it("allows files in nested source directory", () => {
      expect(shouldIndexFile("src/components/Button.tsx")).toBe(true)
    })

    it("rejects files matching ignore patterns", () => {
      expect(shouldIndexFile("src/test.spec.ts", DEFAULT_IGNORE_DIRS, ["spec.ts"])).toBe(false)
    })

    it("allows files not matching ignore patterns", () => {
      expect(shouldIndexFile("src/index.ts", DEFAULT_IGNORE_DIRS, ["spec.ts"])).toBe(true)
    })

    it("detects binary file with null bytes", () => {
      const binary = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x00, 0x6f])
      expect(isBinaryFile(binary)).toBe(true)
    })

    it("allows text content without null bytes", () => {
      const text = Buffer.from("Hello World\nThis is a test\n")
      expect(isBinaryFile(text)).toBe(false)
    })

    it("rejects file exceeding max size", () => {
      expect(isTooLarge(MAX_FILE_SIZE + 1)).toBe(true)
    })

    it("allows file at exact max size", () => {
      expect(isTooLarge(MAX_FILE_SIZE)).toBe(false)
    })

    it("allows file below max size", () => {
      expect(isTooLarge(1024)).toBe(false)
    })

    it("resolves relative path correctly on Windows", () => {
      const root = "C:\\home\\user\\project"
      const full = "C:\\home\\user\\project\\src\\index.ts"
      const rel = resolveRelativePath(full, root)
      expect(rel).toBe("src\\index.ts")
    })

    it("resolves relative path using OS-specific separator", () => {
      const sep = path.sep
      const root = `C:${sep}home${sep}user${sep}project`
      const full = `C:${sep}home${sep}user${sep}project${sep}src${sep}index.ts`
      const rel = resolveRelativePath(full, root)
      expect(rel).toBe(`src${sep}index.ts`)
    })
  })

  // --- Экстрактор TypeScript ---

  describe("TypeScript extractor", () => {
    it("extracts class declaration with methods", async () => {
      if (!treeSitterAvailable) return
      const srcDir = path.join(tmpDir, "ts-test")
      await fs.mkdir(srcDir, { recursive: true })
      initGit(srcDir)

      await fs.writeFile(
        path.join(srcDir, "Class.ts"),
        `export class Greeter {
  private greeting: string;

  constructor(greeting: string) {
    this.greeting = greeting;
  }

  public greet(): string {
    return this.greeting;
  }
}`
      )

      const dbPath = path.join(tmpDir, "ts-test.db")
      const testDb = NtGraphDb.initialize({ projectRoot: srcDir, dbPath })
      const orch = new ExtractionOrchestrator(srcDir, testDb)
      const result = await orch.indexAll()

      expect(result.filesIndexed).toBeGreaterThan(0)
      expect(result.nodesCreated).toBeGreaterThan(0)
      expect(result.edgesCreated).toBeGreaterThan(0)

      const stats = testDb.getStats()
      expect(stats.nodeCount).toBeGreaterThan(0)
      expect(stats.edgeCount).toBeGreaterThan(0)

      testDb.close()
      await fs.rm(srcDir, { recursive: true, force: true })
    })

    it("extracts function declaration with parameters", async () => {
      if (!treeSitterAvailable) return
      const srcDir = path.join(tmpDir, "ts-func-test")
      await fs.mkdir(srcDir, { recursive: true })
      initGit(srcDir)

      await fs.writeFile(
        path.join(srcDir, "utils.ts"),
        `/**
 * Adds two numbers together.
 */
export function add(a: number, b: number): number {
  return a + b;
}`
      )

      const dbPath = path.join(tmpDir, "ts-func-test.db")
      const testDb = NtGraphDb.initialize({ projectRoot: srcDir, dbPath })
      const orch = new ExtractionOrchestrator(srcDir, testDb)
      const result = await orch.indexAll()

      expect(result.filesIndexed).toBeGreaterThan(0)
      expect(result.nodesCreated).toBeGreaterThan(0)

      testDb.close()
      await fs.rm(srcDir, { recursive: true, force: true })
    })

    it("extracts interface with extends", async () => {
      if (!treeSitterAvailable) return
      const srcDir = path.join(tmpDir, "ts-iface-test")
      await fs.mkdir(srcDir, { recursive: true })
      initGit(srcDir)

      await fs.writeFile(
        path.join(srcDir, "types.ts"),
        `interface Base {
  id: string;
}

interface Extended extends Base {
  name: string;
}`
      )

      const dbPath = path.join(tmpDir, "ts-iface-test.db")
      const testDb = NtGraphDb.initialize({ projectRoot: srcDir, dbPath })
      const orch = new ExtractionOrchestrator(srcDir, testDb)
      const result = await orch.indexAll()

      expect(result.filesIndexed).toBeGreaterThan(0)

      testDb.close()
      await fs.rm(srcDir, { recursive: true, force: true })
    })

    it("extracts import statements", async () => {
      if (!treeSitterAvailable) return
      const srcDir = path.join(tmpDir, "ts-import-test")
      await fs.mkdir(srcDir, { recursive: true })
      initGit(srcDir)

      await fs.writeFile(
        path.join(srcDir, "index.ts"),
        `import { Component } from '@angular/core';
import React from 'react';`
      )

      const dbPath = path.join(tmpDir, "ts-import-test.db")
      const testDb = NtGraphDb.initialize({ projectRoot: srcDir, dbPath })
      const orch = new ExtractionOrchestrator(srcDir, testDb)
      const result = await orch.indexAll()

      expect(result.filesIndexed).toBeGreaterThan(0)

      testDb.close()
      await fs.rm(srcDir, { recursive: true, force: true })
    })

    it("extracts enum with members", async () => {
      if (!treeSitterAvailable) return
      const srcDir = path.join(tmpDir, "ts-enum-test")
      await fs.mkdir(srcDir, { recursive: true })
      initGit(srcDir)

      await fs.writeFile(
        path.join(srcDir, "enums.ts"),
        `export enum Color {
  Red,
  Green,
  Blue
}`
      )

      const dbPath = path.join(tmpDir, "ts-enum-test.db")
      const testDb = NtGraphDb.initialize({ projectRoot: srcDir, dbPath })
      const orch = new ExtractionOrchestrator(srcDir, testDb)
      const result = await orch.indexAll()

      expect(result.filesIndexed).toBeGreaterThan(0)

      testDb.close()
      await fs.rm(srcDir, { recursive: true, force: true })
    })

    it("extracts type alias", async () => {
      if (!treeSitterAvailable) return
      const srcDir = path.join(tmpDir, "ts-type-test")
      await fs.mkdir(srcDir, { recursive: true })
      initGit(srcDir)

      await fs.writeFile(
        path.join(srcDir, "types.ts"),
        `export type UserId = string;`
      )

      const dbPath = path.join(tmpDir, "ts-type-test.db")
      const testDb = NtGraphDb.initialize({ projectRoot: srcDir, dbPath })
      const orch = new ExtractionOrchestrator(srcDir, testDb)
      const result = await orch.indexAll()

      expect(result.filesIndexed).toBeGreaterThan(0)

      testDb.close()
      await fs.rm(srcDir, { recursive: true, force: true })
    })

    it("handles empty file gracefully", async () => {
      if (!treeSitterAvailable) return
      const srcDir = path.join(tmpDir, "ts-empty-test")
      await fs.mkdir(srcDir, { recursive: true })
      initGit(srcDir)

      await fs.writeFile(path.join(srcDir, "empty.ts"), "")

      const dbPath = path.join(tmpDir, "ts-empty-test.db")
      const testDb = NtGraphDb.initialize({ projectRoot: srcDir, dbPath })
      const orch = new ExtractionOrchestrator(srcDir, testDb)
      const result = await orch.indexAll()

      expect(result.errors.length).toBe(0)

      testDb.close()
      await fs.rm(srcDir, { recursive: true, force: true })
    })
  })

  // --- Экстрактор Python ---

  describe("Python extractor", () => {
    it("extracts class with methods", async () => {
      if (!treeSitterAvailable) return
      const srcDir = path.join(tmpDir, "py-test")
      await fs.mkdir(srcDir, { recursive: true })
      initGit(srcDir)

      await fs.writeFile(
        path.join(srcDir, "greeter.py"),
        `class Greeter:
    """A simple greeter class."""
    def __init__(self, name: str):
        self.name = name

    def greet(self) -> str:
        return f"Hello, {self.name}!"`
      )

      const dbPath = path.join(tmpDir, "py-test.db")
      const testDb = NtGraphDb.initialize({ projectRoot: srcDir, dbPath })
      const orch = new ExtractionOrchestrator(srcDir, testDb)
      const result = await orch.indexAll()

      expect(result.filesIndexed).toBeGreaterThan(0)
      expect(result.nodesCreated).toBeGreaterThan(0)

      testDb.close()
      await fs.rm(srcDir, { recursive: true, force: true })
    })

    it("extracts standalone function", async () => {
      if (!treeSitterAvailable) return
      const srcDir = path.join(tmpDir, "py-func-test")
      await fs.mkdir(srcDir, { recursive: true })
      initGit(srcDir)

      await fs.writeFile(
        path.join(srcDir, "utils.py"),
        `def add(a: int, b: int) -> int:
    """Add two numbers."""
    return a + b`
      )

      const dbPath = path.join(tmpDir, "py-func-test.db")
      const testDb = NtGraphDb.initialize({ projectRoot: srcDir, dbPath })
      const orch = new ExtractionOrchestrator(srcDir, testDb)
      const result = await orch.indexAll()

      expect(result.filesIndexed).toBeGreaterThan(0)

      testDb.close()
      await fs.rm(srcDir, { recursive: true, force: true })
    })
  })

  // --- Константы NodeKind и EdgeKind ---

  describe("NodeKind and EdgeKind", () => {
    it("contains all expected NodeKind values", () => {
      expect(NodeKind.File).toBe("file")
      expect(NodeKind.Class).toBe("class")
      expect(NodeKind.Function).toBe("function")
      expect(NodeKind.Method).toBe("method")
      expect(NodeKind.Property).toBe("property")
      expect(NodeKind.Field).toBe("field")
      expect(NodeKind.Interface).toBe("interface")
      expect(NodeKind.Struct).toBe("struct")
      expect(NodeKind.Enum).toBe("enum")
      expect(NodeKind.TypeAlias).toBe("type_alias")
      expect(NodeKind.Constant).toBe("constant")
      expect(NodeKind.Variable).toBe("variable")
      expect(NodeKind.Namespace).toBe("namespace")
      expect(NodeKind.Module).toBe("module")
      expect(NodeKind.Route).toBe("route")
      expect(NodeKind.Trait).toBe("trait")
      expect(NodeKind.Protocol).toBe("protocol")
      expect(NodeKind.EnumMember).toBe("enum_member")
      expect(NodeKind.Parameter).toBe("parameter")
      expect(NodeKind.Import).toBe("import")
      expect(NodeKind.Export).toBe("export")
      expect(NodeKind.Component).toBe("component")
      expect(NodeKind.Try).toBe("try")
      expect(NodeKind.Catch).toBe("catch")
      expect(NodeKind.Throw).toBe("throw")
      expect(NodeKind.Decorator).toBe("decorator")
      expect(NodeKind.TypeParameter).toBe("type_parameter")
      expect(NodeKind.Generic).toBe("generic")
    })

    it("contains all expected EdgeKind values", () => {
      expect(EdgeKind.Contains).toBe("contains")
      expect(EdgeKind.Calls).toBe("calls")
      expect(EdgeKind.Imports).toBe("imports")
      expect(EdgeKind.Exports).toBe("exports")
      expect(EdgeKind.Extends).toBe("extends")
      expect(EdgeKind.Implements).toBe("implements")
      expect(EdgeKind.References).toBe("references")
      expect(EdgeKind.TypeOf).toBe("type_of")
      expect(EdgeKind.Returns).toBe("returns")
      expect(EdgeKind.Instantiates).toBe("instantiates")
      expect(EdgeKind.Overrides).toBe("overrides")
      expect(EdgeKind.Decorates).toBe("decorates")
      expect(EdgeKind.Catches).toBe("catches")
      expect(EdgeKind.Throws).toBe("throws")
      expect(EdgeKind.ReExports).toBe("re_exports")
    })
  })

  // --- Интеграция с Orchestrator ---

  describe("Orchestrator", () => {
    it("reports progress during indexing", async () => {
      const srcDir = path.join(tmpDir, "orch-progress-test")
      await fs.mkdir(srcDir, { recursive: true })
      initGit(srcDir)

      await fs.writeFile(
        path.join(srcDir, "a.ts"),
        "export function a() { return 1; }"
      )
      await fs.writeFile(
        path.join(srcDir, "b.ts"),
        "export function b() { return 2; }"
      )

      const progressPhases: string[] = []
      const onProgress = (p: { phase: string }) => {
        progressPhases.push(p.phase)
      }

      const dbPath = path.join(tmpDir, "orch-progress-test.db")
      const testDb = NtGraphDb.initialize({ projectRoot: srcDir, dbPath })
      const orch = new ExtractionOrchestrator(srcDir, testDb)
      await orch.indexAll(onProgress)

      expect(progressPhases).toContain("scanning")
      expect(progressPhases).toContain("parsing")

      testDb.close()
      await fs.rm(srcDir, { recursive: true, force: true })
    })

    it("handles abort signal", async () => {
      const srcDir = path.join(tmpDir, "orch-abort-test")
      await fs.mkdir(srcDir, { recursive: true })
      initGit(srcDir)

      await fs.writeFile(
        path.join(srcDir, "a.ts"),
        "export function a() { return 1; }"
      )

      const controller = new AbortController()
      controller.abort()

      const dbPath = path.join(tmpDir, "orch-abort-test.db")
      const testDb = NtGraphDb.initialize({ projectRoot: srcDir, dbPath })
      const orch = new ExtractionOrchestrator(srcDir, testDb)
      const result = await orch.indexAll(undefined, controller.signal)

      expect(result.errors.some(e => e.message === 'Операция отменена')).toBe(true)

      testDb.close()
      await fs.rm(srcDir, { recursive: true, force: true })
    })

    it("skips binary files", async () => {
      if (!treeSitterAvailable) return
      const srcDir = path.join(tmpDir, "orch-binary-test")
      await fs.mkdir(srcDir, { recursive: true })
      initGit(srcDir)

      await fs.writeFile(
        path.join(srcDir, "a.ts"),
        "export function a() { return 1; }"
      )
      await fs.writeFile(
        path.join(srcDir, "binary.ts"),
        Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x00, 0x6f])
      )

      const dbPath = path.join(tmpDir, "orch-binary-test.db")
      const testDb = NtGraphDb.initialize({ projectRoot: srcDir, dbPath })
      const orch = new ExtractionOrchestrator(srcDir, testDb)
      const result = await orch.indexAll()

      expect(result.indexed).toBe(1)

      testDb.close()
      await fs.rm(srcDir, { recursive: true, force: true })
    })

    it("skips files exceeding max size", async () => {
      if (!treeSitterAvailable) return
      const srcDir = path.join(tmpDir, "orch-size-test")
      await fs.mkdir(srcDir, { recursive: true })
      initGit(srcDir)

      await fs.writeFile(
        path.join(srcDir, "a.ts"),
        "export function a() { return 1; }"
      )

      const dbPath = path.join(tmpDir, "orch-size-test.db")
      const testDb = NtGraphDb.initialize({ projectRoot: srcDir, dbPath })
      const orch = new ExtractionOrchestrator(srcDir, testDb)
      const result = await orch.indexAll()

      expect(result.errors.length).toBe(0)
      expect(result.indexed).toBeGreaterThan(0)

      testDb.close()
      await fs.rm(srcDir, { recursive: true, force: true })
    })

    it("returns graph stats after indexing", async () => {
      if (!treeSitterAvailable) {
        return
      }

      const srcDir = path.join(tmpDir, "orch-stats-test")
      await fs.mkdir(srcDir, { recursive: true })
      initGit(srcDir)

      await fs.writeFile(
        path.join(srcDir, "a.ts"),
        `class A {
  greet(): string {
    return "hello";
  }
}`
      )

      const dbPath = path.join(tmpDir, "orch-stats-test.db")
      const testDb = NtGraphDb.initialize({ projectRoot: srcDir, dbPath })
      const orch = new ExtractionOrchestrator(srcDir, testDb)
      await orch.indexAll()

      const stats = testDb.getStats()
      expect(stats.nodeCount).toBeGreaterThan(0)
      expect(stats.edgeCount).toBeGreaterThan(0)
      expect(stats.fileCount).toBeGreaterThan(0)

      testDb.close()
      await fs.rm(srcDir, { recursive: true, force: true })
    })
  })
})
