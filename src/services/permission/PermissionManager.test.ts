import { describe, it, expect, vi, beforeEach } from "vitest"
import { PermissionManager } from "./PermissionManager"

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
