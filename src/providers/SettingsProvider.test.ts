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
  })

  it("shows settings panel", () => {
    const provider = new SettingsProvider({ fsPath: "/ext" } as any, backend)
    expect(() => {
      provider.show()
    }).not.toThrow()
  })

  it("reveals existing panel on second show", () => {
    const provider = new SettingsProvider({ fsPath: "/ext" } as any, backend)
    provider.show()
    expect(() => {
      provider.show()
    }).not.toThrow()
  })

  it("calls backend getConfig on show", async () => {
    const provider = new SettingsProvider({ fsPath: "/ext" } as any, backend)
    provider.show()
    await vi.waitFor(() => {
      expect(backend.getConfig).toHaveBeenCalled()
    })
  })

  it("calls backend listModels on show", async () => {
    const provider = new SettingsProvider({ fsPath: "/ext" } as any, backend)
    provider.show()
    await vi.waitFor(() => {
      expect(backend.listModels).toHaveBeenCalled()
    })
  })

  it("disposes resources", () => {
    const provider = new SettingsProvider({ fsPath: "/ext" } as any, backend)
    expect(() => {
      provider.dispose()
    }).not.toThrow()
  })
})
