import { describe, it, expect } from "vitest"
import { matchCommandPattern, matchPathPattern } from "./PatternMatch"

describe("matchCommandPattern", () => {
  it("точное совпадение", () => {
    expect(matchCommandPattern("git status", "git status")).toBe(true)
  })

  it("префикс: команда длиннее паттерна", () => {
    expect(matchCommandPattern("git status", "git status --short")).toBe(true)
    expect(matchCommandPattern("npm test", "npm test -- --watch")).toBe(true)
  })

  it("префикс не пересекает границы слов", () => {
    expect(matchCommandPattern("npm t", "npm test")).toBe(false)
  })

  it("звёздочка: любой хвост", () => {
    expect(matchCommandPattern("git *", "git log -5")).toBe(true)
    expect(matchCommandPattern("git *", "git")).toBe(true)
    expect(matchCommandPattern("git *", "github login")).toBe(false)
  })

  it("пустые значения — false", () => {
    expect(matchCommandPattern("", "git status")).toBe(false)
    expect(matchCommandPattern("git status", "  ")).toBe(false)
  })
})

describe("matchPathPattern", () => {
  it("точное совпадение", () => {
    expect(matchPathPattern("package.json", "package.json")).toBe(true)
  })

  it("* — в пределах сегмента", () => {
    expect(matchPathPattern("*.ts", "a.ts")).toBe(true)
    expect(matchPathPattern("*.ts", "src/a.ts")).toBe(false)
  })

  it("** — через сегменты", () => {
    expect(matchPathPattern("src/**/*.ts", "src/a/b.ts")).toBe(true)
    expect(matchPathPattern("src/**/*.ts", "src/b.ts")).toBe(true)
    expect(matchPathPattern("src/**/*.ts", "other/b.ts")).toBe(false)
  })

  it(".env-паттерны", () => {
    expect(matchPathPattern(".env*", ".env")).toBe(true)
    expect(matchPathPattern(".env*", ".env.local")).toBe(true)
    expect(matchPathPattern("**/.env*", "src/.env.example")).toBe(true)
    expect(matchPathPattern(".env*", "env.txt")).toBe(false)
  })

  it("обратные слэши нормализуются", () => {
    expect(matchPathPattern("src/**/*.ts", "src\\a\\b.ts")).toBe(true)
  })
})
