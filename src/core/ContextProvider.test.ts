import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  ContextProviderRegistry,
  makeUrlProvider,
  makeWebSearchProvider,
  makeFileProvider,
  makeCodeProvider,
  makeTreeProvider,
  makeRepoMapProvider,
  makeRulesProvider,
  makeMCPProvider,
  loadRulesFiles,
} from "./ContextProvider"

vi.mock("fs/promises", () => ({
  stat: vi.fn(),
  readFile: vi.fn(),
  readdir: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}))

import * as fs from "fs/promises"

describe("ContextProviderRegistry", () => {
  let reg: ContextProviderRegistry

  beforeEach(() => {
    reg = new ContextProviderRegistry()
  })

  it("registers and retrieves provider", () => {
    const provider = {
      description: { name: "test", displayTitle: "Test", description: "desc", type: "normal" as const },
      resolve: vi.fn().mockResolvedValue([]),
    }
    reg.register(provider)
    expect(reg.get("test")).toBe(provider)
    expect(reg.has("test")).toBe(true)
  })

  it("unregisters provider", () => {
    const provider = {
      description: { name: "test", displayTitle: "Test", description: "desc", type: "normal" as const },
      resolve: vi.fn().mockResolvedValue([]),
    }
    reg.register(provider)
    reg.unregister("test")
    expect(reg.get("test")).toBeUndefined()
    expect(reg.has("test")).toBe(false)
  })

  it("lists providers", () => {
    const p1 = {
      description: { name: "a", displayTitle: "A", description: "a", type: "normal" as const },
      resolve: vi.fn().mockResolvedValue([]),
    }
    const p2 = {
      description: { name: "b", displayTitle: "B", description: "b", type: "normal" as const },
      resolve: vi.fn().mockResolvedValue([]),
    }
    reg.register(p1)
    reg.register(p2)
    expect(reg.list()).toHaveLength(2)
  })

  it("returns undefined for missing provider", () => {
    expect(reg.get("missing")).toBeUndefined()
    expect(reg.has("missing")).toBe(false)
  })
})

describe("makeUrlProvider", () => {
  const provider = makeUrlProvider()

  it("returns empty for empty query", async () => {
    const result = await provider.resolve("")
    expect(result).toEqual([])
  })

  it("returns error for invalid URL", async () => {
    const result = await provider.resolve("not a url")
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain("Некорректный URL")
  })

  it("returns error for fetch failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")))
    const result = await provider.resolve("https://example.com")
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain("Ошибка загрузки")
    vi.unstubAllGlobals()
  })

  it("returns error for non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
    }))
    const result = await provider.resolve("https://example.com")
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain("HTTP 404")
    vi.unstubAllGlobals()
  })

  it("returns content for successful fetch", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue("<html><title>Test</title><body><p>Hello</p></body></html>"),
    }))
    const result = await provider.resolve("https://example.com")
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain("Источник: https://example.com")
    expect(result[0].name).toBe("Test")
    vi.unstubAllGlobals()
  })

  it("adds https for bare domain", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")))
    const result = await provider.resolve("example.com")
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain("Ошибка загрузки")
    vi.unstubAllGlobals()
  })
})

describe("makeWebSearchProvider", () => {
  const provider = makeWebSearchProvider()

  it("returns empty for empty query", async () => {
    const result = await provider.resolve("")
    expect(result).toEqual([])
  })

  it("returns error for fetch failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")))
    const result = await provider.resolve("test query")
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain("Ошибка поиска")
    vi.unstubAllGlobals()
  })

  it("returns search results", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        Abstract: "Some abstract",
        RelatedTopics: [{ Text: "Topic 1" }, { Text: "Topic 2" }],
      }),
    }))
    const result = await provider.resolve("test query")
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain("Some abstract")
    expect(result[0].content).toContain("Topic 1")
    vi.unstubAllGlobals()
  })

  it("returns error for non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    const result = await provider.resolve("test query")
    expect(result[0].content).toContain("Поиск недоступен")
    vi.unstubAllGlobals()
  })
})

describe("makeFileProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns empty for empty query", async () => {
    const provider = makeFileProvider(() => "/work")
    const result = await provider.resolve("")
    expect(result).toEqual([])
  })

  it("returns error for directory", async () => {
    vi.mocked(fs.stat).mockResolvedValueOnce({ isDirectory: () => true, size: 0 } as any)
    const provider = makeFileProvider(() => "/work")
    const result = await provider.resolve("somefile")
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain("Это директория")
  })

  it("returns error for too large file", async () => {
    vi.mocked(fs.stat).mockResolvedValueOnce({ isDirectory: () => false, size: 300_000 } as any)
    const provider = makeFileProvider(() => "/work")
    const result = await provider.resolve("bigfile")
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain("слишком большой")
  })

  it("returns file content", async () => {
    vi.mocked(fs.stat).mockResolvedValueOnce({ isDirectory: () => false, size: 100 } as any)
    vi.mocked(fs.readFile).mockResolvedValueOnce("const x = 1")
    const provider = makeFileProvider(() => "/work")
    const result = await provider.resolve("test.ts")
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain("const x = 1")
    expect(result[0].name).toBe("test.ts")
  })

  it("returns error for missing file", async () => {
    vi.mocked(fs.stat).mockRejectedValueOnce(new Error("ENOENT"))
    const provider = makeFileProvider(() => "/work")
    const result = await provider.resolve("missing.ts")
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain("Не удалось прочитать файл")
  })
})

describe("makeCodeProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns empty for empty query", async () => {
    const provider = makeCodeProvider(() => "/work", () => ({
      findByPattern: () => [],
      findByLanguage: () => [],
    }))
    const result = await provider.resolve("")
    expect(result).toEqual([])
  })

  it("returns not found when no matches", async () => {
    const provider = makeCodeProvider(() => "/work", () => ({
      findByPattern: () => [],
      findByLanguage: () => [],
    }))
    const result = await provider.resolve("nonexistent")
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain("не найдены")
  })

  it("returns code matches", async () => {
    vi.mocked(fs.stat).mockResolvedValueOnce({ size: 100 } as any)
    vi.mocked(fs.readFile).mockResolvedValueOnce("export class MyClass {}\nconst myVar = 1")
    const provider = makeCodeProvider(() => "/work", () => ({
      findByPattern: () => [{ path: "/work/test.ts", language: "typescript", size: 100 }],
      findByLanguage: () => [],
    }))
    const result = await provider.resolve("MyClass")
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain("Результаты поиска кода")
  })
})

describe("makeTreeProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns tree for work dir", async () => {
    vi.mocked(fs.readdir)
      .mockResolvedValueOnce([
        { name: "src", isDirectory: () => true } as any,
        { name: "package.json", isDirectory: () => false } as any,
      ])
      .mockResolvedValueOnce([])
    const provider = makeTreeProvider(() => "/work")
    const result = await provider.resolve("")
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain("Дерево: /work")
  })

  it("returns error for missing dir", async () => {
    vi.mocked(fs.readdir).mockRejectedValueOnce(new Error("ENOENT"))
    const provider = makeTreeProvider(() => "/work")
    const result = await provider.resolve("/nonexistent")
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain("Не удалось построить дерево")
  })
})

describe("makeRepoMapProvider", () => {
  it("returns repo map", async () => {
    const provider = makeRepoMapProvider(
      () => "/work",
      () => ({
        findByPattern: () => [],
        findByLanguage: () => [],
        stats: () => ({ totalFiles: 10, languages: 2, totalSize: 5000 }),
      }),
      () => Promise.resolve({
        fileCount: 100,
        dirCount: 20,
        languages: { typescript: 80, json: 20 },
        buildSystems: ["npm"],
        topDirs: ["/work/src"],
        notableFiles: ["/work/package.json"],
      }),
    )
    const result = await provider.resolve("")
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain("Карта репозитория")
    expect(result[0].content).toContain("Файлов: 100")
    expect(result[0].content).toContain("typescript: 80")
  })
})

describe("makeRulesProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns empty when no rules found", async () => {
    vi.mocked(fs.readdir).mockRejectedValueOnce(new Error("ENOENT"))
    vi.mocked(fs.readFile).mockRejectedValueOnce(new Error("ENOENT"))
    const provider = makeRulesProvider(() => "/work")
    const result = await provider.resolve("")
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain("не найдены")
  })

  it("returns rules from AGENTS.md", async () => {
    vi.mocked(fs.readdir).mockRejectedValueOnce(new Error("ENOENT"))
    vi.mocked(fs.readFile).mockResolvedValueOnce("# Test Rule")
    const provider = makeRulesProvider(() => "/work")
    const result = await provider.resolve("")
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain("# Test Rule")
    expect(result[0].content).toContain("## AGENTS.md")
  })
})

describe("makeMCPProvider", () => {
  it("returns empty when no tools", async () => {
    const provider = makeMCPProvider(() => Promise.resolve([]))
    const result = await provider.resolve("")
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain("не подключены")
  })

  it("returns all tools for empty query", async () => {
    const provider = makeMCPProvider(() => Promise.resolve([
      { server: "s1", tool: { name: "tool1", description: "desc1", schema: {} } },
    ]))
    const result = await provider.resolve("")
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain("tool1")
  })

  it("filters tools by query", async () => {
    const provider = makeMCPProvider(() => Promise.resolve([
      { server: "s1", tool: { name: "tool1", description: "desc1", schema: {} } },
      { server: "s2", tool: { name: "tool2", description: "desc2", schema: {} } },
    ]))
    const result = await provider.resolve("tool1")
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain("tool1")
    expect(result[0].content).not.toContain("tool2")
  })

  it("returns not found for no matches", async () => {
    const provider = makeMCPProvider(() => Promise.resolve([
      { server: "s1", tool: { name: "tool1", description: "desc1", schema: {} } },
    ]))
    const result = await provider.resolve("nonexistent")
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain("не найдены")
  })

  it("loads submenu items", async () => {
    const provider = makeMCPProvider(() => Promise.resolve([
      { server: "s1", tool: { name: "tool1", description: "desc1", schema: {} } },
    ]))
    const items = await provider.loadSubmenuItems?.()
    expect(items).toHaveLength(1)
    expect(items![0].id).toBe("s1:tool1")
  })
})

describe("loadRulesFiles", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns empty when no rules exist", async () => {
    vi.mocked(fs.readdir).mockRejectedValueOnce(new Error("ENOENT"))
    vi.mocked(fs.readFile).mockRejectedValueOnce(new Error("ENOENT"))
    const rules = await loadRulesFiles(() => "/work")
    expect(rules).toEqual([])
  })

  it("loads rules from .neuraltower/rules", async () => {
    vi.mocked(fs.readdir).mockResolvedValueOnce(["rule1.md", "rule2.md"])
    vi.mocked(fs.readFile)
      .mockResolvedValueOnce("# Rule 1")
      .mockResolvedValueOnce("# Rule 2")
      .mockRejectedValue(new Error("ENOENT"))
      .mockRejectedValue(new Error("ENOENT"))
      .mockRejectedValue(new Error("ENOENT"))
    const rules = await loadRulesFiles(() => "/work")
    expect(rules).toHaveLength(2)
    expect(rules[0].name).toBe("rule1.md")
    expect(rules[1].name).toBe("rule2.md")
  })
})
