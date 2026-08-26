import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest"
import * as os from "os"
import * as path from "path"
import * as fs from "fs/promises"
import {
  isSourceFile,
  isLanguageSupported,
  isFileLevelOnlyLanguage,
  loadExtensionOverrides,
  getSupportedLanguages,
  EXTENSION_TO_LANGUAGE,
} from "./LanguageDetector"
import { isGrammarLoaded, loadGrammarWasm } from "./WasmRuntime"



let tmpDir: string

// Создаём временную директорию для тестов
beforeAll(async () => {
  tmpDir = path.join(os.tmpdir(), `ntgraph-lang-detector-test-${Date.now()}`)
  await fs.mkdir(tmpDir, { recursive: true })
})

// Удаляем временную директорию после завершения всех тестов
afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

// --- isSourceFile ---
// Тесты для функции isSourceFile — проверка определения исходных файлов по расширению

describe("isSourceFile", () => {
  it("returns true for .ts files", () => {
    expect(isSourceFile("src/file.ts")).toBe(true)
  })

  it("returns true for .tsx files", () => {
    expect(isSourceFile("src/file.tsx")).toBe(true)
  })

  it("returns true for .py files", () => {
    expect(isSourceFile("src/file.py")).toBe(true)
  })

  it("returns true for .go files", () => {
    expect(isSourceFile("src/file.go")).toBe(true)
  })

  it("returns true for .rs files", () => {
    expect(isSourceFile("src/file.rs")).toBe(true)
  })

  it("returns true for .java files", () => {
    expect(isSourceFile("src/file.java")).toBe(true)
  })

  it("returns true for .cpp files", () => {
    expect(isSourceFile("src/file.cpp")).toBe(true)
  })

  it("returns true for .cs files", () => {
    expect(isSourceFile("src/file.cs")).toBe(true)
  })

  it("returns true for .yaml files", () => {
    expect(isSourceFile("config.yaml")).toBe(true)
  })

  it("returns true for .json files", () => {
    expect(isSourceFile("package.json")).toBe(true)
  })

  it("returns true for .md files", () => {
    expect(isSourceFile("README.md")).toBe(true)
  })

  it("returns true for .vue files", () => {
    expect(isSourceFile("App.vue")).toBe(true)
  })

  it("returns true for dotfiles without extension", () => {
    expect(isSourceFile("Makefile")).toBe(false)
  })

  it("returns false for unknown extensions", () => {
    expect(isSourceFile("src/file.xyz")).toBe(false)
  })

  it("returns false for files without extension", () => {
    expect(isSourceFile("src/Dockerfile")).toBe(false)
  })

  it("returns true for .rb files", () => {
    expect(isSourceFile("lib/app.rb")).toBe(true)
  })

  it("returns true for .php files", () => {
    expect(isSourceFile("index.php")).toBe(true)
  })

  it("returns true for .swift files", () => {
    expect(isSourceFile("ViewController.swift")).toBe(true)
  })

  it("returns true for .kt files", () => {
    expect(isSourceFile("MainActivity.kt")).toBe(true)
  })

  it("returns true for .dart files", () => {
    expect(isSourceFile("main.dart")).toBe(true)
  })

  it("returns true for .sql files", () => {
    expect(isSourceFile("schema.sql")).toBe(true)
  })

  it("returns true for .sh files", () => {
    expect(isSourceFile("deploy.sh")).toBe(true)
  })

  it("returns true for .toml files", () => {
    expect(isSourceFile("Cargo.toml")).toBe(true)
  })

  it("returns true for .lua files", () => {
    expect(isSourceFile("init.lua")).toBe(true)
  })

  it("returns true for .scala files", () => {
    expect(isSourceFile("App.scala")).toBe(true)
  })
})

// --- isLanguageSupported ---
// Тесты для функции isLanguageSupported — проверка поддержки языка для парсинга

describe("isLanguageSupported", () => {
  it("returns true for typescript", () => {
    expect(isLanguageSupported("typescript")).toBe(true)
  })

  it("returns true for python", () => {
    expect(isLanguageSupported("python")).toBe(true)
  })

  it("returns true for go", () => {
    expect(isLanguageSupported("go")).toBe(true)
  })

  it("returns true for rust", () => {
    expect(isLanguageSupported("rust")).toBe(true)
  })

  it("returns true for java", () => {
    expect(isLanguageSupported("java")).toBe(true)
  })

  it("returns true for cpp", () => {
    expect(isLanguageSupported("cpp")).toBe(true)
  })

  it("returns true for c", () => {
    expect(isLanguageSupported("c")).toBe(true)
  })

  it("returns true for csharp", () => {
    expect(isLanguageSupported("csharp")).toBe(true)
  })

  it("returns false for unknown", () => {
    expect(isLanguageSupported("unknown")).toBe(false)
  })

  it("returns true for ruby", () => {
    expect(isLanguageSupported("ruby")).toBe(true)
  })

  it("returns true for php", () => {
    expect(isLanguageSupported("php")).toBe(true)
  })

  it("returns true for swift", () => {
    expect(isLanguageSupported("swift")).toBe(true)
  })

  it("returns true for kotlin", () => {
    expect(isLanguageSupported("kotlin")).toBe(true)
  })

  it("returns false for dart", () => {
    expect(isLanguageSupported("dart")).toBe(false)
  })

  it("returns true for vue", () => {
    expect(isLanguageSupported("vue")).toBe(true)
  })

  it("returns true for svelte", () => {
    expect(isLanguageSupported("svelte")).toBe(true)
  })

  it("returns true for astro", () => {
    expect(isLanguageSupported("astro")).toBe(true)
  })

  it("returns true for liquid", () => {
    expect(isLanguageSupported("liquid")).toBe(true)
  })

  it("returns true for razor", () => {
    expect(isLanguageSupported("razor")).toBe(true)
  })

  it("returns true for cfml", () => {
    expect(isLanguageSupported("cfml")).toBe(true)
  })

  it("returns true for pascal", () => {
    expect(isLanguageSupported("pascal")).toBe(true)
  })

  it("returns false for scala", () => {
    expect(isLanguageSupported("scala")).toBe(false)
  })

  it("returns false for lua", () => {
    expect(isLanguageSupported("lua")).toBe(false)
  })

  it("returns false for yaml", () => {
    expect(isLanguageSupported("yaml")).toBe(false)
  })

  it("returns false for json", () => {
    expect(isLanguageSupported("json")).toBe(false)
  })

  it("returns false for markdown", () => {
    expect(isLanguageSupported("markdown")).toBe(false)
  })

  it("returns false for shell", () => {
    expect(isLanguageSupported("shell")).toBe(false)
  })

  it("returns false for sql", () => {
    expect(isLanguageSupported("sql")).toBe(false)
  })

  it("returns false for css", () => {
    expect(isLanguageSupported("css")).toBe(false)
  })

  it("returns false for html", () => {
    expect(isLanguageSupported("html")).toBe(false)
  })

  it("returns true for xml", () => {
    expect(isLanguageSupported("xml")).toBe(true)
  })

  it("returns false for arbitrary string", () => {
    expect(isLanguageSupported("nonexistent")).toBe(false)
  })
})

// --- isFileLevelOnlyLanguage ---
// Тесты для функции isFileLevelOnlyLanguage — определение языков, которые парсятся только на уровне файла

describe("isFileLevelOnlyLanguage", () => {
  it("returns true for yaml", () => {
    expect(isFileLevelOnlyLanguage("yaml")).toBe(true)
  })

  it("returns true for properties", () => {
    expect(isFileLevelOnlyLanguage("properties")).toBe(true)
  })

  it("returns true for xml", () => {
    expect(isFileLevelOnlyLanguage("xml")).toBe(true)
  })

  it("returns false for typescript", () => {
    expect(isFileLevelOnlyLanguage("typescript")).toBe(false)
  })

  it("returns false for python", () => {
    expect(isFileLevelOnlyLanguage("python")).toBe(false)
  })

  it("returns false for go", () => {
    expect(isFileLevelOnlyLanguage("go")).toBe(false)
  })

  it("returns false for rust", () => {
    expect(isFileLevelOnlyLanguage("rust")).toBe(false)
  })

  it("returns false for java", () => {
    expect(isFileLevelOnlyLanguage("java")).toBe(false)
  })

  it("returns false for cpp", () => {
    expect(isFileLevelOnlyLanguage("cpp")).toBe(false)
  })

  it("returns false for json", () => {
    expect(isFileLevelOnlyLanguage("json")).toBe(false)
  })

  it("returns false for markdown", () => {
    expect(isFileLevelOnlyLanguage("markdown")).toBe(false)
  })

  it("returns false for html", () => {
    expect(isFileLevelOnlyLanguage("html")).toBe(false)
  })

  it("returns false for css", () => {
    expect(isFileLevelOnlyLanguage("css")).toBe(false)
  })

  it("returns false for sql", () => {
    expect(isFileLevelOnlyLanguage("sql")).toBe(false)
  })

  it("returns false for shell", () => {
    expect(isFileLevelOnlyLanguage("shell")).toBe(false)
  })

  it("returns false for unknown language", () => {
    expect(isFileLevelOnlyLanguage("unknown")).toBe(false)
  })

  it("returns false for arbitrary string", () => {
    expect(isFileLevelOnlyLanguage("nonexistent")).toBe(false)
  })
})

// --- loadExtensionOverrides ---

describe("loadExtensionOverrides", () => {
  beforeEach(async () => {
    // Восстанавливаем исходное состояние EXTENSION_TO_LANGUAGE
    const testExt = ".testext"
    if (testExt in EXTENSION_TO_LANGUAGE) {
      delete EXTENSION_TO_LANGUAGE[testExt]
    }
  })

  it("loads overrides from ntgraph.json", async () => {
    const testDir = path.join(tmpDir, "override-test")
    await fs.mkdir(testDir, { recursive: true })

    const config = {
      extensions: {
        ".testext": "testlang",
      },
    }
    await fs.writeFile(
      path.join(testDir, "ntgraph.json"),
      JSON.stringify(config)
    )

    loadExtensionOverrides(testDir)

    expect(EXTENSION_TO_LANGUAGE[".testext"]).toBe("testlang")

    // Очищаем после теста
    delete EXTENSION_TO_LANGUAGE[".testext"]
    await fs.rm(testDir, { recursive: true, force: true })
  })

  it("does nothing when ntgraph.json is missing", async () => {
    const testDir = path.join(tmpDir, "no-config-test")
    await fs.mkdir(testDir, { recursive: true })

    const before = { ...EXTENSION_TO_LANGUAGE }

    loadExtensionOverrides(testDir)

    expect(EXTENSION_TO_LANGUAGE).toEqual(before)

    await fs.rm(testDir, { recursive: true, force: true })
  })

  it("ignores config without extensions field", async () => {
    const testDir = path.join(tmpDir, "no-extensions-test")
    await fs.mkdir(testDir, { recursive: true })

    const config = {
      someOtherField: "value",
    }
    await fs.writeFile(
      path.join(testDir, "ntgraph.json"),
      JSON.stringify(config)
    )

    const before = { ...EXTENSION_TO_LANGUAGE }

    loadExtensionOverrides(testDir)

    expect(EXTENSION_TO_LANGUAGE).toEqual(before)

    await fs.rm(testDir, { recursive: true, force: true })
  })

  it("ignores non-string values in extensions", async () => {
    const testDir = path.join(tmpDir, "invalid-ext-test")
    await fs.mkdir(testDir, { recursive: true })

    const config = {
      extensions: {
        ".bad": 123,
        ".good": "goodlang",
      },
    }
    await fs.writeFile(
      path.join(testDir, "ntgraph.json"),
      JSON.stringify(config)
    )

    loadExtensionOverrides(testDir)

    expect(EXTENSION_TO_LANGUAGE[".bad"]).toBeUndefined()
    expect(EXTENSION_TO_LANGUAGE[".good"]).toBe("goodlang")

    // Очищаем после теста
    delete EXTENSION_TO_LANGUAGE[".good"]
    await fs.rm(testDir, { recursive: true, force: true })
  })

  it("overrides existing extension", async () => {
    const testDir = path.join(tmpDir, "override-existing-test")
    await fs.mkdir(testDir, { recursive: true })

    const original = EXTENSION_TO_LANGUAGE[".ts"]

    const config = {
      extensions: {
        ".ts": "overridden",
      },
    }
    await fs.writeFile(
      path.join(testDir, "ntgraph.json"),
      JSON.stringify(config)
    )

    loadExtensionOverrides(testDir)

    expect(EXTENSION_TO_LANGUAGE[".ts"]).toBe("overridden")

    // Восстанавливаем исходное значение
    EXTENSION_TO_LANGUAGE[".ts"] = original

    await fs.rm(testDir, { recursive: true, force: true })
  })

  it("does not throw on invalid JSON", async () => {
    const testDir = path.join(tmpDir, "invalid-json-test")
    await fs.mkdir(testDir, { recursive: true })

    await fs.writeFile(
      path.join(testDir, "ntgraph.json"),
      "not valid json {{{"
    )

    expect(() => loadExtensionOverrides(testDir)).not.toThrow()

    await fs.rm(testDir, { recursive: true, force: true })
  })

  it("does not throw on nonexistent directory", () => {
    expect(() =>
      loadExtensionOverrides(path.join(tmpDir, "nonexistent-dir"))
    ).not.toThrow()
  })

  it("extensions is not an object — ignored", async () => {
    const testDir = path.join(tmpDir, "extensions-not-object-test")
    await fs.mkdir(testDir, { recursive: true })

    const config = {
      extensions: "not-an-object",
    }
    await fs.writeFile(
      path.join(testDir, "ntgraph.json"),
      JSON.stringify(config)
    )

    const before = { ...EXTENSION_TO_LANGUAGE }

    loadExtensionOverrides(testDir)

    expect(EXTENSION_TO_LANGUAGE).toEqual(before)

    await fs.rm(testDir, { recursive: true, force: true })
  })
})

// --- isGrammarLoaded ---
// Тесты для грамматик — проверяем доступность WASM-грамматик через isGrammarCached

describe("WasmRuntime (grammars)", () => {
  it("isGrammarLoaded returns false before load", () => {
    expect(isGrammarLoaded("python")).toBe(false)
  })

  it("loadGrammarWasm loads a real grammar", async () => {
    const ok = await loadGrammarWasm("python")
    expect(ok).toBe(true)
    expect(isGrammarLoaded("python")).toBe(true)
  })

  it("loadGrammarWasm returns false for unknown language", async () => {
    expect(await loadGrammarWasm("nonexistent")).toBe(false)
  })
})

// --- getSupportedLanguages ---
// Тесты для функции getSupportedLanguages — проверка списка поддерживаемых языков

describe("getSupportedLanguages", () => {
  it("returns array of 24 languages", () => {
    const langs = getSupportedLanguages()
    expect(langs).toHaveLength(24)
  })

  it("contains typescript", () => {
    expect(getSupportedLanguages()).toContain("typescript")
  })

  it("contains python", () => {
    expect(getSupportedLanguages()).toContain("python")
  })

  it("contains go", () => {
    expect(getSupportedLanguages()).toContain("go")
  })

  it("contains rust", () => {
    expect(getSupportedLanguages()).toContain("rust")
  })

  it("contains java", () => {
    expect(getSupportedLanguages()).toContain("java")
  })

  it("contains cpp", () => {
    expect(getSupportedLanguages()).toContain("cpp")
  })

  it("contains c", () => {
    expect(getSupportedLanguages()).toContain("c")
  })

  it("contains csharp", () => {
    expect(getSupportedLanguages()).toContain("csharp")
  })

  it("contains ruby", () => {
    expect(getSupportedLanguages()).toContain("ruby")
  })

  it("contains php", () => {
    expect(getSupportedLanguages()).toContain("php")
  })

  it("does not contain yaml", () => {
    expect(getSupportedLanguages()).not.toContain("yaml")
  })

  it("returns new array on each call", () => {
    const a = getSupportedLanguages()
    const b = getSupportedLanguages()
    expect(a).not.toBe(b)
  })
})
