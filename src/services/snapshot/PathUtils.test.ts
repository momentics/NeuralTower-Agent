import { describe, it, expect } from "vitest"
import { isCaseInsensitivePlatform, pathKey, toPosix } from "./PathUtils"

describe("PathUtils", () => {
  it("toPosix converts backslashes to forward slashes", () => {
    expect(toPosix("a\\b\\c")).toBe("a/b/c")
    expect(toPosix("already/posix")).toBe("already/posix")
  })

  it("pathKey lowercases only on case-insensitive platforms", () => {
    if (isCaseInsensitivePlatform()) {
      expect(pathKey("A/B.TXT")).toBe("a/b.txt")
    } else {
      expect(pathKey("A/B.TXT")).toBe("A/B.TXT")
    }
  })

  it("pathKey normalizes slashes identically on both forms", () => {
    expect(pathKey("a\\B")).toBe(pathKey("a/B"))
  })
})
