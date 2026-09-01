import { describe, it, expect } from "vitest"
import { workspaceKey } from "./WorkspaceKey"

describe("workspaceKey", () => {
  it("16 hex-символов", () => {
    expect(workspaceKey("/some/path")).toMatch(/^[0-9a-f]{16}$/)
  })

  it("стабилен: одинаковый путь — одинаковый ключ", () => {
    expect(workspaceKey("/some/path")).toBe(workspaceKey("/some/path"))
  })

  it("хвостовой слэш не меняет ключ", () => {
    expect(workspaceKey("/some/path")).toBe(workspaceKey("/some/path/"))
  })

  it("разные пути — разные ключи", () => {
    expect(workspaceKey("/some/path")).not.toBe(workspaceKey("/some/other"))
  })

  it("на Windows регистр не меняет ключ", () => {
    if (process.platform !== "win32") return
    expect(workspaceKey("C:\\Users\\Dev\\proj")).toBe(workspaceKey("c:/users/dev/proj"))
  })
})
