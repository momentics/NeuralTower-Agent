import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { MemoryStore, emptyMemoryData } from "./MemoryStore"

describe("MemoryStore", () => {
  let dir: string
  let file: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "nt-memory-"))
    file = path.join(dir, "mem.json")
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it("нет файла — null", async () => {
    expect(await new MemoryStore(file).load()).toBeNull()
  })

  it("update создаёт файл и применяет мутатор", async () => {
    const store = new MemoryStore(file)
    await store.update((d) => {
      d.repo = "demo"
      d.notes.push("Проект на TypeScript")
    })
    const data = await store.load()
    expect(data!.repo).toBe("demo")
    expect(data!.notes).toEqual(["Проект на TypeScript"])
  })

  it("повреждённый файл трактуется как отсутствующий", async () => {
    await fs.writeFile(file, "{не json", "utf-8")
    const store = new MemoryStore(file)
    expect(await store.load()).toBeNull()
    await store.update((d) => {
      d.repo = "x"
    })
    expect((await store.load())!.repo).toBe("x")
  })

  it("normalize заполняет отсутствующие поля", async () => {
    await fs.writeFile(file, JSON.stringify({ repo: "demo" }), "utf-8")
    const data = await new MemoryStore(file).load()
    expect(data).toEqual({ ...emptyMemoryData(), repo: "demo", updatedAt: data!.updatedAt })
  })
})
