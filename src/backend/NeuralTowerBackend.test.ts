import { describe, it, expect, vi, beforeEach } from "vitest"
import { NeuralTowerBackend } from "./NeuralTowerBackend"

describe("NeuralTowerBackend", () => {
  let backend: NeuralTowerBackend
  let onConfigChangeSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    onConfigChangeSpy = vi.fn()
    backend = new NeuralTowerBackend(undefined, onConfigChangeSpy)
  })

  it("getConfig returns defaults", async () => {
    const result = await backend.getConfig()
    expect(result.url).toBe("http://localhost:30000")
    expect(result.model).toBe("qwen3.6-27b")
    expect(result.maxRetries).toBe(3)
    expect(result.timeoutMs).toBe(60000)
  })

  it("updateConfig calls onConfigChange callback", async () => {
    await backend.updateConfig({ url: "http://new", model: "new-model" })
    expect(onConfigChangeSpy).toHaveBeenCalledWith({ url: "http://new", model: "new-model" })
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
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fail")))
    const errorBackend = new NeuralTowerBackend({
      url: "http://localhost:30000",
      model: "test-model",
      maxRetries: 0,
      timeoutMs: 60000,
    })
    const result = await errorBackend.healthCheck()
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

  it("chat returns native tool_calls from backend", async () => {
    const argsJson = '{"path":"/test"}'
    const payload1 = JSON.stringify({ choices: [{ delta: { content: "Hello" } }] })
    const payload2 = JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "read", arguments: argsJson } }] } }] })
    const chunks = `data: ${payload1}\ndata: ${payload2}\ndata: [DONE]\n`

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
    const result = await backend.chat(
      [{ role: "user", content: "hi" }],
      onChunk,
      [{ name: "read", description: "Read a file", parameters: { parameters: { path: { type: "string" } }, required: ["path"] } }],
    )

    expect(result.content).toBe("Hello")
    expect(onChunk).toHaveBeenCalledTimes(1)
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls![0].id).toBe("call_1")
    expect(result.toolCalls![0].toolName).toBe("read")
    expect(result.toolCalls![0].arguments).toBe(argsJson)
    vi.unstubAllGlobals()
  })

  it("chat sends tools in request body", async () => {
    const chunks = [
      "data: [DONE]\n",
    ].join("")

    const reader = {
      read: vi.fn()
        .mockResolvedValueOnce({ done: false, value: Buffer.from(chunks) })
        .mockResolvedValueOnce({ done: true }),
      releaseLock: vi.fn(),
    }

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    })

    vi.stubGlobal("fetch", fetchMock)

    const tools = [{ name: "read", description: "Read a file", parameters: { parameters: { path: { type: "string" } }, required: ["path"] } }]
    await backend.chat([{ role: "user", content: "hi" }], () => {}, tools)

    const callArgs = fetchMock.mock.calls[0][1] as { body: string }
    const body = JSON.parse(callArgs.body)
    expect(body.tools).toHaveLength(1)
    expect(body.tools[0].type).toBe("function")
    expect(body.tools[0].function.name).toBe("read")
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
