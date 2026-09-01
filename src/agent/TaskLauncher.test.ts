import { describe, it, expect } from "vitest"
import { SubagentLauncherHolder, filterSubagentTools } from "./TaskLauncher"
import { ToolRegistry } from "../tools/ToolRegistry"

function makeTool(name: string) {
  return {
    name,
    description: "t",
    category: "test",
    schema: { name, description: "t", parameters: {} },
    isSafe: true,
    execute: async () => ({ output: "", success: true }),
  }
}

describe("filterSubagentTools", () => {
  it("исключает task и question", () => {
    const reg = new ToolRegistry()
    reg.registerMany([makeTool("read_file"), makeTool("task"), makeTool("question"), makeTool("bash")])
    const sub = filterSubagentTools(reg)
    const names = sub.list().map((t) => t.name)
    expect(names).toContain("read_file")
    expect(names).toContain("bash")
    expect(names).not.toContain("task")
    expect(names).not.toContain("question")
  })
})

describe("SubagentLauncherHolder", () => {
  it("без реализации — недоступен", async () => {
    const h = new SubagentLauncherHolder()
    const r = await h.launch({ name: "a", task: "b", mode: "build", workDir: "/w" })
    expect(r.ok).toBe(false)
    expect(r.error).toContain("недоступны")
  })

  it("с реализацией — проброс", async () => {
    const h = new SubagentLauncherHolder()
    h.setImpl({ launch: async () => ({ ok: true, output: "готово" }) })
    const r = await h.launch({ name: "a", task: "b", mode: "build", workDir: "/w" })
    expect(r.ok).toBe(true)
    expect(r.output).toBe("готово")
  })
})
