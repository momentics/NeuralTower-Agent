import { describe, it, expect } from "vitest"
import { makeRepoMapProvider } from "./repo-map"

describe("makeRepoMapProvider", () => {
  it("returns repo map", async () => {
    const provider = makeRepoMapProvider(
      () => "/work",
      () => ({
        findByPattern: () => [],
        findByLanguage: () => [],
        stats: () => ({ totalFiles: 10, languages: 2, totalSize: 5000 }),
      }),
      () => Promise.resolve({
        fileCount: 100,
        dirCount: 20,
        languages: { typescript: 80, json: 20 },
        buildSystems: ["npm"],
        topDirs: ["/work/src"],
        notableFiles: ["/work/package.json"],
      }),
    )
    const result = await provider.resolve("")
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain("Карта репозитория")
    expect(result[0].content).toContain("Файлов: 100")
    expect(result[0].content).toContain("typescript: 80")
  })
})
