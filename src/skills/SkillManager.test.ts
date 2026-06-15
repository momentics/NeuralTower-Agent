import { describe, it, expect } from "vitest"
import { SkillManager } from "../../skills/SkillManager"
import type { ISkill } from "../../skills/ISkill"

const createMockSkill = (name: string, triggers: string[] = []): ISkill => ({
  name,
  description: `Mock ${name}`,
  triggers,
  instructions: `Instructions for ${name}`,
  priority: 1,
})

describe("SkillManager", () => {
  it("registers and retrieves a skill", () => {
    const mgr = new SkillManager()
    const skill = createMockSkill("test_skill", ["trigger1"])
    mgr.register(skill)
    expect(mgr.get("test_skill")).toBe(skill)
  })

  it("returns undefined for unknown skill", () => {
    const mgr = new SkillManager()
    expect(mgr.get("nonexistent")).toBeUndefined()
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
    mgr.register({ ...createMockSkill("low", ["shared"]), priority: 1 })
    mgr.register({ ...createMockSkill("high", ["shared"]), priority: 10 })
    const matched = mgr.match("shared")
    expect(matched[0].name).toBe("high")
    expect(matched[1].name).toBe("low")
  })

  it("unregisters a skill", () => {
    const mgr = new SkillManager()
    mgr.register(createMockSkill("removable", ["trigger"]))
    expect(mgr.get("removable")).toBeDefined()
    mgr.unregister("removable")
    expect(mgr.get("removable")).toBeUndefined()
  })

  it("unregistering unknown skill does not throw", () => {
    const mgr = new SkillManager()
    expect(() => mgr.unregister("nonexistent")).not.toThrow()
  })

  it("clears all skills", () => {
    const mgr = new SkillManager()
    mgr.register(createMockSkill("clear_a", ["a"]))
    mgr.register(createMockSkill("clear_b", ["b"]))
    mgr.clear()
    expect(mgr.match("a").length).toBe(0)
    expect(mgr.match("b").length).toBe(0)
  })
})
