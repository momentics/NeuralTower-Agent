import { describe, it, expect } from "vitest"
import {
  ParseWorkerPool,
  resolveParsePoolSize,
  resolveParseWorkerPath,
  WASM_WORKER_EXEC_ARGV,
  type ParsePoolWorker,
} from "./ParserWorkerPool"

// --- resolveParsePoolSize ---

describe("resolveParsePoolSize", () => {
  it("env=0 disables the pool", () => {
    expect(resolveParsePoolSize("0", 8)).toBe(0)
  })
  it("env value is clamped to [0, 16]", () => {
    expect(resolveParsePoolSize("2", 8)).toBe(2)
    expect(resolveParsePoolSize("99", 8)).toBe(16)
    expect(resolveParsePoolSize("-3", 8)).toBe(Math.max(1, Math.min(8 - 1, 8)))
  })
  it("default: min(cpus-1, 8), at least 1", () => {
    expect(resolveParsePoolSize(undefined, 8)).toBe(7)
    expect(resolveParsePoolSize(undefined, 16)).toBe(8)
    expect(resolveParsePoolSize(undefined, 2)).toBe(1)
  })
})

// --- mock-воркер ---

function createMockWorker() {
  const handlers: Record<string, Array<(...args: unknown[]) => void>> = {}
  const posted: unknown[] = []
  const worker = {
    postMessage: (msg: unknown) => posted.push(msg),
    terminate: () => Promise.resolve(0),
    on: (event: string, cb: (...args: unknown[]) => void) => {
      (handlers[event] ??= []).push(cb)
    },
  } as unknown as ParsePoolWorker
  return {
    worker,
    posted,
    emit: (event: string, ...args: unknown[]) => {
      for (const cb of handlers[event] ?? []) cb(...args)
    },
  }
}

describe("ParseWorkerPool (mock worker)", () => {
  it("loads grammars then parses via the worker", async () => {
    const mocks: ReturnType<typeof createMockWorker>[] = []
    const pool = new ParseWorkerPool({
      languages: ["typescript"],
      size: 1,
      createWorker: () => {
        const m = createMockWorker()
        mocks.push(m)
        // воркер сразу сообщает о готовности
        queueMicrotask(() => m.emit("message", { type: "grammars-loaded" }))
        return m.worker
      },
    })
    const handle = pool.requestParse({
      filePath: "a.ts",
      content: "export function a() { return 1; }",
      language: "typescript",
    })
    // ждём диспетчеризации
    await new Promise((r) => setTimeout(r, 20))
    const m = mocks[0]!
    const last = m.posted[m.posted.length - 1] as { type: string }
    expect(last.type).toBe("parse")
    m.emit("message", {
      type: "parse-result",
      id: (last as { id: number }).id,
      result: { nodes: [], edges: [], unresolvedReferences: [], errors: [], durationMs: 1 },
      parseMs: 1,
    })
    await expect(handle).resolves.toMatchObject({ nodes: [] })
    await pool.destroy()
  })

  it("rejects pending parses on destroy", async () => {
    const pool = new ParseWorkerPool({
      languages: ["typescript"],
      size: 1,
      createWorker: () => {
        const m = createMockWorker()
        queueMicrotask(() => m.emit("message", { type: "grammars-loaded" }))
        return m.worker
      },
    })
    const handle = pool.requestParse({
      filePath: "a.ts",
      content: "export function a() { return 1; }",
      language: "typescript",
    })
    await new Promise((r) => setTimeout(r, 20))
    await pool.destroy()
    await expect(handle).rejects.toThrow()
  })

  it("respawns worker after crash and rejects in-flight job", async () => {
    let spawned = 0
    const first = createMockWorker()
    const pool = new ParseWorkerPool({
      languages: ["typescript"],
      size: 1,
      createWorker: () => {
        spawned++
        if (spawned === 1) {
          queueMicrotask(() => first.emit("message", { type: "grammars-loaded" }))
          return first.worker
        }
        const m = createMockWorker()
        queueMicrotask(() => m.emit("message", { type: "grammars-loaded" }))
        return m.worker
      },
    })
    await new Promise((r) => setTimeout(r, 20))
    const handle = pool.requestParse({
      filePath: "a.ts",
      content: "export function a() { return 1; }",
      language: "typescript",
    })
    await new Promise((r) => setTimeout(r, 20))
    first.emit("error", new Error("boom"))
    await expect(handle).rejects.toThrow()
    expect(spawned).toBe(2)
    await pool.destroy()
  })
})

// --- реальный воркер (бандл из build:worker / pretest) ---

const realWorkerPath = resolveParseWorkerPath()

describe.skipIf(!realWorkerPath)("parser worker (real bundle)", () => {
  it("parses a TypeScript file in a worker thread", async () => {
    const pool = new ParseWorkerPool({
      languages: ["typescript"],
      size: 1,
      workerScriptPath: realWorkerPath!,
      workerExecArgv: WASM_WORKER_EXEC_ARGV,
    })
    const result = await pool.requestParse({
      filePath: "sample.ts",
      content: "export function hello(): string { return \"world\"; }\n",
      language: "typescript",
    })
    expect(result.errors.filter((e) => e.code === "parse_error")).toHaveLength(0)
    expect(result.nodes.some((n) => n.kind === "function" && n.name === "hello")).toBe(true)
    await pool.destroy()
  }, 30000)

  it("returns parse_error (not crash) when the language grammar was not loaded", async () => {
    const pool = new ParseWorkerPool({
      languages: ["typescript"],
      size: 1,
      workerScriptPath: realWorkerPath!,
      workerExecArgv: WASM_WORKER_EXEC_ARGV,
    })
    // ruby не входит в languages пула — его грамматика в воркере не
    // загружена, экстрактор обязан вернуть быстрый parse_error без узлов
    const result = await pool.requestParse({
      filePath: "sample.rb",
      content: "def foo\n  1\nend\n",
      language: "ruby",
    })
    expect(result.nodes).toHaveLength(0)
    expect(result.errors.some((e) => e.code === "parse_error")).toBe(true)
    await pool.destroy()
  }, 30000)
})
