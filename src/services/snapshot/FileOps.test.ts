import { describe, it, expect, vi, beforeEach } from "vitest"
import * as fs from "fs/promises"
import { removeFileWithRetry } from "./FileOps"

vi.mock("fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs/promises")>()
  return { ...actual, rm: vi.fn() }
})

const rmMock = vi.mocked(fs.rm)

describe("FileOps", () => {
  beforeEach(() => {
    rmMock.mockReset()
  })

  it("успешное удаление с первой попытки", async () => {
    rmMock.mockResolvedValueOnce(undefined)
    await expect(removeFileWithRetry("/tmp/file.txt")).resolves.toBeUndefined()
    expect(rmMock).toHaveBeenCalledTimes(1)
    expect(rmMock).toHaveBeenCalledWith("/tmp/file.txt", { force: true })
  })

  it("повтор при EBUSY: три попытки, затем успех", async () => {
    const busy = () => Object.assign(new Error("busy"), { code: "EBUSY" })
    rmMock.mockRejectedValueOnce(busy())
    rmMock.mockRejectedValueOnce(busy())
    rmMock.mockResolvedValueOnce(undefined)
    await expect(removeFileWithRetry("/tmp/file.txt")).resolves.toBeUndefined()
    expect(rmMock).toHaveBeenCalledTimes(3)
  })

  it("неповторяемая ошибка пробрасывается сразу", async () => {
    rmMock.mockRejectedValueOnce(
      Object.assign(new Error("no such file"), { code: "ENOENT" }),
    )
    await expect(removeFileWithRetry("/tmp/file.txt")).rejects.toThrow("no such file")
    expect(rmMock).toHaveBeenCalledTimes(1)
  })
})
