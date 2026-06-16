import { describe, it, expect, vi, beforeEach } from "vitest"
import { NeuralTowerBackend } from "./NeuralTowerBackend"
import * as vscode from "vscode"

describe("NeuralTowerBackend", () => {
  let backend: NeuralTowerBackend
  let configMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    configMock = vi.fn().mockReturnValue({
      get: vi.fn().mockImplementation((_key: string, fallback: any) => fallback),
      update: vi.fn().mockResolvedValue(undefined),
    })
    ;(vscode.workspace.getConfiguration as any) = configMock
    backend = new NeuralTowerBackend()
  })

  it("getConfig returns defaults", async () => {
    const result = await backend.getConfig()
    expect(result.url).toBe("http://localhost:30000")
    expect(result.model).toBe("qwen3.6-27b")
    expect(result.maxRetries).toBe(3)
    expect(result.timeoutMs).toBe(60000)
  })

  it("updateConfig updates values", async () => {
    const updateSpy = vi.fn().mockResolvedValue(undefined)
    configMock.mockReturnValue({
      get: vi.fn(),
      update: updateSpy,
    })
    await backend.updateConfig({ url: "http://new", model: "new-model" })
    expect(updateSpy).toHaveBeenCalledWith("neuralTowerUrl", "http://new", true)
    expect(updateSpy).toHaveBeenCalledWith("model", "new-model", true)
  })

  it("listModels returns model ids", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        data: [{ id: "model1" }, { id: "model2" }],
      }),
    }))
    const result = await backend.listModels()
    expect(result).toEqual(["model1", "model2"])
    vi.unstubAllGlobals()
  })

  it("listModels returns empty on no data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({}),
    }))
    const result = await backend.listModels()
    expect(result).toEqual([])
    vi.unstubAllGlobals()
  })

  it("healthCheck returns true on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }))
    const result = await backend.healthCheck()
    expect(result).toBe(true)
    vi.unstubAllGlobals()
  })

  it("healthCheck returns false on error", async () => {
    configMock.mockReturnValue({
      get: vi.fn().mockImplementation((_key: string, fallback: any) => {
        if (_key === "maxRetries") return 0
        return fallback
      }),
      update: vi.fn().mockResolvedValue(undefined),
    })
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fail")))
    const result = await backend.healthCheck()
    expect(result).toBe(false)
    vi.unstubAllGlobals()
  })

  it("chat streams response", async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n',
      'data: {"choices":[{"delta":{"content":" World"}}]}\n',
      "data: [DONE]\n",
    ].join("")

    const reader = {
      read: vi.fn()
        .mockResolvedValueOnce({ done: false, value: Buffer.from(chunks) })
        .mockResolvedValueOnce({ done: true }),
      releaseLock: vi.fn(),
    }

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    }))

    const onChunk = vi.fn()
    const result = await backend.chat([{ role: "user", content: "hi" }], onChunk)

    expect(result.content).toBe("Hello World")
    expect(onChunk).toHaveBeenCalledTimes(2)
    vi.unstubAllGlobals()
  })

  it("chat throws on empty body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, body: null }))
    await expect(backend.chat([{ role: "user", content: "hi" }], () => {})).rejects.toThrow("Пустой ответ")
    vi.unstubAllGlobals()
  })

  it("chatJson returns parsed json", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [{ message: { content: '{"summary":"ok"}' } }],
      }),
    }))
    const result = await backend.chatJson<{ summary: string }>([{ role: "user", content: "hi" }])
    expect(result.summary).toBe("ok")
    vi.unstubAllGlobals()
  })

  it("chatJson throws on non-json", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [{ message: { content: "not json" } }],
      }),
    }))
    await expect(backend.chatJson<any>([{ role: "user", content: "hi" }])).rejects.toThrow("не-JSON")
    vi.unstubAllGlobals()
  })
})
