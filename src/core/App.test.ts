import { describe, it, expect, vi, beforeEach } from "vitest"
import * as vscode from "vscode"
import { App } from "./App"
import type { IProvider } from "./IProvider"

describe("App", () => {
  let ctx: vscode.ExtensionContext

  beforeEach(() => {
    vi.clearAllMocks()
    ;(vscode.commands as any)._calls = []
    ctx = {
      extension: {
        packageJSON: { version: "1.0.0" },
      },
      subscriptions: [],
    } as unknown as vscode.ExtensionContext
  })

  it("registers provider and stores it", () => {
    const app = new App(ctx)
    const provider: IProvider = {
      viewType: "test",
      resolveWebviewView: vi.fn(),
      dispose: vi.fn(),
    } as unknown as IProvider
    app.registerProvider(provider)
    // Access private providers array to verify
    expect((app as any).providers).toHaveLength(1)
  })

  it("registers command", () => {
    const app = new App(ctx)
    const handler = vi.fn()
    app.registerCommand("test.cmd", handler)
    const calls = (vscode.commands as any)._calls
    expect(calls).toContainEqual(expect.objectContaining({ id: "test.cmd" }))
  })

  it("registers bound command", () => {
    const app = new App(ctx)
    const fn = vi.fn()
    app.registerBoundCommand("test.bound", fn)
    const calls = (vscode.commands as any)._calls
    expect(calls).toContainEqual(expect.objectContaining({ id: "test.bound" }))
  })

  it("init logs version", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    const app = new App(ctx)
    app.init()
    expect(logSpy).toHaveBeenCalledWith("[NeuralTower Agent] инициализация версии 1.0.0")
    logSpy.mockRestore()
  })

  it("dispose calls provider dispose and disposes disposables", () => {
    const disposeSpy = vi.fn()
    const provider: IProvider = {
      viewType: "test",
      resolveWebviewView: vi.fn(),
      dispose: disposeSpy,
    } as unknown as IProvider
    const app = new App(ctx)
    app.registerProvider(provider)
    app.dispose()
    expect(disposeSpy).toHaveBeenCalled()
  })

  it("dispose with unknown version", () => {
    ctx.extension.packageJSON = {} as any
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    const app = new App(ctx)
    app.init()
    expect(logSpy).toHaveBeenCalledWith("[NeuralTower Agent] инициализация версии неизвестно")
    logSpy.mockRestore()
  })
})
