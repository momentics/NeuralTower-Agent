import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { SnapshotStore } from "./SnapshotStore"
import type { ISnapshotRecord } from "./SnapshotTypes"

const DAY_MS = 86_400_000

function makeRecord(runId: string, overrides: Partial<ISnapshotRecord> = {}): ISnapshotRecord {
  return {
    runId,
    sessionId: "sess-1",
    hash: `hash-${runId}`,
    files: ["a.txt"],
    createdAt: Date.now(),
    ...overrides,
  }
}

describe("SnapshotStore", () => {
  let dir: string
  let ledgerPath: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "snapshot-store-"))
    ledgerPath = path.join(dir, "ledger.json")
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it("save persists record; new instance restores it", async () => {
    const store = new SnapshotStore(ledgerPath)
    const record = makeRecord("run-1")
    await store.save(record)

    const store2 = new SnapshotStore(ledgerPath)
    const loaded = await store2.get("run-1")
    expect(loaded).toEqual(record)
    // Файл на диске существует
    expect(await fs.stat(ledgerPath)).toBeDefined()
  })

  it("get returns null for unknown runId", async () => {
    const store = new SnapshotStore(ledgerPath)
    expect(await store.get("nope")).toBeNull()
  })

  it("upsert by runId replaces existing record", async () => {
    const store = new SnapshotStore(ledgerPath)
    await store.save(makeRecord("run-1", { files: ["a.txt"] }))
    await store.save(makeRecord("run-1", { files: ["b.txt"] }))
    const list = await store.listBySession("sess-1")
    expect(list).toHaveLength(1)
    expect(list[0].files).toEqual(["b.txt"])
  })

  it("повторное сохранение перезаписывает файл", async () => {
    const store = new SnapshotStore(ledgerPath)
    await store.save(makeRecord("run-1", { files: ["a.txt"] }))
    await store.save(makeRecord("run-1", { files: ["b.txt"] }))

    const store2 = new SnapshotStore(ledgerPath)
    const loaded = await store2.get("run-1")
    expect(loaded).not.toBeNull()
    expect(loaded!.files).toEqual(["b.txt"])
  })

  it("listBySession returns only session records sorted by createdAt desc", async () => {
    const store = new SnapshotStore(ledgerPath)
    await store.save(makeRecord("run-1", { sessionId: "sess-1", createdAt: 1000 }))
    await store.save(makeRecord("run-2", { sessionId: "sess-2", createdAt: 2000 }))
    await store.save(makeRecord("run-3", { sessionId: "sess-1", createdAt: 3000 }))
    const list = await store.listBySession("sess-1")
    expect(list.map((r) => r.runId)).toEqual(["run-3", "run-1"])
  })

  it("prune removes records older than retentionDays", async () => {
    const store = new SnapshotStore(ledgerPath)
    const now = Date.now()
    await store.save(makeRecord("old", { createdAt: now - 10 * DAY_MS }))
    await store.save(makeRecord("new", { createdAt: now - 1 * DAY_MS }))
    await store.prune(7)
    expect(await store.get("old")).toBeNull()
    expect(await store.get("new")).not.toBeNull()
  })

  it("corrupted JSON leads to empty ledger without exceptions", async () => {
    await fs.writeFile(ledgerPath, "{ not json", "utf-8")
    const store = new SnapshotStore(ledgerPath)
    expect(await store.get("run-1")).toBeNull()
    // Сохранение после повреждения работает
    await store.save(makeRecord("run-2"))
    expect(await store.get("run-2")).not.toBeNull()
  })

  it("invalid records are filtered out on load", async () => {
    await fs.writeFile(
      ledgerPath,
      JSON.stringify({ records: [{ broken: true }, makeRecord("run-ok")] }),
      "utf-8",
    )
    const store = new SnapshotStore(ledgerPath)
    expect(await store.get("run-ok")).not.toBeNull()
    expect((await store.listBySession("sess-1")).length).toBe(1)
  })

  it("records beyond cap: oldest are removed", async () => {
    const store = new SnapshotStore(ledgerPath, 3)
    for (let i = 0; i < 5; i++) {
      await store.save(makeRecord(`run-${i}`, { createdAt: 1000 + i }))
    }
    const list = await store.listBySession("sess-1")
    expect(list).toHaveLength(3)
    expect(list.map((r) => r.runId)).toEqual(["run-4", "run-3", "run-2"])
  })

  it("dispose stops accepting writes", async () => {
    const store = new SnapshotStore(ledgerPath)
    store.dispose()
    await store.save(makeRecord("run-1"))
    expect(await store.get("run-1")).toBeNull()
  })
})
