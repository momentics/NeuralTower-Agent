import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { RememberTool } from "./RememberTool"
import { MemoryStore } from "../../services/memory/MemoryStore"

describe("RememberTool", () => {
  let dir: string
  let store: MemoryStore

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "nt-remember-"))
    store = new MemoryStore(path.join(dir, "mem.json"))
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it("command: сохраняет команду по имени", async () => {
    const tool = new RememberTool(store)
    const r = await tool.execute({ fact: "npm test", kind: "command", name: "test" }, undefined)
    expect(r.success).toBe(true)
    expect((await store.load())!.commands).toEqual({ test: "npm test" })
  })

  it("command без имени — ошибка", async () => {
    const tool = new RememberTool(store)
    const r = await tool.execute({ fact: "npm test", kind: "command" }, undefined)
    expect(r.success).toBe(false)
  })

  it("note: дубликаты не накапливаются", async () => {
    const tool = new RememberTool(store)
    await tool.execute({ fact: "Монорепозиторий", kind: "note" }, undefined)
    await tool.execute({ fact: "Монорепозиторий", kind: "note" }, undefined)
    expect((await store.load())!.notes).toEqual(["Монорепозиторий"])
  })

  it("convention: лимит 30", async () => {
    const tool = new RememberTool(store)
    for (let i = 0; i < 35; i++) {
      await tool.execute({ fact: `Конвенция ${i}`, kind: "convention" }, undefined)
    }
    const conventions = (await store.load())!.conventions
    expect(conventions).toHaveLength(30)
    expect(conventions[0]).toBe("Конвенция 5")
    expect(conventions[29]).toBe("Конвенция 34")
  })

  it("пустой факт — ошибка", async () => {
    const tool = new RememberTool(store)
    const r = await tool.execute({ fact: "   " }, undefined)
    expect(r.success).toBe(false)
  })
})
