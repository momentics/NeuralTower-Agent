import { describe, it, expect, vi, beforeEach } from "vitest"
import { NeuralTowerBackend } from "./NeuralTowerBackend"
import { DEFAULT_BACKEND_URL } from "../core/Config"
import { makeTestBackendConfig } from "../__tests__/fixtures"
import { BackendError, TimeoutError } from "../core/Errors"
import type { IChatMessage } from "../core/IBackend"

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
    expect(result.url).toBe(DEFAULT_BACKEND_URL)
    expect(result.model).toBe("qwen3.6-27b")
    expect(result.maxRetries).toBe(3)
    expect(result.timeoutMs).toBe(60000)
  })

  it("updateConfig calls onConfigChange callback", async () => {
    await backend.updateConfig({ url: "http://new", model: "new-model" })
    expect(onConfigChangeSpy).toHaveBeenCalledWith({ url: "http://new", model: "new-model" })
  })

  it("normalizes trailing slash in constructor", () => {
    const b = new NeuralTowerBackend(makeTestBackendConfig({ url: "http://localhost:3000/" }))
    expect(b.currentUrl()).toBe("http://localhost:3000")
  })

  it("normalizes trailing slash on updateConfig and persists canonical form", async () => {
    await backend.updateConfig({ url: "http://localhost:3000//" })
    expect(backend.currentUrl()).toBe("http://localhost:3000")
    expect(onConfigChangeSpy).toHaveBeenCalledWith({ url: "http://localhost:3000" })
  })

  it("currentUrl tracks the live url", async () => {
    expect(backend.currentUrl()).toBe(DEFAULT_BACKEND_URL)
    await backend.updateConfig({ url: "http://other:1234" })
    expect(backend.currentUrl()).toBe("http://other:1234")
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
    const errorBackend = new NeuralTowerBackend(makeTestBackendConfig({ maxRetries: 0 }))
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

  it("chat передаёт нативный протокол в тело запроса", async () => {
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

    const conversation: IChatMessage[] = [
      { role: "user", content: "hi", timestamp: 1 },
      {
        role: "assistant", content: "", timestamp: 2,
        toolCalls: [{ id: "c1", toolName: "read_file", arguments: '{"path":"x"}' }],
      },
      { role: "tool", toolCallId: "c1", name: "read_file", content: "ok", timestamp: 3 },
    ]
    await backend.chat(conversation, () => {})

    const callArgs = fetchMock.mock.calls[0][1] as { body: string }
    const body = JSON.parse(callArgs.body)
    const messages = body.messages as Array<Record<string, unknown>>
    const toolCalls = messages[1].tool_calls as Array<Record<string, unknown>>
    expect(messages[1].role).toBe("assistant")
    expect(messages[1].content).toBeNull()
    expect(toolCalls[0].id).toBe("c1")
    expect(toolCalls[0].type).toBe("function")
    expect(toolCalls[0].function).toEqual({ name: "read_file", arguments: '{"path":"x"}' })
    expect(messages[2].role).toBe("tool")
    expect(messages[2].tool_call_id).toBe("c1")
    expect(messages[2].name).toBe("read_file")
    expect(messages[2].content).toBe("ok")
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

  it("SSE: строка, разорванная на два чанка", async () => {
    const reader = {
      read: vi.fn()
        .mockResolvedValueOnce({ done: false, value: Buffer.from('data: {"choices":[{"delta":{"cont') })
        .mockResolvedValueOnce({ done: false, value: Buffer.from('ent":"Hello"}}]}\n\ndata: [DONE]\n') })
        .mockResolvedValueOnce({ done: true }),
      releaseLock: vi.fn(),
    }

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    }))

    const onChunk = vi.fn()
    const result = await backend.chat([{ role: "user", content: "hi" }], onChunk)

    expect(result.content).toBe("Hello")
    expect(onChunk).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })

  it("SSE: аргументы tool_calls, разорванные на чанки", async () => {
    const reader = {
      read: vi.fn()
        .mockResolvedValueOnce({
          done: false,
          value: Buffer.from('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"read_file","arguments":"{\\"pa'),
        })
        .mockResolvedValueOnce({
          done: false,
          value: Buffer.from('th\\":\\"/x\\"}"}}]}}]}\n\ndata: [DONE]\n'),
        })
        .mockResolvedValueOnce({ done: true }),
      releaseLock: vi.fn(),
    }

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    }))

    const result = await backend.chat([{ role: "user", content: "hi" }], () => {})

    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls![0].id).toBe("c1")
    expect(result.toolCalls![0].toolName).toBe("read_file")
    expect(JSON.parse(result.toolCalls![0].arguments)).toEqual({ path: "/x" })
    vi.unstubAllGlobals()
  })

  it("SSE: окончания строк \\r\\n", async () => {
    const chunks = 'data: {"choices":[{"delta":{"content":"Hi"}}]}\r\n\r\ndata: [DONE]\r\n'
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

    const result = await backend.chat([{ role: "user", content: "hi" }], () => {})
    expect(result.content).toBe("Hi")
    vi.unstubAllGlobals()
  })

  it("SSE: ошибка в потоке", async () => {
    const reader = {
      read: vi.fn()
        .mockResolvedValueOnce({ done: false, value: Buffer.from('data: {"error":{"message":"boom"}}\n') })
        .mockResolvedValueOnce({ done: true }),
      releaseLock: vi.fn(),
    }

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    }))

    await expect(backend.chat([{ role: "user", content: "hi" }], () => {})).rejects.toThrow("Ошибка бэкенда в потоке: boom")
    vi.unstubAllGlobals()
  })

  it("HTTP 400 не повторяется", async () => {
    const b = new NeuralTowerBackend(makeTestBackendConfig({ maxRetries: 3 }))
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => "invalid",
    })
    vi.stubGlobal("fetch", fetchMock)

    let caught: unknown
    try {
      await b.listModels()
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(BackendError)
    expect((caught as BackendError).message).toContain("HTTP 400")
    expect((caught as BackendError).message).not.toContain("Ошибка бэкенда")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })

  it("HTTP 500 повторяется, затем успех", async () => {
    const b = new NeuralTowerBackend(makeTestBackendConfig({ maxRetries: 2 }))
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => "err" })
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => "err" })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: '{"ok":1}' } }] }),
      })
    vi.stubGlobal("fetch", fetchMock)

    const result = await b.chatJson<{ ok: number }>([{ role: "user", content: "hi" }])
    expect(result).toEqual({ ok: 1 })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    vi.unstubAllGlobals()
  })

  it("chatJson отменяется по сигналу", async () => {
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted", "AbortError"))
        })
      }),
    ))
    const ac = new AbortController()
    setTimeout(() => ac.abort(), 50)
    await expect(backend.chatJson([{ role: "user", content: "hi", timestamp: 1 }], ac.signal)).rejects.toThrow()
    vi.unstubAllGlobals()
  })

  it("Idle-таймаут: поток без данных прерывается TimeoutError, а не отменой пользователя", async () => {
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) =>
      Promise.resolve({
        ok: true,
        body: {
          getReader: () => ({
            read: () => new Promise((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () => {
                reject(new DOMException("aborted", "AbortError"))
              })
            }),
            releaseLock: vi.fn(),
          }),
        },
      })),
    )
    const b = new NeuralTowerBackend(makeTestBackendConfig({ timeoutMs: 50, maxRetries: 0 }))
    await expect(b.chat([{ role: "user", content: "hi", timestamp: 1 }], () => {})).rejects.toBeInstanceOf(TimeoutError)
    vi.unstubAllGlobals()
  })
})
