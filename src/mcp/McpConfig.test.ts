import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { loadMcpServers } from "./McpConfig"

describe("loadMcpServers", () => {
  let dir: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "nt-mcp-"))
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it("только настройки VS Code", async () => {
    const servers = await loadMcpServers(
      { fs: { command: "npx", args: ["-y", "fs-mcp"] } },
      null,
    )
    expect(servers).toEqual([
      { name: "fs", transport: "stdio", command: "npx", args: ["-y", "fs-mcp"], env: undefined },
    ])
  })

  it(".mcp.json переопределяет глобальный сервер по имени", async () => {
    await fs.writeFile(
      path.join(dir, ".mcp.json"),
      JSON.stringify({ mcpServers: { fs: { command: "npx", args: ["-y", "fs-mcp@2"] } } }),
      "utf-8",
    )
    const servers = await loadMcpServers(
      { fs: { command: "npx", args: ["-y", "fs-mcp"] }, other: { command: "node", args: ["mcp.js"] } },
      dir,
    )
    expect(servers).toHaveLength(2)
    const fsServer = servers.find((s) => s.name === "fs")!
    expect(fsServer.args).toEqual(["-y", "fs-mcp@2"])
    expect(servers.find((s) => s.name === "other")!.command).toBe("node")
  })

  it("запись без command — пропущена", async () => {
    const servers = await loadMcpServers({ broken: {} as any }, null)
    expect(servers).toEqual([])
  })

  it("повреждённый .mcp.json — без ошибок, только глобальные", async () => {
    await fs.writeFile(path.join(dir, ".mcp.json"), "{не json", "utf-8")
    const servers = await loadMcpServers({ a: { command: "x" } }, dir)
    expect(servers).toHaveLength(1)
  })

  it(".mcp.json без mcpServers — без добавлений", async () => {
    await fs.writeFile(path.join(dir, ".mcp.json"), JSON.stringify({}), "utf-8")
    const servers = await loadMcpServers({ a: { command: "x" } }, dir)
    expect(servers).toHaveLength(1)
  })
})
