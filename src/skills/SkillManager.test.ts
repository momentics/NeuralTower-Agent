import { describe, it, expect } from "vitest"
import { SkillManager } from "./SkillManager"
import type { ISkill } from "./ISkill"

const createMockSkill = (name: string, triggers: string[] = [], priority = 1): ISkill => ({
  name,
  description: `Mock ${name}`,
  triggers,
  instructions: `Instructions for ${name}`,
  priority,
})

describe("SkillManager", () => {
  it("registers a skill", () => {
    const mgr = new SkillManager()
    const skill = createMockSkill("test_skill", ["trigger1"])
    mgr.register(skill)
    expect(mgr.list()).toContain(skill)
  })

  it("registers many skills at once", () => {
    const mgr = new SkillManager()
    const skills = [
      createMockSkill("a", ["trigger_a"]),
      createMockSkill("b", ["trigger_b"]),
    ]
    mgr.registerMany(skills)
    expect(mgr.list()).toHaveLength(2)
  })

  it("matches skills by trigger", () => {
    const mgr = new SkillManager()
    mgr.register(createMockSkill("skill_a", ["trigger_a", "alt_a"]))
    mgr.register(createMockSkill("skill_b", ["trigger_b"]))
    const matched = mgr.match("trigger_a")
    expect(matched.length).toBe(1)
    expect(matched[0].name).toBe("skill_a")
  })

  it("matches skills by alternative trigger", () => {
    const mgr = new SkillManager()
    mgr.register(createMockSkill("skill_a", ["trigger_a", "alt_a"]))
    const matched = mgr.match("alt_a")
    expect(matched.length).toBe(1)
    expect(matched[0].name).toBe("skill_a")
  })

  it("matches multiple skills", () => {
    const mgr = new SkillManager()
    mgr.register(createMockSkill("skill_a", ["shared"]))
    mgr.register(createMockSkill("skill_b", ["shared"]))
    const matched = mgr.match("shared")
    expect(matched.length).toBe(2)
  })

  it("returns empty for no match", () => {
    const mgr = new SkillManager()
    mgr.register(createMockSkill("skill_a", ["trigger_a"]))
    const matched = mgr.match("nonexistent")
    expect(matched.length).toBe(0)
  })

  it("sorts matched skills by priority", () => {
    const mgr = new SkillManager()
    mgr.register(createMockSkill("low", ["shared"], 1))
    mgr.register(createMockSkill("high", ["shared"], 10))
    const matched = mgr.match("shared")
    expect(matched[0].name).toBe("high")
    expect(matched[1].name).toBe("low")
  })

  it("limits matched skills to 5", () => {
    const mgr = new SkillManager()
    for (let i = 0; i < 10; i++) {
      mgr.register(createMockSkill(`skill_${i}`, ["shared"]))
    }
    expect(mgr.match("shared").length).toBe(5)
  })

  it("builds context from matched skills", () => {
    const mgr = new SkillManager()
    const skills = [
      createMockSkill("skill_a", ["a"]),
      createMockSkill("skill_b", ["b"]),
    ]
    mgr.registerMany(skills)
    const ctx = mgr.buildContext(skills)
    expect(ctx).toContain("## Активные навыки")
    expect(ctx).toContain("## skill_a")
    expect(ctx).toContain("## skill_b")
  })

  it("buildContext returns empty for no skills", () => {
    const mgr = new SkillManager()
    expect(mgr.buildContext([])).toBe("")
  })

  it("clears all skills", () => {
    const mgr = new SkillManager()
    mgr.register(createMockSkill("clear_a", ["a"]))
    mgr.register(createMockSkill("clear_b", ["b"]))
    mgr.clear()
    expect(mgr.list()).toHaveLength(0)
    expect(mgr.match("a").length).toBe(0)
  })

  it("register заменяет навык с тем же именем", () => {
    const m = new SkillManager()
    m.register({ name: "a", description: "1", triggers: [], instructions: "old" })
    m.register({ name: "a", description: "2", triggers: [], instructions: "new" })
    const list = m.list()
    expect(list.length).toBe(1)
    expect(list[0].instructions).toBe("new")
  })
})
