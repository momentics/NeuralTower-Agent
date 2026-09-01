import { describe, it, expect } from "vitest"
import { parseUserMode, loadUserModes } from "./UserModeLoader"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

describe("parseUserMode", () => {
  it("разбирает frontmatter, tools и тело", () => {
    const mode = parseUserMode(
      [
        "---",
        "description: Режим ревью",
        "transitions: build",
        "tools:",
        "  read_file: allow",
        "  edit_file: deny",
        '  "*": deny',
        "---",
        "Ты — ревьюер. Проверяй код.",
      ].join("\n"),
      "review",
    )
    expect(mode).not.toBeNull()
    expect(mode!.name).toBe("review")
    expect(mode!.description).toBe("Режим ревью")
    expect(mode!.transitions).toEqual(["build"])
    expect(mode!.toolRules).toEqual([
      { tool: "read_file", level: "allow" },
      { tool: "edit_file", level: "deny" },
      { tool: "*", level: "deny" },
    ])
    expect(mode!.systemPromptAddon).toBe("Ты — ревьюер. Проверяй код.")
  })

  it("без tools — wildcard ask; без transitions — все встроенные", () => {
    const mode = parseUserMode("Промпт режима.", "simple")
    expect(mode!.toolRules).toEqual([{ tool: "*", level: "ask" }])
    expect(mode!.transitions).toEqual(["build", "plan", "explore", "ask"])
  })

  it("пустое тело — null", () => {
    expect(parseUserMode("---\ndescription: x\n---\n  \n", "x")).toBeNull()
  })
})

describe("loadUserModes", () => {
  it("загружает *.md файлы каталога", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nt-modes-"))
    try {
      await fs.writeFile(path.join(dir, "review.md"), "Промпт ревью.", "utf-8")
      await fs.writeFile(path.join(dir, "notes.txt"), "не режим", "utf-8")
      const modes = await loadUserModes(dir)
      expect(modes.map((m) => m.name)).toEqual(["review"])
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it("несуществующий каталог — пустой список", async () => {
    expect(await loadUserModes("/nonexistent-nt-modes")).toEqual([])
  })
})
