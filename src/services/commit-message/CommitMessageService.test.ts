import { describe, it, expect, vi, beforeEach } from "vitest"
import { CommitMessageService } from "./CommitMessageService"
import type { IBackend } from "../../core/IBackend"
import type { GitService } from "../git/GitService"

describe("CommitMessageService", () => {
  let backend: IBackend
  let gitService: GitService
  let service: CommitMessageService

  beforeEach(() => {
    vi.clearAllMocks()
    backend = {
      listModels: vi.fn().mockResolvedValue([]),
      healthCheck: vi.fn().mockResolvedValue(true),
      chat: vi.fn().mockResolvedValue({ role: "assistant", content: "feat: add feature" }),
      chatJson: vi.fn(),
      getConfig: vi.fn().mockResolvedValue({ url: "", model: "", maxRetries: 0, timeoutMs: 0 }),
      updateConfig: vi.fn().mockResolvedValue(undefined),
    }
    gitService = {
      getCachedDiff: vi.fn(),
    } as unknown as GitService
    service = new CommitMessageService(backend, gitService)
  })

  it("generates commit message", async () => {
    vi.mocked(gitService.getCachedDiff).mockResolvedValue("diff --git a/file.ts b/file.ts")
    const result = await service.generate("/work")
    expect(result).toBe("feat: add feature")
  })

  it("returns empty when no diff", async () => {
    vi.mocked(gitService.getCachedDiff).mockResolvedValue("")
    const result = await service.generate("/work")
    expect(result).toBe("")
  })

  it("uses fallback on backend error", async () => {
    vi.mocked(gitService.getCachedDiff).mockResolvedValue("diff --git a/file.ts b/file.ts\ndiff --git a/other.ts b/other.ts")
    backend.chat = vi.fn().mockRejectedValue(new Error("fail"))
    const result = await service.generate("/work")
    expect(result).toBe("chore: изменить 2 файл(ов)")
  })

  it("fallback with no files", async () => {
    vi.mocked(gitService.getCachedDiff).mockResolvedValue("some diff")
    backend.chat = vi.fn().mockRejectedValue(new Error("fail"))
    const result = await service.generate("/work")
    expect(result).toBe("chore: обновления")
  })

  it("clean removes code blocks", async () => {
    backend.chat = vi.fn().mockResolvedValue({ role: "assistant", content: "```md\nfeat: add\n```" })
    vi.mocked(gitService.getCachedDiff).mockResolvedValue("diff")
    const result = await service.generate("/work")
    expect(result).toBe("feat: add")
  })

  it("clean removes quotes", async () => {
    backend.chat = vi.fn().mockResolvedValue({ role: "assistant", content: '"feat: add"' })
    vi.mocked(gitService.getCachedDiff).mockResolvedValue("diff")
    const result = await service.generate("/work")
    expect(result).toBe("feat: add")
  })

  it("init and dispose are no-ops", async () => {
    await service.init()
    service.dispose()
  })
})
