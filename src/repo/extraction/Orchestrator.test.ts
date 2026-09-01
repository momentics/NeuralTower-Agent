import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest"
import * as os from "os"
import * as path from "path"
import * as fs from "fs/promises"
import * as fsSync from "fs"
import { NtGraphDb, createDatabase } from "../ntgraph/index"
import { ExtractionOrchestrator } from "./Orchestrator"
import { detectLanguage, isFileLevelOnlyLanguage } from "./LanguageDetector"
import { readGitignorePatterns, matchGitignorePattern } from "./Gitignore"
import { findIgnoredEmbeddedRepos, classifyGitDir } from "./EmbeddedRepos"

let tmpDir: string
let db: NtGraphDb
let orchestrator: ExtractionOrchestrator

beforeAll(async () => {
  tmpDir = path.join(os.tmpdir(), `ntgraph-orchestrator-test-${Date.now()}`)
  await fs.mkdir(tmpDir, { recursive: true })

  const dbPath = path.join(tmpDir, "test.db")
  db = new NtGraphDb(dbPath)
  db.initialize()
  orchestrator = new ExtractionOrchestrator(tmpDir, db)
})

afterAll(async () => {
  db.close()
  await fs.rm(tmpDir, { recursive: true, force: true })
})

beforeEach(() => {
  db.clear()
})

// --- stripComments: Python triple-quoted strings ---

describe("stripComments — Python triple-quoted strings", () => {
  it("preserves # inside triple-quoted docstring", () => {
    const content = `def foo():
    """This is a docstring with # hash"""
    x = 1  # real comment
    return x`

    const result = (orchestrator as any).stripComments(content, "python")

    // # inside triple-quoted string should be preserved
    expect(result).toContain("This is a docstring with # hash")
    // Real comment should be stripped
    expect(result).not.toContain("# real comment")
  })

  it("preserves # inside single triple-quoted string", () => {
    const content = `def foo():
    '''Another docstring with # hash'''
    x = 1  # real comment`

    const result = (orchestrator as any).stripComments(content, "python")

    expect(result).toContain("Another docstring with # hash")
    expect(result).not.toContain("# real comment")
  })

  it("handles multiline triple-quoted docstring", () => {
    const content = `def foo():
    """
    Multiline docstring
    with # hash inside
    """
    x = 1  # real comment`

    const result = (orchestrator as any).stripComments(content, "python")

    // The docstring content with # should be preserved
    expect(result).toContain("with # hash inside")
    // Real comment should be stripped
    expect(result).not.toContain("# real comment")
  })

  it("handles triple-quoted string that opens and closes on same line", () => {
    const content = `x = """hello # world""" + "# comment"`

    const result = (orchestrator as any).stripComments(content, "python")

    expect(result).toContain("hello # world")
    expect(result).not.toContain("# comment")
  })

  it("handles triple-quoted string that spans multiple lines", () => {
    const content = `x = """
line1 # not a comment
line2
"""
y = 1  # real comment`

    const result = (orchestrator as any).stripComments(content, "python")

    expect(result).toContain("line1 # not a comment")
    expect(result).not.toContain("# real comment")
    expect(result).toContain("y = 1")
  })

  it("handles nested quotes inside triple-quoted string", () => {
    const content = `x = """He said "hello # world" to me"""
y = 1  # real comment`

    const result = (orchestrator as any).stripComments(content, "python")

    expect(result).toContain("hello # world")
    expect(result).not.toContain("# real comment")
  })

  it("handles triple single quotes with # inside", () => {
    const content = `x = '''This has # hash'''
y = 1  # real comment`

    const result = (orchestrator as any).stripComments(content, "python")

    expect(result).toContain("This has # hash")
    expect(result).not.toContain("# real comment")
  })

  it("handles regular Python comments (no triple quotes)", () => {
    const content = `x = 1  # comment
y = 2`

    const result = (orchestrator as any).stripComments(content, "python")

    expect(result).not.toContain("# comment")
    expect(result).toContain("x = 1")
    expect(result).toContain("y = 2")
  })

  it("handles shebang line", () => {
    const content = `#!/usr/bin/env python3
x = 1`

    const result = (orchestrator as any).stripComments(content, "python")

    expect(result).not.toContain("#!/usr/bin/env python3")
    expect(result).toContain("x = 1")
  })

  it("handles triple-quoted string at start of file", () => {
    const content = `"""
Module docstring with # hash
"""
x = 1  # comment`

    const result = (orchestrator as any).stripComments(content, "python")

    expect(result).toContain("Module docstring with # hash")
    expect(result).not.toContain("# comment")
  })
})

// --- File-level only languages ---

describe("File-level only languages", () => {
  it("yaml is NOT file-level only", () => {
    expect(isFileLevelOnlyLanguage("yaml")).toBe(false)
  })

  it("properties is file-level only", () => {
    expect(isFileLevelOnlyLanguage("properties")).toBe(true)
  })

  it("xml is file-level only", () => {
    expect(isFileLevelOnlyLanguage("xml")).toBe(true)
  })

  it("typescript is NOT file-level only", () => {
    expect(isFileLevelOnlyLanguage("typescript")).toBe(false)
  })

  it("detects yaml from .yaml extension", () => {
    expect(detectLanguage("config.yaml")).toBe("yaml")
  })

  it("detects yaml from .yml extension", () => {
    expect(detectLanguage("config.yml")).toBe("yaml")
  })

  it("detects xml from .xml extension", () => {
    expect(detectLanguage("pom.xml")).toBe("xml")
  })

  it("detects properties from .properties extension", () => {
    expect(detectLanguage("app.properties")).toBe("properties")
  })
})

// --- Per-directory .gitignore parsing ---

describe("Per-directory .gitignore parsing", () => {
  it("reads .gitignore patterns from directory", async () => {
    const testDir = path.join(tmpDir, "gitignore-test")
    await fs.mkdir(testDir, { recursive: true })

    const gitignoreContent = "*.log\nbuild/\n!important.log\n"
    await fs.writeFile(path.join(testDir, ".gitignore"), gitignoreContent)

    const patterns = readGitignorePatterns(path.join(testDir, ".gitignore"))

    expect(patterns).toContain("*.log")
    expect(patterns).toContain("build/")
    expect(patterns).toContain("!important.log")

    await fs.rm(testDir, { recursive: true, force: true })
  })

  it("skips empty lines and comments in .gitignore", async () => {
    const testDir = path.join(tmpDir, "gitignore-test2")
    await fs.mkdir(testDir, { recursive: true })

    const gitignoreContent = "# This is a comment\n\n*.tmp\n\n# Another comment\n*.bak\n"
    await fs.writeFile(path.join(testDir, ".gitignore"), gitignoreContent)

    const patterns = readGitignorePatterns(path.join(testDir, ".gitignore"))

    expect(patterns).toContain("*.tmp")
    expect(patterns).toContain("*.bak")
    expect(patterns).not.toContain("# This is a comment")
    expect(patterns).not.toContain("")

    await fs.rm(testDir, { recursive: true, force: true })
  })

  it("handles double !! as negation", async () => {
    const testDir = path.join(tmpDir, "gitignore-test3")
    await fs.mkdir(testDir, { recursive: true })

    const gitignoreContent = "!!important.log\n"
    await fs.writeFile(path.join(testDir, ".gitignore"), gitignoreContent)

    const patterns = readGitignorePatterns(path.join(testDir, ".gitignore"))

    // Double !! is converted to ! + the rest of the string
    expect(patterns).toContain("!important.log")

    await fs.rm(testDir, { recursive: true, force: true })
  })

  it("matches gitignore pattern with glob", () => {
    expect(matchGitignorePattern("file.log", "*.log")).toBe(true)
    expect(matchGitignorePattern("file.txt", "*.log")).toBe(false)
  })

  it("matches gitignore pattern with directory", () => {
    expect(matchGitignorePattern("build/output.js", "build/")).toBe(true)
    expect(matchGitignorePattern("src/output.js", "build/")).toBe(false)
  })
})

// --- findIgnoredEmbeddedRepos ---

describe("findIgnoredEmbeddedRepos", () => {
  it("finds repos in vendor directory", async () => {
    const testDir = path.join(tmpDir, "vendor-test")
    const vendorDir = path.join(testDir, "vendor")
    const repoDir = path.join(vendorDir, "some-dep")
    await fs.mkdir(path.join(repoDir, ".git"), { recursive: true })

    const results = findIgnoredEmbeddedRepos(testDir)

    expect(results.length).toBeGreaterThan(0)
    expect(results.some(r => r.includes("vendor"))).toBe(true)

    await fs.rm(testDir, { recursive: true, force: true })
  })

  it("returns empty when no repos in ignored dirs", async () => {
    const testDir = path.join(tmpDir, "no-repo-test")
    await fs.mkdir(path.join(testDir, "vendor"), { recursive: true })

    const results = findIgnoredEmbeddedRepos(testDir)

    expect(results).toEqual([])

    await fs.rm(testDir, { recursive: true, force: true })
  })
})

// --- classifyGitDir ---

describe("classifyGitDir", () => {
  it("classifies embedded repo", async () => {
    const testDir = path.join(tmpDir, "embedded-git-test")
    await fs.mkdir(path.join(testDir, ".git"), { recursive: true })

    const result = classifyGitDir(testDir)

    expect(result).toBe("embedded")

    await fs.rm(testDir, { recursive: true, force: true })
  })

  it("classifies none when no .git", async () => {
    const testDir = path.join(tmpDir, "no-git-test")
    await fs.mkdir(testDir, { recursive: true })

    const result = classifyGitDir(testDir)

    expect(result).toBe("none")

    await fs.rm(testDir, { recursive: true, force: true })
  })

  it("classifies worktree when gitdir points outside", async () => {
    const testDir = path.join(tmpDir, "worktree-git-test")
    await fs.mkdir(testDir, { recursive: true })

    const gitContent = "gitdir: /outside/this/repo/.git/worktrees/branch1"
    await fs.writeFile(path.join(testDir, ".git"), gitContent)

    const result = classifyGitDir(testDir)

    expect(result).toBe("worktree")

    await fs.rm(testDir, { recursive: true, force: true })
  })
})

// --- resolveAndPersistBatched ---

describe("resolveAndPersistBatched", () => {
  it("resolves references and persists edges", async () => {
    const node1 = {
      id: "node1",
      kind: "function" as const,
      name: "foo",
      qualifiedName: "foo",
      filePath: "test.ts",
      language: "typescript" as const,
      startLine: 1,
      endLine: 1,
      startColumn: 0,
      endColumn: 0,
      updatedAt: Date.now(),
    }

    const node2 = {
      id: "node2",
      kind: "function" as const,
      name: "bar",
      qualifiedName: "bar",
      filePath: "test.ts",
      language: "typescript" as const,
      startLine: 2,
      endLine: 2,
      startColumn: 0,
      endColumn: 0,
      updatedAt: Date.now(),
    }

    db.insertNodes([node1, node2])

    db.insertUnresolvedRef({
      fromNodeId: "node1",
      referenceName: "bar",
      referenceKind: "calls",
      line: 1,
      column: 0,
    })

    const result = await orchestrator.resolveAndPersistBatched(undefined, 5000)

    expect(result.resolved.length).toBeGreaterThan(0)
    expect(result.resolved[0].targetNodeId).toBe("node2")
  })

  it("handles empty unresolved references", async () => {
    const result = await orchestrator.resolveAndPersistBatched(undefined, 5000)

    expect(result.resolved).toEqual([])
    expect(result.unresolved).toEqual([])
  })

  it("leaves unresolvable references in unresolved", async () => {
    const node1 = {
      id: "node1",
      kind: "function" as const,
      name: "foo",
      qualifiedName: "foo",
      filePath: "test.ts",
      language: "typescript" as const,
      startLine: 1,
      endLine: 1,
      startColumn: 0,
      endColumn: 0,
      updatedAt: Date.now(),
    }

    db.insertNodes([node1])

    db.insertUnresolvedRef({
      fromNodeId: "node1",
      referenceName: "nonexistent",
      referenceKind: "calls",
      line: 1,
      column: 0,
    })

    const result = await orchestrator.resolveAndPersistBatched(undefined, 5000)

    expect(result.unresolved.length).toBeGreaterThan(0)
    expect(result.unresolved[0].referenceName).toBe("nonexistent")
  })

  it("resolves by qualified name", async () => {
    const node1 = {
      id: "node1",
      kind: "function" as const,
      name: "foo",
      qualifiedName: "src/utils.ts::MathHelper.calculateTotal",
      filePath: "src/utils.ts",
      language: "typescript" as const,
      startLine: 1,
      endLine: 1,
      startColumn: 0,
      endColumn: 0,
      updatedAt: Date.now(),
    }

    db.insertNodes([node1])

    db.insertUnresolvedRef({
      fromNodeId: "node1",
      referenceName: "src/utils.ts::MathHelper.calculateTotal",
      referenceKind: "calls",
      line: 1,
      column: 0,
    })

    const result = await orchestrator.resolveAndPersistBatched(undefined, 5000)

    expect(result.resolved.length).toBeGreaterThan(0)
  })
})

// --- synthesizeCallbackEdges ---

describe("synthesizeCallbackEdges", () => {
  it("creates callback edges for addEventListener", async () => {
    const content = `function onMount() {
  bus.on('ready', function onReady() { console.log('ok'); });
}

function triggerReady() {
  bus.emit('ready');
}
`
    const testFile = "callback-test.ts"
    await fs.writeFile(path.join(tmpDir, testFile), content)

    const onMountNode = {
      id: "onMountNode",
      kind: "function" as const,
      name: "onMount",
      qualifiedName: "onMount",
      filePath: testFile,
      language: "typescript" as const,
      startLine: 1,
      endLine: 3,
      startColumn: 0,
      endColumn: 0,
      updatedAt: Date.now(),
    }

    const onReadyNode = {
      id: "onReadyNode",
      kind: "function" as const,
      name: "onReady",
      qualifiedName: "onReady",
      filePath: testFile,
      language: "typescript" as const,
      startLine: 2,
      endLine: 2,
      startColumn: 0,
      endColumn: 0,
      updatedAt: Date.now(),
    }

    const triggerReadyNode = {
      id: "triggerReadyNode",
      kind: "function" as const,
      name: "triggerReady",
      qualifiedName: "triggerReady",
      filePath: testFile,
      language: "typescript" as const,
      startLine: 5,
      endLine: 7,
      startColumn: 0,
      endColumn: 0,
      updatedAt: Date.now(),
    }

    const localDb = new NtGraphDb(path.join(tmpDir, "callback-test.db"))
    localDb.initialize()
    const localOrchestrator = new ExtractionOrchestrator(tmpDir, localDb)

    localDb.insertNodes([onMountNode, onReadyNode, triggerReadyNode])

    await localDb.upsertFile({
      path: testFile,
      contentHash: "hash",
      language: "typescript",
      size: content.length,
      modifiedAt: Date.now(),
      indexedAt: Date.now(),
      nodeCount: 3,
    })

    ;(localOrchestrator as any).synthesizeCallbackEdges()

    const edges = localDb.getOutgoingEdges("triggerReadyNode", ["calls"])
    expect(edges.length).toBeGreaterThan(0)
    expect(edges[0]?.target).toBe("onReadyNode")
    localDb.close()
  })

  it("does not throw when no callback patterns exist", () => {
    expect(() => {
      (orchestrator as any).synthesizeCallbackEdges()
    }).not.toThrow()
  })
})

// --- getImportMappings / getReExports ---

describe("getImportMappings / getReExports", () => {
  it("returns import mappings for a file", async () => {
    const importNode = {
      id: "importNode",
      kind: "import" as const,
      name: "utils",
      qualifiedName: "utils",
      filePath: "test.ts",
      language: "typescript" as const,
      startLine: 1,
      endLine: 1,
      startColumn: 0,
      endColumn: 0,
      updatedAt: Date.now(),
    }

    const targetNode = {
      id: "targetNode",
      kind: "function" as const,
      name: "helper",
      qualifiedName: "helper",
      filePath: "utils.ts",
      language: "typescript" as const,
      startLine: 1,
      endLine: 1,
      startColumn: 0,
      endColumn: 0,
      updatedAt: Date.now(),
    }

    db.insertNodes([importNode, targetNode])

    db.insertEdges([{
      source: "importNode",
      target: "targetNode",
      kind: "imports",
    }])

    const mappings = (orchestrator as any).getImportMappings("test.ts")

    expect(mappings.length).toBeGreaterThan(0)
    expect(mappings[0].resolvedPath).toBe("utils.ts")
  })

  it("returns empty when no imports exist", () => {
    const mappings = (orchestrator as any).getImportMappings("nonexistent.ts")
    expect(mappings).toEqual([])
  })

  it("returns re-exports for a file", async () => {
    const exportNode = {
      id: "exportNode",
      kind: "export" as const,
      name: "helper",
      qualifiedName: "helper",
      filePath: "utils.ts",
      language: "typescript" as const,
      startLine: 1,
      endLine: 1,
      startColumn: 0,
      endColumn: 0,
      updatedAt: Date.now(),
    }

    db.insertNodes([exportNode])

    db.insertEdges([{
      source: "exportNode",
      target: "exportNode",
      kind: "exports",
    }])

    const reExports = (orchestrator as any).getReExports("utils.ts")

    expect(reExports.length).toBeGreaterThan(0)
    expect(reExports[0].kind).toBe("named")
    expect(reExports[0].exportedName).toBe("helper")
  })

  it("returns empty when no exports exist", () => {
    const reExports = (orchestrator as any).getReExports("nonexistent.ts")
    expect(reExports).toEqual([])
  })
})

// --- buildDetectionContext with real import mappings ---

describe("buildDetectionContext", () => {
  it("returns import mappings from context", async () => {
    const importNode = {
      id: "importNode",
      kind: "import" as const,
      name: "utils",
      qualifiedName: "utils",
      filePath: "test.ts",
      language: "typescript" as const,
      startLine: 1,
      endLine: 1,
      startColumn: 0,
      endColumn: 0,
      updatedAt: Date.now(),
    }

    const targetNode = {
      id: "targetNode",
      kind: "function" as const,
      name: "helper",
      qualifiedName: "helper",
      filePath: "utils.ts",
      language: "typescript" as const,
      startLine: 1,
      endLine: 1,
      startColumn: 0,
      endColumn: 0,
      updatedAt: Date.now(),
    }

    db.insertNodes([importNode, targetNode])

    db.insertEdges([{
      source: "importNode",
      target: "targetNode",
      kind: "imports",
    }])

    const ctx = orchestrator.buildDetectionContext(["test.ts"])

    const mappings = ctx.getImportMappings("test.ts")
    expect(mappings.length).toBeGreaterThan(0)
  })

  it("returns re-exports from context", async () => {
    const exportNode = {
      id: "exportNode",
      kind: "export" as const,
      name: "helper",
      qualifiedName: "helper",
      filePath: "utils.ts",
      language: "typescript" as const,
      startLine: 1,
      endLine: 1,
      startColumn: 0,
      endColumn: 0,
      updatedAt: Date.now(),
    }

    db.insertNodes([exportNode])

    db.insertEdges([{
      source: "exportNode",
      target: "exportNode",
      kind: "exports",
    }])

    const ctx = orchestrator.buildDetectionContext(["utils.ts"])

    const reExports = ctx.getReExports("utils.ts")
    expect(reExports.length).toBeGreaterThan(0)
  })

  it("getFileContent returns content for existing file", () => {
    const testFile = path.join(tmpDir, "test-content.ts")
    fsSync.writeFileSync(testFile, "const x = 1")

    const ctx = orchestrator.buildDetectionContext(["test-content.ts"])
    const content = ctx.getFileContent("test-content.ts")

    expect(content).toBe("const x = 1")

    fsSync.unlinkSync(testFile)
  })

  it("getFileContent returns null for nonexistent file", () => {
    const ctx = orchestrator.buildDetectionContext([])
    const content = ctx.getFileContent("nonexistent.ts")

    expect(content).toBeNull()
  })
})
