import { describe, it, expect } from "vitest"
import { TOOL_NAME_PATTERN, isValidToolName, sanitizeToolName } from "./ToolNames"

describe("sanitizeToolName", () => {
  it("заменяет двоеточие на подчёркивание", () => {
    expect(sanitizeToolName("server:tool")).toBe("server_tool")
  })

  it("не создаёт двойного префикса у ntgraph-имён", () => {
    expect(sanitizeToolName("ntgraph:ntgraph_search")).toBe("ntgraph_ntgraph_search")
  })

  it("обрабатывает несколько недопустимых символов", () => {
    expect(sanitizeToolName("a:b:c")).toBe("a_b_c")
  })

  it("не меняет валидное имя", () => {
    expect(sanitizeToolName("ok_name-1")).toBe("ok_name-1")
  })

  it("обрезает имя до 64 символов", () => {
    expect(sanitizeToolName("x".repeat(70)).length).toBe(64)
  })

  it("возвращает «tool» для имени без допустимых символов", () => {
    expect(sanitizeToolName("___")).toBe("tool")
  })
})

describe("isValidToolName", () => {
  it("принимает валидные имена", () => {
    expect(isValidToolName("read_file")).toBe(true)
  })

  it("отклоняет имена с двоеточием", () => {
    expect(isValidToolName("a:b")).toBe(false)
  })

  it("отклоняет пустое имя", () => {
    expect(isValidToolName("")).toBe(false)
  })

  it("шаблон совпадает с функцией проверки", () => {
    for (const name of ["read_file", "a-b_c1", "x".repeat(64), "a:b", "", "x".repeat(65)]) {
      expect(TOOL_NAME_PATTERN.test(name)).toBe(isValidToolName(name))
    }
  })
})
