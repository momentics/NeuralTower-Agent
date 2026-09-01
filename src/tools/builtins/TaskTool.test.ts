import { describe, it, expect } from "vitest"
import { TaskTool } from "./TaskTool"

describe("TaskTool", () => {
  const getWorkDir = () => "/work"

  it("запускает субагента и возвращает его ответ", async () => {
    const seen: Array<{ name: string; mode: string }> = []
    const tool = new TaskTool(
      {
        launch: async (cfg) => {
          seen.push({ name: cfg.name, mode: cfg.mode })
          return { ok: true, output: "Субагент завершил: найдено 3 файла" }
        },
      },
      getWorkDir,
    )
    const r = await tool.execute(
      { description: "Найти обработчики", prompt: "Найди все обработчики API", subagent_type: "explore" },
      undefined,
    )
    expect(r.success).toBe(true)
    expect(r.output).toContain("найдено 3 файла")
    expect(seen[0].mode).toBe("explore")
  })

  it("general → режим build", async () => {
    let mode = ""
    const tool = new TaskTool(
      { launch: async (cfg) => { mode = cfg.mode; return { ok: true, output: "ок" } } },
      getWorkDir,
    )
    await tool.execute({ description: "Добавить тесты", prompt: "Напиши тесты для модуля X" }, undefined)
    expect(mode).toBe("build")
  })

  it("сбой субагента — ошибка инструмента", async () => {
    const tool = new TaskTool(
      { launch: async () => ({ ok: false, output: "", error: "Превышен лимит одновременных субагентов: 4" }) },
      getWorkDir,
    )
    const r = await tool.execute({ description: "x", prompt: "y" }, undefined)
    expect(r.success).toBe(false)
    expect(r.output).toContain("Превышен лимит")
  })

  it("пустые аргументы — ошибка", async () => {
    const tool = new TaskTool({ launch: async () => ({ ok: true, output: "" }) }, getWorkDir)
    const r = await tool.execute({}, undefined)
    expect(r.success).toBe(false)
  })
})
