import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { ToolOutputTruncator, TRUNCATE_KEEP_HEAD, TRUNCATE_KEEP_TAIL, FULL_OUTPUT_MARKER } from "./Truncate"

describe("ToolOutputTruncator", () => {
  let dir: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "nt-truncate-"))
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it("короткий вывод возвращается как есть", async () => {
    const t = new ToolOutputTruncator(() => dir, () => 100)
    const out = await t.truncate("привет", "call_1")
    expect(out).toBe("привет")
  })

  it("длинный вывод обрезается, полный текст сохраняется в файл", async () => {
    const t = new ToolOutputTruncator(() => dir, () => 1000)
    const long = "А".repeat(TRUNCATE_KEEP_HEAD + TRUNCATE_KEEP_TAIL + 5000)
    const out = await t.truncate(long, "call_2")

    expect(out.length).toBeLessThan(long.length)
    expect(out.startsWith("А".repeat(100))).toBe(true)
    expect(out.endsWith("А".repeat(100))).toBe(true)
    expect(out).toContain(FULL_OUTPUT_MARKER)

    const file = path.join(dir, "call_2.txt")
    const saved = await fs.readFile(file, "utf-8")
    expect(saved).toBe(long)
  })

  it("директория null — обрезка без файла", async () => {
    const t = new ToolOutputTruncator(() => null, () => 1000)
    const long = "Б".repeat(5000)
    const out = await t.truncate(long, "call_3")
    expect(out).not.toContain(FULL_OUTPUT_MARKER)
    expect(out).toContain("вывод обрезан")
  })

  it("ошибка записи — фолбэк без файла", async () => {
    const fileAsDir = path.join(dir, "blocker.txt")
    await fs.writeFile(fileAsDir, "x", "utf-8")
    const t = new ToolOutputTruncator(() => path.join(fileAsDir, "impossible"), () => 1000)
    const long = "В".repeat(5000)
    const out = await t.truncate(long, "call_4")
    expect(out).toContain("вывод обрезан")
    expect(out).not.toContain(FULL_OUTPUT_MARKER)
  })

  it("id вызова санитизируется для имени файла", async () => {
    const t = new ToolOutputTruncator(() => dir, () => 1000)
    const long = "Г".repeat(5000)
    await t.truncate(long, "nt/call:5")
    const files = await fs.readdir(dir)
    expect(files).toContain("nt_call_5.txt")
  })
})
