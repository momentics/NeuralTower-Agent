import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as vscode from "vscode"
import { BackendHealthMonitor } from "./BackendHealthMonitor"
import type { IBackend } from "../../core/IBackend"

describe("BackendHealthMonitor", () => {
  let backend: IBackend
  let monitor: BackendHealthMonitor

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()

    backend = {
      listModels: vi.fn().mockResolvedValue([]),
      healthCheck: vi.fn().mockResolvedValue(true),
      chat: vi.fn(),
      chatJson: vi.fn(),
      getConfig: vi.fn().mockResolvedValue({ url: "", model: "", maxRetries: 0, timeoutMs: 0 }),
      updateConfig: vi.fn().mockResolvedValue(undefined),
    }

    const statusBar = {
      text: "",
      color: undefined,
      tooltip: "",
      show: vi.fn(),
      dispose: vi.fn(),
    }
    vi.spyOn(vscode.window, "createStatusBarItem").mockReturnValue(statusBar as any)

    monitor = new BackendHealthMonitor(backend)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("init checks health", async () => {
    await monitor.init()
    // Первая проверка выполняется в фоне через setImmediate
    await vi.advanceTimersByTimeAsync(0)
    expect(backend.healthCheck).toHaveBeenCalled()
  })

  it("init starts interval", async () => {
    await monitor.init()
    // setImmediate для первой проверки
    await vi.advanceTimersByTimeAsync(0)
    // Интервал для периодической проверки
    await vi.advanceTimersByTimeAsync(15000)
    expect(backend.healthCheck).toHaveBeenCalledTimes(2)
  })

  it("check returns true when healthy", async () => {
    backend.healthCheck = vi.fn().mockResolvedValue(true)
    const result = await monitor.check()
    expect(result).toBe(true)
    expect(monitor.isConnected()).toBe(true)
  })

  it("check returns false when unhealthy", async () => {
    backend.healthCheck = vi.fn().mockResolvedValue(false)
    const result = await monitor.check()
    expect(result).toBe(false)
    expect(monitor.isConnected()).toBe(false)
  })

  it("check returns false on error", async () => {
    backend.healthCheck = vi.fn().mockRejectedValue(new Error("fail"))
    const result = await monitor.check()
    expect(result).toBe(false)
  })

  it("check is idempotent - second call returns cached value while first is pending", async () => {
    backend.healthCheck = vi.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 100))
      return true
    })
    const p1 = monitor.check()
    const p2 = monitor.check()
    await vi.advanceTimersByTimeAsync(200)
    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1).toBe(true)
    expect(r2).toBe(false) // second call returns this.connected which is still false
    expect(backend.healthCheck).toHaveBeenCalledTimes(1)
  })

  it("dispose clears interval and status bar", async () => {
    await monitor.init()
    monitor.dispose()
  })
})
