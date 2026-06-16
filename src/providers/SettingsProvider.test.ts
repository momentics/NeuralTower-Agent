import { describe, it, expect, vi, beforeEach } from "vitest"
import { SettingsProvider } from "./SettingsProvider"
import type { IBackend } from "../core/IBackend"

const createMockBackend = (): IBackend => ({
  chat: vi.fn(async () => ({ role: "assistant", content: "ok", timestamp: Date.now() })),
  chatJson: vi.fn(async () => ({})),
  getConfig: vi.fn(async () => ({ url: "http://localhost:30000", model: "test-model", maxRetries: 3, timeoutMs: 60000 })),
  updateConfig: vi.fn(async () => {}),
  listModels: vi.fn(async () => ["test-model"]),
  healthCheck: vi.fn(async () => true),
})

describe("SettingsProvider", () => {
  let backend: IBackend

  beforeEach(() => {
    backend = createMockBackend()
    vi.clearAllMocks()
    ; (SettingsProvider as any).current = undefined
  })

  it("renders settings panel", () => {
    expect(() => {
      SettingsProvider.render({ fsPath: "/ext" } as any, backend)
    }).not.toThrow()
  })

  it("reveals existing panel on second render", () => {
    SettingsProvider.render({ fsPath: "/ext" } as any, backend)
    expect(() => {
      SettingsProvider.render({ fsPath: "/ext" } as any, backend)
    }).not.toThrow()
  })

  it("calls backend getConfig on render", async () => {
    SettingsProvider.render({ fsPath: "/ext" } as any, backend)
    await vi.waitFor(() => {
      expect(backend.getConfig).toHaveBeenCalled()
    })
  })

  it("calls backend listModels on render", async () => {
    SettingsProvider.render({ fsPath: "/ext" } as any, backend)
    await vi.waitFor(() => {
      expect(backend.listModels).toHaveBeenCalled()
    })
  })
})
