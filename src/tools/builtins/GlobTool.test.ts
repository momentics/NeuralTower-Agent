import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { GlobTool } from "./GlobTool"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { GLOB_MAX_RESULTS } from "../../core/Config"

describe("GlobTool", () => {
  let tmpDir: string
  let tool: GlobTool

  beforeAll(async () => {
    tmpDir = path.join(os.tmpdir(), `glob-test-${Date.now()}`)
    await fs.mkdir(tmpDir, { recursive: true })
    await fs.mkdir(path.join(tmpDir, "sub"), { recursive: true })
    await fs.writeFile(path.join(tmpDir, "a.ts"), "const a = 1")
    await fs.writeFile(path.join(tmpDir, "b.js"), "const b = 2")
    await fs.writeFile(path.join(tmpDir, "sub", "c.ts"), "const c = 3")
    // Файл в node_modules: широкий шаблон не должен возвращать зависимости.
    await fs.mkdir(path.join(tmpDir, "node_modules", "pkg"), { recursive: true })
    await fs.writeFile(path.join(tmpDir, "node_modules", "pkg", "index.js"), "const dep = 1")
    tool = new GlobTool(tmpDir)
  })

  afterAll(async () => {
    GlobTool.maxResults = GLOB_MAX_RESULTS
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it("has correct metadata", () => {
    expect(tool.name).toBe("glob")
    expect(tool.category).toBe("filesystem")
    expect(tool.isSafe).toBe(true)
  })

  it("has correct schema", () => {
    expect(tool.schema.name).toBe("glob")
    expect(tool.schema.required).toContain("pattern")
    expect(tool.schema.parameters.pattern).toBeDefined()
    expect(tool.schema.parameters.path).toBeDefined()
  })

  it("finds files matching pattern", async () => {
    const result = await tool.execute({ pattern: "**/*.ts", path: tmpDir })
    expect(result.success).toBe(true)
    expect(result.output).toContain("a.ts")
    expect(result.output).toContain("c.ts")
    expect(result.output).not.toContain("b.js")
  })

  it("finds files with simple pattern", async () => {
    const result = await tool.execute({ pattern: "*.js", path: tmpDir })
    expect(result.success).toBe(true)
    expect(result.output).toContain("b.js")
    expect(result.output).not.toContain("a.ts")
  })

  it("returns no matches message when nothing found", async () => {
    const result = await tool.execute({ pattern: "**/*.py", path: tmpDir })
    expect(result.success).toBe(true)
    expect(result.output).toContain("Совпадений не найдено")
  })

  it("returns error for empty pattern", async () => {
    const result = await tool.execute({ pattern: "" })
    expect(result.success).toBe(false)
    expect(result.output).toContain("Не указан шаблон")
  })

  it("uses default path of current directory", async () => {
    const result = await tool.execute({ pattern: "**/*.test.ts" })
    expect(result.success).toBe(true)
  })

  it("returns absolute paths", async () => {
    const result = await tool.execute({ pattern: "a.ts", path: tmpDir })
    expect(result.success).toBe(true)
    // resolveToReal нормализует DOS short paths (MOMENT~1 → momentics), поэтому проверяем по имени теста
    expect(result.output).toContain("glob-test-")
    expect(result.output).toContain("a.ts")
  })

  it("handles invalid path gracefully", async () => {
    const result = await tool.execute({
      pattern: "**/*.ts",
      path: "/nonexistent/path/that/does/not/exist",
    })
    // На некоторых платформах glob возвращает пустой результат, на других — выбрасывает исключение.
    // С workDir enforcement путь вне рабочей директории будет отклонён с "Доступ запрещён".
    if (result.success) {
      expect(result.output).toContain("Совпадений не найдено")
    } else {
      expect(result.output).toMatch(/не выполнен|Доступ запрещён/)
    }
  })

  it("node_modules исключается из результатов", async () => {
    const result = await tool.execute({ pattern: "**/*.js", path: tmpDir })
    expect(result.success).toBe(true)
    expect(result.output).toContain("b.js")
    expect(result.output).not.toContain("node_modules")
  })

  it("результаты ограничиваются лимитом с заметкой об обрезке", async () => {
    // Добавляем 6 файлов *.js — всего 7 (включая b.js из beforeAll).
    for (let i = 1; i <= 6; i++) {
      await fs.writeFile(path.join(tmpDir, `limit-${i}.js`), `const l${i} = ${i}`)
    }
    GlobTool.maxResults = 5
    const result = await tool.execute({ pattern: "*.js", path: tmpDir })
    expect(result.success).toBe(true)
    const lines = result.output.split("\n")
    // До заметки ровно 5 строк путей, последняя строка — заметка об обрезке.
    expect(lines.length).toBe(6)
    expect(lines[5]).toContain("обрезано")
    expect(lines[5]).toContain("7")
  })
})
