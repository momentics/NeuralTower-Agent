import { describe, it, expect, vi, beforeEach } from "vitest"
import { PermissionManager } from "./PermissionManager"

const createMockMemento = (preloaded?: Record<string, unknown>) => {
  const store: Record<string, unknown> = { ...preloaded }
  return {
    get: vi.fn(<T>(key: string, defaultValue?: T): T => (key in store ? store[key] : defaultValue!)),
    update: vi.fn((key: string, value: unknown) => { store[key] = value; return Promise.resolve() }),
    keys: vi.fn(() => Object.keys(store)),
  }
}

describe("PermissionManager", () => {
  let pm: PermissionManager

  beforeEach(() => {
    pm = new PermissionManager()
  })

  it("allows tool with allow permission", async () => {
    pm.setPermission("read", "allow")
    const result = await pm.checkPermission({ name: "read", isSafe: false, execute: vi.fn() } as any, {})
    expect(result).toBe(true)
  })

  it("denies tool with deny permission", async () => {
    pm.setPermission("bash", "deny")
    const result = await pm.checkPermission({ name: "bash", isSafe: false, execute: vi.fn() } as any, {})
    expect(result).toBe(false)
  })

  it("allows safe tool without permission", async () => {
    const result = await pm.checkPermission({ name: "read", isSafe: true, execute: vi.fn() } as any, {})
    expect(result).toBe(true)
  })

  it("allows with auto-approve", async () => {
    pm.setAutoApprove({ enabled: true, tools: ["bash"], maxCost: 0 })
    const result = await pm.checkPermission({ name: "bash", isSafe: false, execute: vi.fn() } as any, {})
    expect(result).toBe(true)
  })

  it("asks permission for unknown tool and times out", async () => {
    const result = await pm.checkPermission({ name: "unknown", isSafe: false, execute: vi.fn() } as any, {}, 10)
    expect(result).toBe(false)
  })

  it("set and get permission level", () => {
    pm.setPermission("read", "allow")
    expect(pm.getPermissionLevel("read")).toBe("allow")
    expect(pm.getPermissionLevel("unknown")).toBe("ask")
  })

  it("set and get auto-approve", () => {
    pm.setAutoApprove({ enabled: true, tools: ["bash"], maxCost: 100 })
    const cfg = pm.getAutoApprove()
    expect(cfg.enabled).toBe(true)
    expect(cfg.tools).toContain("bash")
  })

  it("list permissions", () => {
    pm.setPermission("read", "allow")
    pm.setPermission("bash", "deny")
    const list = pm.listPermissions()
    expect(list).toHaveLength(2)
  })

  it("clear removes permissions", () => {
    pm.setPermission("read", "allow")
    pm.clear()
    expect(pm.listPermissions()).toHaveLength(0)
  })

  it("resolveRequest resolves pending request", async () => {
    const checkPromise = pm.checkPermission({ name: "test", isSafe: false, execute: vi.fn() } as any, {}, 5000)
    const reqs = (pm as any).pendingRequests
    expect(reqs.length).toBeGreaterThan(0)
    const req = reqs[0]
    pm.resolveRequest(req.id, true, false)
    const result = await checkPromise
    expect(result).toBe(true)
  })

  it("resolveRequest with always sets permanent permission", async () => {
    const checkPromise = pm.checkPermission({ name: "test", isSafe: false, execute: vi.fn() } as any, {}, 5000)
    const reqs = (pm as any).pendingRequests
    const req = reqs[0]
    pm.resolveRequest(req.id, true, true)
    await checkPromise
    expect(pm.getPermissionLevel("test")).toBe("allow")
  })

  it("resolveRequest returns false for unknown id", () => {
    expect(pm.resolveRequest("unknown", true, false)).toBe(false)
  })

  it("onDidRequestPermission fires event", async () => {
    const handler = vi.fn()
    pm.onDidRequestPermission(handler)
    const checkPromise = pm.checkPermission({ name: "test", isSafe: false, execute: vi.fn() } as any, {}, 5000)
    expect(handler).toHaveBeenCalled()
    const reqs = (pm as any).pendingRequests
    const req = reqs[0]
    pm.resolveRequest(req.id, true, false)
    await checkPromise
  })

  it("dispose resolves pending requests as false", async () => {
    const checkPromise = pm.checkPermission({ name: "test", isSafe: false, execute: vi.fn() } as any, {}, 5000)
    pm.dispose()
    const result = await checkPromise
    expect(result).toBe(false)
  })
})

describe("PermissionManager — isSafeForArgs (per-operation classification)", () => {
  let pm: PermissionManager

  beforeEach(() => {
    pm = new PermissionManager()
  })

  it("allows unsafe tool when isSafeForArgs says the call is safe", async () => {
    const tool = {
      name: "git",
      isSafe: false,
      isSafeForArgs: (args: Record<string, unknown>) => args.operation === "status",
      execute: vi.fn(),
    } as any
    const result = await pm.checkPermission(tool, { operation: "status" })
    expect(result).toBe(true)
  })

  it("asks permission when isSafeForArgs says the call is not safe", async () => {
    const tool = {
      name: "git",
      isSafe: false,
      isSafeForArgs: (args: Record<string, unknown>) => args.operation === "status",
      execute: vi.fn(),
    } as any
    const checkPromise = pm.checkPermission(tool, { operation: "commit" }, 5000)
    const reqs = (pm as any).pendingRequests
    expect(reqs).toHaveLength(1)
    pm.resolveRequest(reqs[0].id, true, false)
    expect(await checkPromise).toBe(true)
  })

  it("includes describeCall text in the permission request", async () => {
    const tool = {
      name: "git",
      isSafe: false,
      isSafeForArgs: () => false,
      describeCall: () => "Force push в origin/main (перезапишет историю remote)",
      execute: vi.fn(),
    } as any
    const handler = vi.fn()
    pm.onDidRequestPermission(handler)
    const checkPromise = pm.checkPermission(tool, {}, 5000)
    expect(handler).toHaveBeenCalled()
    const req = handler.mock.calls[0][0]
    expect(req.description).toBe("Force push в origin/main (перезапишет историю remote)")
    pm.resolveRequest(req.id, true, false)
    await checkPromise
  })

  it("saved deny overrides isSafeForArgs", async () => {
    pm.setPermission("git", "deny")
    const tool = {
      name: "git",
      isSafe: false,
      isSafeForArgs: () => true,
      execute: vi.fn(),
    } as any
    const result = await pm.checkPermission(tool, { operation: "status" })
    expect(result).toBe(false)
  })

  it("saved allow skips isSafeForArgs entirely", async () => {
    pm.setPermission("git", "allow")
    const tool = {
      name: "git",
      isSafe: false,
      isSafeForArgs: vi.fn(() => false),
      execute: vi.fn(),
    } as any
    const result = await pm.checkPermission(tool, { operation: "push" })
    expect(result).toBe(true)
    expect(tool.isSafeForArgs).not.toHaveBeenCalled()
  })
})

describe("PermissionManager — паттерны, .env, doom loop", () => {
  let pm: PermissionManager

  beforeEach(() => {
    pm = new PermissionManager()
  })

  const tool = (name: string, isSafe = false) =>
    ({ name, isSafe, execute: vi.fn() } as any)

  it("bash-паттерн allow: без запроса", async () => {
    pm.setPatternRules({ bash: [{ pattern: "npm test", level: "allow" }] })
    const handler = vi.fn()
    pm.onDidRequestPermission(handler)
    const result = await pm.checkPermission(tool("bash"), { command: "npm test -- --watch" })
    expect(result).toBe(true)
    expect(handler).not.toHaveBeenCalled()
  })

  it("bash-паттерн deny: даже при allow на инструмент", async () => {
    pm.setPermission("bash", "allow")
    pm.setPatternRules({ bash: [{ pattern: "rm *", level: "deny" }] })
    const result = await pm.checkPermission(tool("bash"), { command: "rm -rf build" })
    expect(result).toBe(false)
  })

  it("file-паттерн allow: без запроса", async () => {
    pm.setPatternRules({ files: [{ pattern: "src/**/*.ts", level: "allow" }] })
    const result = await pm.checkPermission(tool("edit_file"), { filepath: "src/a/b.ts" })
    expect(result).toBe(true)
  })

  it(".env: подтверждение даже при allow на инструмент", async () => {
    pm.setPermission("read_file", "allow")
    const checkPromise = pm.checkPermission(tool("read_file"), { filepath: ".env" }, 5000)
    const reqs = (pm as any).pendingRequests
    expect(reqs).toHaveLength(1)
    expect(reqs[0].description).toContain(".env")
    pm.resolveRequest(reqs[0].id, true, false)
    expect(await checkPromise).toBe(true)
  })

  it(".env.example: не защищён", async () => {
    pm.setPermission("read_file", "allow")
    const result = await pm.checkPermission(tool("read_file"), { filepath: ".env.example" })
    expect(result).toBe(true)
  })

  it("forceReason: подтверждение даже при allow", async () => {
    pm.setPermission("bash", "allow")
    const checkPromise = pm.checkPermission(tool("bash"), { command: "x" }, 5000, {
      forceReason: "Повторный одинаковый вызов bash (3 раза подряд) — возможное зацикливание",
    })
    const reqs = (pm as any).pendingRequests
    expect(reqs).toHaveLength(1)
    expect(reqs[0].description).toContain("зацикливание")
    pm.resolveRequest(reqs[0].id, true, false)
    expect(await checkPromise).toBe(true)
  })

  it("setPatternRules не затирает не переданные поля", () => {
    pm.setPatternRules({ bash: [{ pattern: "npm *", level: "allow" }] })
    expect(pm.getAutoApprove()).toBeDefined()
    // doomLoopLimit сохранён из дефолта
    expect((pm as any).patternRules.doomLoopLimit).toBe(3)
  })
})

describe("PermissionManager — persistence", () => {
  it("persists permissions to Memento on setPermission", () => {
    const memento = createMockMemento()
    const pm2 = new PermissionManager(memento)
    pm2.setPermission("bash", "allow")
    expect(memento.update).toHaveBeenCalledWith("neuralTowerAgent.permissions", { bash: "allow" })
  })

  it("persists permissions to Memento on resolveRequest with always=true", async () => {
    const memento = createMockMemento()
    const pm2 = new PermissionManager(memento)
    const checkPromise = pm2.checkPermission({ name: "bash", isSafe: false, execute: vi.fn() } as any, {}, 5000)
    const reqs = (pm2 as any).pendingRequests
    const req = reqs[0]
    pm2.resolveRequest(req.id, true, true)
    await checkPromise
    expect(memento.update).toHaveBeenCalledWith("neuralTowerAgent.permissions", { bash: "allow" })
  })

  it("does not persist permissions on resolveRequest with always=false", async () => {
    const memento = createMockMemento()
    const pm2 = new PermissionManager(memento)
    const checkPromise = pm2.checkPermission({ name: "bash", isSafe: false, execute: vi.fn() } as any, {}, 5000)
    const reqs = (pm2 as any).pendingRequests
    const req = reqs[0]
    pm2.resolveRequest(req.id, true, false)
    await checkPromise
    expect(memento.update).not.toHaveBeenCalled()
  })

  it("persists autoApprove to Memento on setAutoApprove", () => {
    const memento = createMockMemento()
    const pm2 = new PermissionManager(memento)
    pm2.setAutoApprove({ enabled: true, tools: ["bash"], maxCost: 100 })
    expect(memento.update).toHaveBeenCalledWith("neuralTowerAgent.autoApprove", {
      enabled: true,
      tools: ["bash"],
      maxCost: 100,
    })
  })

  it("persists empty object on clear", () => {
    const memento = createMockMemento()
    const pm2 = new PermissionManager(memento)
    pm2.setPermission("bash", "allow")
    memento.update.mockClear()
    pm2.clear()
    expect(memento.update).toHaveBeenCalledWith("neuralTowerAgent.permissions", {})
  })

  it("loads permissions from Memento on init", async () => {
    const memento = createMockMemento({
      "neuralTowerAgent.permissions": { bash: "allow", read: "deny" },
    })
    const pm2 = new PermissionManager(memento)
    await pm2.init()
    expect(pm2.getPermissionLevel("bash")).toBe("allow")
    expect(pm2.getPermissionLevel("read")).toBe("deny")
    expect(pm2.getPermissionLevel("unknown")).toBe("ask")
  })

  it("loads autoApprove from Memento on init", async () => {
    const memento = createMockMemento({
      "neuralTowerAgent.autoApprove": { enabled: true, tools: ["bash"], maxCost: 50 },
    })
    const pm2 = new PermissionManager(memento)
    await pm2.init()
    const cfg = pm2.getAutoApprove()
    expect(cfg.enabled).toBe(true)
    expect(cfg.tools).toContain("bash")
    expect(cfg.maxCost).toBe(50)
  })

  it("skips invalid levels when loading from Memento", async () => {
    const memento = createMockMemento({
      "neuralTowerAgent.permissions": { bash: "allow", read: "invalid" as any },
    })
    const pm2 = new PermissionManager(memento)
    await pm2.init()
    expect(pm2.getPermissionLevel("bash")).toBe("allow")
    expect(pm2.getPermissionLevel("read")).toBe("ask")
  })

  it("does not persist without Memento", () => {
    const pm2 = new PermissionManager()
    pm2.setPermission("bash", "allow")
    pm2.setAutoApprove({ enabled: true, tools: ["bash"], maxCost: 0 })
    pm2.clear()
    expect(pm2.getPermissionLevel("bash")).toBe("ask")
  })

  it("does not load without Memento on init", async () => {
    const pm2 = new PermissionManager()
    await pm2.init()
    expect(pm2.getPermissionLevel("bash")).toBe("ask")
  })

  it("permissions survive across new instance", async () => {
    const memento = createMockMemento()
    const pm1 = new PermissionManager(memento)
    pm1.setPermission("bash", "allow")
    pm1.setPermission("read", "deny")

    const pm2 = new PermissionManager(memento)
    await pm2.init()

    expect(pm2.getPermissionLevel("bash")).toBe("allow")
    expect(pm2.getPermissionLevel("read")).toBe("deny")
  })
})
