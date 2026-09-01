import { describe, it, expect } from "vitest"
import { parseSkillFile, loadSkillsFromDir } from "./SkillFileLoader"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

describe("parseSkillFile", () => {
  it("разбирает frontmatter и тело", () => {
    const s = parseSkillFile(
      "---\nname: my-skill\ndescription: Тест навыка\ntriggers: alpha, beta\n---\n# Инструкции\nДелай так.",
      "fallback",
    )
    expect(s).not.toBeNull()
    expect(s!.name).toBe("my-skill")
    expect(s!.description).toBe("Тест навыка")
    expect(s!.triggers).toEqual(["alpha", "beta"])
    expect(s!.instructions).toContain("Делай так.")
    expect(s!.source).toBe("file")
  })

  it("без frontmatter — имя из каталога, описание из первой строки", () => {
    const s = parseSkillFile("Первая строка описания.\n\nТело.", "dir-name")
    expect(s!.name).toBe("dir-name")
    expect(s!.description).toBe("Первая строка описания.")
    expect(s!.triggers).toEqual([])
  })

  it("пустое тело — null", () => {
    expect(parseSkillFile("---\nname: x\n---\n   \n", "x")).toBeNull()
  })

  it("BOM удаляется", () => {
    const s = parseSkillFile("\uFEFF---\nname: x\n---\nТело", "x")
    expect(s!.name).toBe("x")
  })
})

describe("loadSkillsFromDir", () => {
  it("загружает навыки из поддиректорий, пропускает остальные", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nt-skills-"))
    try {
      await fs.mkdir(path.join(dir, "good"), { recursive: true })
      await fs.writeFile(
        path.join(dir, "good", "SKILL.md"),
        "---\nname: good\ndescription: ok\n---\nТело",
        "utf-8",
      )
      await fs.mkdir(path.join(dir, "empty"), { recursive: true })
      const skills = await loadSkillsFromDir(dir)
      expect(skills.map((s) => s.name)).toEqual(["good"])
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it("несуществующий каталог — пустой список", async () => {
    expect(await loadSkillsFromDir("/nonexistent-nt-skills")).toEqual([])
  })
})
