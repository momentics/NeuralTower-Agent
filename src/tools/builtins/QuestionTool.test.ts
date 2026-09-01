import { describe, it, expect } from "vitest"
import { QuestionTool } from "./QuestionTool"

describe("QuestionTool", () => {
  it("возвращает ответ пользователя", async () => {
    const tool = new QuestionTool({ ask: async () => "вариант А" })
    const r = await tool.execute({ question: "Что выбрать?" }, undefined)
    expect(r.success).toBe(true)
    expect(r.output).toContain("вариант А")
  })

  it("null — пользователь не ответил", async () => {
    const tool = new QuestionTool({ ask: async () => null })
    const r = await tool.execute({ question: "Что выбрать?" }, undefined)
    expect(r.success).toBe(false)
    expect(r.output).toContain("не ответил")
  })

  it("пустой вопрос — ошибка", async () => {
    const tool = new QuestionTool({ ask: async () => "x" })
    const r = await tool.execute({}, undefined)
    expect(r.success).toBe(false)
  })
})
