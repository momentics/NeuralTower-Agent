import { describe, it, expect } from "vitest"
import { SkillTool } from "./SkillTool"
import { SkillManager } from "../../skills/SkillManager"

describe("SkillTool", () => {
  function makeManager() {
    const m = new SkillManager()
    m.register({
      name: "tdd",
      description: "Тест-драйрованная разработка",
      triggers: ["tdd"],
      instructions: "Пиши тесты до кода.",
    })
    return m
  }

  it("возвращает инструкции навыка", async () => {
    const tool = new SkillTool(makeManager())
    const r = await tool.execute({ name: "tdd" }, undefined)
    expect(r.success).toBe(true)
    expect(r.output).toContain("Пиши тесты до кода.")
  })

  it("имя без учёта регистра", async () => {
    const tool = new SkillTool(makeManager())
    const r = await tool.execute({ name: "TDD" }, undefined)
    expect(r.success).toBe(true)
  })

  it("неизвестный навык — список доступных", async () => {
    const tool = new SkillTool(makeManager())
    const r = await tool.execute({ name: "нет-такого" }, undefined)
    expect(r.success).toBe(false)
    expect(r.output).toContain("tdd")
  })
})
