import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { MultiEditTool } from "./MultiEditTool"

describe("MultiEditTool", () => {
  let dir: string
  let tool: MultiEditTool
  let file: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "nt-multi-"))
    tool = new MultiEditTool(dir)
    file = path.join(dir, "a.txt")
    await fs.writeFile(file, "alpha\nbeta\ngamma\n", "utf-8")
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it("применяет все замены одной операцией", async () => {
    const r = await tool.execute(
      {
        filepath: "a.txt",
        edits: [
          { oldString: "alpha", newString: "one" },
          { oldString: "beta", newString: "two" },
        ],
      },
      undefined,
    )
    expect(r.success).toBe(true)
    expect(await fs.readFile(file, "utf-8")).toBe("one\ntwo\ngamma\n")
  })

  it("all-or-nothing: одна замена не найдена — файл не изменён", async () => {
    const r = await tool.execute(
      {
        filepath: "a.txt",
        edits: [
          { oldString: "alpha", newString: "one" },
          { oldString: "нет-такого", newString: "x" },
        ],
      },
      undefined,
    )
    expect(r.success).toBe(false)
    expect(r.output).toContain("не найден")
    expect(await fs.readFile(file, "utf-8")).toBe("alpha\nbeta\ngamma\n")
  })

  it("неоднозначная замена без replaceAll — ошибка", async () => {
    await fs.writeFile(file, "x x x\n", "utf-8")
    const r = await tool.execute(
      { filepath: "a.txt", edits: [{ oldString: "x", newString: "y" }] },
      undefined,
    )
    expect(r.success).toBe(false)
    expect(r.output).toContain("3 вхождения")
  })

  it("replaceAll работает", async () => {
    await fs.writeFile(file, "x x x\n", "utf-8")
    const r = await tool.execute(
      { filepath: "a.txt", edits: [{ oldString: "x", newString: "y", replaceAll: true }] },
      undefined,
    )
    expect(r.success).toBe(true)
    expect(await fs.readFile(file, "utf-8")).toBe("y y y\n")
  })

  it("пустой список замен — ошибка", async () => {
    const r = await tool.execute({ filepath: "a.txt", edits: [] }, undefined)
    expect(r.success).toBe(false)
  })

  it("путь вне workspace — отказ", async () => {
    const r = await tool.execute(
      { filepath: "../../outside.txt", edits: [{ oldString: "a", newString: "b" }] },
      undefined,
    )
    expect(r.success).toBe(false)
    expect(r.output).toContain("запрещён")
  })
})
