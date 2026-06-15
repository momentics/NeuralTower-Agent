import { vi } from "vitest"

// Mock crypto.randomBytes for webview HTML generation
vi.mock("crypto", () => ({
  default: {
    randomBytes: (n: number) => Buffer.alloc(n),
  },
  randomBytes: (n: number) => Buffer.alloc(n),
}))

// Mock fetch for network tests
vi.stubGlobal("fetch", vi.fn())
