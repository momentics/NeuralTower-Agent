import { describe, it, expect } from "vitest"
import { builtInSkills } from "./builtInSkills"

describe("builtInSkills", () => {
  it("exports an array of skills", () => {
    expect(Array.isArray(builtInSkills)).toBe(true)
    expect(builtInSkills.length).toBeGreaterThan(0)
  })

  it("each skill has required fields", () => {
    for (const skill of builtInSkills) {
      expect(skill.name).toBeDefined()
      expect(typeof skill.name).toBe("string")
      expect(skill.description).toBeDefined()
      expect(typeof skill.description).toBe("string")
      expect(skill.triggers).toBeDefined()
      expect(Array.isArray(skill.triggers)).toBe(true)
      expect(skill.instructions).toBeDefined()
      expect(typeof skill.instructions).toBe("string")
    }
  })

  it("each skill has unique name", () => {
    const names = builtInSkills.map((s) => s.name)
    const unique = new Set(names)
    expect(unique.size).toBe(names.length)
  })

  it("each skill has at least one trigger", () => {
    for (const skill of builtInSkills) {
      expect(skill.triggers.length).toBeGreaterThan(0)
    }
  })

  it("each skill has non-empty instructions", () => {
    for (const skill of builtInSkills) {
      expect(skill.instructions.trim().length).toBeGreaterThan(0)
    }
  })
})
